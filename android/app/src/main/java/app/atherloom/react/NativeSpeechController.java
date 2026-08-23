package app.atherloom.react;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.webkit.WebView;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Locale;

/**
 * Owns one bounded Android speech-recognition session at a time.
 *
 * JavaScript starts and stops sessions through {@code AtherloomNative}. Results are emitted to
 * {@code window.AtherloomNativeVoice(callbackId, json)}. This class deliberately does not own TTS
 * or restart recognition automatically: the React voice adapter remains responsible for turn
 * orchestration, and a stalled device recognizer cannot create an unbounded restart loop.
 */
final class NativeSpeechController {
    private static final long SESSION_TIMEOUT_MS = 30_000L;
    private static final String DEFAULT_LANGUAGE = "zh-CN";

    private final MainActivity activity;
    private final WebView webView;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private SpeechRecognizer recognizer;
    private String activeCallbackId;
    private String pendingCallbackId;
    private String pendingLanguage = DEFAULT_LANGUAGE;
    private String resumeTerminalCallbackId;
    private String resumeTerminalCode;
    private String resumeTerminalMessage;
    private Runnable timeoutTask;
    private int generation;
    private boolean resumed;
    private boolean destroyed;

    NativeSpeechController(MainActivity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    String capabilities() {
        try {
            return new JSONObject()
                .put("available", SpeechRecognizer.isRecognitionAvailable(activity))
                .put("permission", activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                    == PackageManager.PERMISSION_GRANTED ? "granted" : "prompt")
                .put("adapter", "android-speech-recognizer")
                .put("language", DEFAULT_LANGUAGE)
                .toString();
        } catch (Exception error) {
            return "{\"available\":false,\"permission\":\"unknown\",\"adapter\":\"android-speech-recognizer\"}";
        }
    }

    void start(String callbackId, String languageTag) {
        runOnMain(() -> startOnMain(normalizeCallbackId(callbackId), normalizeLanguage(languageTag)));
    }

    void stop(String callbackId) {
        runOnMain(() -> stopOnMain(normalizeCallbackId(callbackId), "stopped", "语音识别已停止"));
    }

    void onRecordAudioPermissionResult(boolean granted) {
        runOnMain(() -> {
            if (destroyed || pendingCallbackId == null) return;
            if (!granted) {
                String callbackId = pendingCallbackId;
                clearPending();
                emitErrorAndEnd(callbackId, "permission_denied", "未授予麦克风权限");
                return;
            }
            startPendingIfReady();
        });
    }

    void onResume() {
        runOnMain(() -> {
            if (destroyed) return;
            resumed = true;
            replayPausedTerminalEvent();
            startPendingIfReady();
        });
    }

    void onPause(boolean permissionDialogOpen) {
        runOnMain(() -> {
            resumed = false;
            String pausedCallbackId = activeCallbackId;
            cancelActive("paused", "应用进入后台，语音识别已停止", true);
            rememberPausedTerminalEvent(pausedCallbackId);
            if (!permissionDialogOpen && pendingCallbackId != null) {
                String callbackId = pendingCallbackId;
                clearPending();
                emitEnd(callbackId, "paused", "应用进入后台，语音识别已停止");
                rememberPausedTerminalEvent(callbackId);
            }
        });
    }

    void destroy() {
        runOnMain(() -> {
            if (destroyed) return;
            destroyed = true;
            resumed = false;
            clearPausedTerminalEvent();
            clearPending();
            releaseRecognizer(true);
        });
    }

    private void startOnMain(String callbackId, String languageTag) {
        if (destroyed || callbackId.isEmpty()) return;
        if (!SpeechRecognizer.isRecognitionAvailable(activity)) {
            emitErrorAndEnd(callbackId, "unavailable", "这台设备没有可用的系统语音识别服务");
            return;
        }

        if (pendingCallbackId != null && !pendingCallbackId.equals(callbackId)) {
            String replaced = pendingCallbackId;
            clearPending();
            emitEnd(replaced, "replaced", "语音识别会话已被新会话替换");
        }
        cancelActive("replaced", "语音识别会话已被新会话替换", true);
        pendingCallbackId = callbackId;
        pendingLanguage = languageTag;

        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            activity.requestRecordAudioPermissionForSpeech();
            return;
        }
        startPendingIfReady();
    }

