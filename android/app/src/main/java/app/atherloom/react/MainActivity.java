package app.atherloom.react;

import android.app.Activity;
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

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Set;
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
        private final MainActivity activity;
        private final WebView webView;
        private final ConcurrentHashMap<String, HttpURLConnection> streams = new ConcurrentHashMap<>();
        private final Set<String> cancelledStreams = ConcurrentHashMap.newKeySet();

        NativeBridge(MainActivity activity, WebView webView) {
            this.activity = activity;
            this.preferences = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            this.webView = webView;
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
                String script = "window.AtherloomNativeRequest&&window.AtherloomNativeRequest("
                    + JSONObject.quote(callbackId) + "," + JSONObject.quote(result) + ")";
                webView.post(() -> webView.evaluateJavascript(script, null));
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
