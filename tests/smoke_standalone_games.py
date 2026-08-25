from __future__ import annotations

import json
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = "http://127.0.0.1:4199"
ROOT = Path(__file__).resolve().parents[1]


STATE = {
    "personas": [{
        "id": "persona-smoke",
        "name": "同一人格",
        "prompt": "按用户配置自然交流。",
        "provider_id": "provider-smoke",
        "config": {"history_enabled": True},
    }],
    "worldbooks": [],
    "conversations": [{
        "id": "conversation-smoke",
        "title": "游戏链路测试",
        "provider_id": "provider-smoke",
        "persona_id": "persona-smoke",
        "created_at": "2026-08-25T00:00:00.000Z",
        "updated_at": "2026-08-25T00:00:00.000Z",
    }],
    "messages": {"conversation-smoke": []},
    "settings": {"display_name": "玩家", "auto_title_mode": "local"},
    "favorites": [],
    "memories": [],
    "mcpServers": [],
    "motivations": {},
}


INIT_SCRIPT = """
(() => {
  localStorage.clear();
  localStorage.setItem('atherloom-react:standalone-state:v1', __STATE__);
  localStorage.setItem('atherloom-react:last-persona', 'persona-smoke');
  localStorage.setItem('atherloom-react:last-provider', 'provider-smoke');
  localStorage.setItem('atherloom-react:last-conversation', 'conversation-smoke');
  localStorage.setItem('atherloom-react:last-conversation:persona-smoke', 'conversation-smoke');
  const provider = {
    id: 'provider-smoke', name: 'Smoke Provider', protocol: 'openai',
    base_url: 'https://example.invalid/v1', model: 'smoke-model', enabled: true,
    max_tokens: 2048, temperature: 0.4, top_p: 1,
    thinking_enabled: false, stream_enabled: false, has_api_key: true
  };
  window.__providerCalls = [];
  window.AtherloomNative = {
    getBackendUrl: () => '',
    setBackendUrl: () => JSON.stringify({ok:true}),
    listProviders: () => JSON.stringify([provider]),
    cancelStream: () => {},
    providerOperationAsync: (_operation, raw, callbackId) => {
      const payload = JSON.parse(raw);
      window.__providerCalls.push(payload);
      const serialized = JSON.stringify(payload);
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      const latestUser = [...messages].reverse().find((item) => item && item.role === 'user');
      const hasToolResult = messages.some((item) => item && (item.role === 'tool' || String(item.content || '').includes('atherloom_tool_results')));
      let result;
      if (serialized.includes('return_one_legal_action_json')) {
        if (serialized.includes('rock_paper_scissors')) result = {content: JSON.stringify({choice:'scissors'}), model:'smoke-model'};
        else {
          const match = String(payload.system || '').match(/"legal_positions"\s*:\s*\[([^\]]*)\]/);
          const legal = match ? match[1].match(/\\d+/g)?.map(Number) || [] : [];
          result = {content: JSON.stringify({position: legal[0]}), model:'smoke-model'};
        }
      } else if (serialized.includes('reply_to_verified_game_result')) {
        result = {content:'这局已经接回原来的聊天了。', model:'smoke-model'};
      } else if (serialized.includes('atherloom_open_game') && !hasToolResult) {
        const gameId = String(latestUser?.content || '').includes('猜拳') ? 'rock_paper_scissors' : 'tic_tac_toe';
        result = {content:'', model:'smoke-model', tool_calls:[{id:'open-game-smoke', name:'atherloom_open_game', arguments:{game_id:gameId}}]};
      } else {
        result = {content:'游戏已经打开。', model:'smoke-model'};
      }
      setTimeout(() => window.AtherloomNativeRequest(callbackId, JSON.stringify({ok:true,status:200,body:JSON.stringify(result)})), 0);
    }
  };
})();
""".replace("__STATE__", json.dumps(json.dumps(STATE, ensure_ascii=False)))


def open_games(page) -> None:
    page.get_by_role("button", name="打开菜单").click()
    page.get_by_role("button", name="休闲游戏").click()
    page.get_by_role("heading", name="休闲游戏").wait_for()


def main() -> None:
    errors: list[str] = []
    with sync_playwright() as playwright:
        edge = Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
        browser = playwright.chromium.launch(headless=True, executable_path=str(edge) if edge.exists() else None)
        page = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.add_init_script(INIT_SCRIPT)
        page.goto(BASE_URL)
        page.wait_for_load_state("networkidle")

        open_games(page)
        page.locator(".cg-hub-games article.is-tic_tac_toe").get_by_role("button", name="开始新一局").click()
        page.get_by_role("heading", name="井字棋").wait_for()
        page.locator(".cg-cell").nth(0).click()
        try:
            page.wait_for_function("document.querySelectorAll('.cg-cell.is-persona').length === 1")
        except Exception:
            print(json.dumps(page.locator("body").inner_text(), ensure_ascii=True))
            print(json.dumps(page.evaluate("window.__providerCalls"), ensure_ascii=True))
            print(json.dumps(page.evaluate("localStorage.getItem('atherloom-react:standalone-casual-games:v1')"), ensure_ascii=True))
            raise
        page.locator(".cg-cell").nth(3).click()
        page.wait_for_function("document.querySelectorAll('.cg-cell.is-persona').length === 2")
        page.locator(".cg-cell").nth(6).click()
        page.get_by_text("这一局，你赢了。").wait_for()
        page.get_by_text("赛后回复已经回到").wait_for()
        page.get_by_role("button", name="记住这局").click()
        page.get_by_text("这局已经留进").wait_for()
        standalone_state = json.loads(page.evaluate("localStorage.getItem('atherloom-react:standalone-state:v1')"))
        assert standalone_state["memories"][0]["persona_key"] == "persona-smoke"
        assert standalone_state["memories"][0]["provenance"]["reality_scope"] == "real_interaction"
        page.get_by_role("button", name="回到对话").click()
        page.get_by_text("这局已经接回原来的聊天了。").wait_for()

        open_games(page)
        page.locator(".cg-hub-games article.is-rock_paper_scissors").get_by_role("button", name="开始新一局").click()
        page.get_by_role("heading", name="石头 · 剪刀 · 布").wait_for()
        page.locator(".cg-rps-choices button").nth(0).click()
        page.get_by_text("这一局，你赢了。").wait_for()
        calls = page.evaluate("window.__providerCalls")
        rps_turn = next(call for call in reversed(calls) if "return_one_legal_action_json" in json.dumps(call))
        assert '"user_choice":"rock"' not in rps_turn["system"]
        assert '"user_choice_committed":true' in rps_turn["system"]
        page.get_by_text("赛后回复已经回到").wait_for()
        page.get_by_role("button", name="回到对话").click()

        page.get_by_role("textbox", name="消息").fill("陪我玩井字棋")
        page.get_by_role("button", name="发送").click()
        page.get_by_role("heading", name="井字棋").wait_for()
        page.locator(".cg-room-header > button").click()
        open_games(page)
        assert page.get_by_text("未完成的对局").is_visible()
        assert page.locator(".cg-hub-sessions > button").count() >= 1

        screenshot = ROOT / "artifacts" / "standalone-games-smoke.png"
        screenshot.parent.mkdir(exist_ok=True)
        page.screenshot(path=str(screenshot), full_page=True)
        assert not errors, errors
        browser.close()
    print("standalone games smoke: PASS")


if __name__ == "__main__":
    main()
