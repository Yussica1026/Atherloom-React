import argparse
import json
import re
from pathlib import Path

from playwright.sync_api import sync_playwright


root = Path(__file__).resolve().parents[1]
artifacts = root / "artifacts"
artifacts.mkdir(exist_ok=True)

parser = argparse.ArgumentParser()
parser.add_argument("--base-url", default="http://127.0.0.1:5173")
base_url = parser.parse_args().base_url.rstrip("/")
account_settings_name = re.compile(r"(设置用户名|打开账号与外观设置)$")

native_bridge = r"""
(() => {
  const providerKey = "__atherloom_test_secure_providers";
  const readProviders = () => JSON.parse(localStorage.getItem(providerKey) || "[]");
  const writeProviders = providers => localStorage.setItem(providerKey, JSON.stringify(providers));
  const publicProvider = provider => {
    const result = { ...provider, has_api_key: Boolean(provider.api_key) };
    delete result.api_key;
    return result;
  };
  window.__atherloomNativeCalls = window.__atherloomNativeCalls || [];
  window.AtherloomNative = {
    getBackendUrl() { return ""; },
    setBackendUrl(value) {
      window.__atherloomNativeCalls.push(["setBackendUrl", value]);
      return JSON.stringify({ ok: true, value });
    },
    getClipboard() {
      window.__atherloomNativeCalls.push(["getClipboard"]);
      return "sk-android-native-clipboard-123456789";
    },
    saveProvider(raw) {
      const draft = JSON.parse(raw);
      const providers = readProviders();
      const existing = providers.find(item => item.id === draft.id || item.id === draft.source_provider_id);
      const provider = {
        ...existing,
        ...draft,
        id: draft.id || `provider-${Date.now()}`,
        api_key: draft.api_key || existing?.api_key || "",
      };
      delete provider.source_provider_id;
      const next = providers.filter(item => item.id !== provider.id);
      next.push(provider);
      writeProviders(next);
      window.__atherloomNativeCalls.push(["saveProvider", provider.id, provider.api_key.length]);
      return JSON.stringify(publicProvider(provider));
    },
    listProviders() {
      window.__atherloomNativeCalls.push(["listProviders"]);
      return JSON.stringify(readProviders().map(publicProvider));
    },
    deleteProvider(id) {
      writeProviders(readProviders().filter(item => item.id !== id));
      window.__atherloomNativeCalls.push(["deleteProvider", id]);
      return JSON.stringify({ ok: true });
    },
    providerOperationAsync(operation, raw, callbackId) {
      const request = JSON.parse(raw);
      window.__atherloomNativeCalls.push(["providerOperationAsync", operation, request.provider_id || request.base_url || ""]);
      let payload;
      if (operation === "models") payload = { models: ["native-local-model", "native-local-model-vision"] };
      else if (operation === "test") payload = { ok: true, message: "连接成功，模型已响应" };
      else if (operation === "chat") payload = { content: "这是 Android 本机模式的真实回复。", reasoning: "", model: "native-local-model", usage: { input_tokens: 12, output_tokens: 9, total_tokens: 21 } };
      else payload = { error: "unexpected operation" };
      setTimeout(() => window.AtherloomNativeRequest(callbackId, JSON.stringify({ ok: true, status: 200, body: JSON.stringify(payload) })), 120);
    },
    apiRequest() {
      window.__atherloomNativeCalls.push(["apiRequest-sync"]);
      return JSON.stringify({ ok: false, status: 500, error: "本机模式不应调用 FastAPI" });
    },
    apiRequestAsync(method, path) {
      window.__atherloomNativeCalls.push(["apiRequestAsync", method, path]);
      throw new Error("本机模式不应调用 FastAPI");
    },
    saveFile(fileName, mimeType, base64, callbackId) {
      window.__atherloomNativeCalls.push(["saveFile", fileName, mimeType, base64.length]);
      window.__atherloomSavedFileText = new TextDecoder().decode(Uint8Array.from(atob(base64), character => character.charCodeAt(0)));
      setTimeout(() => window.AtherloomNativeFile(callbackId, JSON.stringify({ ok: true, message: "Android 系统文件已保存" })), 20);
    },
    chatStream() { throw new Error("本机模式不应调用后端 chatStream"); },
    cancelStream() {},
  };
})();
"""


def field(form, label: str, selector: str):
    return form.locator("label", has_text=label).locator(selector).first


