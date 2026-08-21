import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


root = Path(__file__).resolve().parents[1]
artifacts = root / "artifacts"
artifacts.mkdir(exist_ok=True)

parser = argparse.ArgumentParser()
parser.add_argument("--base-url", default="http://127.0.0.1:5173")
base_url = parser.parse_args().base_url.rstrip("/")

native_bridge = r"""
(() => {
  const provider = {
    id: "provider-android",
    name: "Android 原生桥线路",
    protocol: "openai",
    base_url: "https://example.invalid/v1",
    model: "native-mock-model",
    models: ["native-mock-model"],
    enabled: true,
    custom_headers: "{}",
    prompt_cache: true,
    thinking_enabled: true,
    stream_enabled: true,
    temperature: 0.7,
    top_p: 1,
    max_tokens: 4096,
    vision_mode: "auto",
    cache_mode: "auto",
    prompt_cache_key: "",
    has_api_key: true,
  };
  const personaA = { id: "persona-a", name: "人格甲", prompt: "甲", config: { provider_id: provider.id, startup_chat: "resume" } };
  const personaB = { id: "persona-b", name: "人格乙", prompt: "乙", config: { provider_id: provider.id, startup_chat: "resume" } };
  const stamp = new Date().toISOString();
  const state = {
    providers: [provider],
    personas: [personaA, personaB],
    worldbooks: [],
    conversations: [
      { id: "conversation-a1", title: "甲对话一", provider_id: provider.id, persona_id: personaA.id, updated_at: stamp },
      { id: "conversation-a2", title: "甲对话二", provider_id: provider.id, persona_id: personaA.id, updated_at: stamp },
      { id: "conversation-b1", title: "乙对话一", provider_id: provider.id, persona_id: personaB.id, updated_at: stamp },
      { id: "conversation-b2", title: "乙对话二", provider_id: provider.id, persona_id: personaB.id, updated_at: stamp },
    ],
    settings: {
      display_name: "Android",
      proactive_questions: false,
      typing_presence_enabled: true,
      vision_provider_id: "",
    },
  };
  const messages = {
    "conversation-a1": [{ id: "message-a1", role: "assistant", content: "甲空间消息一" }],
    "conversation-a2": [{ id: "message-a2", role: "assistant", content: "甲空间消息二" }],
    "conversation-b1": [{ id: "message-b1", role: "assistant", content: "乙空间消息一" }],
    "conversation-b2": [{ id: "message-b2", role: "assistant", content: "乙空间消息二" }],
  };
  window.__atherloomNativeCalls = [];

  const success = payload => JSON.stringify({ ok: true, status: 200, body: JSON.stringify(payload) });
  const respond = (method, path, rawBody) => {
    const body = rawBody ? JSON.parse(rawBody) : {};
    if (method === "GET" && path === "/api/bootstrap") return success(state);
    if (method === "GET" && path.startsWith("/api/conversations/") && path.endsWith("/messages")) {
      const id = path.split("/")[3];
      return success(messages[id] || []);
    }
    if (method === "GET" && path.startsWith("/api/search?q=")) {
      const query = decodeURIComponent(path.slice("/api/search?q=".length));
      return success(state.conversations.filter(item => item.title.includes(query) || (messages[item.id] || []).some(message => message.content.includes(query))));
    }
    if (method === "PUT" && path === "/api/settings") {
      state.settings = body;
      return success(state.settings);
    }
    if (method === "PUT" && path === "/api/providers/provider-android") {
      state.providers[0] = { ...provider, ...body, id: provider.id, has_api_key: true };
      return success(state.providers[0]);
    }
    if (method === "POST" && path === "/api/personas") {
      const persona = { ...body, id: "persona-android", created_at: new Date().toISOString() };
      state.personas.push(persona);
      return success(persona);
    }
    if (method === "POST" && path === "/api/conversations") {
      const id = `conversation-created-${state.conversations.length + 1}`;
      const conversation = { id, title: "新对话", provider_id: body.provider_id, persona_id: body.persona_id, updated_at: new Date().toISOString() };
      state.conversations.unshift(conversation);
      messages[id] = [];
      return success(conversation);
    }
    if (method === "PATCH" && path.startsWith("/api/conversations/") && path.endsWith("/state")) {
      const id = path.split("/")[3];
      const conversation = state.conversations.find(item => item.id === id);
      if (!conversation) return JSON.stringify({ ok: false, status: 404, error: "conversation missing" });
      Object.assign(conversation, body, { updated_at: new Date().toISOString() });
      return success(conversation);
    }
    if (method === "PATCH" && path.startsWith("/api/conversations/")) {
      const id = path.split("/")[3];
      const conversation = state.conversations.find(item => item.id === id);
      if (!conversation) return JSON.stringify({ ok: false, status: 404, error: "conversation missing" });
      Object.assign(conversation, body, { updated_at: new Date().toISOString() });
      return success(conversation);
    }
    if (method === "DELETE" && path.startsWith("/api/conversations/")) {
      const id = path.split("/")[3];
      state.conversations = state.conversations.filter(item => item.id !== id);
      delete messages[id];
      return success({ deleted: true });
    }
    if (method === "POST" && path === "/api/worldbooks") {
      const worldbook = { ...body, id: "worldbook-android", created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      state.worldbooks.unshift(worldbook);
      return success(worldbook);
    }
    if (method === "POST" && path === "/api/backup/export") {
      return success({ format: "atherloom-backup", version: 2, exported_at: new Date().toISOString(), parts: body.parts, tables: {}, secrets_omitted: ["providers.api_key"] });
    }
    if (method === "POST" && path === "/api/backup/restore") {
      return success({ ok: true, parts: body.parts, tables: {}, snapshot: "local.pre-restore-android.bak", secrets_restored: false });
    }
    return JSON.stringify({ ok: false, status: 404, error: `unexpected ${method} ${path}` });
  };

  window.AtherloomNative = {
    getBackendUrl() { return "https://backend.example.invalid"; },
    setBackendUrl(value) {
      window.__atherloomNativeCalls.push(["setBackendUrl", value]);
      return JSON.stringify({ ok: true, value });
    },
    apiRequest(method, path, body) {
      window.__atherloomNativeCalls.push(["apiRequest-sync", method, path, body]);
      return JSON.stringify({ ok: false, status: 500, error: "同步原生请求不应再被调用" });
    },
    apiRequestAsync(method, path, body, callbackId) {
      window.__atherloomNativeCalls.push(["apiRequestAsync", method, path, body]);
      setTimeout(() => window.AtherloomNativeRequest(callbackId, respond(method, path, body)), 180);
    },
    saveFile(fileName, mimeType, base64, callbackId) {
      window.__atherloomNativeCalls.push(["saveFile", fileName, mimeType, base64.length]);
      setTimeout(() => window.AtherloomNativeFile(callbackId, JSON.stringify({ ok: true, message: "Android 系统文件已保存" })), 40);
    },
    chatStream() {},
    cancelStream() {},
  };
})();
"""


