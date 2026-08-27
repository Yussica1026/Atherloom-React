from __future__ import annotations

import importlib.util
import json
import mimetypes
from pathlib import Path
from urllib.parse import unquote, urlparse

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"
ARTIFACTS.mkdir(exist_ok=True)


def native_mock() -> str:
    smoke_path = ROOT / "tests" / "react_ui_smoke.py"
    spec = importlib.util.spec_from_file_location("atherloom_ui_smoke", smoke_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    source = module.NATIVE_MOCK.replace(
        "const providers = [];",
        "const providers = [{id: 'provider-book', name: '本机书籍线路', protocol: 'openai', base_url: 'https://example.invalid/v1', api_key: 'smoke-only', model: 'mock-book', models: ['mock-book'], enabled: true, max_tokens: 4096, temperature: 0.4, top_p: 1, thinking_enabled: false, stream_enabled: false}];",
    )
    anchor = "      else {\n        chatCount += 1;"
    branch = """      else if (String(request.system || '').includes('atherloom_book_analysis_protocol')) {
        body = {
          content: JSON.stringify({
            core_idea: '测试核心思想', frameworks: [], concepts: [], mental_models: [], methods: [],
            anti_patterns: [], decision_rules: [], worked_examples: [],
            key_takeaways: ['正文留在设备上', '整书任务复用缓存'], topic_tags: ['本地书库'],
            evidence_refs: [{locator: '当前章节', note: '回归夹具'}], quality_warnings: []
          }),
          reasoning: '', model: request.model || 'mock-book',
          usage: {prompt_tokens: 12, completion_tokens: 20, total_tokens: 32}
        };
      }
      else {
        chatCount += 1;"""
    assert anchor in source
    return source.replace(anchor, branch, 1)


def seeded_state() -> str:
    stamp = "2026-08-27T00:00:00.000Z"
    state = {
        "personas": [{
            "id": "persona-book",
            "name": "程栈",
            "prompt": "保持当前人格，用清楚的语言分析使用者主动提交的书籍。",
            "provider_id": "provider-book",
            "config": {"provider_id": "provider-book", "pinned": True},
            "created_at": stamp,
            "updated_at": stamp,
        }],
        "worldbooks": [],
        "conversations": [{
            "id": "conversation-book",
            "title": "共读回归",
            "persona_id": "persona-book",
            "provider_id": "provider-book",
            "created_at": stamp,
            "updated_at": stamp,
            "pinned": False,
            "starred": False,
            "archived": False,
        }],
        "messages": {"conversation-book": []},
        "settings": {"display_name": "枔枔"},
        "favorites": [],
        "memories": [],
        "mcpServers": [],
        "motivations": {},
    }
    payload = json.dumps(state, ensure_ascii=False)
    return f"""
      localStorage.setItem('atherloom-react:standalone-state:v1', {json.dumps(payload, ensure_ascii=False)});
      localStorage.setItem('atherloom-react:last-persona', 'persona-book');
      localStorage.setItem('atherloom-react:last-provider', 'provider-book');
      localStorage.setItem('atherloom-react:last-conversation', 'conversation-book');
      localStorage.setItem('atherloom-react:last-conversation:persona-book', 'conversation-book');
    """


def run() -> None:
    console_errors: list[str] = []
    page_errors: list[str] = []
    dialogs: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="msedge", headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 900})

        def serve_dist(route) -> None:
            request_path = unquote(urlparse(route.request.url).path).lstrip("/") or "index.html"
            candidate = (ROOT / "dist" / request_path).resolve()
            dist_root = (ROOT / "dist").resolve()
            if dist_root not in candidate.parents and candidate != dist_root:
                route.fulfill(status=404, body="not found")
                return
            if not candidate.is_file():
                candidate = dist_root / "index.html"
            content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
            route.fulfill(path=candidate, content_type=content_type)

        context.route("https://atherloom.local/**", serve_dist)
        page = context.new_page()
        page.add_init_script(native_mock())
        page.add_init_script(seeded_state())
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        def accept_dialog(dialog) -> None:
            dialogs.append(dialog.message)
            dialog.accept()

        page.on("dialog", accept_dialog)
        page.goto("https://atherloom.local/", wait_until="networkidle")

        page.locator(".sidebar-hub > summary").filter(has_text="共创空间").click()
        page.get_by_role("button", name="一起读书", exact=False).click()
        forge = page.locator(".book-forge")
        forge.wait_for()
        forge.locator(".book-forge-import input").set_input_files(ROOT / "tests" / "fixtures" / "book_forge_smoke.md")
        page.wait_for_timeout(1_500)
        assert "book_forge_smoke" in forge.inner_text(), (forge.inner_text(), console_errors, page_errors)
        assert forge.locator(".book-forge-chapter-list button").count() == 2
        assert "第一章 初见" in forge.locator(".book-forge-reader").inner_text()

        forge.get_by_label("当前章节笔记").fill("回归笔记：留在本机")
        forge.get_by_role("button", name="保存笔记").click()
        forge.get_by_text("回归笔记：留在本机", exact=False).wait_for()

        forge.get_by_role("button", name="分析本章", exact=True).click()
        forge.get_by_text("测试核心思想", exact=True).wait_for(timeout=10_000)
        operations = page.evaluate("window.__providerOperations")
        book_calls = [row for row in operations if "atherloom_book_analysis_protocol" in str(row.get("request", {}).get("system", ""))]
        assert len(book_calls) == 1, operations
        assert "保持当前人格" in book_calls[0]["request"]["system"]

        forge.get_by_role("button", name="整书炼制", exact=True).click()
        forge.get_by_text("已完成", exact=True).wait_for(timeout=15_000)
        assert any("1 章可直接使用缓存" in message and "还需调用模型分析 1 章" in message for message in dialogs), dialogs
        operations = page.evaluate("window.__providerOperations")
        book_calls = [row for row in operations if "atherloom_book_analysis_protocol" in str(row.get("request", {}).get("system", ""))]
        assert len(book_calls) == 2, book_calls
        assert "2 / 2" in forge.locator(".book-forge-job").inner_text()

        forge.get_by_role("button", name="导出 Agent Skill", exact=True).click()
        forge.get_by_text("Agent Skill 已导出", exact=False).wait_for()

        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(150)
        bounds = forge.bounding_box()
        assert bounds and bounds["x"] >= -1 and bounds["x"] + bounds["width"] <= 391, bounds
        assert page.evaluate("document.documentElement.scrollWidth === document.documentElement.clientWidth")
        page.screenshot(path=ARTIFACTS / "book-forge-mobile.png", full_page=True)

        page.set_viewport_size({"width": 1280, "height": 900})
        page.locator(".feature-hub-header > button").click()
        page.evaluate("console.warn('书库 smoke 小提醒')")
        page.locator(".profile-row").click()
        page.get_by_role("button", name="后台日志", exact=True).click()
        page.get_by_text("书库 smoke 小提醒", exact=True).wait_for()
        assert page.locator(".diagnostics-ledger > article").count() >= 2
        page.screenshot(path=ARTIFACTS / "background-diagnostics.png", full_page=True)

        assert not console_errors, console_errors
        assert not page_errors, page_errors
        browser.close()

    print("book forge + diagnostics smoke: ok")


if __name__ == "__main__":
    run()
