from __future__ import annotations

import base64
import copy
import io
import json
import os
import zipfile

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("ATHERLOOM_SMOKE_BASE_URL", "http://127.0.0.1:5173")


def encoded_zip(name: str, payload: object) -> str:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(name, json.dumps(payload, ensure_ascii=False))
    return base64.b64encode(buffer.getvalue()).decode("ascii")


CHATGPT = [{
    "id": "chatgpt-conversation-1",
    "title": "ChatGPT 历史",
    "current_node": "assistant-current",
    "mapping": {
        "root-node": {
            "id": "root-node",
            "parent": None,
            "children": ["user-node"],
            "message": None,
        },
        "user-node": {
            "id": "user-node",
            "parent": "root-node",
            "children": ["assistant-old", "assistant-current"],
            "message": {
                "id": "chatgpt-user-1",
                "author": {"role": "user"},
                "content": {"content_type": "multimodal_text", "parts": ["你好", {"content_type": "image_asset_pointer", "asset_pointer": "asset://image-1"}]},
                "metadata": {"attachments": [{"id": "file-1", "name": "说明.txt", "mime_type": "text/plain"}]},
                "create_time": 1_700_000_000,
            },
        },
        "assistant-old": {
            "id": "assistant-old",
            "parent": "user-node",
            "message": {
                "id": "chatgpt-assistant-old",
                "author": {"role": "assistant", "name": "ChatGPT"},
                "content": {"content_type": "text", "parts": ["旧回答"]},
                "create_time": 1_700_000_001,
            },
        },
        "assistant-current": {
            "id": "assistant-current",
            "parent": "user-node",
            "message": {
                "id": "chatgpt-assistant-current",
                "author": {"role": "assistant", "name": "ChatGPT"},
                "content": {"content_type": "text", "parts": ["当前回答"]},
                "create_time": 1_700_000_002,
            },
        },
    },
}]

CLAUDE = [{
    "uuid": "claude-conversation-1",
    "name": "Claude 历史",
    "current_leaf_message_uuid": "claude-assistant-current",
    "chat_messages": [
        {
            "uuid": "claude-user-1",
            "sender": "human",
            "text": "问题",
            "content": [{"type": "tool_use", "id": "tool-1", "name": "present_files", "input": {"file_id": "claude-file-1"}}],
            "files_v2": [{"file_uuid": "claude-file-1", "file_kind": "document", "file_name": "资料.pdf"}],
            "created_at": "2025-01-01T00:00:00Z",
            "parent_message_uuid": "00000000-0000-4000-8000-000000000000",
        },
        {
            "uuid": "claude-assistant-old",
            "sender": "assistant",
            "content": [{"type": "text", "text": "旧回答"}],
            "parent_message_uuid": "claude-user-1",
        },
        {
            "uuid": "claude-assistant-current",
            "sender": "assistant",
            "text": "当前回答",
            "content": [{"type": "thinking", "thinking": "当前思考"}, {"type": "tool_result", "tool_use_id": "tool-1", "content": "历史结果"}],
            "parent_message_uuid": "claude-user-1",
        },
    ],
}]

ASTRBOT_JSONL = "\n".join([
    json.dumps({
        "conversation_id": "astrbot-conversation-1",
        "platform_id": "aiocqhttp",
        "user_id": "user-1",
        "persona_id": "persona-1",
        "title": "AstrBot 历史",
        "history": json.dumps([
            {"role": "user", "content": "在吗"},
            {"role": "assistant", "content": "在"},
        ], ensure_ascii=False),
    }, ensure_ascii=False),
    "{bad-jsonl-line",
])

KELIVO = {
    "version": 1,
    "conversations": [{
        "id": "kelivo-session-1",
        "title": "Kelivo 历史",
        "messageIds": ["kelivo-user-1", "kelivo-assistant-old", "kelivo-assistant-current"],
        "versionSelections": {"assistant-slot": 1},
        "assistantId": "kelivo-assistant-1",
    }],
    "messages": [
        {"id": "kelivo-user-1", "conversationId": "kelivo-session-1", "groupId": "user-slot", "version": 0, "role": "user", "parts": [{"kind": "text", "payload": "继续"}]},
        {"id": "kelivo-assistant-old", "conversationId": "kelivo-session-1", "groupId": "assistant-slot", "version": 0, "role": "assistant", "content": "旧回答"},
        {"id": "kelivo-assistant-current", "conversationId": "kelivo-session-1", "groupId": "assistant-slot", "version": 1, "role": "assistant", "parts": [{"kind": "reasoning", "payload": "当前思考"}, {"kind": "text", "payload": "好"}]},
    ],
    "toolEvents": {
        "kelivo-assistant-current": [{"type": "tool_call", "name": "历史工具", "status": "success"}],
    },
    "geminiThoughtSigs": {"kelivo-assistant-current": "opaque-signature"},
}


