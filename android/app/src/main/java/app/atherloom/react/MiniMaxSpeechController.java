package app.atherloom.react;

import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Secure Android-only MiniMax HTTP T2A adapter.
 *
 * API keys live only in EncryptedSharedPreferences. Callers choose a region identifier rather
 * than a URL so credentials can only be sent to MiniMax's fixed CN or global HTTPS host. Each
 * request owns its connection, temporary audio file, and MediaPlayer and can be canceled without
 * affecting the WebView or the next voice turn.
 */
final class MiniMaxSpeechController {
    private static final String SECURE_PREFS = "atherloom_react_voice_secrets";
    private static final String PROFILE_KEY = "minimax_voice_profile";
    private static final String CN_ENDPOINT = "https://api.minimaxi.com/v1/t2a_v2";
    private static final String GLOBAL_ENDPOINT = "https://api.minimax.io/v1/t2a_v2";
    private static final String DEFAULT_MODEL = "speech-2.8-turbo";
    private static final String DEFAULT_VOICE_ID = "male-qn-qingse";
    private static final int MAX_TEXT_CHARACTERS = 2_000;
    private static final int MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
    private static final int MAX_ERROR_BYTES = 256 * 1024;

    private final MainActivity activity;
    private final WebView webView;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ConcurrentHashMap<String, SpeechJob> jobs = new ConcurrentHashMap<>();
    private final SharedPreferences securePreferences;
    private final String secureStorageError;

    private volatile boolean destroyed;
    private boolean paused = true;
    private String resumeErrorCallbackId;

    MiniMaxSpeechController(MainActivity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        SharedPreferences encrypted = null;
        String encryptionError = "";
        try {
            MasterKey key = new MasterKey.Builder(activity)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build();
            encrypted = EncryptedSharedPreferences.create(
                activity,
                SECURE_PREFS,
                key,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            );
        } catch (Exception error) {
            encryptionError = safeMessage(error, "Android 加密存储初始化失败");
        }
        securePreferences = encrypted;
        secureStorageError = encryptionError;
    }

    String getVoiceProfile() {
        try {
            JSONObject profile = storedProfile();
            return new JSONObject()
                .put("ok", true)
                .put("profile", publicProfile(profile))
                .toString();
        } catch (Exception error) {
            return failure(safeMessage(error, "读取 MiniMax 语音设置失败"));
        }
    }

    String saveVoiceProfile(String raw) {
        try {
            requireSecureStorage();
            JSONObject incoming = new JSONObject(raw == null || raw.trim().isEmpty() ? "{}" : raw);
            JSONObject existing = storedProfile();
            JSONObject profile = normalizedProfile(incoming, existing, true);
            String apiKey = incoming.optString("api_key", "").trim();
            if (apiKey.isEmpty()) apiKey = existing.optString("api_key", "").trim();
            validateApiKey(apiKey);
            profile.put("api_key", apiKey);
            if (!securePreferences.edit().putString(PROFILE_KEY, profile.toString()).commit()) {
                throw new Exception("Android 未能写入 MiniMax 加密语音设置");
            }
            return new JSONObject()
                .put("ok", true)
                .put("profile", publicProfile(profile))
                .toString();
        } catch (Exception error) {
            return failure(safeMessage(error, "保存 MiniMax 语音设置失败"));
        }
    }

    void synthesizeSpeechAsync(String raw, String callbackId) {
        String normalizedCallbackId = normalizeCallbackId(callbackId);
        if (normalizedCallbackId.isEmpty()) return;

        final SpeechRequest request;
        try {
            request = buildRequest(raw);
        } catch (Exception error) {
            emitError(normalizedCallbackId, "invalid_request", safeMessage(error, "MiniMax 语音参数无效"), null);
            return;
        }

        runOnMain(() -> startSynthesis(request, normalizedCallbackId));
    }

