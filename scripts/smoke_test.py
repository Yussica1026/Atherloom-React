import argparse
import json
from pathlib import Path
from uuid import uuid4

from playwright.sync_api import Route, sync_playwright


root = Path(__file__).resolve().parents[1]
artifacts = root / "artifacts"
artifacts.mkdir(exist_ok=True)

parser = argparse.ArgumentParser()
parser.add_argument("--base-url", default="http://127.0.0.1:5173")
base_url = parser.parse_args().base_url.rstrip("/")
run_id = uuid4().hex[:7]
seed_provider_name = f"待删除线路-{run_id}"
seed_persona_name = f"待删除人格-{run_id}"
seed_worldbook_name = f"待删除世界书-{run_id}"
provider_name = f"本地验证线路-{run_id}"
persona_name = f"阿栈 · 验证人格-{run_id}"
edited_persona_name = f"阿栈 · 已编辑-{run_id}"
worldbook_name = f"雾港设定集-{run_id}"
imported_worldbook_name = f"导入验证书-{run_id}"


def mock_chat(route: Route) -> None:
    events = [
        {"reasoning_delta": "先确认界面与流式协议。"},
        {"delta": "你好，测试用户。这里是 **Atherloom React** 设置迁移版。"},
        {"delta": "\n\n- React + TypeScript\n- 完整设置 CRUD\n- 旧版 Atherloom 视觉"},
        {
            "done": True,
            "assistant_id": "assistant-e2e",
            "user_id": "user-e2e",
            "title": "React 设置验证",
            "usage": {"input_tokens": 18, "output_tokens": 35, "total_tokens": 53},
        },
    ]
    route.fulfill(
        status=200,
        content_type="application/x-ndjson; charset=utf-8",
        body="\n".join(json.dumps(event, ensure_ascii=False) for event in events) + "\n",
    )


def mock_models(route: Route) -> None:
    route.fulfill(
        status=200,
        content_type="application/json; charset=utf-8",
        body=json.dumps({"models": ["mock-primary", "mock-vision", "mock-reasoner"]}),
    )


def mock_provider_test(route: Route) -> None:
    route.fulfill(
        status=200,
        content_type="application/json; charset=utf-8",
        body=json.dumps({"ok": True, "message": "测试连接成功"}, ensure_ascii=False),
    )


def provider_payload(name: str) -> dict:
    return {
        "name": name,
        "protocol": "deepseek",
        "base_url": "https://example.invalid",
        "api_key": "not-a-real-key",
        "model": "delete-me",
        "models": ["delete-me"],
        "enabled": True,
        "custom_headers": "{}",
        "prompt_cache": True,
        "thinking_enabled": True,
        "stream_enabled": True,
        "temperature": 0.7,
        "top_p": 1,
        "max_tokens": 4096,
        "vision_mode": "auto",
        "cache_mode": "auto",
        "prompt_cache_key": "",
    }


def field(form, label: str, selector: str):
    return form.locator("label", has_text=label).locator(selector).first


def set_switch(page, label: str, checked: bool) -> None:
    control = page.get_by_label(label)
    current = control.get_attribute("aria-checked") == "true" if control.get_attribute("role") == "switch" else control.is_checked()
    if current != checked:
        control.click()
    page.wait_for_function(
        "args => (args.control.matches('input') ? args.control.checked : args.control.getAttribute('aria-checked') === 'true') === args.checked",
        arg={"control": control.element_handle(), "checked": checked},
    )


def card(page, title: str):
    cards = page.locator("article.settings-list-card")
    titles: list[str] = []
    for index in range(cards.count()):
        current = cards.nth(index)
        heading = current.locator(".settings-list-copy > strong")
        if not heading.count():
            continue
        current_title = heading.inner_text().strip()
        titles.append(current_title)
        if current_title == title:
            return current
    raise AssertionError(f"没有找到设置卡片 {title!r}；当前卡片：{titles!r}")


