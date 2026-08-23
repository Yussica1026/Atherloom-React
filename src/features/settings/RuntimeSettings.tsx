import { useCallback, useEffect, useMemo, useState } from "react";
import { fastApi } from "../../adapters/fastapi/client";
import type { McpServer, Memory, MotivationPayload, Persona, Provider, Worldbook } from "../../domain/types";

interface RuntimeSettingsProps {
  personaKey: string;
  personas: Persona[];
  providers: Provider[];
  worldbooks: Worldbook[];
  mcpServers: McpServer[];
  onOpenMemory: () => void;
  onOpenMcp: () => void;
  onOpenTools: () => void;
}

const fallbackLabels: Record<string, string> = {
  connection: "联结", curiosity: "好奇", reflection: "反思", duty: "责任", social: "交流",
  fatigue: "疲劳", closeness: "亲近", stress: "压力", joy: "愉悦",
};

export function RuntimeSettings(props: RuntimeSettingsProps) {
  const { personaKey, personas, providers, worldbooks, mcpServers, onOpenMemory, onOpenMcp, onOpenTools } = props;
  const [motivation, setMotivation] = useState<MotivationPayload | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [offlineMode, setOfflineMode] = useState("limited");
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    setStatus("正在检查当前人格的数据…");
    try {
      const [nextMotivation, currentMemories, archivedMemories, trashMemories] = await Promise.all([
        fastApi.getMotivation(personaKey),
        fastApi.listMemories(personaKey),
        fastApi.listMemories(personaKey, "", true, false),
        fastApi.listMemories(personaKey, "", true, true),
      ]);
      setMotivation(nextMotivation);
      setMemories([...new Map([...currentMemories, ...archivedMemories, ...trashMemories].map((item) => [item.id, item])).values()]);
      setEnabled(Boolean(nextMotivation.enabled));
      setOfflineMode(String(nextMotivation.offline_mode || "limited"));
      setStatus("检查完成");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "插件状态读取失败");
    }
  }, [personaKey]);

  useEffect(() => { void load(); }, [load]);

  const memoryStats = useMemo(() => ({
    active: memories.filter((item) => !item.deleted_at && !item.archived && (item.memory_status || "active") === "active").length,
    candidate: memories.filter((item) => !item.deleted_at && item.memory_status === "candidate").length,
    archived: memories.filter((item) => Boolean(item.archived)).length,
    trash: memories.filter((item) => Boolean(item.deleted_at)).length,
  }), [memories]);

  const saveMotivation = async () => {
    setStatus("正在保存九维状态设置…");
    try {
      await fastApi.setMotivationEnabled(personaKey, enabled, offlineMode);
      await load();
      setStatus("九维状态设置已保存");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "九维状态保存失败");
    }
  };

  const runAction = async (action: "tick" | "reset") => {
    if (action === "reset" && !window.confirm("重置当前人格的九维状态？记忆和聊天不会删除。")) return;
    setStatus(action === "tick" ? "正在执行一次心跳…" : "正在重置九维状态…");
    try {
      if (action === "tick") await fastApi.tickMotivation(personaKey);
      else await fastApi.resetMotivation(personaKey);
      await load();
      setStatus(action === "tick" ? "心跳已完成" : "九维状态已重置");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "操作失败");
    }
  };

  const personaName = personas.find((item) => item.id === personaKey)?.name || "默认人格";
  return <section className="settings-section settings-feature">
    <div className="section-heading"><span className="settings-eyebrow">INNER PLUGINS</span><h3>插件中心与数据健康</h3><p>以下统计与九维状态都按当前人格隔离，切换人格不会共用。</p></div>
    <div className="plugin-overview-react">
      <article><strong>记忆</strong><small>{memories.length} 条 · 当前 {memoryStats.active} · 待确认 {memoryStats.candidate} · 回收站 {memoryStats.trash}</small><button type="button" onClick={onOpenMemory}>管理记忆</button></article>
      <article><strong>MCP</strong><small>{mcpServers.length} 个连接 · {mcpServers.filter((item) => item.last_status === "online").length} 个在线</small><button type="button" onClick={onOpenMcp}>管理 MCP</button></article>
      <article><strong>工具与线路</strong><small>{providers.filter((item) => item.enabled !== false).length} 条模型线路 · {worldbooks.filter((item) => item.enabled !== false).length} 本世界书</small><button type="button" onClick={onOpenTools}>检查权限</button></article>
    </div>
    <div className="settings-edit-card runtime-diagnostic"><h4>数据健康</h4><p>当前人格：{personaName}</p><p>记忆：{memoryStats.active} 当前 · {memoryStats.candidate} 待确认 · {memoryStats.archived} 归档 · {memoryStats.trash} 回收站</p><p>模型线路：{providers.filter((item) => item.enabled !== false).length} 条可用 · MCP：{mcpServers.filter((item) => item.enabled !== false).length} 个已启用</p><button type="button" onClick={() => void load()}>重新检查</button></div>
    <div className="settings-edit-card runtime-diagnostic"><h4>版本与运行方式</h4><p>Atherloom React 0.2.4 · Android versionCode 10</p><p>{window.AtherloomNative ? "Android WebView 本机/后端双模式" : "浏览器 / 可安装 PWA；离线壳不会强制刷新正在进行的聊天。"}</p></div>
    <form className="settings-form settings-edit-card" onSubmit={(event) => { event.preventDefault(); void saveMotivation(); }}>
      <div className="span-all"><h4>人格九维状态</h4><p className="form-hint">启用后，每轮真实对话只更新当前人格的驱动，并作为行为参考注入；它不能绕过任何工具权限。</p></div>
      <label className="check-row"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span>启用九维状态</span></label>
      <label>离线时间处理<select value={offlineMode} onChange={(event) => setOfflineMode(event.target.value)}><option value="frozen">冻结，不补算</option><option value="limited">有限补算（推荐）</option><option value="full">完整补算</option></select></label>
      <div className="motivation-grid span-all">{Object.entries(motivation?.state.drives || {}).map(([key, value]) => <article key={key}><header><strong>{motivation?.drives?.[key]?.label || fallbackLabels[key] || key}</strong><span>{Math.round(value)}</span></header><meter min="0" max="100" value={value} /></article>)}</div>
      {motivation?.state.thoughts?.length ? <div className="motivation-thoughts span-all"><strong>持续念头</strong>{motivation.state.thoughts.slice(-4).map((item) => <p key={item.id}>{item.content}{item.obsession ? " · 持续" : ""}</p>)}</div> : null}
      <p className="form-status span-all" aria-live="polite">{status}</p>
      <div className="form-actions span-all"><button type="button" onClick={() => void runAction("tick")}>模拟一次心跳</button><button type="button" className="danger-action" onClick={() => void runAction("reset")}>重置状态</button><button className="primary-button">保存九维设置</button></div>
    </form>
  </section>;
}