    private void startSynthesis(SpeechRequest request, String callbackId) {
        if (destroyed) {
            emitError(callbackId, "destroyed", "语音服务已经关闭", null);
            return;
        }
        if (paused) {
            emitError(callbackId, "paused", "应用位于后台，不能开始语音播放", null);
            return;
        }
        cancelAll("replaced", "已由新的语音播放替换", true);
        SpeechJob job = new SpeechJob(callbackId);
        jobs.put(callbackId, job);
        emit(callbackId, event("started", "started", "正在请求 MiniMax 语音合成", null));
        Thread worker = new Thread(() -> runSynthesis(job, request), "atherloom-minimax-tts");
        job.worker = worker;
        worker.start();
    }

    void cancelSpeechSynthesis(String callbackId) {
        String normalized = normalizeCallbackId(callbackId);
        if (normalized.isEmpty()) return;
        runOnMain(() -> {
            SpeechJob job = jobs.get(normalized);
            if (job != null) cancelJob(job, "cancelled", "语音播放已取消", true);
        });
    }

    void onResume() {
        runOnMain(() -> {
            paused = false;
            String callbackId = resumeErrorCallbackId;
            resumeErrorCallbackId = null;
            if (callbackId != null && !destroyed) {
                emitError(callbackId, "paused", "应用进入后台，MiniMax 语音播放已停止", null);
            }
        });
    }

    void onPause() {
        runOnMain(() -> {
            paused = true;
            ArrayList<SpeechJob> active = new ArrayList<>(jobs.values());
            if (!active.isEmpty()) resumeErrorCallbackId = active.get(active.size() - 1).callbackId;
            for (SpeechJob job : active) {
                cancelJob(job, "paused", "应用进入后台，MiniMax 语音播放已停止", false);
                emitError(job.callbackId, "paused", "应用进入后台，MiniMax 语音播放已停止", job.traceId);
            }
        });
    }

    void destroy() {
        runOnMain(() -> {
            if (destroyed) return;
            destroyed = true;
            paused = true;
            resumeErrorCallbackId = null;
            cancelAll("destroyed", "语音服务已经关闭", false);
        });
    }

    private SpeechRequest buildRequest(String raw) throws Exception {
        requireSecureStorage();
        JSONObject incoming = new JSONObject(raw == null || raw.trim().isEmpty() ? "{}" : raw);
        JSONObject stored = storedProfile();
        JSONObject profile = normalizedProfile(incoming, stored, false);
        String apiKey = stored.optString("api_key", "").trim();
        validateApiKey(apiKey);

        String text = incoming.optString("text", "").trim();
        if (text.isEmpty()) throw new Exception("没有可朗读的文本");
        if (text.length() > MAX_TEXT_CHARACTERS) {
            throw new Exception("单次语音朗读不能超过 " + MAX_TEXT_CHARACTERS + " 个字符");
        }

        String region = profile.getString("region");
        String endpoint = "global".equals(region) ? GLOBAL_ENDPOINT : CN_ENDPOINT;
        JSONObject payload = new JSONObject()
            .put("model", profile.getString("model"))
            .put("text", text)
            .put("stream", false)
            .put("language_boost", languageBoost(incoming.optString("language", "")))
            .put("output_format", "hex")
            .put("voice_setting", new JSONObject()
                .put("voice_id", profile.getString("voice_id"))
                .put("speed", profile.getDouble("speed"))
                .put("vol", profile.getDouble("volume"))
                .put("pitch", profile.getInt("pitch")))
            .put("audio_setting", new JSONObject()
                .put("sample_rate", 32_000)
                .put("bitrate", 128_000)
                .put("format", "mp3")
                .put("channel", 1));
        return new SpeechRequest(endpoint, apiKey, payload.toString());
    }