def run() -> None:
    claude_zip = base64.b64decode(encoded_zip("account/conversations.json", CLAUDE))
    multi_chatgpt = copy.deepcopy(CHATGPT)
    second_chatgpt = copy.deepcopy(CHATGPT[0])
    second_chatgpt["id"] = "chatgpt-conversation-2"
    second_chatgpt["title"] = "ChatGPT 第二段历史"
    multi_chatgpt.append(second_chatgpt)
    multi_chatgpt_bytes = json.dumps(multi_chatgpt, ensure_ascii=False).encode()
    console_errors: list[str] = []
    page_errors: list[str] = []
    state = {
        "personas": [],
        "worldbooks": [],
        "conversations": [{
            "id": "conversation-default",
            "title": "默认对话",
            "provider_id": "provider-smoke",
            "persona_id": None,
            "created_at": "2026-08-26T00:00:00.000Z",
            "updated_at": "2026-08-26T00:00:00.000Z",
        }],
        "messages": {"conversation-default": []},
        "settings": {"display_name": "本机用户"},
        "favorites": [],
        "memories": [],
        "mcpServers": [],
        "motivations": {},
    }
    init_script = """
    (() => {
      localStorage.clear();
      localStorage.setItem('atherloom-react:standalone-state:v1', __STATE__);
      localStorage.setItem('atherloom-react:last-provider', 'provider-smoke');
      localStorage.setItem('atherloom-react:last-conversation', 'conversation-default');
      localStorage.setItem('atherloom-react:last-conversation:__default__', 'conversation-default');
      const provider = {id:'provider-smoke',name:'Smoke',protocol:'openai',base_url:'https://example.invalid/v1',model:'smoke-model',enabled:true,has_api_key:true};
      window.AtherloomNative = {
        getBackendUrl: () => '',
        setBackendUrl: () => JSON.stringify({ok:true}),
        listProviders: () => JSON.stringify([provider]),
        cancelStream: () => {},
        providerOperationAsync: (_operation, _payload, callbackId) => setTimeout(() => {
          window.AtherloomNativeRequest(callbackId, JSON.stringify({ok:true,status:200,body:JSON.stringify({content:''})}));
        }, 0),
      };
    })();
    """.replace("__STATE__", json.dumps(json.dumps(state, ensure_ascii=False)))

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="msedge", headless=True)
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.add_init_script(init_script)
        page.goto(BASE_URL, wait_until="networkidle")
        page.locator(".mobile-menu").click()
        page.locator(".profile-row").click()
        page.locator(".settings-nav button").nth(11).click()
        source = page.locator(".import-source-card")
        source.wait_for()
        assert source.locator("button.primary-button").is_visible(), source.inner_text()
        input_box = source.locator("input[type=file]")
        history = page.locator(".import-history")
        page.on("dialog", lambda dialog: dialog.accept())

        def ensure_history_open() -> None:
            if not history.evaluate("node => node.open"):
                history.locator("summary").click()

        def round_trip(
            name: str,
            mime: str,
            data: bytes,
            expected_platform: str,
            expected_title: str,
            expected_message: str,
            expected_message_count: int = 2,
            expected_branch_count: int = 1,
            expected_attachment_count: int = 0,
            expected_reasoning: str = "",
            unexpected_message: str = "",
        ) -> None:
            input_box.set_input_files({"name": name, "mimeType": mime, "buffer": data})
            page.locator(".import-status").filter(has_text=f"已识别为 {expected_platform}").wait_for()
            preview = page.locator(".import-preview")
            preview.wait_for()
            assert expected_platform in preview.locator("h4").inner_text(), preview.inner_text()
            assert expected_title in preview.locator(".import-conversation-list").inner_text(), preview.inner_text()
            assert "已选 1 / 1" in preview.locator(".import-list-heading").inner_text(), preview.inner_text()
            compact_stats = "".join(preview.locator(".import-stat-grid").inner_text().split())
            assert f"{expected_branch_count}分支" in compact_stats, preview.inner_text()
            assert f"{expected_attachment_count}附件" in compact_stats, preview.inner_text()
            page.locator(".import-commit-card button").click()
            page.locator(".import-result.committed").wait_for()
            page.locator(".import-status").filter(has_text="导入完成").wait_for()
            committed_state = json.loads(page.evaluate("localStorage.getItem('atherloom-react:standalone-state:v1')"))
            imported_conversations = [item for item in committed_state["conversations"] if item["id"] != "conversation-default"]
            assert len(imported_conversations) == 1, imported_conversations
            imported_conversation = imported_conversations[0]
            provenance = imported_conversation["external_import"]
            assert provenance["source_domain"] == expected_platform.lower(), provenance
            assert provenance["import_batch_id"], provenance
            persisted_messages = committed_state["messages"][imported_conversation["id"]]
            assert all(item["external_import"]["import_batch_id"] == provenance["import_batch_id"] for item in persisted_messages), persisted_messages
            page.locator(".imported-conversation-tabs button").first.click()
            reader = page.locator(".imported-message-reader")
            reader.locator("article").first.wait_for()
            assert reader.locator("article").count() == expected_message_count, reader.inner_text()
            assert expected_message in reader.inner_text(), reader.inner_text()
            if expected_reasoning:
                reader.locator("details summary").click()
                assert expected_reasoning in reader.inner_text(), reader.inner_text()
            if unexpected_message:
                assert unexpected_message not in reader.inner_text(), reader.inner_text()
            page.locator(".import-result.committed button.secondary-button").click()
            page.locator(".import-result.rolled_back").wait_for()
            page.locator(".import-status").filter(has_text="本次导入已撤销").wait_for()
            local_state = json.loads(page.evaluate("localStorage.getItem('atherloom-react:standalone-state:v1')"))
            assert [item["id"] for item in local_state["conversations"]] == ["conversation-default"], local_state["conversations"]
            platform_texts.append(expected_platform)

        platform_texts: list[str] = []
        round_trip("conversations.json", "application/json", json.dumps(CHATGPT, ensure_ascii=False).encode(), "ChatGPT", "ChatGPT 历史", "当前回答", expected_branch_count=2, expected_attachment_count=2, unexpected_message="旧回答")
        round_trip("claude-export.zip", "application/zip", claude_zip, "Claude", "Claude 历史", "当前回答", expected_branch_count=2, expected_attachment_count=1, expected_reasoning="当前思考", unexpected_message="旧回答")
        round_trip("astrbot.jsonl", "application/x-ndjson", ASTRBOT_JSONL.encode(), "AstrBot", "AstrBot 历史", "在吗")
        round_trip("kelivo-backup.json", "application/json", json.dumps(KELIVO, ensure_ascii=False).encode(), "Kelivo", "Kelivo 历史", "好", expected_branch_count=2, unexpected_message="旧回答")

        # A partial commit must only mark the selected source conversation as a duplicate.
        input_box.set_input_files({"name": "partial-conversations.json", "mimeType": "application/json", "buffer": multi_chatgpt_bytes})
        page.locator(".import-status").filter(has_text="已识别为 ChatGPT").wait_for()
        first_preview_rows = page.locator(".import-conversation-list label")
        assert first_preview_rows.count() == 2, first_preview_rows.all_inner_texts()
        first_preview_rows.nth(1).locator("input").uncheck()
        page.locator(".import-commit-card button").click()
        page.locator(".import-result.committed").wait_for()

        input_box.set_input_files({"name": "partial-conversations.json", "mimeType": "application/json", "buffer": multi_chatgpt_bytes})
        page.locator(".import-status").filter(has_text="已识别为 ChatGPT").wait_for()
        duplicate_rows = page.locator(".import-conversation-list label")
        assert duplicate_rows.count() == 2, duplicate_rows.all_inner_texts()
        assert not duplicate_rows.nth(0).locator("input").is_checked(), duplicate_rows.nth(0).inner_text()
        assert duplicate_rows.nth(1).locator("input").is_checked(), duplicate_rows.nth(1).inner_text()
        assert "可能重复" in duplicate_rows.nth(0).inner_text(), duplicate_rows.nth(0).inner_text()
        assert "可能重复" not in duplicate_rows.nth(1).inner_text(), duplicate_rows.nth(1).inner_text()

        ensure_history_open()
        history.locator("article").filter(has_text="待确认").get_by_role("button", name="丢弃").click()
        page.locator(".import-status").filter(has_text="预览批次已丢弃").wait_for()
        history.locator("article").filter(has_text="已导入").get_by_role("button", name="撤销").click()
        page.locator(".import-status").filter(has_text="本次导入已撤销").wait_for()

        exact_duplicates = json.dumps([CHATGPT[0], copy.deepcopy(CHATGPT[0])], ensure_ascii=False).encode()
        input_box.set_input_files({"name": "exact-duplicates.json", "mimeType": "application/json", "buffer": exact_duplicates})
        page.locator(".import-status").filter(has_text="已识别为 ChatGPT").wait_for()
        exact_rows = page.locator(".import-conversation-list label")
        assert exact_rows.count() == 2, exact_rows.all_inner_texts()
        assert exact_rows.nth(0).locator("input").is_checked(), exact_rows.nth(0).inner_text()
        assert not exact_rows.nth(1).locator("input").is_checked(), exact_rows.nth(1).inner_text()
        assert "可能重复" in exact_rows.nth(1).inner_text(), exact_rows.nth(1).inner_text()
        ensure_history_open()
        history.locator("article").filter(has_text="待确认").get_by_role("button", name="丢弃").first.click()
        page.locator(".import-status").filter(has_text="预览批次已丢弃").wait_for()

        # If the IndexedDB batch ledger fails, the just-written conversation must be compensated away.
        input_box.set_input_files({"name": "ledger-failure.json", "mimeType": "application/json", "buffer": json.dumps(CHATGPT, ensure_ascii=False).encode()})
        page.locator(".import-status").filter(has_text="已识别为 ChatGPT").wait_for()
        page.evaluate("""
        (() => {
          const originalPut = IDBObjectStore.prototype.put;
          window.__failNextImportBatchPut = true;
          IDBObjectStore.prototype.put = function(...args) {
            const request = originalPut.apply(this, args);
            if (window.__failNextImportBatchPut) {
              window.__failNextImportBatchPut = false;
              this.transaction.abort();
            }
            return request;
          };
        })();
        """)
        page.locator(".import-commit-card button").click()
        page.locator(".import-status").filter(has_text="导入账本保存失败").wait_for()
        compensated_state = json.loads(page.evaluate("localStorage.getItem('atherloom-react:standalone-state:v1')"))
        assert [item["id"] for item in compensated_state["conversations"]] == ["conversation-default"], compensated_state["conversations"]
        ensure_history_open()
        history.locator("article").filter(has_text="待确认").get_by_role("button", name="丢弃").first.click()
        page.locator(".import-status").filter(has_text="预览批次已丢弃").wait_for()

        # Corrupt standalone state must stop commit without replacing the raw snapshot.
        input_box.set_input_files({"name": "corrupt-state-guard.json", "mimeType": "application/json", "buffer": json.dumps(CHATGPT, ensure_ascii=False).encode()})
        page.locator(".import-status").filter(has_text="已识别为 ChatGPT").wait_for()
        valid_state = page.evaluate("localStorage.getItem('atherloom-react:standalone-state:v1')")
        page.evaluate("localStorage.setItem('atherloom-react:standalone-state:v1', '{truncated')")
        page.locator(".import-commit-card button").click()
        page.locator(".import-status").filter(has_text="已停止导入以避免覆盖旧数据").wait_for()
        assert page.evaluate("localStorage.getItem('atherloom-react:standalone-state:v1')") == "{truncated"
        page.evaluate("value => localStorage.setItem('atherloom-react:standalone-state:v1', value)", valid_state)
        ensure_history_open()
        history.locator("article").filter(has_text="待确认").get_by_role("button", name="丢弃").first.click()
        page.locator(".import-status").filter(has_text="预览批次已丢弃").wait_for()

        input_box.set_input_files({"name": "kelivo.db", "mimeType": "application/octet-stream", "buffer": b"SQLite format 3\x00payload"})
        page.locator(".import-status").filter(has_text="Kelivo SQLite").wait_for()
        local_state = json.loads(page.evaluate("localStorage.getItem('atherloom-react:standalone-state:v1')"))
        assert [item["id"] for item in local_state["conversations"]] == ["conversation-default"], local_state["conversations"]
        browser.close()
    assert platform_texts == ["ChatGPT", "Claude", "AstrBot", "Kelivo"], platform_texts
    assert not console_errors, console_errors
    assert not page_errors, page_errors
    print("STANDALONE_EXTERNAL_IMPORT_SMOKE_OK")
    print("platforms=" + ",".join(platform_texts))


if __name__ == "__main__":
    run()
