import { useCallback, useEffect, useState, type FormEvent } from "react";
import { fastApi } from "../../adapters/fastapi/client";
import type { Memory, MemoryDraft, MemoryKind } from "../../domain/types";

const kinds: Array<[MemoryKind, string]> = [["fact", "事实"], ["preference", "偏好"], ["relationship", "关系"], ["promise", "承诺"], ["event", "事件"], ["emotion", "情感"], ["summary", "摘要"], ["diary", "日记"], ["other", "其他"]];

function emptyDraft(personaKey: string): MemoryDraft {
  return { title: "", content: "", kind: "fact", persona_key: personaKey, importance: 0.5, confidence: 1, source_type: "explicit" };
}

export function MemorySettings({ personaKey }: { personaKey: string }) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("current");
  const [kindFilter, setKindFilter] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<MemoryDraft>(() => emptyDraft(personaKey));
  const [status, setStatus] = useState("");
  const [organizing, setOrganizing] = useState(false);

  const reload = useCallback(async () => {
    try {
      const groups = await Promise.all([
        fastApi.listMemories(personaKey, query),
        fastApi.listMemories(personaKey, query, true, false),
        fastApi.listMemories(personaKey, query, true, true),
      ]);
      setMemories([...new Map(groups.flat().map((item) => [item.id, item])).values()]);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "记忆读取失败");
    }
  }, [personaKey, query]);

  useEffect(() => {
    setEditing(null);
    setDraft(emptyDraft(personaKey));
    void reload();
  }, [personaKey, reload]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setStatus(editing ? "正在保存记忆修改…" : "正在新增记忆…");
    try {
      if (editing) await fastApi.updateMemory(editing, draft); else await fastApi.createMemory(draft);
      setEditing(null);
      setDraft(emptyDraft(personaKey));
      setStatus("记忆已保存");
      await reload();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "记忆保存失败");
    }
  };

  const visible = memories.filter((memory) => !kindFilter || memory.kind === kindFilter).filter((memory) => statusFilter === "trash" ? Boolean(memory.deleted_at)
    : statusFilter === "archived" ? Boolean(memory.archived) && !memory.deleted_at
      : statusFilter === "candidate" ? memory.memory_status === "candidate" && !memory.deleted_at
        : statusFilter === "forgotten" ? memory.memory_status === "forgotten" && !memory.deleted_at
          : statusFilter === "superseded" ? memory.memory_status === "superseded" && !memory.deleted_at
        : !memory.deleted_at && !memory.archived && !["forgotten", "superseded"].includes(memory.memory_status || ""));

  const organize = async () => {
    setOrganizing(true);
    setStatus("正在整理衰减、关联与阶段摘要…");
    try {
      const result = await fastApi.organizeMemories(personaKey);
      setStatus(`整理完成：检查 ${result.lifecycle.processed || 0} 条，淡化 ${result.lifecycle.faded || 0} 条，新增 ${result.consolidated.candidates_created || 0} 条待确认摘要`);
      await reload();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "记忆整理失败");
    } finally {
      setOrganizing(false);
    }
  };

  return (
    <section className="settings-section settings-feature">
      <div className="section-heading section-heading-with-action"><div><h3>记忆库</h3><p>当前人格的长期记忆与其他人格隔离；本机聊天只会召回真正相关的记忆。</p></div><button type="button" disabled={organizing} onClick={() => void organize()}>{organizing ? "正在整理…" : "立即整理"}</button></div>
      <div className="memory-toolbar-react"><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void reload()} placeholder="搜索记忆" /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="current">当前记忆</option><option value="candidate">待确认</option><option value="forgotten">已遗忘</option><option value="superseded">已替代</option><option value="archived">已归档</option><option value="trash">回收站</option></select><select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}><option value="">全部类型</option>{kinds.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><button type="button" onClick={() => void reload()}>搜索</button></div>
      <form className="settings-form settings-edit-card" onSubmit={(event) => void submit(event)}>
        {editing ? <div className="edit-state">正在修改记忆</div> : null}
        <label>标题<input required maxLength={160} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></label>
        <label>类型<select value={draft.kind} onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as MemoryKind }))}>{kinds.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label className="span-all">内容<textarea required rows={5} value={draft.content} onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))} /></label>
        <label>重要度<input type="range" min="0.1" max="1" step="0.1" value={draft.importance} onChange={(event) => setDraft((current) => ({ ...current, importance: Number(event.target.value) }))} /><small>{draft.importance.toFixed(1)}</small></label>
        <label>可信度<input type="range" min="0" max="1" step="0.1" value={draft.confidence} onChange={(event) => setDraft((current) => ({ ...current, confidence: Number(event.target.value) }))} /><small>{draft.confidence.toFixed(1)}</small></label>
        <div className="form-actions">{editing ? <button type="button" className="secondary-button" onClick={() => { setEditing(null); setDraft(emptyDraft(personaKey)); }}>取消修改</button> : null}<button className="primary-button">{editing ? "保存修改" : "新增记忆"}</button></div>
      </form>
      <div className="settings-card-list">
        {visible.map((memory) => (
          <article className="settings-list-card" key={memory.id}>
            <div className="settings-list-copy"><strong>{memory.starred ? "★ " : ""}{memory.title}</strong><small>{kinds.find(([kind]) => kind === memory.kind)?.[1] || memory.kind} · 重要度 {Number(memory.importance || 0.5).toFixed(1)} · 可信 {Math.round(Number(memory.confidence || 0) * 100)}%</small><p>{memory.content}</p></div>
            <div className="card-actions">
              {memory.memory_status === "candidate" ? <><button type="button" onClick={() => void fastApi.confirmMemory(memory.id, true).then(reload)}>确认</button><button type="button" className="danger-action" onClick={() => void fastApi.confirmMemory(memory.id, false).then(reload)}>驳回</button></> : null}
              {!memory.deleted_at ? <button type="button" onClick={() => { setEditing(memory.id); setDraft({ title: memory.title, content: memory.content, kind: memory.kind, persona_key: memory.persona_key, importance: memory.importance, confidence: memory.confidence, source_type: memory.source_type }); }}>编辑</button> : null}
              {!memory.deleted_at ? <button type="button" onClick={() => void fastApi.updateMemoryState(memory.id, { starred: !memory.starred }).then(reload)}>{memory.starred ? "取消星标" : "星标"}</button> : null}
              {!memory.deleted_at ? <button type="button" onClick={() => void fastApi.updateMemoryState(memory.id, { archived: !memory.archived }).then(reload)}>{memory.archived ? "取消归档" : "归档"}</button> : null}
              <button className="danger-action" type="button" onClick={() => void fastApi.updateMemoryState(memory.id, { trash: !memory.deleted_at }).then(reload)}>{memory.deleted_at ? "恢复" : "回收"}</button>
            </div>
          </article>
        ))}
        {!visible.length ? <p className="settings-empty-copy">当前筛选下没有记忆。</p> : null}
      </div>
      <p className="form-status" aria-live="polite">{status}</p>
    </section>
  );
}