def wait_card_gone(page, title: str) -> None:
    page.wait_for_function(
        "title => [...document.querySelectorAll('article.settings-list-card .settings-list-copy > strong')].every(node => node.textContent.trim() !== title)",
        arg=title,
    )


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel="msedge", headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 960}, device_scale_factor=1)
    console_errors: list[str] = []
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: console_errors.append(str(error)))
    page.on("dialog", lambda dialog: dialog.accept())
    page.route("**/api/chat", mock_chat)
    page.route("**/api/providers/models", mock_models)
    page.route("**/api/providers/test", mock_provider_test)

    seed_provider = page.request.post(f"{base_url}/api/providers", data=provider_payload(seed_provider_name))
    assert seed_provider.ok, seed_provider.text()
    seed_persona = page.request.post(f"{base_url}/api/personas", data={"name": seed_persona_name, "prompt": "仅供删除测试", "config": {}})
    assert seed_persona.ok, seed_persona.text()
    seed_worldbook = page.request.post(f"{base_url}/api/worldbooks", data={"name": seed_worldbook_name, "description": "仅供删除测试", "enabled": True, "entries": []})
    assert seed_worldbook.ok, seed_worldbook.text()

    page.goto(f"{base_url}/", wait_until="domcontentloaded")
    launch = page.locator("#launchScreen")
    launch.wait_for(state="visible")
    launch_metrics = page.evaluate("""() => ({
      mode: document.documentElement.dataset.launchMode,
      markAnimation: getComputedStyle(document.querySelector('.launch-mark')).animationName,
      drawAnimation: getComputedStyle(document.querySelector('.launch-a')).animationName,
      accent: getComputedStyle(document.querySelector('.launch-star')).fill,
    })""")
    assert launch_metrics == {
        "mode": "full",
        "markAnimation": "launchBreath",
        "drawAnimation": "launchDraw",
        "accent": "rgb(201, 100, 66)",
    }, launch_metrics
    page.wait_for_timeout(850)
    page.screenshot(path=artifacts / "launch-animation.png", full_page=True)
    launch.wait_for(state="detached", timeout=3000)
    page.wait_for_load_state("networkidle")
    page.get_by_role("heading", name="今天想聊些什么？").wait_for()
    page.get_by_role("button", name="打开设置").click()
    page.get_by_role("heading", name="API 与网关").wait_for()

    delete_provider_card = card(page, seed_provider_name)
    delete_provider_card.get_by_role("button", name="删除").click()
    wait_card_gone(page, seed_provider_name)

    page.get_by_role("button", name="添加线路").click()
    provider_form = page.locator("form.settings-edit-card").first
    field(provider_form, "供应商 / 协议", "select").select_option("deepseek")
    field(provider_form, "显示名称", "input").fill(provider_name)
    field(provider_form, "官方或反代 Base URL", "input").fill("https://example.invalid")
    field(provider_form, "API Key", "input").fill("not-a-real-key")
    field(provider_form, "当前默认模型", "input").fill("mock-primary")
    field(provider_form, "已配置的模型", "textarea").fill("mock-primary\nmock-reasoner")
    field(provider_form, "温度 Temperature", "input").fill("0.4")
    field(provider_form, "Top P", "input").fill("0.85")
    field(provider_form, "最大输出 Tokens", "input").fill("8192")
    field(provider_form, "图片能力", "select").select_option("openai")
    field(provider_form, "提示词缓存", "select").select_option("openai")
    field(provider_form, "OpenAI 缓存键", "input").fill("persona-e2e")
    field(provider_form, "自定义请求头", "textarea").fill('{"X-Test":"safe"}')
    provider_form.get_by_role("button", name="保存线路与模型").click()
    page.get_by_text("线路已保存", exact=True).wait_for()

    provider_card = card(page, provider_name)
    provider_text = provider_card.inner_text()
    provider_state = page.request.get(f"{base_url}/api/bootstrap").json()["providers"]
    assert "mock-reasoner" in provider_text, json.dumps({"card": provider_text, "providers": provider_state}, ensure_ascii=True)
    provider_card.get_by_role("button", name="编辑").click()
    provider_form = page.locator("form.settings-edit-card").first
    assert field(provider_form, "API Key", "input").input_value() == ""
    assert "留空" in field(provider_form, "API Key", "input").get_attribute("placeholder")
    provider_form.get_by_role("button", name="拉取模型").click()
    fetched = provider_form.get_by_label("选择已拉取的模型")
    fetched.wait_for()
    fetched.select_option("mock-vision")
    provider_form.get_by_role("button", name="测试当前模型").click()
    page.get_by_text("测试连接成功", exact=True).wait_for()
    provider_form.get_by_role("button", name="保存线路与模型").click()
    page.get_by_text("线路修改已保存", exact=True).wait_for()
    provider_card = card(page, provider_name)
    provider_card.get_by_text("mock-vision", exact=True).wait_for()
    vision_select = page.get_by_label("图片理解线路")
    vision_select.select_option(label=f"{provider_name} · mock-vision")

    page.screenshot(path=artifacts / "settings-api-desktop.png", full_page=True)

    page.get_by_role("button", name="人格指令", exact=True).click()
    set_switch(page, "允许助手主动提问", True)
    page.wait_for_timeout(800)
    saved_settings = page.request.get(f"{base_url}/api/bootstrap").json()["settings"]
    assert saved_settings["proactive_questions"] is True, json.dumps(saved_settings, ensure_ascii=True)
    delete_persona_card = card(page, seed_persona_name)
    delete_persona_card.get_by_role("button", name="删除").click()
    wait_card_gone(page, seed_persona_name)

    persona_form = page.locator("form.persona-form")
    field(persona_form, "助手名称", "input").fill(persona_name)
    page.get_by_label("专属模型线路").select_option(label=f"{provider_name} · mock-vision")
    set_switch(page, "置顶人格", True)
    page.get_by_role("button", name="提示词", exact=True).click()
    field(persona_form, "系统提示词", "textarea").fill("这是只用于界面测试的脱敏人格。")
    field(persona_form, "聊天内容模板", "textarea").fill("[{{time}}] {{role}}：{{message}}")
    page.get_by_role("button", name="快捷短语", exact=True).click()
    field(persona_form, "快捷短语", "textarea").fill("继续说下去\n帮我整理成清单")
    page.get_by_role("button", name="自定义请求", exact=True).click()
    field(persona_form, "自定义 Header", "textarea").fill('{"X-Persona":"safe"}')
    field(persona_form, "自定义 Body", "textarea").fill('{"safe":true}')
    page.get_by_role("button", name="正则替换", exact=True).click()
    field(persona_form, "正则规则", "textarea").fill('[{"pattern":"foo","replacement":"bar","flags":"g","target":"assistant"}]')
    page.get_by_role("button", name="记忆", exact=True).click()
    field(persona_form, "摘要更新频率", "input").fill("12")
    set_switch(page, "参考历史聊天记录", False)
    page.get_by_role("button", name="MCP", exact=True).click()
    field(persona_form, "绑定 MCP 服务", "textarea").fill("safe-mcp")
    persona_form.get_by_role("button", name="保存人格").click()
    page.get_by_text(f"已保存「{persona_name}」", exact=True).wait_for()
    persona_card = card(page, f"● {persona_name}")
    persona_card.get_by_role("button", name="编辑").click()
    field(persona_form, "助手名称", "input").fill(edited_persona_name)
    persona_form.get_by_role("button", name="保存修改").click()
    page.get_by_text(f"已保存「{edited_persona_name}」", exact=True).wait_for()
    page.screenshot(path=artifacts / "settings-persona-desktop.png", full_page=True)

    page.get_by_role("button", name="世界书", exact=True).click()
    delete_worldbook_card = card(page, seed_worldbook_name)
    delete_worldbook_card.get_by_role("button", name="删除").click()
    wait_card_gone(page, seed_worldbook_name)
    page.get_by_role("button", name="添加世界书").click()
    worldbook_form = page.locator("form.worldbook-form")
    field(worldbook_form, "名称", "input").fill(worldbook_name)
    field(worldbook_form, "简介", "input").fill("脱敏世界书功能验证")
    worldbook_form.get_by_role("button", name="添加条目").click()
    entry_form = page.locator("form.entry-editor")
    field(entry_form, "条目名称", "input").fill("港口规则")
    field(entry_form, "内容", "textarea").fill("雾港在夜里关闭北门。")
    entry_form.get_by_text("常驻激活", exact=True).click()
    field(entry_form, "关键词", "textarea").fill("雾港\n北门")
    entry_form.get_by_text("使用正则", exact=True).click()
    field(entry_form, "扫描深度", "input").fill("8")
    field(entry_form, "注入位置", "select").select_option("history_before")
    field(entry_form, "注入角色", "select").select_option("assistant")
    field(entry_form, "优先级", "input").fill("9")
    entry_form.get_by_role("button", name="保存条目").click()
    worldbook_form.get_by_text("港口规则", exact=True).wait_for()
    worldbook_form.get_by_role("button", name="保存世界书").click()
    page.get_by_text("世界书已保存", exact=True).wait_for()
    worldbook_card = card(page, worldbook_name)
    worldbook_card.get_by_text("1 个条目", exact=False).wait_for()
    worldbook_card.get_by_role("button", name="编辑").click()
    worldbook_form = page.locator("form.worldbook-form")
    field(worldbook_form, "简介", "input").fill("已经完成编辑验证")
    worldbook_form.get_by_role("button", name="保存世界书").click()
    page.get_by_text("世界书修改已保存", exact=True).wait_for()

    with page.expect_download() as download_info:
        page.get_by_role("button", name="导出", exact=True).click()
    assert download_info.value.suggested_filename.startswith("atherloom-worldbooks-")

    import_file = artifacts / "worldbook-import-e2e.json"
    import_file.write_text(json.dumps({
        "format": "atherloom-worldbooks",
        "version": 1,
        "worldbooks": [{"name": imported_worldbook_name, "description": "导入后删除", "enabled": True, "entries": []}],
    }, ensure_ascii=False), encoding="utf-8")
    page.locator('input[type="file"][accept*="json"]').set_input_files(import_file)
    page.locator("article.settings-list-card .settings-list-copy > strong").get_by_text(imported_worldbook_name, exact=True).wait_for()
    imported_card = card(page, imported_worldbook_name)
    imported_card.wait_for()
    imported_card.get_by_role("button", name="删除").click()
    wait_card_gone(page, imported_worldbook_name)
    page.screenshot(path=artifacts / "settings-worldbook-desktop.png", full_page=True)

    page.get_by_role("button", name="备份与恢复", exact=True).click()
    page.get_by_role("heading", name="备份与恢复").wait_for()
    with page.expect_download() as backup_download_info:
        page.get_by_role("button", name="导出备份").click()
    backup_download = backup_download_info.value
    backup_file = artifacts / f"backup-e2e-{run_id}.json"
    backup_download.save_as(backup_file)
    backup_bundle = json.loads(backup_file.read_text(encoding="utf-8"))
    assert backup_bundle["format"] == "atherloom-backup" and backup_bundle["version"] == 2
    assert set(backup_bundle["parts"]) == {"conversations", "personas", "memory", "settings", "games"}
    assert all(provider["api_key"] == "" and provider["custom_headers"] == "{}" for provider in backup_bundle["tables"]["providers"])
    assert "atherloom-react:api-base" not in backup_bundle.get("client_data", {})
    page.locator('.settings-section input[type="file"]').set_input_files(backup_file)
    page.get_by_text("恢复完成；恢复前快照：", exact=False).wait_for()
    page.wait_for_timeout(1200)
    page.wait_for_load_state("networkidle")
    page.get_by_role("button", name="打开设置").click()
    page.get_by_role("heading", name="API 与网关").wait_for()

    page.get_by_role("button", name="外观", exact=True).click()
    swatches = page.locator(".theme-swatches")
    expected_themes = {
        "浅色": ("light", "#f7f6f2", "#c96442"),
        "深色": ("dark", "#24231f", "#c96442"),
        "水色": ("water", "#f2f8f8", "#4f9298"),
        "薄荷绿": ("mint", "#f5fbf8", "#6aa88b"),
        "丁香": ("lilac", "#f7f4fa", "#8d6fa1"),
        "腮红": ("blush", "#fbf5f6", "#b87382"),
    }
    for label, (theme_name, background, accent) in expected_themes.items():
        swatches.get_by_role("button", name=label, exact=True).click()
        metrics = page.evaluate("""() => ({
          name: document.documentElement.dataset.theme,
          background: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
          accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
        })""")
        assert metrics == {"name": theme_name, "background": background, "accent": accent}, metrics
    swatches.get_by_role("button", name="浅色", exact=True).click()

    page.get_by_role("button", name="API 与网关", exact=True).click()
    provider_card = card(page, provider_name)
    provider_card.get_by_role("button", name="编辑").click()
    page.set_viewport_size({"width": 390, "height": 844})
    page.locator(".settings-content").evaluate("node => { node.scrollTop = 0; }")
    page.wait_for_timeout(250)
    mobile_metrics = page.evaluate("""() => {
      const input = document.querySelector('.settings-edit-card input');
      const heading = document.querySelector('.settings-section h3');
      return {
        innerWidth: window.innerWidth,
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        inputWeight: getComputedStyle(input).fontWeight,
        inputSize: getComputedStyle(input).fontSize,
        headingFamily: getComputedStyle(heading).fontFamily,
      };
    }""")
    assert mobile_metrics["innerWidth"] == mobile_metrics["clientWidth"] == mobile_metrics["scrollWidth"] == 390, mobile_metrics
    assert mobile_metrics["inputWeight"] == "400", mobile_metrics
    assert mobile_metrics["inputSize"] == "14px", mobile_metrics
    assert "Georgia" in mobile_metrics["headingFamily"], mobile_metrics
    page.screenshot(path=artifacts / "settings-api-mobile.png", full_page=True)
    page.get_by_role("button", name="关闭设置").click()

    composer = page.get_by_role("textbox", name="消息")
    composer.fill("请介绍这个 React 设置迁移版。")
    page.get_by_role("button", name="发送").click()
    page.get_by_text("Atherloom React", exact=False).wait_for()
    page.locator(".conversation-title").get_by_text("React 设置验证", exact=True).wait_for()
    page.get_by_role("button", name="打开菜单").click()
    page.get_by_role("button", name="对话操作：React 设置验证").click()
    managed_title = f"会话管理验证-{run_id}"
    page.get_by_role("button", name="重命名").click()
    page.get_by_label("对话名称").fill(managed_title)
    page.get_by_role("button", name="保存名称").click()
    page.get_by_role("button", name=managed_title, exact=True).wait_for()
    page.get_by_role("button", name="置顶", exact=True).click()
    page.get_by_role("heading", name="置顶", exact=True).wait_for()
    page.get_by_role("button", name="星标", exact=True).click()
    page.get_by_role("button", name="归档", exact=True).click()
    page.get_by_role("heading", name="已归档", exact=True).wait_for()
    page.get_by_role("button", name="取消归档", exact=True).click()
    page.get_by_label("搜索当前人格的对话").fill(run_id)
    managed_history = page.locator("button.history-item", has_text=managed_title)
    managed_history.wait_for()
    page.get_by_label("搜索当前人格的对话").fill("")
    managed_history.click()
    page.locator(".conversation-title").get_by_text(managed_title, exact=True).wait_for()
    deleted_conversation_id = page.evaluate("localStorage.getItem('atherloom-react:last-conversation')")
    saved_conversation = next(item for item in page.request.get(f"{base_url}/api/bootstrap").json()["conversations"] if item["id"] == deleted_conversation_id)
    assert saved_conversation["title"] == managed_title and saved_conversation["pinned"] and saved_conversation["starred"] and not saved_conversation["archived"], saved_conversation
    assert any(item["id"] == deleted_conversation_id for item in page.request.get(f"{base_url}/api/search?q={run_id}").json())
    page.get_by_role("button", name="打开菜单").click()
    page.get_by_role("button", name="删除这条对话").click()
    managed_history.wait_for(state="detached")
    backend_conversations = page.request.get(f"{base_url}/api/bootstrap").json()["conversations"]
    assert deleted_conversation_id and all(item["id"] != deleted_conversation_id for item in backend_conversations)
    page.screenshot(path=artifacts / "react-mobile.png", full_page=True)

    browser.close()

    if console_errors:
        raise AssertionError("Browser console errors:\n" + "\n".join(console_errors))

print(json.dumps({
    "settings_api_desktop": str(artifacts / "settings-api-desktop.png"),
    "launch_animation": str(artifacts / "launch-animation.png"),
    "settings_persona_desktop": str(artifacts / "settings-persona-desktop.png"),
    "settings_worldbook_desktop": str(artifacts / "settings-worldbook-desktop.png"),
    "settings_api_mobile": str(artifacts / "settings-api-mobile.png"),
    "mobile_metrics": mobile_metrics,
    "checks": [
        "provider create/edit/delete", "saved key preservation", "model fetch and native select", "provider test",
        "vision route", "persona eight panes/create/edit/delete", "worldbook entry/create/edit/delete/import/export",
        "sanitized full backup and selective restore", "conversation delete against real backend",
        "conversation rename/pin/star/archive and search",
        "seven themes", "old typography", "old launch animation", "mobile width", "chat stream",
    ],
}, ensure_ascii=False, indent=2))
