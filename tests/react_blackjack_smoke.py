from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import Route, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"
ARTIFACTS.mkdir(exist_ok=True)
SCREENSHOT = ARTIFACTS / "casual-blackjack-smoke.png"
BASE_URL = os.environ.get("ATHERLOOM_SMOKE_BASE_URL", "http://127.0.0.1:5173")

STAMP = "2026-08-28T09:00:00+00:00"
CONVERSATION_ID = "conversation-blackjack-smoke"
PERSONA_ID = "persona-blackjack-smoke"
PROVIDER_ID = "provider-blackjack-smoke"
SESSION_ID = "casual-blackjack-session-smoke"
RESULT_ID = "casual-blackjack-result-smoke"

revision = 0
status = "active"
turn: str | None = "user"
user_hand = [
    {"rank": "10", "suit": "spades"},
    {"rank": "6", "suit": "diamonds"},
]
persona_hand = [
    {"rank": "10", "suit": "clubs"},
    {"rank": "8", "suit": "hearts"},
]
user_total = 16
persona_total = 18
user_stood = False
persona_stood = False
deck_remaining = 48
message_rows: list[dict[str, object]] = []
action_requests: list[dict[str, object]] = []
persona_turn_requests: list[dict[str, object]] = []
memory_decisions: list[dict[str, object]] = []
chat_reply_count = 0
unhandled_routes: list[str] = []


def public_state() -> dict[str, object]:
    return {
        "status": status,
        "turn": turn,
        "user_hand": [dict(card) for card in user_hand],
        "persona_hand": [dict(card) for card in persona_hand],
        "user_total": user_total,
        "persona_total": persona_total,
        "user_stood": user_stood,
        "persona_stood": persona_stood,
        "deck_remaining": deck_remaining,
    }


def result_payload() -> dict[str, object]:
    return {
        "game_id": "blackjack",
        "session_id": SESSION_ID,
        "outcome": "user_win",
        "participants": [
            {"kind": "user", "id": "local_user"},
            {"kind": "persona", "id": PERSONA_ID},
        ],
        "score": {"user": 20, "persona": 18},
        "notable_events": ["both_stood", "final_totals:user=20,persona=18"],
        "started_at": STAMP,
        "finished_at": STAMP,
    }


def session_payload() -> dict[str, object]:
    return {
        "id": SESSION_ID,
        "game_id": "blackjack",
        "rules_version": 1,
        "conversation_id": CONVERSATION_ID,
        "persona_id": PERSONA_ID,
        "player_id": "local_user",
        "state": public_state(),
        "current_actor": turn,
        "status": status,
        "revision": revision,
        "result_id": RESULT_ID if status == "finished" else None,
        "created_at": STAMP,
        "updated_at": STAMP,
        "finished_at": STAMP if status == "finished" else None,
    }


def action_payload(events: list[dict[str, object]]) -> dict[str, object]:
    return {
        "session_id": SESSION_ID,
        "game_id": "blackjack",
        "revision": revision,
        "status": status,
        "state": public_state(),
        "current_actor": turn,
        "events": events,
        "result": result_payload() if status == "finished" else None,
        "result_id": RESULT_ID if status == "finished" else None,
        "idempotent_replay": False,
    }


def fulfill_json(route: Route, payload: object, status_code: int = 200) -> None:
    route.fulfill(
        status=status_code,
        content_type="application/json; charset=utf-8",
        body=json.dumps(payload, ensure_ascii=False),
    )