    private void runSynthesis(SpeechJob job, SpeechRequest request) {
        HttpURLConnection connection = null;
        String traceId = null;
        try {
            if (!isCurrent(job)) return;
            byte[] body = request.payload.getBytes(StandardCharsets.UTF_8);
            connection = (HttpURLConnection) new URL(request.endpoint).openConnection();
            job.connection = connection;
            if (!isCurrent(job)) return;
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(90_000);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(body.length);
            connection.setRequestProperty("Authorization", "Bearer " + request.apiKey);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Accept", "application/json");
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body);
            }

            int status = connection.getResponseCode();
            boolean httpSuccess = status >= 200 && status < 300;
            long contentLength = connection.getContentLengthLong();
            int responseLimit = httpSuccess ? MAX_RESPONSE_BYTES : MAX_ERROR_BYTES;
            if (contentLength > responseLimit) throw new SpeechFailure("response_too_large", "MiniMax 响应过大，已停止处理", null);
            String responseText = readBounded(
                httpSuccess ? connection.getInputStream() : connection.getErrorStream(),
                responseLimit
            );
            JSONObject response;
            try {
                response = responseText.isEmpty() ? new JSONObject() : new JSONObject(responseText);
            } catch (Exception malformed) {
                if (!httpSuccess) throw new SpeechFailure("http_" + status, "MiniMax HTTP " + status, null);
                throw new SpeechFailure("invalid_response", "MiniMax 返回了无法解析的响应", null);
            }
            traceId = normalizedTraceId(response.optString("trace_id", ""));
            job.traceId = traceId;
            JSONObject baseResponse = response.optJSONObject("base_resp");
            int serviceCode = baseResponse == null ? -1 : baseResponse.optInt("status_code", -1);
            String serviceMessage = baseResponse == null ? "" : baseResponse.optString("status_msg", "");
            if (!httpSuccess) {
                throw new SpeechFailure("http_" + status, serviceMessage.isEmpty() ? "MiniMax HTTP " + status : serviceMessage, traceId);
            }
            if (baseResponse == null || serviceCode != 0) {
                throw new SpeechFailure("minimax_" + serviceCode, serviceMessage.isEmpty() ? "MiniMax 语音合成失败" : serviceMessage, traceId);
            }
            if (traceId == null) throw new SpeechFailure("invalid_response", "MiniMax 响应缺少 trace_id", null);
            JSONObject data = response.optJSONObject("data");
            String audioHex = data == null ? "" : data.optString("audio", "").trim();
            if (audioHex.isEmpty()) throw new SpeechFailure("empty_audio", "MiniMax 没有返回音频", traceId);
            byte[] audio = decodeHex(audioHex);
            if (!isCurrent(job)) return;

