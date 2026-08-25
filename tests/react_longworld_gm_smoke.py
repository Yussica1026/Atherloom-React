from __future__ import annotations

import copy
import json
import os
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import Route, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"
ARTIFACTS.mkdir(exist_ok=True)
SCREENSHOT = ARTIFACTS / "longworld-gm-smoke.png"
BASE_URL = os.environ.get("ATHERLOOM_SMOKE_BASE_URL", "http://127.0.0.1:5173")

STAMP = "2026-08-24T08:00:00+00:00"
PLAYER = {"kind": "player", "id": "player-smoke"}
PROVIDER_ID = "provider-smoke"
WORLD_ID = "world-smoke"
SESSION_ID = "session-smoke"

world_state = {
    "schema_version": 1,
    "world_id": WORLD_ID,
    "world_version_id": "world-version-smoke",
    "session_id": SESSION_ID,
    "revision": 0,
    "turn": 0,
    "clock": {"total_minutes": 0},
    "player": {"id": PLAYER["id"], "display_name": "测试玩家", "location_id": "attic"},
    "ai_characters": {},
    "npcs": {},
    "locations": {
        "attic": {
            "id": "attic",
            "name": "潮汐阁楼",
            "description": "潮声从木板缝里透进来，一张车票压在旧灯下。",
            "exits": ["alley"],
            "visited": True,
        },
        "alley": {
            "id": "alley",
            "name": "灯影巷",
            "description": "巷口的灯沿着潮雾排开。",
            "exits": ["attic"],
            "visited": False,
        },
    },
    "items": {
        "ticket": {
            "id": "ticket",
            "name": "明日车票",
            "description": "票面只写着明日，没有终点。",
            "quantity": 1,
            "position": {"kind": "location", "location_id": "attic"},
        }
    },
    "relationships": {},
    "conditions": {},
    "quests": {},
    "open_threads": {},
    "facts": {
        "ticket-back": {
            "id": "ticket-back",
            "text": "车票背面藏着退潮时刻。",
            "known_by": [],
        }
    },
    "phone_threads": {},
}

world_detail = {
    "id": WORLD_ID,
    "name": "雾港回声",
    "description": "一座会替人保管未竟之事的港口。",
    "current_version": 1,
    "created_at": STAMP,
    "updated_at": STAMP,
    "version": {
        "id": "world-version-smoke",
        "version": 1,
        "definition_hash": "a" * 64,
        "definition": {
            "name": "雾港回声",
            "description": "一座会替人保管未竟之事的港口。",
            "starting_location_id": "attic",
            "locations": [
                {"id": "attic", "name": "潮汐阁楼", "description": "潮声从木板缝里透进来。", "exits": ["alley"]},
                {"id": "alley", "name": "灯影巷", "description": "巷口的灯沿着潮雾排开。", "exits": ["attic"]},
            ],
            "items": [{"id": "ticket", "name": "明日车票", "description": "票面只写着明日。", "initial_location_id": "attic", "quantity": 1}],
            "npcs": [],
            "facts": [{
                "id": "ticket-back",
                "text": "车票背面藏着退潮时刻。",
                "initially_known_by_player": False,
            }],
            "quests": [],
        },
    },
}

events: list[dict] = []
turns: list[dict] = []
gm_requests: list[dict] = []
unhandled_routes: list[str] = []


def session_detail() -> dict:
    hash_char = {0: "0", 1: "b", 2: "c"}.get(world_state["revision"], "d")
    return {
        "id": SESSION_ID,
        "world_id": WORLD_ID,
        "world_version_id": "world-version-smoke",
        "branch_name": "主线",
        "parent_session_id": None,
        "parent_revision": None,
        "current_revision": world_state["revision"],
        "state_hash": hash_char * 64,
        "state": copy.deepcopy(world_state),
        "created_at": STAMP,
        "updated_at": STAMP,
    }


def session_summary() -> dict:
    detail = session_detail()
    return {
        "id": detail["id"],
        "world_id": detail["world_id"],
        "world_name": world_detail["name"],
        "branch_name": detail["branch_name"],
        "parent_session_id": None,
        "parent_revision": None,
        "current_revision": detail["current_revision"],
        "state_hash": detail["state_hash"],
        "player": detail["state"]["player"],
        "ai_character_count": 0,
        "created_at": STAMP,
        "updated_at": STAMP,
    }


