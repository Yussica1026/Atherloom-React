import { useState, type FormEvent } from "react";
import { saveFile } from "../../adapters/native/files";
import type { McpServer, McpServerDraft } from "../../domain/types";

const emptyDraft = (): McpServerDraft => ({ name: "", transport: "http", url: "", token: "", command: "", args: [], env: {}, headers: {}, tool_policies: {}, enabled: true });

interface McpSettingsProps {
  servers: McpServer[];
  onCreate: (draft: McpServerDraft) => Promise<unknown>;
  onUpdate: (id: string, draft: McpServerDraft) => Promise<unknown>;
  onDelete: (id: string) => Promise<void>;
  onTest: (draft: McpServerDraft) => Promise<{ message: string }>;
  onRefresh: (id: string) => Promise<unknown>;
}

export function McpSettings({ servers, onCreate, onUpdate, onDelete, onTest, onRefresh }: McpSettingsProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<McpServerDraft>(emptyDraft);
  const [argsText, setArgsText] = useState("");
  const [envText, setEnvText] = useState("{}");
  const [headersText, setHeadersText] = useState("{}");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const exportServers = async () => {
    const safe = servers.map((server) => ({
      name: server.name,
      transport: server.transport,
      url: server.url || "",
      command: server.command || "",
      args: server.args || [],
      enabled: server.enabled !== false,
      tool_policies: server.tool_policies || {},
      token: "",
      headers: {},
      env: {},
      secrets_omitted: ["token", "headers", "env"],
    }));
    try {
      const message = await saveFile(`atherloom-mcp-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify({ format: "atherloom-mcp", version: 1, servers: safe }, null, 2)], { type: "application/json" }));
      setStatus(message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "MCP 导出失败");
    }
  };

  const importServers = async (file: File) => {
    setBusy(true);
    setStatus("正在导入 MCP 配置…");
    try {
      const parsed = JSON.parse(await file.text()) as { servers?: Array<Partial<McpServerDraft>> } | Array<Partial<McpServerDraft>>;
      const rows = Array.isArray(parsed) ? parsed : parsed.servers;
      if (!Array.isArray(rows) || !rows.length) throw new Error("文件里没有 MCP 配置");
      let imported = 0;
      for (const row of rows) {
        const transport = row.transport === "stdio" ? "stdio" : "http";
        if (!String(row.name || "").trim()) continue;
        await onCreate({
          name: String(row.name).trim(), transport, url: String(row.url || ""), token: "",
          command: String(row.command || ""), args: Array.isArray(row.args) ? row.args.map(String) : [],
          env: {}, headers: {}, tool_policies: row.tool_policies || {}, enabled: row.enabled !== false,
        });
        imported += 1;
      }
      setStatus(`已导入 ${imported} 个 MCP 配置；令牌、请求头和环境变量需重新填写。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "MCP 导入失败");
    } finally {
      setBusy(false);
    }
  };

  const payload = () => ({
    ...draft,
    args: argsText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
    env: JSON.parse(envText || "{}") as Record<string, string>,
    headers: JSON.parse(headersText || "{}") as Record<string, string>,
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setStatus("正在保存 MCP 连接…");
    try {
      const value = payload();
      if (editing) await onUpdate(editing, value); else await onCreate(value);
      setEditing(null); setDraft(emptyDraft()); setArgsText(""); setEnvText("{}"); setHeadersText("{}");
      setStatus("MCP 配置已保存");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "MCP 保存失败");
    } finally {
      setBusy(false);
    }
  };

  const open = (server: McpServer) => {
    setEditing(server.id);
    setDraft({ name: server.name, transport: server.transport, url: server.url || "", token: "", command: server.command || "", args: server.args || [], env: server.env || {}, headers: server.headers || {}, tool_policies: server.tool_policies || {}, enabled: server.enabled !== false });
    setArgsText((server.args || []).join("\n"));
    setEnvText(JSON.stringify(server.env || {}, null, 2));
    setHeadersText(JSON.stringify(server.headers || {}, null, 2));
    setStatus(server.has_token ? "访问令牌已保存；留空不会擦除。" : "");
  };

  const changeToolPolicy = async (server: McpServer, toolName: string, policy: "allow" | "ask" | "deny") => {
    setStatus(`正在保存 ${toolName} 权限…`);
    try {
      await onUpdate(server.id, {
        name: server.name, transport: server.transport, url: server.url || "", token: "",
        command: server.command || "", args: server.args || [], env: server.env || {}, headers: server.headers || {},
        enabled: server.enabled !== false, tool_policies: { ...(server.tool_policies || {}), [toolName]: policy },
      });
      setStatus(`${toolName} 权限已保存`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "工具权限保存失败");
    }
  };

  return (
    <section className="settings-section settings-feature">
      <div className="section-heading section-heading-with-action"><div><h3>MCP</h3><p>配置 HTTP 或 stdio 服务、发现工具并绑定到人格。Android 本机可保存配置，执行需要 FastAPI 后端。</p></div><div className="form-actions"><label className="secondary-button file-button">导入<input type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importServers(file); event.target.value = ""; }} /></label><button type="button" className="secondary-button" onClick={() => void exportServers()}>脱敏导出</button></div></div>
      <form className="settings-form settings-edit-card" onSubmit={(event) => void submit(event)}>
        {editing ? <div className="edit-state">正在编辑 MCP 连接</div> : null}
        <label>名称<input required value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
        <label>传输方式<select value={draft.transport} onChange={(event) => setDraft((current) => ({ ...current, transport: event.target.value as "http" | "stdio" }))}><option value="http">HTTP / SSE</option><option value="stdio">stdio</option></select></label>
        {draft.transport === "http" ? <><label className="span-all">服务地址<input type="url" required value={draft.url} onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))} placeholder="https://example.com/mcp" /></label><label className="span-all">访问令牌<input type="password" value={draft.token || ""} onChange={(event) => setDraft((current) => ({ ...current, token: event.target.value }))} placeholder={editing ? "留空继续使用已保存令牌" : "可选"} /></label></> : <><label className="span-all">启动命令<input required value={draft.command} onChange={(event) => setDraft((current) => ({ ...current, command: event.target.value }))} placeholder="python 或 npx" /></label><label className="span-all">参数（每行一个）<textarea rows={4} value={argsText} onChange={(event) => setArgsText(event.target.value)} /></label><label className="span-all">环境变量（JSON）<textarea rows={4} value={envText} onChange={(event) => setEnvText(event.target.value)} /></label></>}
        <label className="span-all">自定义请求头（JSON）<textarea rows={4} value={headersText} onChange={(event) => setHeadersText(event.target.value)} /></label>
        <label className="check-row span-all"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} /><span>启用服务</span></label>
        <div className="form-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={() => { setBusy(true); try { void onTest(payload()).then((result) => setStatus(result.message)).catch((error) => setStatus(error instanceof Error ? error.message : "测试失败")).finally(() => setBusy(false)); } catch (error) { setStatus(error instanceof Error ? error.message : "JSON 格式错误"); setBusy(false); } }}>测试连接</button>
          {editing ? <button type="button" className="secondary-button" onClick={() => { setEditing(null); setDraft(emptyDraft()); }}>取消编辑</button> : null}
          <button className="primary-button" disabled={busy}>保存连接</button>
        </div>
        <p className="form-status span-all" aria-live="polite">{status}</p>
      </form>
      <div className="settings-card-list">
        {servers.map((server) => <article className="settings-list-card" key={server.id}><div className="settings-list-copy"><strong>{server.name}</strong><small>{server.transport} · {server.last_status || "未测试"} · {server.tools?.length || 0} 个工具</small>{server.last_detail ? <p>{server.last_detail}</p> : null}{server.tools?.length ? <div className="mcp-tool-policies">{server.tools.map((tool) => <label key={tool.name}><span>{tool.name}<small>{tool.description || "未提供说明"}</small></span><select value={server.tool_policies?.[tool.name] || "ask"} onChange={(event) => void changeToolPolicy(server, tool.name, event.target.value as "allow" | "ask" | "deny")}><option value="allow">允许</option><option value="ask">每次询问</option><option value="deny">禁止</option></select></label>)}</div> : null}</div><div className="card-actions"><button type="button" onClick={() => void onRefresh(server.id).catch((error) => setStatus(error instanceof Error ? error.message : "刷新失败"))}>刷新工具</button><button type="button" onClick={() => open(server)}>编辑</button><button className="danger-action" type="button" onClick={() => window.confirm(`删除 MCP“${server.name}”？`) && void onDelete(server.id)}>删除</button></div></article>)}
        {!servers.length ? <p className="settings-empty-copy">还没有 MCP 连接。</p> : null}
      </div>
    </section>
  );
}
