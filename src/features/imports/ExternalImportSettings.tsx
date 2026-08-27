import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { Persona, PersonaDraft } from "../../domain/types";
import {
  commitExternalImport,
  externalImportAvailable,
  getExternalImportBatch,
  getImportedConversationMessages,
  listExternalImportBatches,
  previewExternalConversationFile,
  rollbackExternalImport,
} from "./api";
import type {
  ExternalConversationSummary,
  ExternalImportBatch,
  ExternalSourceIdentity,
} from "./types";
import type { Message } from "../../domain/types";

interface ExternalImportSettingsProps {
  personas: Persona[];
  connected: boolean;
  onOpenConnection: () => void;
  onCreatePersona: (draft: PersonaDraft) => Promise<unknown>;
  onCommitted: () => Promise<unknown>;
}

const platformLabels: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  kelivo: "Kelivo",
  astrbot: "AstrBot",
};

const newPersonaValue = "__create_persona__";

function platformLabel(value: string) {
  return platformLabels[value.toLowerCase()] || value;
}

function formatDate(value?: string | null) {
  if (!value) return "时间未知";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function importSummaries(batch: ExternalImportBatch | null) {
  return batch?.conversation_summaries || batch?.preview || [];
}

function isAssistantIdentity(identity: ExternalSourceIdentity) {
  const kind = identity.kind.toLowerCase();
  return identity.roles.includes("assistant") || ["assistant", "persona", "bot", "ai"].some((part) => kind.includes(part));
}

function identityLabel(identity: ExternalSourceIdentity) {
  const name = identity.display_name?.trim() || identity.platform_id?.trim();
  if (name) return name;
  if (identity.roles.includes("assistant")) return "外部助手";
  return identity.kind || "外部身份";
}

function sourceScopeLabel(summary: ExternalConversationSummary) {
  const scope = String(summary.source_context?.scope || "").toLowerCase();
  if (scope.includes("group")) return "群聊";
  if (scope.includes("private") || scope.includes("friend") || scope.includes("direct")) return "私聊";
  return "";
}

function uniqueAssistantIdentities(summaries: ExternalConversationSummary[]) {
  const found = new Map<string, ExternalSourceIdentity>();
  for (const summary of summaries) {
    for (const identity of summary.source_identities || []) {
      if (isAssistantIdentity(identity) && !found.has(identity.id)) found.set(identity.id, identity);
    }
  }
  return [...found.values()];
}

function createdPersonaDraft(name: string): PersonaDraft {
  return {
    name: name.trim().slice(0, 80) || "导入的人格",
    prompt: "",
    config: {
      memory_enabled: true,
      history_enabled: true,
      startup_chat: "resume",
      summary_frequency: 20,
      message_template: "{{message}}",
    },
  };
}

function createdPersonaId(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" ? id : "";
}

export function ExternalImportSettings({
  personas,
  connected,
  onOpenConnection,
  onCreatePersona,
  onCommitted,
}: ExternalImportSettingsProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ExternalImportBatch | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [personaMapping, setPersonaMapping] = useState<Record<string, string>>({});
  const [recent, setRecent] = useState<ExternalImportBatch[]>([]);
  const [viewingConversationId, setViewingConversationId] = useState("");
  const [viewingMessages, setViewingMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const summaries = importSummaries(preview);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedSummaries = useMemo(
    () => summaries.filter((item) => selectedSet.has(item.canonical_conversation_id)),
    [selectedSet, summaries],
  );
  const assistantIdentities = useMemo(
    () => uniqueAssistantIdentities(selectedSummaries),
    [selectedSummaries],
  );

  const reloadBatches = async () => {
    if (!connected || !externalImportAvailable()) {
      setRecent([]);
      return;
    }
    const result = await listExternalImportBatches();
    setRecent(result.batches || []);
  };

  useEffect(() => {
    void reloadBatches().catch(() => setRecent([]));
  }, [connected]);

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setPreview(null);
    setSelectedIds([]);
    setPersonaMapping({});
    setViewingConversationId("");
    setViewingMessages([]);
    setStatus(`正在识别 ${file.name}…`);
    try {
      const result = await previewExternalConversationFile(file);
      const nextSummaries = importSummaries(result);
      setPreview(result);
      setSelectedIds(result.selection?.selected_conversation_ids || nextSummaries.filter((item) => !item.possible_duplicate).map((item) => item.canonical_conversation_id));
      setStatus(`已识别为 ${platformLabel(result.platform)}，请确认要导入的对话。此时尚未写入聊天库。`);
      await reloadBatches().catch(() => undefined);
    } catch (error) {
      setStatus(error instanceof Error ? `解析失败：${error.message}` : "解析失败：文件格式无法识别");
    } finally {
      setBusy(false);
    }
  };

  const toggleConversation = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const commit = async () => {
    if (!preview || preview.status !== "previewed") return;
    if (!selectedIds.length) {
      setStatus("请至少选择一段对话");
      return;
    }
    setBusy(true);
    setStatus("正在导入所选对话…");
    try {
      const resolvedMapping: Record<string, string | null> = {};
      for (const identity of assistantIdentities) {
        const target = personaMapping[identity.id] || "";
        if (target === newPersonaValue) {
          const created = await onCreatePersona(createdPersonaDraft(identityLabel(identity)));
          const personaId = createdPersonaId(created);
          if (!personaId) throw new Error(`创建 Persona“${identityLabel(identity)}”后没有返回 ID`);
          resolvedMapping[identity.id] = personaId;
        } else {
          resolvedMapping[identity.id] = target || null;
        }
      }
      const result = await commitExternalImport(preview.id, {
        selected_conversation_ids: selectedIds,
        persona_mapping: resolvedMapping,
      });
      setPreview(result);
      const importedCount = result.conversations?.length || result.created_conversation_ids?.length || selectedIds.length;
      setStatus(`导入完成：${importedCount} 段对话已进入“已归档”，长期记忆保持不变。`);
      const refreshResults = await Promise.allSettled([onCommitted(), reloadBatches()]);
      if (refreshResults.some((item) => item.status === "rejected")) {
        setStatus(`导入完成：${importedCount} 段对话已经写入；当前列表刷新失败，重新打开设置即可看到。`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? `导入失败：${error.message}` : "导入失败");
    } finally {
      setBusy(false);
    }
  };

  const rollback = async (batch: ExternalImportBatch) => {
    if (batch.status === "rolled_back") return;
    if (batch.status === "committed" && !window.confirm("撤销会删除这个批次创建的外部对话。导入后继续产生过新消息的对话会自动保留。继续吗？")) return;
    setBusy(true);
    setStatus(batch.status === "previewed" ? "正在丢弃预览批次…" : "正在撤销导入…");
    try {
      const result = await rollbackExternalImport(batch.id);
      if (preview?.id === batch.id) setPreview(result);
      setStatus(batch.status === "previewed" ? "预览批次已丢弃，没有写入聊天库。" : "本次导入已撤销。");
      const refreshResults = await Promise.allSettled([onCommitted(), reloadBatches()]);
      if (refreshResults.some((item) => item.status === "rejected")) {
        setStatus(batch.status === "previewed" ? "预览批次已丢弃；批次列表可在重新打开设置后刷新。" : "本次导入已撤销；当前列表刷新失败，重新打开设置即可同步。");
      }
    } catch (error) {
      setStatus(error instanceof Error ? `撤销失败：${error.message}` : "撤销失败");
    } finally {
      setBusy(false);
    }
  };

  const openBatch = async (batchId: string) => {
    setBusy(true);
    setStatus("正在读取导入批次…");
    try {
      const result = await getExternalImportBatch(batchId);
      setPreview(result);
      setSelectedIds(result.selection?.selected_conversation_ids || []);
      setViewingConversationId("");
      setViewingMessages([]);
      setStatus(result.status === "committed" ? "已打开导入记录。" : result.status === "previewed" ? "可以继续确认这个预览批次。" : "这个导入批次已经撤销。");
    } catch (error) {
      setStatus(error instanceof Error ? `读取失败：${error.message}` : "读取失败");
    } finally {
      setBusy(false);
    }
  };

  const openImportedConversation = async (conversationId: string) => {
    setBusy(true);
    setStatus("正在读取外部对话…");
    try {
      setViewingMessages(await getImportedConversationMessages(conversationId));
      setViewingConversationId(conversationId);
      setStatus("已打开外部历史；这里仅阅读，不会触发旧工具调用。 ");
    } catch (error) {
      setStatus(error instanceof Error ? `读取失败：${error.message}` : "读取失败");
    } finally {
      setBusy(false);
    }
  };

  const stats = preview?.statistics;
  const allSelected = Boolean(summaries.length) && selectedIds.length === summaries.length;

  return (
    <section className="settings-section settings-feature external-import-settings">
      <div className="section-heading">
        <h3>外部对话导入</h3>
        <p>把 ChatGPT、Claude、Kelivo 或 AstrBot 的导出文件搬进 Atherloom。先自动识别和预览，确认后一次导入。</p>
      </div>

      <ol className="import-route" aria-label="导入流程">
        <li className={preview ? "done" : "active"}><span>1</span><strong>选择文件</strong></li>
        <li className={preview?.status === "previewed" ? "active" : preview ? "done" : ""}><span>2</span><strong>预览选择</strong></li>
        <li className={preview?.status === "previewed" ? "active" : preview?.status === "committed" ? "done" : ""}><span>3</span><strong>身份映射</strong></li>
        <li className={preview?.status === "committed" ? "done" : ""}><span>4</span><strong>导入完成</strong></li>
      </ol>

      <div className="import-source-card">
        <div>
          <strong>{connected ? "选择官方导出文件" : "先连接 FastAPI"}</strong>
          <p>{connected ? "支持 JSON、JSONL 与已注册 parser 的备份 ZIP；文件名只作提示，实际按内部数据结构识别。" : "外部导入会写入服务器的 Conversation 数据，因此需要在“后端连接”中填写 FastAPI 地址。"}</p>
          <div className="import-platforms" aria-label="支持的平台">
            {Object.values(platformLabels).map((label) => <span key={label}>{label}</span>)}
          </div>
        </div>
        {connected
          ? <button className="primary-button" type="button" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? "正在读取…" : "选择导出文件"}</button>
          : <button className="primary-button" type="button" onClick={onOpenConnection}>连接 FastAPI</button>}
        <input ref={inputRef} hidden type="file" accept=".json,.jsonl,.zip,application/json,application/x-ndjson,application/zip" onChange={(event) => void chooseFile(event)} />
      </div>

      {preview ? (
        <div className="import-preview">
          <header>
            <div><span>检测结果</span><h4>{platformLabel(preview.platform)} · {preview.source_name || "外部导出"}</h4></div>
            <small>{preview.format_id}</small>
          </header>
          <div className="import-stat-grid">
            <span><strong>{stats?.conversation_count ?? preview.conversation_count}</strong> 对话</span>
            <span><strong>{stats?.message_count ?? preview.message_count}</strong> 消息</span>
            <span><strong>{stats?.attachment_count ?? 0}</strong> 附件</span>
            <span><strong>{stats?.branch_count ?? 0}</strong> 分支{stats?.possible_duplicate_count ? ` · ${stats.possible_duplicate_count} 重复` : ""}</span>
            <span><strong>{stats?.non_text_block_count ?? 0}</strong> 工具/其他块</span>
            <span><strong>{stats?.warning_count ?? preview.warnings.length}</strong> 提示</span>
          </div>

          {preview.warnings.length ? <details className="import-warnings"><summary>查看 {preview.warnings.length} 条格式提示</summary>{preview.warnings.map((warning, index) => <p key={`${warning.code}-${index}`}><strong>{warning.code}</strong>{warning.message}</p>)}</details> : null}

          {preview.status === "previewed" ? (
            <>
              <div className="import-list-heading">
                <div><strong>选择对话</strong><small>已选 {selectedIds.length} / {summaries.length}</small></div>
                <button type="button" className="secondary-button" onClick={() => setSelectedIds(allSelected ? [] : summaries.map((item) => item.canonical_conversation_id))}>{allSelected ? "取消全选" : "全选"}</button>
              </div>
              <div className="import-conversation-list">
                {summaries.map((conversation) => (
                  <label key={conversation.canonical_conversation_id} className={selectedSet.has(conversation.canonical_conversation_id) ? "selected" : ""}>
                    <input type="checkbox" checked={selectedSet.has(conversation.canonical_conversation_id)} onChange={() => toggleConversation(conversation.canonical_conversation_id)} />
                    <span><strong>{conversation.title || "未命名对话"}</strong><small>{sourceScopeLabel(conversation) ? `${sourceScopeLabel(conversation)} · ` : ""}{conversation.message_count} 条消息 · {conversation.branch_count} 个分支 · {formatDate(conversation.updated_at || conversation.created_at)}</small></span>
                    {conversation.possible_duplicate ? <em>可能重复</em> : conversation.warning_count ? <em>{conversation.warning_count} 条提示</em> : null}
                  </label>
                ))}
              </div>

              {assistantIdentities.length ? <div className="import-mapping-card">
                <header><strong>Assistant 映射</strong><p>默认仅作历史归档。只有你确认是同一个 AI 时，才绑定现有 Persona 或创建同名 Persona。</p></header>
                {assistantIdentities.map((identity) => (
                  <label key={identity.id}>
                    <span><strong>{identityLabel(identity)}</strong><small>{platformLabel(identity.platform)} · {identity.message_count} 条消息</small></span>
                    <select value={personaMapping[identity.id] || ""} onChange={(event) => setPersonaMapping((current) => ({ ...current, [identity.id]: event.target.value }))}>
                      <option value="">仅作为历史归档</option>
                      {personas.map((persona) => <option value={persona.id} key={persona.id}>绑定：{persona.name}</option>)}
                      <option value={newPersonaValue}>创建同名 Persona</option>
                    </select>
                  </label>
                ))}
              </div> : null}

              <div className="import-commit-card">
                <div><strong>导入所选对话</strong><p>对话先进入“已归档”；不会自动写长期记忆，也不会执行历史工具调用或导入隐藏提示词。</p></div>
                <button className="primary-button" type="button" disabled={busy || !selectedIds.length} onClick={() => void commit()}>{busy ? "正在导入…" : `一键导入 ${selectedIds.length} 段对话`}</button>
              </div>
            </>
          ) : (
            <div className={`import-result ${preview.status}`}>
              <strong>{preview.status === "committed" ? "导入已完成" : "这个批次已撤销"}</strong>
              <p>{preview.status === "committed" ? `${preview.conversations?.length || preview.created_conversation_ids?.length || 0} 段对话已写入历史归档。` : "聊天库中不再保留这个批次创建的内容。"}</p>
              {preview.status === "committed" ? <button className="secondary-button" type="button" disabled={busy} onClick={() => void rollback(preview)}>撤销本次导入</button> : null}
            </div>
          )}
          {preview.status === "committed" && preview.conversations?.length ? <div className="import-archive-reader">
            <header><strong>已导入的历史</strong><small>点击即可只读查看；绑定 Persona 后也会出现在对应 Persona 的“已归档”分组。</small></header>
            <div className="imported-conversation-tabs">{preview.conversations.map((conversation) => {
              const summary = summaries.find((item) => item.canonical_conversation_id === conversation.canonical_conversation_id);
              return <button type="button" className={viewingConversationId === conversation.conversation_id ? "active" : ""} disabled={busy} key={conversation.conversation_id} onClick={() => void openImportedConversation(conversation.conversation_id)}>{summary?.title || conversation.source_conversation_id || "外部对话"}<small>{conversation.imported_message_count} 条</small></button>;
            })}</div>
            {viewingConversationId ? <div className="imported-message-reader">{viewingMessages.map((message, index) => <article data-role={message.role} key={message.id || `${message.role}-${index}`}><strong>{message.role === "assistant" ? "Assistant" : message.role === "user" ? "用户" : "系统记录"}</strong>{message.reasoning ? <details><summary>思考 / reasoning</summary><p>{message.reasoning}</p></details> : null}<p>{message.content}</p></article>)}</div> : <p className="import-reader-empty">选择一段对话查看消息。</p>}
          </div> : null}
        </div>
      ) : null}

      <p className="form-status import-status" aria-live="polite">{status}</p>

      {recent.length ? <details className="import-history"><summary>最近的导入批次</summary><div>{recent.map((batch) => <article key={batch.id}><span><strong>{platformLabel(batch.platform)} · {batch.source_name || "外部导出"}</strong><small>{batch.conversation_count} 段对话 · {formatDate(batch.created_at)}</small></span><em data-status={batch.status}>{batch.status === "previewed" ? "待确认" : batch.status === "committed" ? "已导入" : "已撤销"}</em><button type="button" disabled={busy} onClick={() => void openBatch(batch.id)}>查看</button>{batch.status !== "rolled_back" ? <button type="button" disabled={busy} onClick={() => void rollback(batch)}>{batch.status === "previewed" ? "丢弃" : "撤销"}</button> : null}</article>)}</div></details> : null}
    </section>
  );
}