def fulfill(route: Route, payload: object, status: int = 200) -> None:
    route.fulfill(
        status=status,
        content_type="application/json; charset=utf-8",
        body=json.dumps(payload, ensure_ascii=False),
    )


def handle_api(route: Route) -> None:
    request = route.request
    parsed = urlparse(request.url)
    path = parsed.path
    method = request.method

    if method == "GET" and path == "/api/bootstrap":
        fulfill(route, {
            "providers": [{
                "id": PROVIDER_ID,
                "name": "隔离 GM 线路",
                "protocol": "openai",
                "base_url": "https://example.invalid/v1",
                "model": "smoke-model",
                "enabled": True,
                "has_api_key": False,
            }],
            "personas": [],
            "conversations": [{
                "id": "conversation-smoke",
                "title": "隔离测试对话",
                "provider_id": PROVIDER_ID,
                "persona_id": None,
                "created_at": STAMP,
                "updated_at": STAMP,
            }],
            "worldbooks": [],
            "settings": {"display_name": "测试玩家"},
            "mcp_servers": [],
        })
        return
    if method == "GET" and path == "/api/favorites":
        fulfill(route, [])
        return
    if method == "GET" and path == "/api/conversations/conversation-smoke/messages":
        fulfill(route, [])
        return
    if method == "GET" and path.startswith("/api/board/"):
        fulfill(route, {"messages": [], "sealed_count": 0})
        return
    if method == "GET" and path == "/api/game-worlds":
        fulfill(route, {"worlds": [{
            "id": WORLD_ID,
            "name": world_detail["name"],
            "description": world_detail["description"],
            "current_version": 1,
            "session_count": 1,
            "created_at": STAMP,
            "updated_at": STAMP,
        }]})
        return
    if method == "GET" and path == f"/api/game-worlds/{WORLD_ID}":
        fulfill(route, world_detail)
        return
    if method == "GET" and path == "/api/game-sessions":
        fulfill(route, {"sessions": [session_summary()]})
        return
    if method == "GET" and path == f"/api/game-sessions/{SESSION_ID}":
        fulfill(route, session_detail())
        return
    if method == "GET" and path == f"/api/game-sessions/{SESSION_ID}/events":
        fulfill(route, {"events": events})
        return
    if method == "GET" and path == f"/api/game-sessions/{SESSION_ID}/turns":
        fulfill(route, {"turns": turns})
        return
    if method == "GET" and path == f"/api/game-sessions/{SESSION_ID}/saves":
        fulfill(route, {"saves": []})
        return
    if method == "POST" and path == f"/api/game-sessions/{SESSION_ID}/gm-turns":
        query = parse_qs(parsed.query)
        body = request.post_data_json
        gm_requests.append({"provider_id": query.get("provider_id", [None])[0], "body": body})
        assert query.get("provider_id") == [PROVIDER_ID], query
        assert body["actor"] == PLAYER, body
        assert body["idempotency_key"].startswith("ui-action-"), body
        assert body["expected_revision"] == world_state["revision"], body

        next_revision = world_state["revision"] + 1
        if body["intent"] == {"type": "take_item", "item_id": "ticket"}:
            assert body["content"] == "拿起明日车票", body
            event_id = "event-smoke-take"
            turn_id = "turn-smoke-take"
            world_state["items"]["ticket"]["position"] = {"kind": "actor", "actor": PLAYER}
            event = {
                "type": "transfer_item",
                "event_id": event_id,
                "actor": PLAYER,
                "item_id": "ticket",
                "from_position": {"kind": "location", "location_id": "attic"},
                "to_position": {"kind": "actor", "actor": PLAYER},
            }
            narration = {"text": "车票离开旧灯的阴影时，纸面浮起一道尚未命名的潮痕。"}
        elif body["intent"] == {"type": "freeform"}:
            assert body["content"] == "我把车票翻到背面，对着灯光寻找被藏起来的字。", body
            event_id = "event-smoke-freeform"
            turn_id = "turn-smoke-freeform"
            world_state["facts"]["ticket-back"]["known_by"] = [PLAYER]
            event = {
                "type": "discover_fact",
                "event_id": event_id,
                "actor": PLAYER,
                "fact_id": "ticket-back",
            }
            narration = {"text": "灯光穿过薄纸，退潮时刻像迟到的墨迹一样显了出来。"}
        else:
            raise AssertionError(f"unexpected typed intent: {body['intent']!r}")

        world_state["revision"] = next_revision
        world_state["turn"] = next_revision
        events.append({
            "id": event_id,
            "turn_id": turn_id,
            "revision": next_revision,
            "sequence": 0,
            "type": event["type"],
            "event": event,
            "created_at": STAMP,
        })
        turns.append({
            "id": turn_id,
            "session_id": SESSION_ID,
            "revision": next_revision,
            "actor": PLAYER,
            "intent": body["intent"],
            "content": body["content"],
            "event_count": 1,
            "narration": narration,
            "created_at": STAMP,
        })
        fulfill(route, {
            "action_id": turn_id,
            "session_id": SESSION_ID,
            "committed_revision": next_revision,
            "idempotent_replay": False,
            "events": [event],
            "state_hash": ({1: "b", 2: "c"}.get(next_revision, "d")) * 64,
            "state": copy.deepcopy(world_state),
            "narration": narration,
        })
        return

    unhandled_routes.append(f"{method} {path}")
    fulfill(route, {"detail": "unhandled smoke route"}, status=404)