def field(form, label: str, selector: str):
    return form.locator("label", has_text=label).locator(selector).first


def touch(page, locator) -> None:
    locator.scroll_into_view_if_needed()
    box = locator.bounding_box()
    assert box, f"控件不可触摸：{locator}"
    page.touchscreen.tap(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)


def long_press(page, locator) -> None:
    locator.scroll_into_view_if_needed()
    box = locator.bounding_box()
    assert box, f"控件不可长按：{locator}"
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    session = page.context.new_cdp_session(page)
    session.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y, "radiusX": 4, "radiusY": 4, "force": 1}]})
    page.wait_for_timeout(380)
    session.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    session.detach()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel="msedge", headless=True)
    page = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=3, has_touch=True)
    errors: list[str] = []
    network_api_calls: list[str] = []
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: network_api_calls.append(request.url) if "/api/" in request.url else None)
    page.on("dialog", lambda dialog: dialog.accept())
    page.add_init_script(native_bridge)

    page.goto(f"{base_url}/", wait_until="networkidle")
    page.get_by_text("甲空间消息一", exact=True).wait_for()
    assert page.locator(".topbar").get_by_role("button", name="打开设置").count() == 0
    page.get_by_role("button", name="打开菜单").click()
    page.locator(".sidebar").get_by_role("button", name="打开设置").click()
    page.get_by_role("heading", name="API 与网关").wait_for()

    provider_card = page.locator("article.settings-list-card", has_text="Android 原生桥线路")
    provider_card.get_by_role("button", name="编辑").click()
    provider_form = page.locator("form.settings-edit-card").first
    field(provider_form, "显示名称", "input").fill("Android 保存成功线路")
    provider_form.get_by_role("button", name="保存线路与模型").click()
    page.get_by_text("正在保存线路修改…", exact=True).wait_for()
    page.get_by_text("线路修改已保存", exact=True).wait_for()
    page.get_by_text("Android 保存成功线路", exact=True).wait_for()

    page.get_by_role("button", name="人格指令", exact=True).click()
    proactive = page.get_by_role("switch", name="允许助手主动提问")
    assert proactive.get_attribute("aria-checked") == "false"
    touch(page, proactive)
    page.wait_for_function("node => node.getAttribute('aria-checked') === 'true'", arg=proactive.element_handle())
    page.get_by_text("正在保存主动提问设置…", exact=True).wait_for()
    page.get_by_text("设置已保存", exact=True).wait_for()

    persona_form = page.locator("form.persona-form")
    field(persona_form, "助手名称", "input").fill("Android 保存人格")
    persona_form.get_by_role("button", name="保存人格").click()
    page.get_by_text("正在保存人格…", exact=True).wait_for()
    page.get_by_text("已保存「Android 保存人格」", exact=True).wait_for()

    page.get_by_role("button", name="世界书", exact=True).click()
    page.get_by_role("button", name="添加世界书").click()
    worldbook_form = page.locator("form.worldbook-form")
    field(worldbook_form, "名称", "input").fill("Android 保存世界书")
    worldbook_form.get_by_role("button", name="保存世界书").click()
    page.get_by_text("正在保存世界书…", exact=True).wait_for()
    page.get_by_text("世界书已保存", exact=True).wait_for()
    page.get_by_text("Android 保存世界书", exact=True).wait_for()

    page.get_by_role("button", name="关闭设置").click()
    persona_a_button = page.locator(".sidebar-personas").get_by_title("人格甲")
    persona_b_button = page.locator(".sidebar-personas").get_by_title("人格乙")
    persona_a_button.click()
    page.get_by_text("甲空间消息一", exact=True).wait_for()
    assert page.get_by_text("乙对话一", exact=True).count() == 0
    composer = page.get_by_role("textbox", name="消息")
    composer.fill("甲人格独立草稿")
    assert page.evaluate("localStorage.getItem('atherloom-react:draft:persona-a:conversation-a1')") == "甲人格独立草稿"
    persona_b_button.click()
    page.get_by_text("乙空间消息一", exact=True).wait_for()
    assert page.get_by_text("甲对话一", exact=True).count() == 0
    persona_a_button.click()
    page.get_by_text("甲空间消息一", exact=True).wait_for()
    page.wait_for_timeout(500)
    assert composer.input_value() == "甲人格独立草稿", page.evaluate("Object.fromEntries(Object.entries(localStorage))")

    page.get_by_role("button", name="对话操作：甲对话二").click()
    page.get_by_role("button", name="重命名").click()
    page.get_by_label("对话名称").fill("甲的旧事")
    page.get_by_role("button", name="保存名称").click()
    page.get_by_role("button", name="甲的旧事", exact=True).wait_for()
    page.get_by_role("button", name="置顶", exact=True).click()
    page.get_by_role("heading", name="置顶", exact=True).wait_for()
    page.get_by_role("button", name="星标", exact=True).click()
    page.get_by_role("button", name="归档", exact=True).click()
    page.get_by_role("heading", name="已归档", exact=True).wait_for()
    page.get_by_role("button", name="取消归档", exact=True).click()
    page.get_by_label("搜索当前人格的对话").fill("空间消息二")
    managed_history = page.locator("button.history-item", has_text="甲的旧事")
    managed_history.wait_for()
    page.get_by_label("搜索当前人格的对话").fill("")
    delete_row = page.get_by_role("button", name="删除这条对话")
    if delete_row.count() and delete_row.is_visible():
        page.get_by_role("button", name="对话操作：甲的旧事").click()
        delete_row.wait_for(state="detached")

    long_press(page, managed_history)
    delete_row.wait_for()
    touch(page, delete_row)
    managed_history.wait_for(state="detached")
    assert page.get_by_text("甲空间消息一", exact=True).is_visible()

    persona_b_button.click()
    page.get_by_text("乙空间消息一", exact=True).wait_for()
    page.get_by_role("button", name="对话操作：乙对话一").click()
    touch(page, page.get_by_role("button", name="删除这条对话"))
    page.get_by_text("乙空间消息二", exact=True).wait_for()
    assert page.get_by_role("button", name="乙对话二", exact=True).is_visible()

    page.locator(".sidebar").get_by_role("button", name="打开设置").click()
    page.get_by_role("button", name="备份与恢复", exact=True).click()
    page.get_by_role("heading", name="备份与恢复").wait_for()
    touch(page, page.get_by_role("button", name="导出备份"))
    page.get_by_text("Android 系统文件已保存", exact=False).wait_for()

    backup_file = artifacts / "android-restore-e2e.json"
    backup_file.write_text(json.dumps({
        "format": "atherloom-backup",
        "version": 2,
        "exported_at": "2026-08-21T00:00:00Z",
        "parts": ["conversations", "personas", "memory", "settings", "games"],
        "tables": {},
        "client_data": {},
    }, ensure_ascii=False), encoding="utf-8")
    page.locator('.settings-section input[type="file"]').set_input_files(backup_file)
    page.wait_for_function("() => window.__atherloomNativeCalls.some(call => call[0] === 'apiRequestAsync' && call[1] === 'POST' && call[2] === '/api/backup/restore')")

    calls = page.evaluate("window.__atherloomNativeCalls")
    assert any(call[0:3] == ["apiRequestAsync", "PUT", "/api/providers/provider-android"] for call in calls), calls
    assert any(call[0:3] == ["apiRequestAsync", "PUT", "/api/settings"] for call in calls), calls
    assert any(call[0:3] == ["apiRequestAsync", "POST", "/api/personas"] for call in calls), calls
    assert any(call[0:3] == ["apiRequestAsync", "POST", "/api/worldbooks"] for call in calls), calls
    assert any(call[0:3] == ["apiRequestAsync", "DELETE", "/api/conversations/conversation-a2"] for call in calls), calls
    assert any(call[0:3] == ["apiRequestAsync", "DELETE", "/api/conversations/conversation-b1"] for call in calls), calls
    assert any(call[0:3] == ["apiRequestAsync", "POST", "/api/backup/export"] for call in calls), calls
    assert any(call[0] == "saveFile" for call in calls), calls
    assert any(call[0:3] == ["apiRequestAsync", "POST", "/api/backup/restore"] for call in calls), calls
    assert not any(call[0] == "apiRequest-sync" for call in calls), calls
    assert not network_api_calls, network_api_calls
    page.screenshot(path=artifacts / "android-settings-save.png", full_page=True)
    browser.close()

    if errors:
        raise AssertionError("Browser console errors:\n" + "\n".join(errors))

print(json.dumps({
    "screenshot": str(artifacts / "android-settings-save.png"),
    "native_calls": [call[:3] for call in calls],
    "network_api_calls": network_api_calls,
    "checks": [
        "top-right settings removed",
        "native async provider save",
        "real touch proactive switch",
        "native async persona save",
        "native async worldbook save",
        "persona-scoped conversations and drafts",
        "rename, pin, star, archive and full-text search",
        "touch long-press and menu conversation delete",
        "native backup export and selective restore",
    ],
}, ensure_ascii=False, indent=2))
