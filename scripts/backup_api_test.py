import os
from contextlib import closing
from uuid import uuid4

from fastapi.testclient import TestClient


os.environ["ATHERLOOM_E2E_RUN_ID"] = f"backup-{uuid4().hex[:8]}"

import e2e_backend  # noqa: E402


app_module = e2e_backend.app_module
provider_id = "provider-backup-test"
conversation_id = "conversation-backup-test"
message_id = "message-backup-test"

with TestClient(e2e_backend.app) as client:
    with closing(app_module.db()) as connection:
        stamp = app_module.now_iso()
        connection.execute(
            "INSERT INTO providers(id,name,protocol,base_url,api_key,model,enabled,custom_headers,prompt_cache,thinking_enabled,stream_enabled,temperature,top_p,max_tokens,created_at,vision_mode,cache_mode,prompt_cache_key,models_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (provider_id, "备份线路", "openai", "https://example.invalid", "secret-api-key", "mock", 1, '{"Authorization":"secret-header"}', 1, 1, 1, 0.7, 1, 4096, stamp, "auto", "auto", "", '["mock"]'),
        )
        connection.execute("INSERT INTO app_settings(key,value) VALUES ('search_api_key','secret-search-key')")
        connection.execute(
            "INSERT INTO mcp_servers(id,name,url,token,enabled,last_status,last_detail,last_tested_at,created_at,updated_at,transport,command,args_json,env_json,headers_json,tools_json,tool_policy_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            ("mcp-backup-test", "备份 MCP", "https://example.invalid/mcp", "secret-token", 1, "", "", None, stamp, stamp, "http", "", "[]", '{"SECRET":"value"}', '{"Authorization":"secret"}', "[]", "{}"),
        )
        connection.execute(
            "INSERT INTO conversations(id,title,provider_id,persona_id,summary,created_at,updated_at,pinned,starred,archived) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (conversation_id, "备份对话", provider_id, None, "", stamp, stamp, 0, 0, 0),
        )
        connection.execute(
            "INSERT INTO messages(id,conversation_id,role,content,provider_id,model,created_at,reasoning,parent_message_id) VALUES (?,?,?,?,?,?,?,?,?)",
            (message_id, conversation_id, "user", "只用于备份回归", provider_id, "mock", stamp, "", None),
        )
        connection.commit()

    exported = client.post("/api/backup/export", json={"parts": ["conversations", "personas", "memory", "settings", "games"]})
    assert exported.status_code == 200, exported.text
    bundle = exported.json()
    assert bundle["format"] == "atherloom-backup" and bundle["version"] == 2
    provider = next(row for row in bundle["tables"]["providers"] if row["id"] == provider_id)
    mcp = next(row for row in bundle["tables"]["mcp_servers"] if row["id"] == "mcp-backup-test")
    assert provider["api_key"] == "" and provider["custom_headers"] == "{}", provider
    assert mcp["token"] == "" and mcp["env_json"] == "{}" and mcp["headers_json"] == "{}", mcp
    assert all(row["key"] != "search_api_key" for row in bundle["tables"]["app_settings"])
    search = client.get("/api/search", params={"q": "只用于备份回归"})
    assert search.status_code == 200 and any(item["id"] == conversation_id for item in search.json()), search.text

    with closing(app_module.db()) as connection:
        connection.execute("DELETE FROM messages WHERE id=?", (message_id,))
        connection.execute("DELETE FROM conversations WHERE id=?", (conversation_id,))
        connection.execute("DELETE FROM providers WHERE id=?", (provider_id,))
        connection.commit()

    restored = client.post("/api/backup/restore", json={"bundle": bundle, "parts": ["conversations", "settings"]})
    assert restored.status_code == 200, restored.text
    result = restored.json()
    assert result["ok"] and result["secrets_restored"] is False
    assert (app_module.DB_PATH.parent / result["snapshot"]).is_file(), result
    with closing(app_module.db()) as connection:
        assert connection.execute("SELECT content FROM messages WHERE id=?", (message_id,)).fetchone()["content"] == "只用于备份回归"
        restored_provider = connection.execute("SELECT api_key,custom_headers FROM providers WHERE id=?", (provider_id,)).fetchone()
        assert restored_provider["api_key"] == "" and restored_provider["custom_headers"] == "{}"
        assert connection.execute("SELECT 1 FROM app_settings WHERE key='search_api_key'").fetchone() is None

print({
    "parts": bundle["parts"],
    "tables": len(bundle["tables"]),
    "snapshot": result["snapshot"],
    "checks": ["all categories exported", "credentials omitted", "message full-text search", "pre-restore snapshot", "selective restore"],
})
