import { useEffect, useState, type FormEvent } from "react";
import type { AppSettings, Provider } from "../../domain/types";

type Permission = "allow" | "ask" | "deny";

const rows = [
  ["web_search", "联网与网页读取", "使用内置网络搜索或已绑定的 MCP。"],
  ["file_read", "读取用户选择的文件", "只读取你明确交给当前对话的内容。"],
  ["memory_read", "读取记忆", "始终只读取当前人格隔离的记忆。"],
  ["memory_write", "写入记忆", "AI 可新增和修改，不包含删除权限。"],
  ["life_records", "生活记录", "记账、生理期、饮食与重要日期。"],
  ["diary_write", "写日记", "创建或更新当前人格的日记。"],
  ["autonomy_schedule", "AI 自动唤醒任务", "AI 可提出或创建当前人格的唤醒任务；“每次询问”只生成待你确认的具体提议。"],
  ["subagent_run", "子代理", "把本轮明确委托的任务交给当前人格已启用的子代理。"],
  ["correspondence", "往来信箱", "读信、写信与联系人操作；不包含暂缓的 AI 会客厅。"],
  ["delete", "删除", "高风险操作保持每次询问。"],
] as const;

interface ToolsSettingsProps {
  settings: AppSettings;
  providers: Provider[];
  onSave: (patch: Partial<AppSettings>) => Promise<unknown>;
}

interface RouteDraft {
  search_provider: string;
  search_api_key: string;
  search_endpoint: string;
  memory_strategy: string;
  vector_memory_enabled: boolean;
  embedding_provider_id: string;
  embedding_model: string;
}

const routeDraft = (settings: AppSettings): RouteDraft => ({
  search_provider: String(settings.search_provider || "builtin"),
  search_api_key: String(settings.search_api_key || ""),
  search_endpoint: String(settings.search_endpoint || ""),
  memory_strategy: String(settings.memory_strategy || "hybrid"),
  vector_memory_enabled: Boolean(settings.vector_memory_enabled),
  embedding_provider_id: String(settings.embedding_provider_id || ""),
  embedding_model: String(settings.embedding_model || ""),
});