def open_account_settings(page) -> None:
    page.locator(".sidebar").get_by_role("button", name=account_settings_name).click()
    page.get_by_role("heading", name="外观", exact=True).wait_for()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel="msedge", headless=True)
    context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3, has_touch=True)
    page = context.new_page()
    errors: list[str] = []
    network_api_calls: list[str] = []
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: network_api_calls.append(request.url) if "/api/" in request.url else None)
    page.add_init_script(native_bridge)

    page.goto(f"{base_url}/", wait_until="networkidle")
    page.get_by_role("button", name="打开菜单").click()
    open_account_settings(page)
    page.get_by_text("Android 本机模式", exact=True).wait_for()
    page.get_by_role("button", name="API 与网关", exact=True).click()
    page.get_by_role("heading", name="API 与网关", exact=True).wait_for()

    page.get_by_role("button", name="添加第一条线路").click()
    provider_form = page.locator("form.settings-edit-card").first
    field(provider_form, "显示名称", "input").fill("手机本机线路")
    field(provider_form, "官方或反代 Base URL", "input").fill("https://api.example.invalid/v1")
    field(provider_form, "当前默认模型", "input").fill("native-local-model")
    field(provider_form, "自定义请求头", "textarea").fill('{"Authorization":"secret-header"}')
    provider_form.get_by_role("button", name="粘贴", exact=True).click()
    page.get_by_text("已从 Android 剪贴板粘贴 37 个字符", exact=True).wait_for()
    assert field(provider_form, "API Key", "input").input_value() == "sk-android-native-clipboard-123456789"
    provider_form.get_by_role("button", name="拉取模型").click()
    page.get_by_text("已读取 2 个模型，请从下拉框选择。", exact=True).wait_for()
    provider_form.get_by_role("button", name="测试当前模型").click()
    page.get_by_text("连接成功，模型已响应", exact=True).wait_for()
    provider_form.get_by_role("button", name="保存线路与模型").click()
    page.get_by_text("线路已保存", exact=True).wait_for()
    provider_card = page.locator("article.settings-list-card", has_text="手机本机线路")
    provider_card.get_by_text("Key 已保存", exact=False).wait_for()

    page.get_by_role("button", name="人格指令", exact=True).click()
    proactive = page.get_by_role("switch", name="允许助手主动提问")
    proactive.click()
    page.get_by_text("设置已保存", exact=True).wait_for()
    persona_form = page.locator("form.persona-form")
    field(persona_form, "助手名称", "input").fill("本机人格")
    persona_form.get_by_label("专属模型线路").select_option(label="手机本机线路 · native-local-model")
    persona_form.get_by_role("button", name="保存人格").click()
    page.get_by_text("已保存「本机人格」", exact=True).wait_for()

    page.get_by_role("button", name="世界书", exact=True).click()
    page.get_by_role("button", name="添加世界书").click()
    worldbook_form = page.locator("form.worldbook-form")
    field(worldbook_form, "名称", "input").fill("本机世界书")
    worldbook_form.get_by_role("button", name="保存世界书").click()
    page.get_by_text("世界书已保存", exact=True).wait_for()

    calls_before_reload = page.evaluate("window.__atherloomNativeCalls")
    page.reload(wait_until="networkidle")
    page.get_by_role("button", name="打开菜单").click()
    open_account_settings(page)
    page.get_by_text("Android 本机模式", exact=True).wait_for()
    page.get_by_role("button", name="API 与网关", exact=True).click()
    page.get_by_role("heading", name="API 与网关", exact=True).wait_for()
    page.get_by_text("手机本机线路", exact=True).wait_for()
    provider_card = page.locator("article.settings-list-card", has_text="手机本机线路")
    provider_card.get_by_role("button", name="编辑").click()
    provider_form = page.locator("form.settings-edit-card").first
    assert field(provider_form, "API Key", "input").input_value() == ""
    field(provider_form, "显示名称", "input").fill("手机本机线路已编辑")
    provider_form.get_by_role("button", name="保存线路与模型").click()
    page.get_by_text("线路修改已保存", exact=True).wait_for()
    page.locator("article.settings-list-card", has_text="手机本机线路已编辑").get_by_text("Key 已保存", exact=False).wait_for()
    page.get_by_role("button", name="人格指令", exact=True).click()
    page.get_by_label("已保存的人格").get_by_text("本机人格", exact=True).wait_for()
    assert page.get_by_role("switch", name="允许助手主动提问").get_attribute("aria-checked") == "true"
    page.get_by_role("button", name="世界书", exact=True).click()
    page.get_by_text("本机世界书", exact=True).wait_for()
    page.get_by_role("button", name="备份与恢复", exact=True).click()
    page.get_by_role("button", name="导出备份").click()
    page.get_by_text("Android 系统文件已保存", exact=False).wait_for()
    backup = json.loads(page.evaluate("window.__atherloomSavedFileText"))
    backup_provider = backup["tables"]["standalone_state"][0]["providers"][0]
    assert "api_key" not in backup_provider
    assert backup_provider["custom_headers"] == "{}"

    page.get_by_role("button", name="关闭设置").click()
    composer = page.get_by_role("textbox", name="消息")
    composer.fill("请验证手机本机聊天")
    page.get_by_role("button", name="发送").click()
    page.get_by_text("这是 Android 本机模式的真实回复。", exact=True).wait_for()

    calls_before_second_reload = page.evaluate("window.__atherloomNativeCalls")
    page.reload(wait_until="networkidle")
    page.get_by_text("这是 Android 本机模式的真实回复。", exact=True).wait_for()
    page.screenshot(path=artifacts / "android-standalone-save.png", full_page=True)

    calls = calls_before_reload + calls_before_second_reload + page.evaluate("window.__atherloomNativeCalls")
    assert any(call[0] == "getClipboard" for call in calls), calls
    assert any(call[0] == "saveProvider" and call[2] == 37 for call in calls), calls
    assert any(call[0:2] == ["providerOperationAsync", "models"] for call in calls), calls
    assert any(call[0:2] == ["providerOperationAsync", "test"] for call in calls), calls
    assert any(call[0:2] == ["providerOperationAsync", "chat"] for call in calls), calls
    assert not any(call[0] in {"apiRequest-sync", "apiRequestAsync"} for call in calls), calls
    assert not network_api_calls, network_api_calls
    browser.close()

    if errors:
        raise AssertionError("Browser console errors:\n" + "\n".join(errors))

print(json.dumps({
    "screenshot": str(artifacts / "android-standalone-save.png"),
    "native_calls": calls,
    "network_api_calls": network_api_calls,
    "checks": [
        "Android native clipboard paste",
        "encrypted provider bridge save",
        "native model list and connection test",
        "empty-key edit preserves encrypted API key",
        "standalone backup omits API key and authorization headers",
        "local settings, persona and worldbook persistence",
        "local conversation and message persistence",
        "direct native provider chat",
        "zero FastAPI calls in standalone mode",
    ],
}, ensure_ascii=False, indent=2))