    private void startPendingIfReady() {
        if (destroyed || !resumed || pendingCallbackId == null) return;
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return;

        String callbackId = pendingCallbackId;
        String languageTag = pendingLanguage;
        clearPending();
        int sessionGeneration = ++generation;
        activeCallbackId = callbackId;

        try {
            recognizer = SpeechRecognizer.createSpeechRecognizer(activity);
            recognizer.setRecognitionListener(listenerFor(sessionGeneration, callbackId));
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, languageTag)
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
                .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
            recognizer.startListening(intent);
            scheduleTimeout(sessionGeneration, callbackId);
        } catch (Exception error) {
            releaseRecognizer(true);
            emitErrorAndEnd(callbackId, "start_failed", safeMessage(error, "系统语音识别启动失败"));
        }
    }

    private RecognitionListener listenerFor(int sessionGeneration, String callbackId) {
        return new RecognitionListener() {
            @Override
            public void onReadyForSpeech(Bundle params) {
                if (!isCurrent(sessionGeneration, callbackId)) return;
                emit(callbackId, event("ready", null, null, "正在听…"));
            }

            @Override public void onBeginningOfSpeech() { }
            @Override public void onRmsChanged(float rmsdB) { }
            @Override public void onBufferReceived(byte[] buffer) { }
            @Override public void onEndOfSpeech() { }

            @Override
            public void onError(int error) {
                if (!isCurrent(sessionGeneration, callbackId)) return;
                String code = errorCode(error);
                String message = errorMessage(error);
                releaseRecognizer(false);
                emitErrorAndEnd(callbackId, code, message);
            }

            @Override
            public void onResults(Bundle results) {
                if (!isCurrent(sessionGeneration, callbackId)) return;
                ArrayList<String> matches = results == null
                    ? null
                    : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                String transcript = matches == null || matches.isEmpty() ? "" : matches.get(0).trim();
                releaseRecognizer(false);
                if (transcript.isEmpty()) {
                    emitErrorAndEnd(callbackId, "no_match", "没有听清，请再说一次");
                    return;
                }
                emit(callbackId, event("result", transcript, null, null));
                emitEnd(callbackId, "completed", "语音识别已完成");
            }

            @Override public void onPartialResults(Bundle partialResults) { }
            @Override public void onEvent(int eventType, Bundle params) { }
        };
    }

    private void stopOnMain(String callbackId, String code, String message) {
        if (destroyed || callbackId.isEmpty()) return;
        if (callbackId.equals(pendingCallbackId)) {
            clearPending();
            emitEnd(callbackId, code, message);
            return;
        }
        if (!callbackId.equals(activeCallbackId)) return;
        cancelActive(code, message, true);
    }

    private void cancelActive(String code, String message, boolean emitEnd) {
        String callbackId = activeCallbackId;
        if (callbackId == null) return;
        releaseRecognizer(true);
        if (emitEnd) emitEnd(callbackId, code, message);
    }

    private void releaseRecognizer(boolean cancel) {
        cancelTimeout();
        SpeechRecognizer current = recognizer;
        recognizer = null;
        activeCallbackId = null;
        generation++;
        if (current == null) return;
        try {
            if (cancel) current.cancel();
        } catch (Exception ignored) {
            // Some vendor recognizers throw after their service process exits.
        }
        try {
            current.destroy();
        } catch (Exception ignored) {
            // Destruction is best-effort during Activity teardown.
        }
    }

    private void scheduleTimeout(int sessionGeneration, String callbackId) {
        cancelTimeout();
        timeoutTask = () -> {
            if (!isCurrent(sessionGeneration, callbackId)) return;
            releaseRecognizer(true);
            emitErrorAndEnd(callbackId, "timeout", "语音识别等待超时，请重试");
        };
        mainHandler.postDelayed(timeoutTask, SESSION_TIMEOUT_MS);
    }

    private void cancelTimeout() {
        if (timeoutTask != null) mainHandler.removeCallbacks(timeoutTask);
        timeoutTask = null;
    }

    private boolean isCurrent(int sessionGeneration, String callbackId) {
        return !destroyed
            && sessionGeneration == generation
            && callbackId.equals(activeCallbackId)
            && recognizer != null;
    }

    private void clearPending() {
        pendingCallbackId = null;
        pendingLanguage = DEFAULT_LANGUAGE;
    }

    private void rememberPausedTerminalEvent(String callbackId) {
        if (callbackId == null || callbackId.isEmpty()) return;
        resumeTerminalCallbackId = callbackId;
        resumeTerminalCode = "paused";
        resumeTerminalMessage = "应用进入后台，语音识别已停止";
    }

    private void replayPausedTerminalEvent() {
        String callbackId = resumeTerminalCallbackId;
        String code = resumeTerminalCode;
        String message = resumeTerminalMessage;
        clearPausedTerminalEvent();
        if (callbackId != null) emitEnd(callbackId, code, message);
    }

    private void clearPausedTerminalEvent() {
        resumeTerminalCallbackId = null;
        resumeTerminalCode = null;
        resumeTerminalMessage = null;
    }

    private void emitErrorAndEnd(String callbackId, String code, String message) {
        emit(callbackId, event("error", null, code, message));
        emitEnd(callbackId, code, message);
    }

    private void emitEnd(String callbackId, String code, String message) {
        emit(callbackId, event("end", null, code, message));
    }

    private JSONObject event(String type, String transcript, String code, String message) {
        JSONObject payload = new JSONObject();
        try {
            payload.put("type", type);
            if (transcript != null) payload.put("transcript", transcript);
            if (code != null) payload.put("code", code);
            if (message != null) payload.put("message", message);
        } catch (Exception ignored) {
            // All values are primitive strings; this is defensive for vendor JSON implementations.
        }
        return payload;
    }

    private void emit(String callbackId, JSONObject payload) {
        if (destroyed || callbackId == null || callbackId.isEmpty()) return;
        String script = "window.AtherloomNativeVoice&&window.AtherloomNativeVoice("
            + JSONObject.quote(callbackId) + "," + JSONObject.quote(payload.toString()) + ")";
        Runnable dispatch = () -> {
            if (!destroyed) webView.evaluateJavascript(script, null);
        };
        if (Looper.myLooper() == Looper.getMainLooper()) dispatch.run();
        else webView.post(dispatch);
    }

    private void runOnMain(Runnable action) {
        if (Looper.myLooper() == Looper.getMainLooper()) action.run();
        else mainHandler.post(action);
    }

    private static String normalizeCallbackId(String value) {
        if (value == null) return "";
        String normalized = value.trim();
        return normalized.length() > 200 ? normalized.substring(0, 200) : normalized;
    }

    private static String normalizeLanguage(String value) {
        if (value == null || value.trim().isEmpty()) return DEFAULT_LANGUAGE;
        String normalized = value.trim();
        if (normalized.length() > 35) return DEFAULT_LANGUAGE;
        Locale locale = Locale.forLanguageTag(normalized);
        return locale.getLanguage().isEmpty() ? DEFAULT_LANGUAGE : locale.toLanguageTag();
    }

    private static String safeMessage(Exception error, String fallback) {
        String message = error == null ? "" : error.getMessage();
        return message == null || message.trim().isEmpty() ? fallback : message.trim();
    }

    private static String errorCode(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_AUDIO: return "audio";
            case SpeechRecognizer.ERROR_CLIENT: return "client";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "permission_denied";
            case SpeechRecognizer.ERROR_NETWORK: return "network";
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: return "network_timeout";
            case SpeechRecognizer.ERROR_NO_MATCH: return "no_match";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "busy";
            case SpeechRecognizer.ERROR_SERVER: return "server";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "speech_timeout";
            default: return "unknown";
        }
    }

    private static String errorMessage(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_AUDIO: return "麦克风录音失败";
            case SpeechRecognizer.ERROR_CLIENT: return "语音识别会话已中断";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "未授予麦克风权限";
            case SpeechRecognizer.ERROR_NETWORK: return "语音识别网络不可用";
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: return "语音识别网络超时";
            case SpeechRecognizer.ERROR_NO_MATCH: return "没有听清，请再说一次";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "系统语音识别正忙，请稍后重试";
            case SpeechRecognizer.ERROR_SERVER: return "系统语音识别服务暂不可用";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "没有检测到语音";
            default: return "系统语音识别失败";
        }
    }
}
