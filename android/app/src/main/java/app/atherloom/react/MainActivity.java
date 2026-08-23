package app.atherloom.react;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.webkit.WebViewAssetLoader;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public class MainActivity extends Activity {
    private static final int REQUEST_OPEN_FILE = 4101;
    private static final int REQUEST_SAVE_FILE = 4102;
    private static final int REQUEST_RECORD_AUDIO = 4103;
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private WebView webView;
    private NativeBridge nativeBridge;
    private NativeSpeechController speechController;
    private MiniMaxSpeechController miniMaxSpeechController;
    private ValueCallback<Uri[]> fileChooserCallback;
    private PermissionRequest pendingMediaPermission;
    private byte[] pendingSaveData;
    private String pendingSaveCallbackId;
    private boolean recordAudioPermissionInFlight;
    private boolean destroyed;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        webView = new WebView(this);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        setContentView(webView);
        configureWebView();
        webView.loadUrl("https://appassets.androidplatform.net/assets/index.html");
    }

    private void configureWebView() {
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
            .build();
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        speechController = new NativeSpeechController(this, webView);
        miniMaxSpeechController = new MiniMaxSpeechController(this, webView);
        nativeBridge = new NativeBridge(this, webView, speechController, miniMaxSpeechController);
        webView.addJavascriptInterface(nativeBridge, "AtherloomNative");
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
                fileChooserCallback = callback;
                Intent intent = params.createIntent();
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                try {
                    startActivityForResult(intent, REQUEST_OPEN_FILE);
                    return true;
                } catch (Exception error) {
                    fileChooserCallback = null;
                    callback.onReceiveValue(null);
                    return false;
                }
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> handleMediaPermissionRequest(request));
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                runOnUiThread(() -> {
                    if (pendingMediaPermission == request) pendingMediaPermission = null;
                });
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isTrustedAssetNavigation(uri)) return false;
                if (!request.isForMainFrame()) return true;
                String scheme = uri == null ? "" : uri.getScheme();
                if (!("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))) return true;
                try {
                    Intent external = new Intent(Intent.ACTION_VIEW, uri);
                    external.addCategory(Intent.CATEGORY_BROWSABLE);
                    startActivity(external);
                } catch (Exception ignored) {
                    // A missing browser must not make an external link crash the WebView shell.
                }
                return true;
            }
        });
    }

    private static boolean isTrustedAssetNavigation(Uri uri) {
        if (uri == null
            || !"https".equalsIgnoreCase(uri.getScheme())
            || !ASSET_HOST.equalsIgnoreCase(uri.getHost())
            || !(uri.getPort() == -1 || uri.getPort() == 443)) return false;
        String path = uri.getPath();
        return path != null && path.startsWith("/assets/");
    }

    void requestRecordAudioPermissionForSpeech() {
        runOnUiThread(() -> {
            if (destroyed || isFinishing()) {
                if (speechController != null) speechController.onRecordAudioPermissionResult(false);
                return;
            }
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                if (speechController != null) speechController.onRecordAudioPermissionResult(true);
                return;
            }
            requestRecordAudioPermissionIfNeeded();
        });
    }

    private void requestRecordAudioPermissionIfNeeded() {
        if (recordAudioPermissionInFlight) return;
        recordAudioPermissionInFlight = true;
        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQUEST_RECORD_AUDIO);
    }

    private void handleMediaPermissionRequest(PermissionRequest request) {
        if (destroyed || isFinishing() || !isTrustedAssetRequest(request) || !requestsAudioCapture(request)) {
            denyMediaPermission(request);
            return;
        }
        if (pendingMediaPermission != null && pendingMediaPermission != request) {
            denyMediaPermission(pendingMediaPermission);
        }
        pendingMediaPermission = request;
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            grantPendingAudioPermission();
            return;
        }
        requestRecordAudioPermissionIfNeeded();
    }

    private static boolean isTrustedAssetRequest(PermissionRequest request) {
        Uri origin = request == null ? null : request.getOrigin();
        return origin != null
            && "https".equalsIgnoreCase(origin.getScheme())
            && ASSET_HOST.equalsIgnoreCase(origin.getHost())
            && (origin.getPort() == -1 || origin.getPort() == 443);
    }

    private static boolean requestsAudioCapture(PermissionRequest request) {
        if (request == null) return false;
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) return true;
        }
        return false;
    }

    private void grantPendingAudioPermission() {
        PermissionRequest request = pendingMediaPermission;
        pendingMediaPermission = null;
        if (request == null || destroyed || !requestsAudioCapture(request)) return;
        try {
            request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } catch (IllegalStateException ignored) {
            // Chromium may cancel the request while the Android permission dialog is open.
        }
    }

    private static void denyMediaPermission(PermissionRequest request) {
        if (request == null) return;
        try {
            request.deny();
        } catch (IllegalStateException ignored) {
            // A canceled Chromium request is already denied and must not crash the activity.
        }
    }

    private void denyPendingMediaPermission() {
        PermissionRequest request = pendingMediaPermission;
        pendingMediaPermission = null;
        denyMediaPermission(request);
    }

    private void requestFileSave(String fileName, String mimeType, String base64, String callbackId) {
        runOnUiThread(() -> {
            try {
                if (pendingSaveCallbackId != null) emitFileResult(pendingSaveCallbackId, false, "上一个文件还没有保存完成");
                pendingSaveData = Base64.decode(base64, Base64.DEFAULT);
                pendingSaveCallbackId = callbackId;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(mimeType == null || mimeType.isEmpty() ? "application/octet-stream" : mimeType);
                intent.putExtra(Intent.EXTRA_TITLE, fileName);
                startActivityForResult(intent, REQUEST_SAVE_FILE);
            } catch (Exception error) {
                pendingSaveData = null;
                pendingSaveCallbackId = null;
                emitFileResult(callbackId, false, error.getMessage());
            }
        });
    }

    private void emitFileResult(String callbackId, boolean ok, String message) {
        if (callbackId == null || callbackId.isEmpty() || webView == null) return;
        try {
            String result = new JSONObject().put("ok", ok).put(ok ? "message" : "error", message == null ? "" : message).toString();
            String script = "window.AtherloomNativeFile&&window.AtherloomNativeFile("
                + JSONObject.quote(callbackId) + "," + JSONObject.quote(result) + ")";
            webView.post(() -> webView.evaluateJavascript(script, null));
        } catch (Exception ignored) {
            // JSONObject with string fields should not fail; there is no safer callback channel here.
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_OPEN_FILE) {
            ValueCallback<Uri[]> callback = fileChooserCallback;
            fileChooserCallback = null;
            if (callback != null) callback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            return;
        }
        if (requestCode != REQUEST_SAVE_FILE) return;
        String callbackId = pendingSaveCallbackId;
        byte[] content = pendingSaveData;
        pendingSaveCallbackId = null;
        pendingSaveData = null;
        if (resultCode != RESULT_OK || data == null || data.getData() == null || content == null) {
            emitFileResult(callbackId, false, "已取消保存");
            return;
        }
        try (OutputStream output = getContentResolver().openOutputStream(data.getData())) {
            if (output == null) throw new Exception("系统没有提供可写入的文件位置");
            output.write(content);
            emitFileResult(callbackId, true, "文件已保存");
        } catch (Exception error) {
            emitFileResult(callbackId, false, error.getMessage());
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQUEST_RECORD_AUDIO) return;
        recordAudioPermissionInFlight = false;
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (granted) {
            grantPendingAudioPermission();
        } else {
            denyPendingMediaPermission();
        }
        if (speechController != null) speechController.onRecordAudioPermissionResult(granted);
    }

    static class NativeBridge {
        private static final String PREFS = "atherloom_react_runtime";
        private static final String BACKEND_URL = "backend_url";
        private final SharedPreferences preferences;
        private final SharedPreferences secrets;
        private final String secureStorageError;
        private final MainActivity activity;
        private final WebView webView;
        private final NativeSpeechController speechController;
        private final MiniMaxSpeechController miniMaxSpeechController;
        private final ConcurrentHashMap<String, HttpURLConnection> streams = new ConcurrentHashMap<>();
        private final Set<String> cancelledStreams = ConcurrentHashMap.newKeySet();

        NativeBridge(
            MainActivity activity,
            WebView webView,
            NativeSpeechController speechController,
            MiniMaxSpeechController miniMaxSpeechController
        ) {
            this.activity = activity;
            this.preferences = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            this.webView = webView;
            this.speechController = speechController;
            this.miniMaxSpeechController = miniMaxSpeechController;
            SharedPreferences encrypted = null;
            String encryptionError = "";
            try {
                MasterKey key = new MasterKey.Builder(activity).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build();
                encrypted = EncryptedSharedPreferences.create(
                    activity,
                    "atherloom_react_secrets",
                    key,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
                );
            } catch (Exception error) {
                encryptionError = safeMessage(error.getMessage());
            }
            this.secrets = encrypted;
            this.secureStorageError = encryptionError;
        }

        @JavascriptInterface
        public String getBackendUrl() {
            return preferences.getString(BACKEND_URL, "");
        }

        @JavascriptInterface
        public String setBackendUrl(String value) {
            try {
                String normalized = normalizeBackendUrl(value);
                preferences.edit().putString(BACKEND_URL, normalized).apply();
                return new JSONObject().put("ok", true).put("value", normalized).toString();
            } catch (Exception error) {
                return failure(error.getMessage());
            }
        }

        @JavascriptInterface
        public String getClipboard() {
            ClipboardManager clipboard = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
            if (clipboard == null || !clipboard.hasPrimaryClip() || clipboard.getPrimaryClip() == null
                || clipboard.getPrimaryClip().getItemCount() == 0) return "";
            CharSequence value = clipboard.getPrimaryClip().getItemAt(0).coerceToText(activity);
            return value == null ? "" : value.toString();
        }

        @JavascriptInterface
        public String setClipboard(String value) {
            try {
                ClipboardManager clipboard = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
                clipboard.setPrimaryClip(ClipData.newPlainText("Atherloom", value == null ? "" : value));
                return "{\"ok\":true}";
            } catch (Exception error) {
                return failure(error.getMessage());
            }
        }

        @JavascriptInterface
        public String speechRecognitionCapabilities() {
            return speechController.capabilities();
        }

        @JavascriptInterface
        public void startSpeechRecognition(String callbackId, String languageTag) {
            speechController.start(callbackId, languageTag);
        }

        @JavascriptInterface
        public void stopSpeechRecognition(String callbackId) {
            speechController.stop(callbackId);
        }

        @JavascriptInterface
        public String getVoiceProfile() {
            return miniMaxSpeechController.getVoiceProfile();
        }

        @JavascriptInterface
        public String saveVoiceProfile(String raw) {
            return miniMaxSpeechController.saveVoiceProfile(raw);
        }

        @JavascriptInterface
        public void synthesizeSpeechAsync(String raw, String callbackId) {
            miniMaxSpeechController.synthesizeSpeechAsync(raw, callbackId);
        }

        @JavascriptInterface
        public void cancelSpeechSynthesis(String callbackId) {
            miniMaxSpeechController.cancelSpeechSynthesis(callbackId);
        }

        @JavascriptInterface
        public String saveProvider(String raw) {
            try {
                requireSecureStorage();
                JSONObject provider = new JSONObject(raw == null || raw.isEmpty() ? "{}" : raw);
                String id = provider.optString("id");
                if (id.isEmpty()) id = UUID.randomUUID().toString();
                if (provider.optString("api_key").isEmpty()) {
                    JSONObject existing = secureProvider(id);
                    String sourceId = provider.optString("source_provider_id");
                    if (existing.optString("api_key").isEmpty() && !sourceId.isEmpty()) existing = secureProvider(sourceId);
                    if (existing.optString("api_key").isEmpty()) {
                        for (String keyName : secrets.getAll().keySet()) {
                            if (!keyName.startsWith("provider:")) continue;
                            JSONObject candidate = new JSONObject(secrets.getString(keyName, "{}"));
                            if (candidate.optString("protocol").equals(provider.optString("protocol"))
                                && candidate.optString("base_url").replaceAll("/+$", "").equals(provider.optString("base_url").replaceAll("/+$", ""))
                                && !candidate.optString("api_key").isEmpty()) {
                                existing = candidate;
                                break;
                            }
                        }
                    }
                    if (!existing.optString("api_key").isEmpty()) provider.put("api_key", existing.optString("api_key"));
                }
                if (provider.optString("name").trim().isEmpty()) throw new Exception("请填写线路名称");
                if (provider.optString("base_url").trim().isEmpty()) throw new Exception("请填写模型 Base URL");
                if (provider.optString("model").trim().isEmpty()) throw new Exception("请填写模型 ID");
                if (provider.optString("api_key").isEmpty()) throw new Exception("请填写或粘贴 API Key");
                provider.put("id", id);
                provider.remove("source_provider_id");
                secrets.edit().putString("provider:" + id, provider.toString()).apply();
                return publicProvider(provider).toString();
            } catch (Exception error) {
                return failure(error.getMessage());
            }
        }

        @JavascriptInterface
        public String listProviders() {
            try {
                requireSecureStorage();
                JSONArray output = new JSONArray();
                for (String keyName : secrets.getAll().keySet()) {
                    if (!keyName.startsWith("provider:")) continue;
                    output.put(publicProvider(new JSONObject(secrets.getString(keyName, "{}"))));
                }
                return output.toString();
            } catch (Exception error) {
                return failure(error.getMessage());
            }
        }

        @JavascriptInterface
        public String deleteProvider(String id) {
            try {
                requireSecureStorage();
                secrets.edit().remove("provider:" + id).apply();
                return "{\"ok\":true}";
            } catch (Exception error) {
                return failure(error.getMessage());
            }
        }

        @JavascriptInterface
        public void providerOperationAsync(String operation, String raw, String callbackId) {
            new Thread(() -> {
                String result;
                try {
                    JSONObject request = new JSONObject(raw == null || raw.isEmpty() ? "{}" : raw);
                    Object response;
                    if ("models".equals(operation)) {
                        response = new JSONObject().put("models", directListModels(request));
                    } else if ("test".equals(operation)) {
                        JSONObject probe = new JSONObject(request.toString())
                            .put("system", "")
                            .put("messages", new JSONArray().put(new JSONObject().put("role", "user").put("content", "只回复 OK")))
                            .put("max_tokens", 16)
                            .put("temperature", 0)
                            .put("thinking_enabled", false);
                        directChat(probe, callbackId);
                        response = new JSONObject().put("ok", true).put("message", "连接成功，模型已响应");
                    } else if ("chat".equals(operation)) {
                        response = directChat(request, callbackId);
                    } else {
                        throw new Exception("不支持的本机模型操作");
                    }
                    result = successResult(response);
                } catch (Exception error) {
                    result = failure(error.getMessage());
                }
                emitRequestResult(callbackId, result);
            }, "atherloom-provider-operation").start();
        }

        @JavascriptInterface
        public void providerChatStream(String raw, String callbackId) {
            new Thread(() -> runProviderChatStream(raw, callbackId), "atherloom-provider-stream").start();
        }

        @JavascriptInterface
        public String apiRequest(String method, String path, String body) {
            HttpURLConnection connection = null;
            try {
                connection = open(method, path, body);
                int status = connection.getResponseCode();
                String response = read(status >= 400 ? connection.getErrorStream() : connection.getInputStream());
                JSONObject result = new JSONObject()
                    .put("ok", status >= 200 && status < 300)
                    .put("status", status)
                    .put("body", response);
                if (status < 200 || status >= 300) result.put("error", httpError(status, response));
                return result.toString();
            } catch (Exception error) {
                return failure(error.getMessage());
            } finally {
                if (connection != null) connection.disconnect();
            }
        }

        @JavascriptInterface
        public void apiRequestAsync(String method, String path, String body, String callbackId) {
            new Thread(() -> {
                String result = apiRequest(method, path, body);
                emitRequestResult(callbackId, result);
            }, "atherloom-api-request").start();
        }

        @JavascriptInterface
        public void saveFile(String fileName, String mimeType, String base64, String callbackId) {
            activity.requestFileSave(fileName, mimeType, base64, callbackId);
        }

        @JavascriptInterface
        public void chatStream(String path, String body, String callbackId) {
            new Thread(() -> runChatStream(path, body, callbackId), "atherloom-chat-stream").start();
        }

        @JavascriptInterface
        public void cancelStream(String callbackId) {
            cancelledStreams.add(callbackId);
            HttpURLConnection connection = streams.remove(callbackId);
            if (connection != null) connection.disconnect();
        }

        private void requireSecureStorage() throws Exception {
            if (secrets == null) throw new Exception("Android 加密存储初始化失败" + (secureStorageError.isEmpty() ? "" : "：" + secureStorageError));
        }

        private JSONObject secureProvider(String id) throws Exception {
            requireSecureStorage();
            if (id == null || id.isEmpty()) return new JSONObject();
            return new JSONObject(secrets.getString("provider:" + id, "{}"));
        }

        private JSONObject publicProvider(JSONObject source) throws Exception {
            JSONObject provider = new JSONObject(source.toString());
            boolean hasKey = !provider.optString("api_key").isEmpty();
            provider.remove("api_key");
            provider.put("has_api_key", hasKey);
            return provider;
        }

        private JSONObject providerFromRequest(JSONObject request) throws Exception {
            JSONObject provider;
            if (!request.optString("base_url").isEmpty()) {
                provider = new JSONObject(request.toString());
            } else {
                provider = secureProvider(request.optString("provider_id"));
            }
            if (provider.length() == 0) throw new Exception("API 线路不存在，请重新保存线路");
            if (provider.optString("api_key").isEmpty()) {
                String sourceId = request.optString("provider_id", request.optString("source_provider_id"));
                JSONObject saved = secureProvider(sourceId);
                if (!saved.optString("api_key").isEmpty()) provider.put("api_key", saved.optString("api_key"));
            }
            if (provider.optString("api_key").isEmpty()) throw new Exception("API Key 为空，请重新粘贴并保存");
            return provider;
        }

        private void applyProviderHeaders(HttpURLConnection connection, JSONObject provider) throws Exception {
            String protocol = provider.optString("protocol", "openai");
            if ("anthropic".equals(protocol)) {
                connection.setRequestProperty("x-api-key", provider.optString("api_key"));
                connection.setRequestProperty("anthropic-version", "2023-06-01");
            } else {
                connection.setRequestProperty("Authorization", "Bearer " + provider.optString("api_key"));
            }
            JSONObject custom = new JSONObject(provider.optString("custom_headers", "{}"));
            for (Iterator<String> keys = custom.keys(); keys.hasNext();) {
                String header = keys.next();
                connection.setRequestProperty(header, custom.optString(header));
            }
        }

        private JSONArray directListModels(JSONObject request) throws Exception {
            JSONObject provider = providerFromRequest(request);
            String protocol = provider.optString("protocol", "openai");
            String base = provider.getString("base_url").replaceAll("/+$", "")
                .replaceAll("/chat/completions$", "")
                .replaceAll("/messages$", "");
            String endpoint;
            if (base.endsWith("/models")) {
                endpoint = base;
            } else if ("anthropic".equals(protocol) && !base.endsWith("/v1")) {
                endpoint = base + "/v1/models";
            } else if (base.matches("https?://api\\.openai\\.com")) {
                endpoint = base + "/v1/models";
            } else {
                endpoint = base + "/models";
            }
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(endpoint).openConnection();
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(25000);
                connection.setReadTimeout(30000);
                connection.setRequestProperty("Accept", "application/json");
                applyProviderHeaders(connection, provider);
                int status = connection.getResponseCode();
                String response = read(status >= 400 ? connection.getErrorStream() : connection.getInputStream());
                if (status >= 400) throw new Exception(httpError(status, response));
                JSONObject payload = new JSONObject(response);
                JSONArray rows = payload.optJSONArray("data");
                if (rows == null) rows = payload.optJSONArray("models");
                JSONArray models = new JSONArray();
                if (rows != null) {
                    for (int index = 0; index < rows.length(); index++) {
                        Object row = rows.opt(index);
                        String model = row instanceof JSONObject ? ((JSONObject) row).optString("id", ((JSONObject) row).optString("name"))
                            : row instanceof String ? (String) row : "";
                        if (!model.isEmpty()) models.put(model);
                    }
                }
                return models;
            } finally {
                if (connection != null) connection.disconnect();
            }
        }

        private JSONObject directChat(JSONObject request, String callbackId) throws Exception {
            JSONObject provider = providerFromRequest(request);
            String protocol = provider.optString("protocol", "openai");
            String base = provider.getString("base_url").replaceAll("/+$", "")
                .replaceAll("/chat/completions$", "")
                .replaceAll("/messages$", "")
                .replaceAll("/models$", "");
            String endpoint = "anthropic".equals(protocol)
                ? (base.endsWith("/v1") ? base + "/messages" : base + "/v1/messages")
                : (base.matches("https?://api\\.openai\\.com") ? base + "/v1/chat/completions" : base + "/chat/completions");
            JSONArray messages = request.optJSONArray("messages");
            if (messages == null) messages = new JSONArray();
            JSONObject payload = new JSONObject()
                .put("model", provider.getString("model"))
                .put("max_tokens", request.optInt("max_tokens", provider.optInt("max_tokens", 4096)))
                .put("temperature", request.optDouble("temperature", provider.optDouble("temperature", 0.7)))
                .put("top_p", request.optDouble("top_p", provider.optDouble("top_p", 1.0)))
                .put("stream", false)
                .put("messages", messages);
            JSONObject customBody = request.optJSONObject("custom_body");
            if (customBody != null) {
                for (Iterator<String> keys = customBody.keys(); keys.hasNext();) {
                    String key = keys.next();
                    if ("model".equals(key) || "messages".equals(key) || "stream".equals(key)
                        || "tools".equals(key) || "tool_choice".equals(key)) continue;
                    payload.put(key, customBody.get(key));
                }
            }
            JSONArray requestTools = request.optJSONArray("tools");
            if (requestTools != null && requestTools.length() > 0) {
                if ("anthropic".equals(protocol)) {
                    payload.put("tools", requestTools);
                } else {
                    JSONArray providerTools = new JSONArray();
                    for (int index = 0; index < requestTools.length(); index++) {
                        JSONObject tool = requestTools.optJSONObject(index);
                        if (tool == null || tool.optString("name").isEmpty()) continue;
                        providerTools.put(new JSONObject().put("type", "function").put("function", new JSONObject()
                            .put("name", tool.optString("name"))
                            .put("description", tool.optString("description"))
                            .put("parameters", tool.optJSONObject("input_schema") == null
                                ? new JSONObject().put("type", "object").put("properties", new JSONObject())
                                : tool.optJSONObject("input_schema"))));
                    }
                    if (providerTools.length() > 0) payload.put("tools", providerTools);
                }
            }
            String system = request.optString("system");
            if ("anthropic".equals(protocol)) {
                if (!system.isEmpty()) payload.put("system", system);
            } else if (!system.isEmpty()) {
                JSONArray withSystem = new JSONArray().put(new JSONObject().put("role", "system").put("content", system));
                for (int index = 0; index < messages.length(); index++) withSystem.put(messages.get(index));
                payload.put("messages", withSystem);
            }
            boolean explicitThinking = "glm".equals(protocol);
            if (explicitThinking && request.optBoolean("thinking_enabled", provider.optBoolean("thinking_enabled", true))) {
                payload.put("thinking", new JSONObject().put("type", "enabled"));
            }

            int requestTimeoutMs = Math.max(1000, Math.min(900000, request.optInt("request_timeout_ms", 180000)));
            HttpURLConnection connection = null;
            try {
                if (cancelledStreams.contains(callbackId)) throw new Exception("本机模型请求已取消");
                connection = (HttpURLConnection) new URL(endpoint).openConnection();
                streams.put(callbackId, connection);
                if (cancelledStreams.contains(callbackId)) {
                    streams.remove(callbackId);
                    connection.disconnect();
                    throw new Exception("本机模型请求已取消");
                }
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(Math.min(25000, requestTimeoutMs));
                connection.setReadTimeout(requestTimeoutMs);
                connection.setDoOutput(true);
                connection.setRequestProperty("Accept", "application/json");
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                applyProviderHeaders(connection, provider);
                JSONObject customHeaders = request.optJSONObject("custom_headers");
                if (customHeaders != null) {
                    for (Iterator<String> keys = customHeaders.keys(); keys.hasNext();) {
                        String header = keys.next();
                        if ("authorization".equalsIgnoreCase(header) || "x-api-key".equalsIgnoreCase(header)
                            || "content-type".equalsIgnoreCase(header)) continue;
                        connection.setRequestProperty(header, customHeaders.optString(header));
                    }
                }
                if (cancelledStreams.contains(callbackId)) throw new Exception("本机模型请求已取消");
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(payload.toString().getBytes(StandardCharsets.UTF_8));
                }
                int status = connection.getResponseCode();
                String response = read(status >= 400 ? connection.getErrorStream() : connection.getInputStream());
                if (status >= 400) throw new Exception(httpError(status, response));
                JSONObject data = new JSONObject(response);
                String content = "";
                String reasoning = "";
                JSONArray toolCalls = new JSONArray();
                Object rawAssistant = new JSONObject();
                if ("anthropic".equals(protocol)) {
                    JSONArray blocks = data.optJSONArray("content");
                    rawAssistant = blocks == null ? new JSONArray() : blocks;
                    StringBuilder text = new StringBuilder();
                    StringBuilder thought = new StringBuilder();
                    if (blocks != null) {
                        for (int index = 0; index < blocks.length(); index++) {
                            JSONObject block = blocks.optJSONObject(index);
                            if (block == null) continue;
                            if ("thinking".equals(block.optString("type"))) thought.append(block.optString("thinking"));
                            else if ("text".equals(block.optString("type"))) text.append(block.optString("text"));
                            else if ("tool_use".equals(block.optString("type")) && !block.optString("name").isEmpty()) {
                                if (toolCalls.length() >= 16) throw new Exception("模型单轮返回的工具调用过多，Atherloom 已停止执行");
                                String toolCallId = block.optString("id");
                                if (toolCallId.isEmpty()) {
                                    toolCallId = "tool-" + callbackId + "-" + index;
                                    block.put("id", toolCallId);
                                }
                                toolCalls.put(new JSONObject()
                                    .put("id", toolCallId)
                                    .put("name", block.optString("name"))
                                    .put("arguments", block.optJSONObject("input") == null ? new JSONObject() : block.optJSONObject("input"))
                                    .put("source", "native"));
                            }
                        }
                    }
                    content = text.toString();
                    reasoning = thought.toString();
                } else {
                    JSONArray choices = data.optJSONArray("choices");
                    JSONObject choice = choices == null || choices.length() == 0 ? null : choices.optJSONObject(0);
                    JSONObject message = choice == null ? null : choice.optJSONObject("message");
                    if (message != null) {
                        rawAssistant = message;
                        content = textValue(message.opt("content"));
                        reasoning = textValue(message.opt("reasoning_content"));
                        if (reasoning.isEmpty()) reasoning = textValue(message.opt("reasoning"));
                        JSONArray nativeCalls = message.optJSONArray("tool_calls");
                        if (nativeCalls != null) {
                            for (int index = 0; index < nativeCalls.length(); index++) {
                                JSONObject nativeCall = nativeCalls.optJSONObject(index);
                                JSONObject function = nativeCall == null ? null : nativeCall.optJSONObject("function");
                                if (function == null || function.optString("name").isEmpty()) continue;
                                if (toolCalls.length() >= 16) throw new Exception("模型单轮返回的工具调用过多，Atherloom 已停止执行");
                                String toolCallId = nativeCall.optString("id");
                                if (toolCallId.isEmpty()) {
                                    toolCallId = "tool-" + callbackId + "-" + index;
                                    nativeCall.put("id", toolCallId);
                                }
                                JSONObject arguments = new JSONObject();
                                String rawArguments = function.optString("arguments", "{}");
                                try {
                                    arguments = new JSONObject(rawArguments.isEmpty() ? "{}" : rawArguments);
                                } catch (Exception invalidArguments) {
                                    arguments.put("_argument_error", "工具参数不是有效 JSON 对象");
                                }
                                toolCalls.put(new JSONObject()
                                    .put("id", toolCallId)
                                    .put("name", function.optString("name"))
                                    .put("arguments", arguments)
                                    .put("source", "native"));
                            }
                        }
                    }
                    if (content.isEmpty() && choice != null) content = textValue(choice.opt("text"));
                    if (content.isEmpty()) content = textValue(data.opt("output_text"));
                }
                if (content.trim().isEmpty() && !reasoning.trim().isEmpty() && toolCalls.length() == 0) content = reasoning.trim();
                if (content.trim().isEmpty() && toolCalls.length() == 0) throw new Exception("模型没有返回正文或工具调用");
                JSONObject result = new JSONObject()
                    .put("content", content)
                    .put("reasoning", reasoning)
                    .put("model", data.optString("model", provider.optString("model")))
                    .put("tool_calls", toolCalls)
                    .put("raw_assistant", rawAssistant);
                if (data.optJSONObject("usage") != null) result.put("usage", data.optJSONObject("usage"));
                return result;
            } finally {
                streams.remove(callbackId);
                cancelledStreams.remove(callbackId);
                if (connection != null) connection.disconnect();
            }
        }

        private void runProviderChatStream(String raw, String callbackId) {
            HttpURLConnection connection = null;
            try {
                JSONObject request = new JSONObject(raw == null || raw.isEmpty() ? "{}" : raw);
                JSONObject provider = providerFromRequest(request);
                String protocol = provider.optString("protocol", "openai");
                String base = provider.getString("base_url").replaceAll("/+$", "")
                    .replaceAll("/chat/completions$", "")
                    .replaceAll("/messages$", "")
                    .replaceAll("/models$", "");
                String endpoint = "anthropic".equals(protocol)
                    ? (base.endsWith("/v1") ? base + "/messages" : base + "/v1/messages")
                    : (base.matches("https?://api\\.openai\\.com") ? base + "/v1/chat/completions" : base + "/chat/completions");
                JSONArray messages = request.optJSONArray("messages");
                if (messages == null) messages = new JSONArray();
                JSONObject payload = new JSONObject()
                    .put("model", provider.getString("model"))
                    .put("max_tokens", request.optInt("max_tokens", provider.optInt("max_tokens", 4096)))
                    .put("temperature", request.optDouble("temperature", provider.optDouble("temperature", 0.7)))
                    .put("top_p", request.optDouble("top_p", provider.optDouble("top_p", 1.0)))
                    .put("stream", true)
                    .put("messages", messages);
                JSONObject customBody = request.optJSONObject("custom_body");
                if (customBody != null) {
                    for (Iterator<String> keys = customBody.keys(); keys.hasNext();) {
                        String key = keys.next();
                        if ("model".equals(key) || "messages".equals(key) || "stream".equals(key)) continue;
                        payload.put(key, customBody.get(key));
                    }
                }
                String system = request.optString("system");
                if ("anthropic".equals(protocol)) {
                    if (!system.isEmpty()) payload.put("system", system);
                } else if (!system.isEmpty()) {
                    JSONArray withSystem = new JSONArray().put(new JSONObject().put("role", "system").put("content", system));
                    for (int index = 0; index < messages.length(); index++) withSystem.put(messages.get(index));
                    payload.put("messages", withSystem);
                }
                if ("glm".equals(protocol) && request.optBoolean("thinking_enabled", provider.optBoolean("thinking_enabled", true))) {
                    payload.put("thinking", new JSONObject().put("type", "enabled"));
                }

                connection = (HttpURLConnection) new URL(endpoint).openConnection();
                streams.put(callbackId, connection);
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(25000);
                connection.setReadTimeout(180000);
                connection.setDoOutput(true);
                connection.setRequestProperty("Accept", "text/event-stream");
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                applyProviderHeaders(connection, provider);
                JSONObject customHeaders = request.optJSONObject("custom_headers");
                if (customHeaders != null) {
                    for (Iterator<String> keys = customHeaders.keys(); keys.hasNext();) {
                        String header = keys.next();
                        if ("authorization".equalsIgnoreCase(header) || "x-api-key".equalsIgnoreCase(header)
                            || "content-type".equalsIgnoreCase(header)) continue;
                        connection.setRequestProperty(header, customHeaders.optString(header));
                    }
                }
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(payload.toString().getBytes(StandardCharsets.UTF_8));
                }
                int status = connection.getResponseCode();
                if (status >= 400) throw new Exception(httpError(status, read(connection.getErrorStream())));

                JSONObject usage = new JSONObject();
                String responseModel = provider.optString("model");
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null && !cancelledStreams.contains(callbackId)) {
                        String eventText = line.trim();
                        if (eventText.isEmpty() || eventText.startsWith(":")) continue;
                        if (eventText.startsWith("event:")) continue;
                        if (eventText.startsWith("data:")) eventText = eventText.substring(5).trim();
                        if (eventText.isEmpty() || "[DONE]".equals(eventText)) continue;
                        JSONObject event = new JSONObject(eventText);
                        if (!event.optString("model").isEmpty()) responseModel = event.optString("model");
                        JSONObject eventUsage = event.optJSONObject("usage");
                        JSONObject message = event.optJSONObject("message");
                        if (eventUsage == null && message != null) eventUsage = message.optJSONObject("usage");
                        if (eventUsage != null) {
                            for (Iterator<String> keys = eventUsage.keys(); keys.hasNext();) {
                                String key = keys.next();
                                usage.put(key, eventUsage.get(key));
                            }
                        }
                        JSONObject output = new JSONObject();
                        if ("anthropic".equals(protocol)) {
                            JSONObject delta = event.optJSONObject("delta");
                            if (delta != null && "content_block_delta".equals(event.optString("type"))) {
                                String text = nullableString(delta, "text");
                                String thinking = nullableString(delta, "thinking");
                                if (!text.isEmpty()) output.put("delta", text);
                                if (!thinking.isEmpty()) output.put("reasoning_delta", thinking);
                            }
                        } else {
                            JSONArray choices = event.optJSONArray("choices");
                            JSONObject choice = choices != null && choices.length() > 0 ? choices.optJSONObject(0) : null;
                            JSONObject delta = choice == null ? null : choice.optJSONObject("delta");
                            String text = nullableString(delta, "content");
                            String reasoning = nullableString(delta, "reasoning_content");
                            if (reasoning.isEmpty()) reasoning = nullableString(delta, "reasoning");
                            if (!text.isEmpty()) output.put("delta", text);
                            if (!reasoning.isEmpty()) output.put("reasoning_delta", reasoning);
                        }
                        if (output.length() > 0) emit(callbackId, output.toString());
                    }
                }
                if (!cancelledStreams.contains(callbackId)) {
                    JSONObject done = new JSONObject().put("done", true).put("model", responseModel);
                    if (usage.length() > 0) done.put("usage", usage);
                    emit(callbackId, done.toString());
                }
            } catch (Exception error) {
                if (!cancelledStreams.contains(callbackId)) emit(callbackId, failurePayload(error.getMessage()));
            } finally {
                streams.remove(callbackId);
                cancelledStreams.remove(callbackId);
                if (connection != null) connection.disconnect();
            }
        }

        private static String textValue(Object value) {
            if (value == null || value == JSONObject.NULL) return "";
            if (value instanceof String) return (String) value;
            if (value instanceof JSONObject) {
                JSONObject object = (JSONObject) value;
                String text = object.optString("text");
                return text.isEmpty() ? textValue(object.opt("content")) : text;
            }
            if (value instanceof JSONArray) {
                StringBuilder output = new StringBuilder();
                JSONArray values = (JSONArray) value;
                for (int index = 0; index < values.length(); index++) output.append(textValue(values.opt(index)));
                return output.toString();
            }
            return String.valueOf(value);
        }

        private static String nullableString(JSONObject object, String key) {
            return object == null || !object.has(key) || object.isNull(key) ? "" : object.optString(key, "");
        }

        private static String successResult(Object body) throws Exception {
            return new JSONObject()
                .put("ok", true)
                .put("status", 200)
                .put("body", body == null ? "null" : body.toString())
                .toString();
        }

        private void emitRequestResult(String callbackId, String result) {
            String script = "window.AtherloomNativeRequest&&window.AtherloomNativeRequest("
                + JSONObject.quote(callbackId) + "," + JSONObject.quote(result) + ")";
            webView.post(() -> webView.evaluateJavascript(script, null));
        }

        private void runChatStream(String path, String body, String callbackId) {
            HttpURLConnection connection = null;
            boolean sawDone = false;
            try {
                connection = open("POST", path, body);
                streams.put(callbackId, connection);
                int status = connection.getResponseCode();
                if (status < 200 || status >= 300) {
                    String response = read(connection.getErrorStream());
                    emit(callbackId, new JSONObject().put("error", httpError(status, response)).toString());
                    return;
                }
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null && !cancelledStreams.contains(callbackId)) {
                        String event = line.trim();
                        if (event.isEmpty() || event.startsWith(":")) continue;
                        if (event.startsWith("event:")) continue;
                        if (event.startsWith("data:")) event = event.substring(5).trim();
                        if (event.isEmpty()) continue;
                        if ("[DONE]".equals(event)) {
                            emit(callbackId, new JSONObject().put("done", true).toString());
                            sawDone = true;
                            break;
                        }
                        JSONObject payload = new JSONObject(event);
                        emit(callbackId, payload.toString());
                        if (payload.optBoolean("done")) {
                            sawDone = true;
                            break;
                        }
                    }
                }
                if (!sawDone && !cancelledStreams.contains(callbackId)) {
                    emit(callbackId, new JSONObject().put("done", true).toString());
                }
            } catch (Exception error) {
                if (!cancelledStreams.contains(callbackId)) emit(callbackId, failurePayload(error.getMessage()));
            } finally {
                streams.remove(callbackId);
                cancelledStreams.remove(callbackId);
                if (connection != null) connection.disconnect();
            }
        }

        private HttpURLConnection open(String method, String path, String body) throws Exception {
            String base = getBackendUrl();
            if (base.isEmpty()) throw new Exception("请先在设置中填写 FastAPI 后端地址");
            if (!path.startsWith("/api/")) throw new Exception("只允许访问 Atherloom API");
            HttpURLConnection connection = (HttpURLConnection) new URL(base + path).openConnection();
            connection.setRequestMethod(method.toUpperCase());
            connection.setConnectTimeout(25000);
            connection.setReadTimeout(180000);
            connection.setRequestProperty("Accept", "application/json, text/event-stream");
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            if (body != null && !body.isEmpty()) {
                connection.setDoOutput(true);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(body.getBytes(StandardCharsets.UTF_8));
                }
            }
            return connection;
        }

        private static String normalizeBackendUrl(String raw) throws Exception {
            String value = raw == null ? "" : raw.trim().replaceAll("/+$", "");
            if (value.isEmpty()) return "";
            URL url = new URL(value);
            if (!("http".equalsIgnoreCase(url.getProtocol()) || "https".equalsIgnoreCase(url.getProtocol()))) {
                throw new Exception("后端地址必须使用 http:// 或 https://");
            }
            if (!url.getPath().isEmpty() && !"/".equals(url.getPath())) {
                throw new Exception("后端地址只填写服务器根地址");
            }
            if (url.getQuery() != null || url.getRef() != null) throw new Exception("后端地址不能包含查询参数或片段");
            return value;
        }

        private void emit(String callbackId, String event) {
            String script = "window.AtherloomNativeStream&&window.AtherloomNativeStream("
                + JSONObject.quote(callbackId) + "," + JSONObject.quote(event) + ")";
            webView.post(() -> webView.evaluateJavascript(script, null));
        }

        private static String read(InputStream stream) throws Exception {
            if (stream == null) return "";
            StringBuilder text = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) text.append(line).append('\n');
            }
            return text.toString().trim();
        }

        private static String httpError(int status, String body) {
            String detail = body == null ? "" : body.trim();
            if (detail.length() > 300) detail = detail.substring(0, 300);
            return "HTTP " + status + (detail.isEmpty() ? "" : " · " + detail);
        }

        private static String failure(String message) {
            try {
                return new JSONObject().put("ok", false).put("status", 0).put("error", safeMessage(message)).toString();
            } catch (Exception ignored) {
                return "{\"ok\":false,\"status\":0,\"error\":\"请求失败\"}";
            }
        }

        private static String failurePayload(String message) {
            try {
                return new JSONObject().put("error", safeMessage(message)).toString();
            } catch (Exception ignored) {
                return "{\"error\":\"请求失败\"}";
            }
        }

        private static String safeMessage(String message) {
            return message == null || message.trim().isEmpty() ? "请求失败" : message.trim();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(
            "(function(){var e=new Event('atherloom:back',{cancelable:true});return !window.dispatchEvent(e);})()",
            result -> {
                if ("true".equals(result)) return;
                if (webView.canGoBack()) webView.goBack();
                else MainActivity.super.onBackPressed();
            }
        );
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
            webView.resumeTimers();
        }
        if (speechController != null) speechController.onResume();
        if (miniMaxSpeechController != null) miniMaxSpeechController.onResume();
    }

    @Override
    protected void onPause() {
        if (speechController != null) speechController.onPause(recordAudioPermissionInFlight);
        if (miniMaxSpeechController != null) miniMaxSpeechController.onPause();
        if (webView != null) {
            webView.onPause();
            webView.pauseTimers();
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        recordAudioPermissionInFlight = false;
        denyPendingMediaPermission();
        if (speechController != null) speechController.destroy();
        if (miniMaxSpeechController != null) miniMaxSpeechController.destroy();
        if (nativeBridge != null) nativeBridge.streams.values().forEach(HttpURLConnection::disconnect);
        if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
        fileChooserCallback = null;
        pendingSaveData = null;
        pendingSaveCallbackId = null;
        if (webView != null) {
            webView.stopLoading();
            webView.removeJavascriptInterface("AtherloomNative");
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            if (webView.getParent() instanceof ViewGroup) {
                ((ViewGroup) webView.getParent()).removeView(webView);
            }
            webView.removeAllViews();
            webView.destroy();
            webView = null;
        }
        nativeBridge = null;
        speechController = null;
        miniMaxSpeechController = null;
        super.onDestroy();
    }
}
