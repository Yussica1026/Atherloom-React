from __future__ import annotations

import json
import os
from urllib.parse import urlparse

from playwright.sync_api import Route, sync_playwright


BASE_URL = os.environ.get("ATHERLOOM_SMOKE_BASE_URL", "http://127.0.0.1:5173")
STAMP = "2026-08-26T08:00:00+00:00"
CONVERSATION_ID = "conversation-four-game-smoke"
PERSONA_ID = "persona-four-game-smoke"
PROVIDER_ID = "provider-four-game-smoke"
BULLS_SESSION_ID = "casual-bulls-smoke"
TWENTY_SESSION_ID = "casual-twenty-smoke"
TWENTY_RESULT_ID = "casual-twenty-result-smoke"
USER_SECRET = "1203"

message_rows: list[dict[str, object]] = []
created_games: list[str] = []
create_requests: list[dict[str, object]] = []
persona_turn_requests: list[tuple[str, str]] = []
action_requests: list[tuple[str, dict[str, object]]] = []
unhandled_routes: list[str] = []

bulls_revision = 0
bulls_turn: str | None = "user"
bulls_history: list[dict[str, object]] = []

twenty_revision = 0
twenty_turn: str | None = "persona"
twenty_status = "active"
twenty_pending: dict[str, object] | None = None
twenty_transcript: list[dict[str, object]] = []


def fulfill_json(route: Route, payload: object, status_code: int = 200) -> None:
    route.fulfill(
        status=status_code,
        content_type="application/json; charset=utf-8",
        body=json.dumps(payload, ensure_ascii=False),
    )