def handle_api(route: Route) -> None:
    global revision, status, turn, user_total, user_stood, persona_stood
    global deck_remaining, chat_reply_count

    request = route.request
    path = urlparse(request.url).path
    method = request.method

    if method == "GET" and path == "/api/bootstrap":
        fulfill_json(route, {
            "providers": [{
                "id": PROVIDER_ID,
                "name": "人格线路",
                "protocol": "openai",
                "base_url": "https://example.invalid/v1",
                "model": "smoke-model",
                "enabled": True,
            }],
            "personas": [{
                "id": PERSONA_ID,
                "name": "测试人格",
                "prompt": "",
                "config": {"provider_id": PROVIDER_ID},
            }],
            "conversations": [{
                "id": CONVERSATION_ID,
                "title": "21 点测试对话",
                "provider_id": PROVIDER_ID,
                "persona_id": PERSONA_ID,
                "created_at": STAMP,
                "updated_at": STAMP,
            }],
            "worldbooks": [],
            "settings": {"display_name": "测试玩家"},
            "mcp_servers": [],
        })
        return
    if method == "GET" and path == "/api/favorites":
        fulfill_json(route, [])
        return
    if method == "GET" and path.startswith("/api/board/"):
        fulfill_json(route, {"messages": [], "sealed_count": 0})
        return
    if method == "GET" and path == f"/api/conversations/{CONVERSATION_ID}/messages":
        fulfill_json(route, message_rows)
        return
    if method == "POST" and path == "/api/chat":
        body = request.post_data_json
        assert body["conversation_id"] == CONVERSATION_ID
        assert body["persona_id"] == PERSONA_ID
        message_rows[:] = [
            {"id": "user-open-blackjack", "role": "user", "content": body["content"], "created_at": STAMP},
            {
                "id": "assistant-open-blackjack",
                "role": "assistant",
                "content": "好，牌已经发好了。",
                "parent_message_id": "user-open-blackjack",
                "created_at": STAMP,
            },
        ]
        effect = {
            "type": "open_game",
            "game_id": "blackjack",
            "session_id": SESSION_ID,
            "conversation_id": CONVERSATION_ID,
            "persona_id": PERSONA_ID,
        }
        events = [
            {"user_id": "user-open-blackjack"},
            {"tool_event": {
                "type": "open_game",
                "tool_name": "打开21 点",
                "status": "已打开",
                "effect": effect,
            }},
            {"assistant_id": "assistant-open-blackjack", "delta": "好，牌已经发好了。", "done": True},
        ]
        route.fulfill(
            status=200,
            content_type="application/x-ndjson; charset=utf-8",
            body="\n".join(json.dumps(event, ensure_ascii=False) for event in events) + "\n",
        )
        return
    if method == "GET" and path == f"/api/casual-games/sessions/{SESSION_ID}":
        fulfill_json(route, session_payload())
        return
    if method == "GET" and path == f"/api/casual-games/behavior-configs/{PERSONA_ID}/blackjack":
        fulfill_json(route, {
            "persona_id": PERSONA_ID,
            "game_id": "blackjack",
            "memory_mode": "ask",
        })
        return
    if method == "POST" and path == f"/api/casual-games/sessions/{SESSION_ID}/actions":
        body = request.post_data_json
        action_requests.append(body)
        assert body["expected_revision"] == revision
        if body["action"] == {"decision": "hit"}:
            user_hand.append({"rank": "4", "suit": "clubs"})
            user_total = 20
            deck_remaining = 47
            revision += 1
            fulfill_json(route, action_payload([{
                "type": "card_drawn",
                "actor": "user",
                "card": {"rank": "4", "suit": "clubs"},
                "total": 20,
            }]))
            return
        assert body["action"] == {"decision": "stand"}
        user_stood = True
        turn = "persona"
        revision += 1
        fulfill_json(route, action_payload([{
            "type": "stood",
            "actor": "user",
            "total": 20,
        }]))
        return
    if method == "POST" and path == f"/api/casual-games/sessions/{SESSION_ID}/persona-turn":
        body = request.post_data_json
        persona_turn_requests.append(body)
        assert body == {
            "expected_revision": revision,
            "idempotency_key": f"persona-turn-{SESSION_ID}-{revision}",
        }
        persona_stood = True
        turn = None
        status = "finished"
        revision += 1
        fulfill_json(route, action_payload([{
            "type": "stood",
            "actor": "persona",
            "total": 18,
        }, {
            "type": "game_finished",
            "outcome": "user_win",
        }]))
        return
    if method == "POST" and path == f"/api/casual-games/results/{RESULT_ID}/chat-reply":
        chat_reply_count += 1
        message_rows.append({
            "id": "assistant-blackjack-reply",
            "role": "assistant",
            "content": "二十点压住十八点，这局是你赢。",
            "created_at": STAMP,
        })
        fulfill_json(route, {
            "conversation_id": CONVERSATION_ID,
            "assistant_id": "assistant-blackjack-reply",
        })
        return
    if method == "POST" and path == f"/api/casual-games/results/{RESULT_ID}/memory-decision":
        body = request.post_data_json
        memory_decisions.append(body)
        fulfill_json(route, {
            "decision": "approved" if body["approved"] else "declined",
            "memory_id": "memory-blackjack-smoke" if body["approved"] else None,
        })
        return

    unhandled_routes.append(f"{method} {path}")
    fulfill_json(route, {"detail": "unhandled blackjack smoke route"}, 404)


def run() -> None:
    console_errors: list[str] = []
    page_errors: list[str] = []
    http_errors: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="msedge", headless=True)
        context = browser.new_context(viewport={"width": 390, "height": 844}, reduced_motion="reduce")
        page = context.new_page()
        page.set_default_timeout(10_000)
        page.route("**/api/**", handle_api)
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on("response", lambda response: http_errors.append(f"{response.status} {response.url}") if response.status >= 400 else None)

        page.goto(BASE_URL, wait_until="networkidle", timeout=30_000)
        composer = page.get_by_role("textbox", name="消息")
        composer.wait_for()
        composer.fill("陪我玩 21 点")
        page.get_by_role("button", name="发送").click()

        dialog = page.get_by_role("dialog", name="21 点")
        dialog.wait_for()
        assert dialog.locator(".cg-blackjack-hand.is-user .cg-blackjack-card").count() == 2
        assert dialog.locator(".cg-blackjack-hand.is-persona .cg-blackjack-card").count() == 2
        dialog.get_by_role("button", name="要牌 再取一张牌").click()
        dialog.locator(".cg-blackjack-hand.is-user .cg-blackjack-card").nth(2).wait_for()
        dialog.get_by_text("保留 20 点", exact=True).wait_for()
        dialog.get_by_role("button", name="停牌 保留 20 点").click()

        page.get_by_role("heading", name="这一局，你赢了。").wait_for()
        page.get_by_text("赛后回复已经回到「21 点测试对话」。", exact=True).wait_for()
        page.get_by_role("button", name="记住这局").click()
        page.get_by_text("这局已经留进 测试人格 原来的记忆。", exact=True).wait_for()

        assert [request["action"] for request in action_requests] == [
            {"decision": "hit"},
            {"decision": "stand"},
        ]
        assert len(persona_turn_requests) == 1
        assert chat_reply_count == 1
        assert memory_decisions == [{"approved": True}]
        page.screenshot(path=str(SCREENSHOT), full_page=True)
        browser.close()

    assert not unhandled_routes, unhandled_routes
    assert not http_errors, http_errors
    assert not console_errors, console_errors
    assert not page_errors, page_errors
    print("CASUAL_BLACKJACK_SMOKE_OK")
    print(SCREENSHOT)


if __name__ == "__main__":
    run()
