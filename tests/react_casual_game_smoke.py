from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import Route, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"
ARTIFACTS.mkdir(exist_ok=True)
SCREENSHOT = ARTIFACTS / "casual-tic-tac-toe-smoke.png"
BASE_URL = os.environ.get("ATHERLOOM_SMOKE_BASE_URL", "http://127.0.0.1:5173")

STAMP = "2026-08-24T09:00:00+00:00"
CONVERSATION_ID = "conversation-casual-smoke"
PERSONA_ID = "persona-casual-smoke"
PROVIDER_ID = "provider-casual-smoke"
SESSION_ID = "casual-session-smoke"
RESULT_ID = "casual-result-smoke"

board: list[str | None] = [None] * 9
revision = 0
status = "active"
turn: str | None = "user"
persona_moves = iter((3, 4))
message_rows: list[dict[str, object]] = []
memory_decisions: list[dict[str, object]] = []
persona_turn_requests: list[dict[str, object]] = []
chat_reply_count = 0
unhandled_routes: list[str] = []


def session_payload() -> dict[str, object]:
    return {
        "id": SESSION_ID,
        "game_id": "tic_tac_toe",
        "rules_version": 1,
        "conversation_id": CONVERSATION_ID,
        "persona_id": PERSONA_ID,
        "player_id": "local_user",
        "state": {
            "status": status,
            "turn": turn,
            "board": list(board),
            "move_count": revision,
        },
        "current_actor": turn,
        "status": status,
        "revision": revision,
        "result_id": RESULT_ID if status == "finished" else None,
        "created_at": STAMP,
        "updated_at": STAMP,
        "finished_at": STAMP if status == "finished" else None,
    }


def result_payload() -> dict[str, object]:
    return {
        "game_id": "tic_tac_toe",
        "session_id": SESSION_ID,
        "outcome": "user_win",
        "participants": [
            {"kind": "user", "id": "local_user"},
            {"kind": "persona", "id": PERSONA_ID},
        ],
        "score": {"user": 1, "persona": 0},
        "notable_events": ["winning_line:0,1,2"],
        "started_at": STAMP,
        "finished_at": STAMP,
    }


def action_payload(events: list[dict[str, object]]) -> dict[str, object]:
    return {
        "session_id": SESSION_ID,
        "game_id": "tic_tac_toe",
        "revision": revision,
        "status": status,
        "state": session_payload()["state"],
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
    global revision, status, turn, chat_reply_count
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
                "title": "测试对话",
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
            {
                "id": "user-open-game",
                "role": "user",
                "content": body["content"],
                "created_at": STAMP,
            },
            {
                "id": "assistant-open-game",
                "role": "assistant",
                "content": "好，棋盘铺好了。",
                "parent_message_id": "user-open-game",
                "created_at": STAMP,
            },
        ]
        effect = {
            "type": "open_game",
            "game_id": "tic_tac_toe",
            "session_id": SESSION_ID,
            "conversation_id": CONVERSATION_ID,
            "persona_id": PERSONA_ID,
        }
        stream_events = [
            {"user_id": "user-open-game"},
            {"tool_event": {
                "type": "open_game",
                "tool_name": "打开井字棋",
                "status": "已打开",
                "effect": effect,
            }},
            {
                "assistant_id": "assistant-open-game",
                "delta": "好，棋盘铺好了。",
                "done": True,
            },
        ]
        route.fulfill(
            status=200,
            content_type="application/x-ndjson; charset=utf-8",
            body="\n".join(
                json.dumps(event, ensure_ascii=False) for event in stream_events
            ) + "\n",
        )
        return
    if method == "GET" and path == f"/api/casual-games/sessions/{SESSION_ID}":
        fulfill_json(route, session_payload())
        return
    if method == "GET" and path == (
        f"/api/casual-games/behavior-configs/{PERSONA_ID}/tic_tac_toe"
    ):
        fulfill_json(route, {
            "persona_id": PERSONA_ID,
            "game_id": "tic_tac_toe",
            "memory_mode": "ask",
        })
        return
    if method == "POST" and path == f"/api/casual-games/sessions/{SESSION_ID}/actions":
        body = request.post_data_json
        assert body["expected_revision"] == revision
        assert isinstance(body["idempotency_key"], str) and body["idempotency_key"]
        position = body["action"]["position"]
        assert turn == "user" and board[position] is None
        board[position] = "X"
        revision += 1
        events: list[dict[str, object]] = [{
            "type": "mark_placed",
            "actor": "user",
            "position": position,
            "mark": "X",
        }]
        if board[0] == board[1] == board[2] == "X":
            status = "finished"
            turn = None
            events.append({
                "type": "game_finished",
                "outcome": "user_win",
                "winner": "user",
            })
        else:
            turn = "persona"
        fulfill_json(route, action_payload(events))
        return
    if method == "POST" and path == f"/api/casual-games/sessions/{SESSION_ID}/persona-turn":
        body = request.post_data_json
        expected = {
            "expected_revision": revision,
            "idempotency_key": f"persona-turn-{SESSION_ID}-{revision}",
        }
        assert body == expected
        persona_turn_requests.append(body)
        assert turn == "persona"
        position = next(persona_moves)
        board[position] = "O"
        revision += 1
        turn = "user"
        fulfill_json(route, action_payload([{
            "type": "mark_placed",
            "actor": "persona",
            "position": position,
            "mark": "O",
        }]))
        return
    if method == "GET" and path == f"/api/casual-games/results/{RESULT_ID}":
        fulfill_json(route, {
            "id": RESULT_ID,
            "session_id": SESSION_ID,
            "result": result_payload(),
            "created_at": STAMP,
        })
        return
    if method == "POST" and path == f"/api/casual-games/results/{RESULT_ID}/chat-reply":
        chat_reply_count += 1
        message_rows.append({
            "id": "assistant-game-reply",
            "role": "assistant",
            "content": "三连成线，这局算你厉害。",
            "parent_message_id": None,
            "created_at": STAMP,
        })
        fulfill_json(route, {
            "conversation_id": CONVERSATION_ID,
            "assistant_id": "assistant-game-reply",
        })
        return
    if method == "POST" and path == f"/api/casual-games/results/{RESULT_ID}/memory-decision":
        body = request.post_data_json
        memory_decisions.append(body)
        fulfill_json(route, {
            "decision": "approved" if body["approved"] else "declined",
            "memory_id": "memory-casual-smoke" if body["approved"] else None,
        })
        return

    unhandled_routes.append(f"{method} {path}")
    fulfill_json(route, {"detail": "unhandled casual smoke route"}, 404)