def bulls_state() -> dict[str, object]:
    return {
        "status": "active",
        "turn": bulls_turn,
        "round": max(1, (len(bulls_history) // 2) + 1),
        "history": [dict(entry) for entry in bulls_history],
    }


def bulls_session() -> dict[str, object]:
    return {
        "id": BULLS_SESSION_ID,
        "game_id": "bulls_and_cows",
        "rules_version": 1,
        "conversation_id": CONVERSATION_ID,
        "persona_id": PERSONA_ID,
        "player_id": "local_user",
        "state": bulls_state(),
        "current_actor": bulls_turn,
        "status": "active",
        "revision": bulls_revision,
        "result_id": None,
        "created_at": STAMP,
        "updated_at": STAMP,
        "finished_at": None,
    }


def bulls_action(events: list[dict[str, object]]) -> dict[str, object]:
    return {
        "session_id": BULLS_SESSION_ID,
        "game_id": "bulls_and_cows",
        "revision": bulls_revision,
        "status": "active",
        "state": bulls_state(),
        "current_actor": bulls_turn,
        "events": events,
        "result": None,
        "result_id": None,
        "idempotent_replay": False,
    }


def twenty_state() -> dict[str, object]:
    return {
        "status": twenty_status,
        "turn": twenty_turn,
        "question_count": max(
            [int(entry["ordinal"]) for entry in twenty_transcript] + [0]
        ),
        "max_questions": 20,
        "pending": dict(twenty_pending) if twenty_pending else None,
        "transcript": [dict(entry) for entry in twenty_transcript],
    }


def twenty_result() -> dict[str, object]:
    return {
        "game_id": "twenty_questions",
        "session_id": TWENTY_SESSION_ID,
        "outcome": "persona_win",
        "participants": [
            {"kind": "user", "id": "local_user"},
            {"kind": "persona", "id": PERSONA_ID},
        ],
        "score": {"user": 0, "persona": 1},
        "notable_events": ["solved_on_question:2"],
        "started_at": STAMP,
        "finished_at": STAMP,
    }


def twenty_session() -> dict[str, object]:
    return {
        "id": TWENTY_SESSION_ID,
        "game_id": "twenty_questions",
        "rules_version": 1,
        "conversation_id": CONVERSATION_ID,
        "persona_id": PERSONA_ID,
        "player_id": "local_user",
        "state": twenty_state(),
        "current_actor": twenty_turn,
        "status": twenty_status,
        "revision": twenty_revision,
        "result_id": TWENTY_RESULT_ID if twenty_status == "finished" else None,
        "created_at": STAMP,
        "updated_at": STAMP,
        "finished_at": STAMP if twenty_status == "finished" else None,
    }


def twenty_action(events: list[dict[str, object]]) -> dict[str, object]:
    return {
        "session_id": TWENTY_SESSION_ID,
        "game_id": "twenty_questions",
        "revision": twenty_revision,
        "status": twenty_status,
        "state": twenty_state(),
        "current_actor": twenty_turn,
        "events": events,
        "result": twenty_result() if twenty_status == "finished" else None,
        "result_id": TWENTY_RESULT_ID if twenty_status == "finished" else None,
        "idempotent_replay": False,
    }


def handle_api(route: Route) -> None:
    global bulls_revision, bulls_turn
    global twenty_revision, twenty_turn, twenty_status, twenty_pending

    request = route.request
    parsed = urlparse(request.url)
    path = parsed.path
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
                "title": "四游戏测试对话",
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
                "id": "user-open-bulls",
                "role": "user",
                "content": body["content"],
                "created_at": STAMP,
            },
            {
                "id": "assistant-open-bulls",
                "role": "assistant",
                "content": "先藏好你的数字，我们再开始。",
                "parent_message_id": "user-open-bulls",
                "created_at": STAMP,
            },
        ]
        effect = {
            "type": "open_game",
            "game_id": "bulls_and_cows",
            "setup_required": True,
            "conversation_id": CONVERSATION_ID,
            "persona_id": PERSONA_ID,
        }
        events = [
            {"user_id": "user-open-bulls"},
            {"tool_event": {
                "type": "open_game",
                "tool_name": "打开猜数字",
                "status": "等待用户设置秘密数字",
                "effect": effect,
            }},
            {
                "assistant_id": "assistant-open-bulls",
                "delta": "先藏好你的数字，我们再开始。",
                "done": True,
            },
        ]
        route.fulfill(
            status=200,
            content_type="application/x-ndjson; charset=utf-8",
            body="\n".join(json.dumps(event, ensure_ascii=False) for event in events) + "\n",
        )
        return
    if method == "GET" and path == "/api/casual-games/sessions":
        sessions: list[dict[str, object]] = []
        if "bulls_and_cows" in created_games:
            sessions.append(bulls_session())
        if "twenty_questions" in created_games and twenty_status == "active":
            sessions.append(twenty_session())
        fulfill_json(route, {"sessions": sessions})
        return
    if method == "POST" and path == "/api/casual-games/sessions":
        body = request.post_data_json
        create_requests.append(body)
        assert body["conversation_id"] == CONVERSATION_ID
        game_id = str(body["game_id"])
        created_games.append(game_id)
        if game_id == "bulls_and_cows":
            assert body["options"] == {"user_secret": USER_SECRET}
            fulfill_json(route, bulls_session())
            return
        if game_id == "twenty_questions":
            assert body["options"] == {}
            fulfill_json(route, twenty_session())
            return
    if method == "GET" and path == f"/api/casual-games/sessions/{BULLS_SESSION_ID}":
        fulfill_json(route, bulls_session())
        return
    if method == "GET" and path == f"/api/casual-games/sessions/{TWENTY_SESSION_ID}":
        fulfill_json(route, twenty_session())
        return
    if method == "GET" and path == f"/api/casual-games/behavior-configs/{PERSONA_ID}/bulls_and_cows":
        fulfill_json(route, {
            "persona_id": PERSONA_ID,
            "game_id": "bulls_and_cows",
            "memory_mode": "ask",
        })
        return
    if method == "GET" and path == f"/api/casual-games/behavior-configs/{PERSONA_ID}/twenty_questions":
        fulfill_json(route, {
            "persona_id": PERSONA_ID,
            "game_id": "twenty_questions",
            "memory_mode": "ask",
        })
        return
    if method == "POST" and path == f"/api/casual-games/sessions/{BULLS_SESSION_ID}/actions":
        body = request.post_data_json
        action_requests.append(("bulls_and_cows", body))
        assert body["expected_revision"] == bulls_revision
        assert body["action"] == {"guess": "5678"}
        bulls_history.append({
            "actor": "user",
            "guess": "5678",
            "bulls": 0,
            "cows": 1,
            "round": 1,
        })
        bulls_revision += 1
        bulls_turn = "persona"
        fulfill_json(route, bulls_action([{
            "type": "guess_scored",
            "actor": "user",
            "guess": "5678",
            "bulls": 0,
            "cows": 1,
            "round": 1,
        }]))
        return
    if method == "POST" and path == f"/api/casual-games/sessions/{BULLS_SESSION_ID}/persona-turn":
        body_text = request.post_data or ""
        body = request.post_data_json
        persona_turn_requests.append(("bulls_and_cows", body_text))
        assert body == {
            "expected_revision": bulls_revision,
            "idempotency_key": f"persona-turn-{BULLS_SESSION_ID}-{bulls_revision}",
        }
        bulls_history.append({
            "actor": "persona",
            "guess": "9876",
            "bulls": 0,
            "cows": 0,
            "round": 1,
        })
        bulls_revision += 1
        bulls_turn = "user"
        fulfill_json(route, bulls_action([{
            "type": "guess_scored",
            "actor": "persona",
            "guess": "9876",
            "bulls": 0,
            "cows": 0,
            "round": 1,
        }]))
        return
    if method == "POST" and path == f"/api/casual-games/sessions/{TWENTY_SESSION_ID}/persona-turn":
        body_text = request.post_data or ""
        body = request.post_data_json
        persona_turn_requests.append(("twenty_questions", body_text))
        assert body == {
            "expected_revision": twenty_revision,
            "idempotency_key": f"persona-turn-{TWENTY_SESSION_ID}-{twenty_revision}",
        }
        twenty_revision += 1
        twenty_turn = "user"
        if twenty_revision == 1:
            twenty_pending = {
                "kind": "question",
                "text": "它是一个活物吗？",
                "ordinal": 1,
            }
            twenty_transcript.append(dict(twenty_pending))
            event = {"type": "prompt_asked", **twenty_pending}
        else:
            twenty_pending = {
                "kind": "guess",
                "text": "你想的是猫吗？",
                "ordinal": 2,
            }
            twenty_transcript.append(dict(twenty_pending))
            event = {"type": "guess_made", **twenty_pending}
        fulfill_json(route, twenty_action([event]))
        return
    if method == "POST" and path == f"/api/casual-games/sessions/{TWENTY_SESSION_ID}/actions":
        body = request.post_data_json
        action_requests.append(("twenty_questions", body))
        assert body["expected_revision"] == twenty_revision
        if body["action"] == {"answer": "yes"}:
            twenty_transcript[-1]["answer"] = "yes"
            twenty_revision += 1
            twenty_turn = "persona"
            twenty_pending = None
            fulfill_json(route, twenty_action([{
                "type": "question_answered",
                "answer": "yes",
                "ordinal": 1,
            }]))
            return
        assert body["action"] == {"verdict": "correct"}
        twenty_transcript[-1]["verdict"] = "correct"
        twenty_revision += 1
        twenty_turn = None
        twenty_status = "finished"
        twenty_pending = None
        fulfill_json(route, twenty_action([{
            "type": "guess_judged",
            "verdict": "correct",
            "ordinal": 2,
        }]))
        return
    if method == "POST" and path == f"/api/casual-games/results/{TWENTY_RESULT_ID}/chat-reply":
        message_rows.append({
            "id": "assistant-twenty-reply",
            "role": "assistant",
            "content": "第二问就猜中了。",
            "created_at": STAMP,
        })
        fulfill_json(route, {
            "conversation_id": CONVERSATION_ID,
            "assistant_id": "assistant-twenty-reply",
        })
        return

    unhandled_routes.append(f"{method} {path}")
    fulfill_json(route, {"detail": "unhandled four-game smoke route"}, 404)


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

        page.goto(BASE_URL, wait_until="networkidle", timeout=30_000)
        composer = page.get_by_role("textbox", name="消息")
        composer.wait_for()
        composer.fill("陪我玩猜数字")
        page.get_by_role("button", name="发送").click()

        hub = page.get_by_role("dialog", name="休闲游戏")
        hub.wait_for()
        secret_input = hub.get_by_label("四位数字不能重复，允许以 0 开头")
        secret_input.wait_for()
        secret_input.fill("1123")
        hub.get_by_text("数字有重复，请换一个", exact=True).wait_for()
        assert hub.get_by_role("button", name="封存并开始").is_disabled()
        secret_input.fill(USER_SECRET)
        assert hub.get_by_role("button", name="封存并开始").is_enabled()
        hub.get_by_role("button", name="封存并开始").click()

        bulls_dialog = page.get_by_role("dialog", name="猜数字")
        bulls_dialog.wait_for()
        assert page.locator("#cg-secret-number").count() == 0
        assert USER_SECRET not in page.locator("body").inner_text()
        assert create_requests[0]["options"] == {"user_secret": USER_SECRET}

        bulls_dialog.get_by_label("输入你的猜测").fill("5678")
        bulls_dialog.get_by_role("button", name="提交猜测").click()
        bulls_dialog.locator(".cg-bac-guess.is-persona strong").filter(
            has_text="9876"
        ).wait_for()
        bulls_persona_requests = [
            body for game_id, body in persona_turn_requests
            if game_id == "bulls_and_cows"
        ]
        assert len(bulls_persona_requests) == 1, bulls_persona_requests
        assert USER_SECRET not in bulls_persona_requests[0]
        assert USER_SECRET not in page.locator("body").inner_text()

        bulls_dialog.locator(".cg-room-header > button").click()
        page.get_by_role("button", name="打开菜单").click()
        page.get_by_role("button", name="休闲游戏").click()
        hub = page.get_by_role("dialog", name="休闲游戏")
        hub.wait_for()
        hub.locator("article.is-twenty_questions").get_by_role(
            "button", name="开始新一局"
        ).click()

        twenty_dialog = page.get_by_role("dialog", name="二十问")
        twenty_dialog.wait_for()
        twenty_dialog.locator(".cg-questions-prompt blockquote").filter(
            has_text="它是一个活物吗？"
        ).wait_for()
        twenty_dialog.get_by_role("button", name="是", exact=True).click()
        twenty_dialog.locator(".cg-questions-prompt blockquote").filter(
            has_text="你想的是猫吗？"
        ).wait_for()
        twenty_dialog.get_by_role("button", name="猜对了", exact=True).click()
        page.get_by_role("heading", name="这一局，测试人格 赢了。").wait_for()
        page.get_by_text("赛后回复已经回到「四游戏测试对话」。", exact=True).wait_for()

        assert [request["game_id"] for request in create_requests] == [
            "bulls_and_cows",
            "twenty_questions",
        ]
        assert [body["action"] for game_id, body in action_requests if game_id == "twenty_questions"] == [
            {"answer": "yes"},
            {"verdict": "correct"},
        ]
        assert len([
            body for game_id, body in persona_turn_requests
            if game_id == "twenty_questions"
        ]) == 2
        browser.close()

    assert not unhandled_routes, unhandled_routes
    assert not http_errors, http_errors
    assert not console_errors, console_errors
    assert not page_errors, page_errors
    print("CASUAL_FOUR_GAME_SMOKE_OK")
    print("console_errors=0 page_errors=0 http_errors=0")


if __name__ == "__main__":
    run()
