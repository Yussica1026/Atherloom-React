package app.atherloom.react;

import android.app.Activity;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
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
    private WebView webView;
    private NativeBridge nativeBridge;
    private ValueCallback<Uri[]> fileChooserCallback;
    private byte[] pendingSaveData;
    private String pendingSaveCallbackId;

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
        nativeBridge = new NativeBridge(this, webView);
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
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("appassets.androidplatform.net".equalsIgnoreCase(uri.getHost())) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
                return true;
            }
        });
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

    static class NativeBridge {
        private static final String PREFS = "atherloom_react_runtime";
        private static final String BACKEND_URL = "backend_url";
        private final SharedPreferences preferences;
        private final SharedPreferences secrets;
        private final String secureStorageError;
        private final MainActivity activity;
        private final WebView webView;
        private final ConcurrentHashMap<String, HttpURLConnection> streams = new ConcurrentHashMap<>();
        private final Set<String> cancelledStreams = ConcurrentHashMap.newKeySet();

        NativeBridge(MainActivity activity, WebView webView) {
            this.activity = activity;
            this.preferences = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            this.webView = webView;
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
                            .put("temperature", 0);
                        directChat(probe);
                        response = new JSONObject().put("ok", true).put("message", "连接成功，模型已响应");
                    } else if ("chat".equals(operation)) {
                        response = directChat(request);
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
            String base = provider.getString("base_url").replaceAll("/+$", "");
            String endpoint = base.endsWith("/models") ? base : base + "/models";
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

        private JSONObject directChat(JSONObject request) throws Exception {
            JSONObject provider = providerFromRequest(request);
            String protocol = provider.optString("protocol", "openai");
            String base = provider.getString("base_url").replaceAll("/+$", "");
            String endpoint = "anthropic".equals(protocol)
                ? (base.endsWith("/messages") ? base : base.endsWith("/v1") ? base + "/messages" : base + "/v1/messages")
                : (base.endsWith("/chat/completions") ? base : base + "/chat/completions");
            JSONArray messages = request.optJSONArray("messages");
            if (messages == null) messages = new JSONArray();
            JSONObject payload = new JSONObject()
                .put("model", provider.getString("model"))
                .put("max_tokens", request.optInt("max_tokens", provider.optInt("max_tokens", 4096)))
                .put("temperature", request.optDouble("temperature", provider.optDouble("temperature", 0.7)))
                .put("top_p", request.optDouble("top_p", provider.optDouble("top_p", 1.0)))
                .put("messages", messages);
            String system = request.optString("system");
            if ("anthropic".equals(protocol)) {
                if (!system.isEmpty()) payload.put("system", system);
            } else if (!system.isEmpty()) {
                JSONArray withSystem = new JSONArray().put(new JSONObject().put("role", "system").put("content", system));
                for (int index = 0; index < messages.length(); index++) withSystem.put(messages.get(index));
                payload.put("messages", withSystem);
            }
            boolean reasoningModel = "deepseek".equals(protocol) || "glm".equals(protocol)
                || provider.optString("model").toLowerCase(java.util.Locale.ROOT).contains("deepseek");
            if (reasoningModel && request.optBoolean("thinking_enabled", provider.optBoolean("thinking_enabled", true))) {
                payload.put("thinking", new JSONObject().put("type", "enabled"));
            }

            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(endpoint).openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(25000);
                connection.setReadTimeout(180000);
                connection.setDoOutput(true);
                connection.setRequestProperty("Accept", "application/json");
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                applyProviderHeaders(connection, provider);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(payload.toString().getBytes(StandardCharsets.UTF_8));
                }
                int status = connection.getResponseCode();
                String response = read(status >= 400 ? connection.getErrorStream() : connection.getInputStream());
                if (status >= 400) throw new Exception(httpError(status, response));
                JSONObject data = new JSONObject(response);
                String content = "";
                String reasoning = "";
                if ("anthropic".equals(protocol)) {
                    content = textValue(data.opt("content"));
                } else {
                    JSONArray choices = data.optJSONArray("choices");
                    JSONObject choice = choices == null || choices.length() == 0 ? null : choices.optJSONObject(0);
                    JSONObject message = choice == null ? null : choice.optJSONObject("message");
                    if (message != null) {
                        content = textValue(message.opt("content"));
                        reasoning = textValue(message.opt("reasoning_content"));
                        if (reasoning.isEmpty()) reasoning = textValue(message.opt("reasoning"));
                    }
                    if (content.isEmpty() && choice != null) content = textValue(choice.opt("text"));
                    if (content.isEmpty()) content = textValue(data.opt("output_text"));
                }
                if (content.trim().isEmpty() && !reasoning.trim().isEmpty()) content = reasoning.trim();
                if (content.trim().isEmpty()) throw new Exception("模型没有返回正文");
                JSONObject result = new JSONObject()
                    .put("content", content)
                    .put("reasoning", reasoning)
                    .put("model", data.optString("model", provider.optString("model")));
                if (data.optJSONObject("usage") != null) result.put("usage", data.optJSONObject("usage"));
                return result;
            } finally {
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
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (nativeBridge != null) nativeBridge.streams.values().forEach(HttpURLConnection::disconnect);
        if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
        fileChooserCallback = null;
        pendingSaveData = null;
        pendingSaveCallbackId = null;
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