def run() -> None:
    console_errors: list[str] = []
    page_errors: list[str] = []
    http_errors: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="msedge", headless=True)
        context = browser.new_context(
            viewport={"width": 390, "height": 844},
            reduced_motion="reduce",
        )
        page = context.new_page()
        page.set_default_timeout(10_000)
        page.route("**/api/**", handle_api)
        page.on(
            "console",
            lambda message: console_errors.append(message.text)
            if message.type == "error" else None,
        )
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on(
            "response",
            lambda response: http_errors.append(f"{response.status} {response.url}")
            if response.status >= 400 else None,
        )

        page.goto(BASE_URL, wait_until="networkidle")
        composer = page.get_by_role("textbox", name="消息")
        composer.wait_for()
        composer.fill("陪我玩井字棋")
        page.get_by_role("button", name="发送").click()

        dialog = page.get_by_role("dialog", name="井字棋")
        dialog.wait_for()
        assert page.locator("main.main").get_attribute("inert") == ""
        assert page.evaluate(
            "document.activeElement?.getAttribute('aria-label')"
        ) == "收起游戏"

        for label in (
            "第 1 行第 1 列，空白",
            "第 1 行第 2 列，空白",
            "第 1 行第 3 列，空白",
        ):
            dialog.get_by_role("gridcell", name=label).click()

        page.get_by_role("heading", name="这一局，你赢了。").wait_for()
        page.get_by_text(
            "赛后回复已经回到「测试对话」。",
            exact=True,
        ).wait_for()
        page.get_by_role("button", name="记住这局").click()
        page.get_by_text(
            "这局已经留进 测试人格 原来的记忆。",
            exact=True,
        ).wait_for()

        assert len(persona_turn_requests) == 2, persona_turn_requests
        assert chat_reply_count == 1, chat_reply_count
        assert memory_decisions == [{"approved": True}], memory_decisions

        page.evaluate("document.documentElement.dataset.theme = 'water'")
        water = page.locator(".cg-cell").first.evaluate(
            "element => getComputedStyle(element).backgroundColor"
        )
        page.evaluate("document.documentElement.dataset.theme = 'lilac'")
        lilac = page.locator(".cg-cell").first.evaluate(
            "element => getComputedStyle(element).backgroundColor"
        )
        assert water != lilac, (water, lilac)
        assert page.locator(".cg-winning-thread line").evaluate(
            "element => getComputedStyle(element).animationName"
        ) == "none"
        page.screenshot(path=str(SCREENSHOT), full_page=True)

        page.evaluate(
            "window.dispatchEvent(new Event('atherloom:back', {cancelable: true}))"
        )
        dialog.wait_for(state="detached")
        assert page.locator("main.main").get_attribute("inert") is None
        browser.close()

    assert not unhandled_routes, unhandled_routes
    assert not http_errors, http_errors
    assert not console_errors, console_errors
    assert not page_errors, page_errors
    print("CASUAL_TTT_SMOKE_OK")
    print(SCREENSHOT)


if __name__ == "__main__":
    run()
