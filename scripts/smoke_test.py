import json
from pathlib import Path

from playwright.sync_api import Route, sync_playwright


root = Path(__file__).resolve().parents[1]
artifacts = root / "artifacts"
artifacts.mkdir(exist_ok=True)


def mock_chat(route: Route) -> None:
    events = [
        {"reasoning_delta": "先确认界面与流式协议。"},
        {"delta": "你好，枔枔。这里是 **Atherloom React** 迁移首版。"},
        {"delta": "\n\n- React + TypeScript\n- 真实 FastAPI 结构\n- Claude 风格暖色界面"},
        {
            "done": True,
            "assistant_id": "assistant-e2e",
            "user_id": "user-e2e",
            "title": "React 首版验证",
            "usage": {"input_tokens": 18, "output_tokens": 35, "total_tokens": 53},
        },
    ]
    route.fulfill(
        status=200,
        content_type="application/x-ndjson; charset=utf-8",
        body="\n".join(json.dumps(event, ensure_ascii=False) for event in events) + "\n",
    )


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel="msedge", headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 960}, device_scale_factor=1)
    console_errors: list[str] = []
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: console_errors.append(str(error)))
    page.route("**/api/chat", mock_chat)

    page.goto("http://127.0.0.1:5173/", wait_until="networkidle")
    page.get_by_role("heading", name="今天想聊些什么？").wait_for()

    page.get_by_role("button", name="打开设置").click()
    provider_form = page.locator("form.settings-form").first
    provider_form.get_by_label("显示名称").fill("本地验证线路")
    provider_form.get_by_label("Base URL").fill("https://example.invalid/v1")
    provider_form.get_by_label("API Key").fill("not-a-real-key")
    provider_form.get_by_label("模型 ID").fill("mock-model")
    provider_form.get_by_role("button", name="保存线路").click()
    page.get_by_text("线路已保存", exact=True).wait_for()

    page.get_by_role("button", name="人格指令").click()
    persona_form = page.locator("form.settings-form").first
    persona_form.get_by_label("人格名称").fill("阿栈 · 验证人格")
    persona_form.get_by_label("系统指令").fill("这是只用于界面测试的脱敏人格。")
    persona_form.get_by_role("button", name="保存人格").click()
    page.get_by_text("人格已保存", exact=True).wait_for()

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
        theme_metrics = page.evaluate("""() => ({
          name: document.documentElement.dataset.theme,
          background: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
          accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
        })""")
        assert theme_metrics == {"name": theme_name, "background": background, "accent": accent}, theme_metrics

    page.emulate_media(color_scheme="dark")
    swatches.get_by_role("button", name="跟随系统", exact=True).click()
    system_dark = page.evaluate("""() => ({
      name: document.documentElement.getAttribute('data-theme'),
      background: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    })""")
    assert system_dark == {"name": None, "background": "#24231f"}, system_dark
    page.emulate_media(color_scheme="light")
    system_light = page.evaluate("""() => ({
      name: document.documentElement.getAttribute('data-theme'),
      background: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    })""")
    assert system_light == {"name": None, "background": "#f7f6f2"}, system_light
    swatches.get_by_role("button", name="浅色", exact=True).click()
    page.screenshot(path=artifacts / "theme-palette.png", full_page=True)
    page.get_by_role("button", name="关闭设置").click()

    composer = page.get_by_role("textbox", name="消息")
    composer.fill("请介绍这个 React 首版。")
    page.get_by_role("button", name="发送").click()
    page.get_by_text("Atherloom React", exact=False).wait_for()
    page.locator(".conversation-title").get_by_text("React 首版验证", exact=True).wait_for()
    page.screenshot(path=artifacts / "react-desktop.png", full_page=True)

    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(250)
    page.get_by_role("button", name="打开菜单").click()
    page.locator(".sidebar").wait_for(state="visible")
    page.locator(".sidebar").get_by_text("React 首版验证", exact=True).wait_for()
    page.get_by_role("button", name="关闭侧栏").click()
    page.wait_for_timeout(250)
    mobile_metrics = page.evaluate("""() => {
      const main = document.querySelector('.main').getBoundingClientRect();
      const sidebar = document.querySelector('.sidebar').getBoundingClientRect();
      return {
        innerWidth: window.innerWidth,
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        mainLeft: Math.round(main.left),
        mainWidth: Math.round(main.width),
        sidebarRight: Math.round(sidebar.right),
      };
    }""")
    assert mobile_metrics == {
        "innerWidth": 390,
        "clientWidth": 390,
        "scrollWidth": 390,
        "mainLeft": 0,
        "mainWidth": 390,
        "sidebarRight": 0,
    }, mobile_metrics
    page.screenshot(path=artifacts / "react-mobile.png", full_page=True)

    browser.close()

    if console_errors:
        raise AssertionError("Browser console errors:\n" + "\n".join(console_errors))

print(json.dumps({
    "desktop": str(artifacts / "react-desktop.png"),
    "mobile": str(artifacts / "react-mobile.png"),
    "themes": str(artifacts / "theme-palette.png"),
    "mobile_metrics": mobile_metrics,
    "checks": ["bootstrap", "provider", "persona", "seven theme modes", "conversation", "chat stream", "markdown", "mobile sidebar"],
}, ensure_ascii=False, indent=2))