export function ToolsSettings({ settings, providers, onSave }: ToolsSettingsProps) {
  const [permissions, setPermissions] = useState<Record<string, Permission>>({});
  const [routes, setRoutes] = useState<RouteDraft>(() => routeDraft(settings));
  const [status, setStatus] = useState("");
  const [routeStatus, setRouteStatus] = useState("");

  useEffect(() => setPermissions({
    memory_read: "allow",
    life_records: "ask",
    autonomy_schedule: "ask",
    subagent_run: "ask",
    delete: "ask",
    ...(settings.tool_permissions as Record<string, Permission> || {}),
  }), [settings.tool_permissions]);
  useEffect(() => setRoutes(routeDraft(settings)), [settings]);

  const save = async (next: Record<string, Permission>) => {
    setPermissions(next);
    setStatus("正在保存权限…");
    try {
      await onSave({ tool_permissions: next });
      setStatus("工具权限已保存");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "工具权限保存失败");
    }
  };

  const bulk = (permission: Permission) => {
    const next = Object.fromEntries(rows.map(([key]) => [key, key === "memory_read" ? "allow" : key === "delete" && permission === "allow" ? "ask" : permission])) as Record<string, Permission>;
    void save(next);
  };

  const saveRoutes = async (event: FormEvent) => {
    event.preventDefault();
    if (routes.search_provider !== "builtin" && !routes.search_api_key.trim()) {
      setRouteStatus("当前搜索线路需要填写 API Key");
      return;
    }
    if (routes.search_provider === "custom" && !/^https?:\/\//i.test(routes.search_endpoint.trim())) {
      setRouteStatus("自定义搜索接口必须使用 http:// 或 https://");
      return;
    }
    setRouteStatus("正在保存搜索与记忆线路…");
    try {
      await onSave({ ...routes, search_api_key: routes.search_api_key.trim(), search_endpoint: routes.search_endpoint.trim(), embedding_model: routes.embedding_model.trim() });
      setRouteStatus("搜索与记忆线路已保存");
    } catch (error) {
      setRouteStatus(error instanceof Error ? error.message : "线路设置保存失败");
    }
  };

  const searchHelp = {
    builtin: "免费线路无需 Key；实时性与覆盖面受公开索引限制。",
    tavily: "需要 Tavily API Key，返回带来源链接的实时网页结果。",
    brave: "需要 Brave Search API Key，使用独立网页索引。",
    custom: "向自定义地址 POST {query,max_results}；响应需包含 results 数组。",
  }[routes.search_provider] || "";

  return (
    <section className="settings-section settings-feature">
      <div className="section-heading"><h3>工具、搜索与记忆线路</h3><p>控制模型可使用的能力，并明确保存联网搜索与向量记忆配置。</p></div>
      <form className="settings-form settings-edit-card" onSubmit={saveRoutes}>
        <label>网页搜索线路<select value={routes.search_provider} onChange={(event) => setRoutes((current) => ({ ...current, search_provider: event.target.value }))}><option value="builtin">内置免费搜索（文章＋百科）</option><option value="tavily">Tavily Search</option><option value="brave">Brave Search</option><option value="custom">自定义搜索 API</option></select><small>{searchHelp}</small></label>
        {routes.search_provider !== "builtin" ? <label>搜索 API Key<input type="password" autoComplete="off" value={routes.search_api_key} onChange={(event) => setRoutes((current) => ({ ...current, search_api_key: event.target.value }))} placeholder="粘贴后点下方保存" /></label> : null}
        {routes.search_provider === "custom" ? <label className="span-all">自定义搜索接口<input inputMode="url" value={routes.search_endpoint} onChange={(event) => setRoutes((current) => ({ ...current, search_endpoint: event.target.value }))} placeholder="https://example.com/search" /></label> : null}
        <label>记忆召回策略<select value={routes.memory_strategy} onChange={(event) => setRoutes((current) => ({ ...current, memory_strategy: event.target.value }))}><option value="local_first">本地关键词优先</option><option value="hybrid">本地＋向量混合</option><option value="remote_first">向量优先</option></select></label>
        <label className="check-row"><input type="checkbox" checked={routes.vector_memory_enabled} onChange={(event) => setRoutes((current) => ({ ...current, vector_memory_enabled: event.target.checked }))} /><span>启用向量记忆<small>需要支持 Embedding 的线路；失败时仍保留本地关键词召回。</small></span></label>
        {routes.vector_memory_enabled ? <><label>Embedding 线路<select value={routes.embedding_provider_id} onChange={(event) => setRoutes((current) => ({ ...current, embedding_provider_id: event.target.value }))}><option value="">选择线路</option>{providers.filter((item) => item.enabled !== false).map((provider) => <option value={provider.id} key={provider.id}>{provider.name}</option>)}</select></label><label>Embedding 模型<input value={routes.embedding_model} onChange={(event) => setRoutes((current) => ({ ...current, embedding_model: event.target.value }))} placeholder="text-embedding-3-small" /></label></> : null}
        <p className="form-status span-all" aria-live="polite">{routeStatus}</p>
        <div className="form-actions span-all"><button className="primary-button">保存搜索与记忆线路</button></div>
      </form>
      <div className="bulk-permissions"><span>批量设置权限</span><button type="button" onClick={() => bulk("allow")}>始终允许</button><button type="button" onClick={() => bulk("ask")}>每次询问</button><button type="button" onClick={() => bulk("deny")}>禁止</button></div>
      <div className="permission-settings">
        {rows.map(([key, title, detail]) => (
          <div className={`setting-row${key === "delete" ? " danger-row" : ""}`} key={key}>
            <div><strong>{title}</strong><small>{detail}</small></div>
            <select disabled={key === "memory_read"} value={permissions[key] || "ask"} onChange={(event) => void save({ ...permissions, [key]: event.target.value as Permission })}>
              {key !== "delete" ? <option value="allow">始终允许</option> : null}<option value="ask">每次询问</option><option value="deny">禁止</option>
            </select>
          </div>
        ))}
        <label className="setting-row"><div><strong>AI 工具调用最长时间</strong><small>达到上限后停止继续调用，并根据已有结果回答。</small></div><input type="number" min="30" max="900" step="10" defaultValue={Number(settings.tool_timeout_seconds || 180)} onBlur={(event) => void onSave({ tool_timeout_seconds: Number(event.target.value) || 180 })} /></label>
      </div>
      <p className="form-status" aria-live="polite">{status}</p>
    </section>
  );
}