            File audioFile = File.createTempFile("atherloom-minimax-", ".mp3", activity.getCacheDir());
            job.audioFile = audioFile;
            try (FileOutputStream output = new FileOutputStream(audioFile)) {
                output.write(audio);
            }
            if (!isCurrent(job)) {
                cleanupFile(job);
                return;
            }
            startPlayback(job, traceId);
        } catch (SpeechFailure error) {
            finishError(job, error.code, safeMessage(error, "MiniMax 语音合成失败"), error.traceId);
        } catch (Exception error) {
            finishError(job, "request_failed", safeMessage(error, "MiniMax 语音合成失败"), traceId);
        } finally {
            job.connection = null;
            if (connection != null) connection.disconnect();
        }
    }

    private void startPlayback(SpeechJob job, String traceId) {
        runOnMain(() -> {
            if (!isCurrent(job) || job.audioFile == null) {
                cleanupFile(job);
                return;
            }
            try {
                MediaPlayer player = new MediaPlayer();
                job.player = player;
                player.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build());
                player.setDataSource(job.audioFile.getAbsolutePath());
                player.setOnPreparedListener(prepared -> {
                    if (!isCurrent(job)) {
                        releasePlayer(job);
                        cleanupFile(job);
                        return;
                    }
                    try {
                        prepared.start();
                    } catch (Exception error) {
                        finishError(job, "playback_failed", safeMessage(error, "MiniMax 音频播放失败"), traceId);
                    }
                });
                player.setOnCompletionListener(completed -> finishSuccess(job, traceId));
                player.setOnErrorListener((failed, what, extra) -> {
                    finishError(job, "playback_" + what, "MiniMax 音频播放失败", traceId);
                    return true;
                });
                player.prepareAsync();
            } catch (Exception error) {
                finishError(job, "playback_failed", safeMessage(error, "MiniMax 音频播放失败"), traceId);
            }
        });
    }

    private void finishSuccess(SpeechJob job, String traceId) {
        runOnMain(() -> {
            if (!jobs.remove(job.callbackId, job)) return;
            job.cancelled = true;
            releasePlayer(job);
            cleanupFile(job);
            emit(job.callbackId, event("end", "completed", "MiniMax 语音播放完成", traceId));
        });
    }

    private void finishError(SpeechJob job, String code, String message, String traceId) {
        runOnMain(() -> {
            if (job.cancelled || destroyed || !jobs.remove(job.callbackId, job)) return;
            job.cancelled = true;
            disconnect(job);
            releasePlayer(job);
            cleanupFile(job);
            emitError(job.callbackId, code, message, traceId);
        });
    }

    private void cancelAll(String code, String message, boolean emitEnd) {
        for (SpeechJob job : new ArrayList<>(jobs.values())) cancelJob(job, code, message, emitEnd);
    }

    private void cancelJob(SpeechJob job, String code, String message, boolean emitEnd) {
        if (!jobs.remove(job.callbackId, job)) return;
        job.cancelled = true;
        disconnect(job);
        Thread worker = job.worker;
        if (worker != null) worker.interrupt();
        runOnMain(() -> {
            releasePlayer(job);
            cleanupFile(job);
            if (emitEnd && !destroyed) emit(job.callbackId, event("end", code, message, job.traceId));
        });
    }

    private static void disconnect(SpeechJob job) {
        HttpURLConnection connection = job.connection;
        job.connection = null;
        if (connection != null) connection.disconnect();
    }

    private static void releasePlayer(SpeechJob job) {
        MediaPlayer player = job.player;
        job.player = null;
        if (player == null) return;
        try { player.setOnPreparedListener(null); } catch (Exception ignored) { }
        try { player.setOnCompletionListener(null); } catch (Exception ignored) { }
        try { player.setOnErrorListener(null); } catch (Exception ignored) { }
        try {
            player.release();
        } catch (Exception ignored) {
            // Vendor MediaPlayer implementations may already have released their native state.
        }
    }

    private static void cleanupFile(SpeechJob job) {
        File file = job.audioFile;
        job.audioFile = null;
        if (file != null && file.exists()) {
            try {
                file.delete();
            } catch (SecurityException ignored) {
                // Cache cleanup is best-effort; Android can reclaim the cache later.
            }
        }
    }

    private boolean isCurrent(SpeechJob job) {
        return !destroyed && !job.cancelled && jobs.get(job.callbackId) == job;
    }

    private JSONObject storedProfile() throws Exception {
        requireSecureStorage();
        String raw = securePreferences.getString(PROFILE_KEY, "");
        JSONObject stored = raw == null || raw.trim().isEmpty() ? new JSONObject() : new JSONObject(raw);
        return normalizedProfile(stored, new JSONObject(), false).put("api_key", stored.optString("api_key", ""));
    }

    private JSONObject normalizedProfile(JSONObject source, JSONObject fallback, boolean requireVoiceId) throws Exception {
        String region = source.has("region") ? source.optString("region", "") : fallback.optString("region", "cn");
        if (!("cn".equals(region) || "global".equals(region))) throw new Exception("MiniMax 服务区域无效");

        String model = source.has("model") ? source.optString("model", "") : fallback.optString("model", DEFAULT_MODEL);
        if (!isAllowedModel(model)) throw new Exception("MiniMax 语音模型无效");

        String voiceId = source.has("voice_id")
            ? source.optString("voice_id", "").trim()
            : fallback.optString("voice_id", DEFAULT_VOICE_ID).trim();
        if (voiceId.isEmpty()) {
            if (requireVoiceId) throw new Exception("请填写 MiniMax voice_id");
            voiceId = DEFAULT_VOICE_ID;
        }
        if (voiceId.length() > 256 || containsControlCharacter(voiceId)) throw new Exception("MiniMax voice_id 无效");

        double speed = numeric(source, fallback, "speed", 1);
        double volume = numeric(source, fallback, "volume", 1);
        int pitch = (int) Math.round(numeric(source, fallback, "pitch", 0));
        if (speed < 0.5 || speed > 2) throw new Exception("MiniMax 语速须在 0.5 到 2 之间");
        if (volume < 0 || volume > 10) throw new Exception("MiniMax 音量须在 0 到 10 之间");
        if (pitch < -12 || pitch > 12) throw new Exception("MiniMax 音高须在 -12 到 12 之间");

        return new JSONObject()
            .put("region", region)
            .put("model", model)
            .put("voice_id", voiceId)
            .put("speed", speed)
            .put("volume", volume)
            .put("pitch", pitch);
    }

    private static double numeric(JSONObject source, JSONObject fallback, String name, double defaultValue) throws Exception {
        Object value = source.has(name) ? source.opt(name) : fallback.opt(name);
        if (value == null || JSONObject.NULL.equals(value)) return defaultValue;
        double numeric;
        try {
            numeric = value instanceof Number ? ((Number) value).doubleValue() : Double.parseDouble(value.toString());
        } catch (Exception error) {
            throw new Exception("MiniMax " + name + " 参数无效");
        }
        if (Double.isNaN(numeric) || Double.isInfinite(numeric)) throw new Exception("MiniMax " + name + " 参数无效");
        return numeric;
    }

    private static JSONObject publicProfile(JSONObject profile) throws Exception {
        return new JSONObject()
            .put("region", profile.optString("region", "cn"))
            .put("model", profile.optString("model", DEFAULT_MODEL))
            .put("voice_id", profile.optString("voice_id", DEFAULT_VOICE_ID))
            .put("speed", profile.optDouble("speed", 1))
            .put("volume", profile.optDouble("volume", 1))
            .put("pitch", profile.optInt("pitch", 0))
            .put("has_api_key", !profile.optString("api_key", "").trim().isEmpty());
    }

    private void requireSecureStorage() throws Exception {
        if (securePreferences == null) {
            throw new Exception("Android 加密存储不可用" + (secureStorageError.isEmpty() ? "" : "：" + secureStorageError));
        }
    }

    private static void validateApiKey(String apiKey) throws Exception {
        if (apiKey == null || apiKey.trim().isEmpty()) throw new Exception("请填写 MiniMax API Key");
        if (apiKey.length() > 4_096 || apiKey.indexOf('\r') >= 0 || apiKey.indexOf('\n') >= 0) {
            throw new Exception("MiniMax API Key 格式无效");
        }
    }

    private static boolean isAllowedModel(String model) {
        return "speech-2.8-turbo".equals(model)
            || "speech-2.8-hd".equals(model)
            || "speech-2.6-turbo".equals(model)
            || "speech-2.6-hd".equals(model);
    }

    private static boolean containsControlCharacter(String value) {
        for (int index = 0; index < value.length(); index++) {
            if (Character.isISOControl(value.charAt(index))) return true;
        }
        return false;
    }

    private static String languageBoost(String languageTag) {
        String language = languageTag == null ? "" : languageTag.trim().toLowerCase();
        if (language.startsWith("zh-hk") || language.startsWith("zh-yue") || language.startsWith("yue")) return "Chinese,Yue";
        if (language.startsWith("zh")) return "Chinese";
        if (language.startsWith("en")) return "English";
        if (language.startsWith("ja")) return "Japanese";
        return "auto";
    }

    private static byte[] decodeHex(String value) throws Exception {
        if ((value.length() & 1) != 0) throw new Exception("MiniMax 返回了损坏的音频数据");
        int byteCount = value.length() / 2;
        if (byteCount == 0 || byteCount > MAX_RESPONSE_BYTES / 2) throw new Exception("MiniMax 返回的音频大小异常");
        byte[] output = new byte[byteCount];
        for (int index = 0; index < byteCount; index++) {
            if ((index & 0x3fff) == 0 && Thread.currentThread().isInterrupted()) {
                throw new InterruptedException("MiniMax 请求已取消");
            }
            int high = Character.digit(value.charAt(index * 2), 16);
            int low = Character.digit(value.charAt(index * 2 + 1), 16);
            if (high < 0 || low < 0) throw new Exception("MiniMax 返回了损坏的音频数据");
            output[index] = (byte) ((high << 4) | low);
        }
        return output;
    }

    private static String readBounded(InputStream stream, int maximumBytes) throws Exception {
        if (stream == null) return "";
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8_192];
            int total = 0;
            int count;
            while ((count = input.read(buffer)) != -1) {
                total += count;
                if (total > maximumBytes) throw new Exception("MiniMax 响应过大，已停止处理");
                output.write(buffer, 0, count);
                if (Thread.currentThread().isInterrupted()) throw new InterruptedException("MiniMax 请求已取消");
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static String normalizedTraceId(String value) {
        String traceId = value == null ? "" : value.trim();
        if (traceId.isEmpty() || traceId.length() > 256 || containsControlCharacter(traceId)) return null;
        return traceId;
    }

    private static String normalizeCallbackId(String value) {
        if (value == null) return "";
        String normalized = value.trim();
        return normalized.length() > 200 ? normalized.substring(0, 200) : normalized;
    }

    private JSONObject event(String type, String code, String message, String traceId) {
        JSONObject payload = new JSONObject();
        try {
            payload.put("type", type);
            if (code != null) payload.put("code", code);
            if (message != null) payload.put("message", message);
            if (traceId != null) payload.put("trace_id", traceId);
        } catch (Exception ignored) {
            // All values are primitive strings.
        }
        return payload;
    }

    private void emitError(String callbackId, String code, String message, String traceId) {
        emit(callbackId, event("error", code, message, traceId));
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

    private static String failure(String message) {
        try {
            return new JSONObject().put("ok", false).put("error", message).toString();
        } catch (Exception ignored) {
            return "{\"ok\":false,\"error\":\"MiniMax 语音设置失败\"}";
        }
    }

    private static String safeMessage(Exception error, String fallback) {
        String message = error == null ? "" : error.getMessage();
        if (message == null || message.trim().isEmpty()) return fallback;
        String normalized = message.trim();
        return normalized.length() > 300 ? normalized.substring(0, 300) : normalized;
    }

    private static final class SpeechRequest {
        final String endpoint;
        final String apiKey;
        final String payload;

        SpeechRequest(String endpoint, String apiKey, String payload) {
            this.endpoint = endpoint;
            this.apiKey = apiKey;
            this.payload = payload;
        }
    }

    private static final class SpeechJob {
        final String callbackId;
        volatile boolean cancelled;
        volatile Thread worker;
        volatile HttpURLConnection connection;
        volatile MediaPlayer player;
        volatile File audioFile;
        volatile String traceId;

        SpeechJob(String callbackId) {
            this.callbackId = callbackId;
        }
    }

    private static final class SpeechFailure extends Exception {
        final String code;
        final String traceId;

        SpeechFailure(String code, String message, String traceId) {
            super(message);
            this.code = code;
            this.traceId = traceId;
        }
    }
}
