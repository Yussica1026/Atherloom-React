import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { Worldbook, WorldbookDraft, WorldbookEntry } from "../../domain/types";

interface WorldbookSettingsProps {
  worldbooks: Worldbook[];
  onCreate: (draft: WorldbookDraft) => Promise<unknown>;
  onUpdate: (id: string, draft: WorldbookDraft) => Promise<unknown>;
  onDelete: (id: string) => Promise<void>;
}

function entryId() {
  return globalThis.crypto?.randomUUID?.() || `entry-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function emptyEntry(): WorldbookEntry {
  return {
    id: entryId(),
    name: "",
    content: "",
    enabled: true,
    constant: false,
    keywords: [],
    use_regex: false,
    case_sensitive: false,
    scan_depth: 4,
    position: "system_after",
    role: "system",
    priority: 0,
  };
}

function emptyBook(): WorldbookDraft {
  return { name: "", description: "", enabled: true, entries: [] };
}

export function WorldbookSettings({ worldbooks, onCreate, onUpdate, onDelete }: WorldbookSettingsProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorldbookDraft>(emptyBook);
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryIndex, setEntryIndex] = useState<number | null>(null);
  const [entryDraft, setEntryDraft] = useState<WorldbookEntry>(emptyEntry);
  const [keywordsText, setKeywordsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

  const updateBook = <Key extends keyof WorldbookDraft>(key: Key, value: WorldbookDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const updateEntry = <Key extends keyof WorldbookEntry>(key: Key, value: WorldbookEntry[Key]) => {
    setEntryDraft((current) => ({ ...current, [key]: value }));
  };

  const openNew = () => {
    setEditingId(null);
    setDraft(emptyBook());
    setStatus("");
    setFormOpen(true);
  };

  const openEdit = (book: Worldbook) => {
    setEditingId(book.id);
    setDraft({ name: book.name, description: book.description || "", enabled: book.enabled !== false, entries: book.entries.map((entry) => ({ ...entry, keywords: [...(entry.keywords || [])] })) });
    setStatus("");
    setFormOpen(true);
  };

  const closeBook = (nextStatus = "") => {
    setFormOpen(false);
    setEditingId(null);
    setDraft(emptyBook());
    setEntryOpen(false);
    setEntryIndex(null);
    setStatus(nextStatus);
  };

  const openEntry = (index: number | null) => {
    const entry = index === null ? emptyEntry() : draft.entries[index];
    setEntryIndex(index);
    setEntryDraft({ ...entry, keywords: [...(entry.keywords || [])] });
    setKeywordsText((entry.keywords || []).join("\n"));
    setEntryOpen(true);
  };

  const saveEntry = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const saved = { ...entryDraft, keywords: keywordsText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) };
    setDraft((current) => {
      const entries = [...current.entries];
      if (entryIndex === null) entries.push(saved);
      else entries[entryIndex] = saved;
      return { ...current, entries };
    });
    setEntryOpen(false);
    setEntryIndex(null);
  };

  const submitBook = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setStatus(editingId ? "正在保存世界书修改…" : "正在保存世界书…");
    try {
      if (editingId) await onUpdate(editingId, draft);
      else await onCreate(draft);
      closeBook(editingId ? "世界书修改已保存" : "世界书已保存");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "世界书保存失败");
    } finally {
      setBusy(false);
    }
  };

  const exportWorldbooks = () => {
    const blob = new Blob([JSON.stringify({ format: "atherloom-worldbooks", version: 1, worldbooks }, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `atherloom-worldbooks-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    setStatus(`已导出 ${worldbooks.length} 本世界书`);
  };

  const importWorldbooks = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setStatus("正在导入世界书…");
    try {
      const bundle = JSON.parse(await file.text()) as { format?: string; worldbooks?: WorldbookDraft[] };
      if (bundle.format !== "atherloom-worldbooks" || !Array.isArray(bundle.worldbooks)) throw new Error("不是有效的 Atherloom 世界书文件");
      for (const book of bundle.worldbooks) {
        await onCreate({
          name: String(book.name || "导入的世界书"),
          description: String(book.description || ""),
          enabled: book.enabled !== false,
          entries: Array.isArray(book.entries) ? book.entries : [],
        });
      }
      setStatus(`已导入 ${bundle.worldbooks.length} 本世界书`);
    } catch (error) {
      setStatus(`导入失败：${error instanceof Error ? error.message : "无法读取文件"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section settings-feature" aria-labelledby="worldbooks-title">
      <div className="section-heading section-heading-with-action">
        <div><h3 id="worldbooks-title">世界书</h3><p>保存可复用的背景、规则与预设，在每个聊天窗口中按需注入。</p></div>
        <div className="heading-actions">
          <button className="secondary-button" type="button" onClick={() => importRef.current?.click()}>导入</button>
          <button className="secondary-button" type="button" onClick={exportWorldbooks}>导出</button>
          <button className="primary-button compact-action" type="button" onClick={openNew}>添加世界书</button>
        </div>
        <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(event) => void importWorldbooks(event)} />
      </div>

      <div className="settings-card-list">
        {worldbooks.map((book) => <article className={`settings-list-card${editingId === book.id ? " editing" : ""}`} key={book.id}>
          <div className="settings-list-copy"><strong>{book.name}</strong><small>{book.enabled ? "已启用" : "已停用"} · {book.entries.length} 个条目 · {book.description || "无简介"}</small></div>
          <div className="card-actions"><button type="button" onClick={() => openEdit(book)}>编辑</button><button className="danger-action" type="button" onClick={() => { if (window.confirm("删除这本世界书？现有聊天中的选择也会失效。")) void onDelete(book.id); }}>删除</button></div>
        </article>)}
        {!worldbooks.length && !formOpen ? <p className="settings-empty-copy">还没有世界书。</p> : null}
      </div>

      {formOpen ? <form className="settings-form settings-edit-card worldbook-form" onSubmit={submitBook}>
        {editingId ? <div className="edit-state">正在编辑「{draft.name}」</div> : <div className="edit-state neutral">新建世界书</div>}
        <label>名称<input maxLength={100} required value={draft.name} onChange={(event) => updateBook("name", event.target.value)} /></label>
        <label>简介<input maxLength={1000} value={draft.description} onChange={(event) => updateBook("description", event.target.value)} /></label>
        <label className="check-row span-all"><input type="checkbox" checked={draft.enabled} onChange={(event) => updateBook("enabled", event.target.checked)} /><span>启用世界书</span></label>
        <div className="worldbook-entry-head span-all"><strong>条目</strong><button className="secondary-button" type="button" onClick={() => openEntry(null)}>添加条目</button></div>
        <div className="worldbook-entry-list span-all">
          {draft.entries.map((entry, index) => <article className="worldbook-entry-row" key={entry.id}>
            <div><strong>{entry.name || "未命名条目"}</strong><small>{entry.constant ? "常驻" : "关键词触发"} · {entry.enabled ? "启用" : "停用"} · 优先级 {entry.priority}</small></div>
            <div className="card-actions"><button type="button" onClick={() => openEntry(index)}>编辑</button><button className="danger-action" type="button" onClick={() => updateBook("entries", draft.entries.filter((_, itemIndex) => itemIndex !== index))}>删除</button></div>
          </article>)}
          {!draft.entries.length ? <p className="settings-empty-copy">还没有条目。添加后才能向模型注入内容。</p> : null}
        </div>
        <p className="form-status span-all" aria-live="polite">{status}</p>
        <div className="form-actions"><button className="secondary-button" type="button" onClick={() => closeBook()}>取消</button><button className="primary-button" disabled={busy}>保存世界书</button></div>
      </form> : null}

      {!formOpen ? <p className="form-status" aria-live="polite">{status}</p> : null}

      {entryOpen ? <EntryEditor entry={entryDraft} keywords={keywordsText} onUpdate={updateEntry} onKeywordsChange={setKeywordsText} onCancel={() => { setEntryOpen(false); setEntryIndex(null); }} onSave={saveEntry} /> : null}
    </section>
  );
}

interface EntryEditorProps {
  entry: WorldbookEntry;
  keywords: string;
  onUpdate: <Key extends keyof WorldbookEntry>(key: Key, value: WorldbookEntry[Key]) => void;
  onKeywordsChange: (value: string) => void;
  onCancel: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}

function EntryEditor({ entry, keywords, onUpdate, onKeywordsChange, onCancel, onSave }: EntryEditorProps) {
  return <div className="entry-editor-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
    <form className="entry-editor" role="dialog" aria-modal="true" aria-label="世界书条目" onSubmit={onSave}>
      <h4>世界书条目</h4>
      <label>条目名称<input maxLength={100} required value={entry.name} onChange={(event) => onUpdate("name", event.target.value)} /></label>
      <label>内容<textarea rows={8} required value={entry.content} onChange={(event) => onUpdate("content", event.target.value)} /></label>
      <label className="check-row"><input type="checkbox" checked={entry.enabled} onChange={(event) => onUpdate("enabled", event.target.checked)} /><span>启用条目</span></label>
      <label className="check-row"><input type="checkbox" checked={entry.constant} onChange={(event) => onUpdate("constant", event.target.checked)} /><span>常驻激活</span></label>
      <label>关键词（每行一个）<textarea rows={3} value={keywords} onChange={(event) => onKeywordsChange(event.target.value)} /></label>
      <div className="entry-options">
        <label className="check-row"><input type="checkbox" checked={entry.use_regex} onChange={(event) => onUpdate("use_regex", event.target.checked)} /><span>使用正则</span></label>
        <label className="check-row"><input type="checkbox" checked={entry.case_sensitive} onChange={(event) => onUpdate("case_sensitive", event.target.checked)} /><span>区分大小写</span></label>
        <label>扫描深度<input type="number" min="1" max="100" value={entry.scan_depth} onChange={(event) => onUpdate("scan_depth", Number(event.target.value))} /></label>
        <label>注入位置<select value={entry.position} onChange={(event) => onUpdate("position", event.target.value as WorldbookEntry["position"])}><option value="system_before">系统提示前</option><option value="system_after">系统提示后</option><option value="history_before">对话历史前</option><option value="history_after">对话历史后</option></select></label>
        <label>注入角色<select value={entry.role} onChange={(event) => onUpdate("role", event.target.value as WorldbookEntry["role"])}><option value="system">系统</option><option value="user">用户</option><option value="assistant">助手</option></select></label>
        <label>优先级<input type="number" min="-9999" max="9999" value={entry.priority} onChange={(event) => onUpdate("priority", Number(event.target.value))} /></label>
      </div>
      <div className="form-actions"><button className="secondary-button" type="button" onClick={onCancel}>取消</button><button className="primary-button">保存条目</button></div>
    </form>
  </div>;
}
