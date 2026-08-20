import json
from pathlib import Path

from playwright.sync_api import sync_playwright


root = Path(__file__).resolve().parents[1]
artifacts = root / "artifacts"
artifacts.mkdir(exist_ok=True)

native_bridge = r"""
(() => {
  const provider = {
    id: "provider-android",
    name: "Android 原生桥线路",
    protocol: "openai",
    base_url: "https://example.invalid/v1",
    model: "native-mock-model",
    enabled: true,
    custom_headers: "{}",
    prompt_cache: true,
  };
  window.__atherloomNativeCalls = [];
  window.AtherloomNative = {
    getBackendUrl() { return "https://backend.example.invalid"; },
    setBackendUrl(value) {
      window.__atherloomNativeCalls.push(["setBackendUrl", value]);
      return JSON.stringify({ ok: true, value });
    },
    apiRequest(method, path, body) {
      window.__atherloomNativeCalls.push(["apiRequest", method, path, body]);
      let payload;
      if (method === "GET" && path === "/api/bootstrap") {
        payload = { providers: [provider], personas: [], conversations: [], settings: { display_name: "Android" } };
      } else if (method === "POST" && path === "/api/conversations") {
        payload = { id: "conversation-android", title: "新对话", provider_id: provider.id, persona_id: null };
      } else if (method === "GET" && path.endsWith("/messages")) {
        payload = [];
      } else {
        return JSON.stringify({ ok: false, status: 404, error: `unexpected ${method} ${path}` });
      }
      return JSON.stringify({ ok: true, status: 200, body: JSON.stringify(payload) });
    },
    chatStream(path, body, callbackId) {
      window.__atherloomNativeCalls.push(["chatStream", path, body, callbackId]);
      setTimeout(() => window.AtherloomNativeStream(callbackId, JSON.stringify({ reasoning_delta: "原生桥思考" })), 10);
      setTimeout(() => window.AtherloomNativeStream(callbackId, JSON.stringify({ delta: "Android 原生桥流式回复正常。" })), 20);
      setTimeout(() => window.AtherloomNativeStream(callbackId, JSON.stringify({ done: true, title: "Android 桥验证" })), 30);
    },
    cancelStream(callbackId) {
      window.__atherloomNativeCalls.push(["cancelStream", callbackId]);
    },
  };
})();
"""


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel="msedge", headless=True)
    page = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
    errors: list[str] = []
    network_api_calls: list[str] = []
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: network_api_calls.append(request.url) if "/api/" in request.url else None)
    page.add_init_script(native_bridge)

    page.goto("http://127.0.0.1:5173/", wait_until="networkidle")
    page.get_by_role("heading", name="今天想聊些什么？").wait_for()
    page.get_by_role("button", name="打开设置").click()
    assert page.get_by_label("FastAPI 根地址").input_value() == "https://backend.example.invalid"
    page.get_by_role("button", name="关闭设置").click()

    page.get_by_role("textbox", name="消息").fill("验证 Android 原生桥")
    page.get_by_role("button", name="发送").click()
    page.get_by_text("Android 原生桥流式回复正常。", exact=True).wait_for()
    page.locator(".conversation-title").get_by_text("Android 桥验证", exact=True).wait_for()

    calls = page.evaluate("window.__atherloomNativeCalls")
    assert any(call[0:3] == ["apiRequest", "GET", "/api/bootstrap"] for call in calls), calls
    assert any(call[0:3] == ["apiRequest", "POST", "/api/conversations"] for call in calls), calls
    assert any(call[0:2] == ["chatStream", "/api/chat"] for call in calls), calls
    assert not network_api_calls, network_api_calls
    page.screenshot(path=artifacts / "android-native-bridge.png", full_page=True)
    browser.close()

    if errors:
        raise AssertionError("Browser console errors:\n" + "\n".join(errors))

print(json.dumps({
    "screenshot": str(artifacts / "android-native-bridge.png"),
    "native_calls": [call[:3] for call in calls],
    "network_api_calls": network_api_calls,
}, ensure_ascii=False, indent=2))