def run() -> None:
    console_errors: list[str] = []
    page_errors: list[str] = []
    http_errors: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="msedge", headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = context.new_page()
        page.route("**/api/**", handle_api)
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on("response", lambda response: http_errors.append(f"{response.status} {response.url}") if response.status >= 400 else None)

        page.goto(BASE_URL, wait_until="networkidle")
        page.get_by_role("button", name="长期世界").click()
        page.get_by_role("heading", name="继续世界线").wait_for()
        page.locator(".lw-session-list > button").first.click()
        page.get_by_role("heading", name="潮汐阁楼", exact=True).first.wait_for()

        route_select = page.get_by_label("本轮行动线路")
        freeform = page.get_by_label("未写行动", exact=False)
        route_select.wait_for()
        assert route_select.input_value() == PROVIDER_ID
        route_select.select_option("__longworld_rules__")
        page.get_by_text("不调用模型，直接执行已定义规则", exact=True).wait_for()
        assert freeform.is_disabled()
        page.get_by_text("自由行动需要 GM 线路；下方明确动作仍可直接使用。", exact=True).wait_for()
        route_select.select_option(PROVIDER_ID)
        page.get_by_text("GM 提出候选，rules 决定能否提交", exact=True).wait_for()
        assert freeform.is_enabled()

        page.get_by_role("button", name="＋ 收起 明日车票").click()
        page.locator(".lw-narrator-copy p").get_by_text("车票离开旧灯的阴影时，纸面浮起一道尚未命名的潮痕。", exact=True).wait_for()
        assert page.locator(".lw-revision-stamp strong").inner_text() == "1"
        page.get_by_text("已提交 1 个 event", exact=True).wait_for()
        page.get_by_text("revision 1", exact=True).last.wait_for()
        page.locator(".lw-inventory-item").get_by_text("明日车票", exact=True).wait_for()
        assert len(gm_requests) == 1, gm_requests

        freeform.fill("  我把车票翻到背面，对着灯光寻找被藏起来的字。  ")
        page.get_by_role("button", name="采取行动", exact=True).click()
        page.locator(".lw-narrator-copy p").get_by_text("灯光穿过薄纸，退潮时刻像迟到的墨迹一样显了出来。", exact=True).wait_for()
        assert page.locator(".lw-revision-stamp strong").inner_text() == "2"
        page.get_by_text("revision 2", exact=True).last.wait_for()
        page.get_by_text("车票背面藏着退潮时刻。", exact=True).wait_for()
        assert freeform.input_value() == ""
        assert len(gm_requests) == 2, gm_requests
        assert gm_requests[1]["body"]["intent"] == {"type": "freeform"}, gm_requests[1]
        assert gm_requests[1]["body"]["content"] == "我把车票翻到背面，对着灯光寻找被藏起来的字。", gm_requests[1]
        assert gm_requests[1]["body"]["expected_revision"] == 1, gm_requests[1]

        page.locator(".lw-narrative-thread > li").last.scroll_into_view_if_needed()
        page.screenshot(path=str(SCREENSHOT), full_page=True)
        browser.close()

    assert not unhandled_routes, unhandled_routes
    assert not http_errors, http_errors
    assert not console_errors, console_errors
    assert not page_errors, page_errors
    print("LONGWORLD_GM_SMOKE_OK")
    print(SCREENSHOT)


if __name__ == "__main__":
    run()
