import { useEffect, useRef, useState, type FormEvent } from "react";
import { saveFile } from "../../adapters/native/files";
import type { Favorite, Persona, Worldbook } from "../../domain/types";

export type FeatureSpace = "favorites" | "life" | "correspondence" | "reading" | "cinema" | "listening" | "roleplay" | "journal" | "board" | "dream";

interface BaseEntry { id: string; persona_key: string; created_at: string; updated_at: string }
interface JournalEntry extends BaseEntry { title: string; content: string; space: "private" | "shared" | "ai"; author: "user" | "ai"; visible_to_user: boolean; visible_to_ai: boolean }
interface BoardEntry extends BaseEntry { content: string; author: "user" | "ai"; visible_to_user: boolean; visible_to_ai: boolean; reply_to?: string }
interface DreamEntry extends BaseEntry { title: string; content: string; owner: "user" | "ai"; isolated: boolean; claimed: boolean }
interface LifeEntry extends BaseEntry { kind: string; occurred_at: string; amount?: number; title: string; category: string; note: string; visible_to_ai: boolean }
interface Contact extends BaseEntry { display_name: string; platform: string; stable_id: string; ai_approved: boolean; user_approved: boolean; blocked: boolean }
interface Mail extends BaseEntry { contact_id: string; direction: "inbound" | "outbound"; subject: string; content: string; status: "delivered" | "draft"; reply_to?: string }
interface RoleplayStory extends BaseEntry { title: string; premise: string; player: string; characters: string; worldbook_ids: string[]; status: "active" | "finished"; turns: Array<{ id: string; role: "user" | "assistant" | "narrator"; content: string; at: string }> }
interface BookState extends BaseEntry { title: string; text: string; progress: number; bookmarks: Array<{ id: string; label: string; progress: number }>; annotations: Array<{ id: string; content: string; progress: number }> }
interface MediaNote extends BaseEntry { medium: "cinema" | "listening"; title: string; at_seconds: number; note: string }

interface SpaceData {
  journals: JournalEntry[];
  board: BoardEntry[];
  dreams: DreamEntry[];
  life: LifeEntry[];
  contacts: Contact[];
  mail: Mail[];
  roleplays: RoleplayStory[];
  books: BookState[];
  mediaNotes: MediaNote[];
}

const storeKey = "atherloom-react:feature-spaces:v1";
const blankData = (): SpaceData => ({ journals: [], board: [], dreams: [], life: [], contacts: [], mail: [], roleplays: [], books: [], mediaNotes: [] });
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

function readData(): SpaceData {
  try {
    const value = JSON.parse(localStorage.getItem(storeKey) || "null") as Partial<SpaceData> | null;
    if (!value) return blankData();
    const empty = blankData();
    return Object.fromEntries(Object.keys(empty).map((key) => [key, Array.isArray(value[key as keyof SpaceData]) ? value[key as keyof SpaceData] : []])) as unknown as SpaceData;
  } catch {
    return blankData();
  }
}

export function exportFeatureSpaceData() {
  return localStorage.getItem(storeKey) || JSON.stringify(blankData());
}

export function restoreFeatureSpaceData(raw: string) {
  const parsed = JSON.parse(raw) as Partial<SpaceData>;
  if (!parsed || typeof parsed !== "object") throw new Error("独立空间数据格式错误");
  localStorage.setItem(storeKey, JSON.stringify(parsed));
  window.dispatchEvent(new CustomEvent("atherloom:feature-spaces-restored"));
}

const labels: Array<[FeatureSpace, string]> = [
  ["favorites", "珍藏"], ["life", "生活簿"], ["correspondence", "往来"], ["reading", "一起读书"], ["cinema", "一起看电影"],
  ["listening", "一起听歌"], ["roleplay", "角色剧场"], ["journal", "日记"], ["board", "留言板"], ["dream", "梦库"],
];

interface FeatureHubProps {
  open: FeatureSpace | null;
  personaId: string | null;
  personas: Persona[];
  worldbooks: Worldbook[];
  favorites: Favorite[];
  onClose: () => void;
  onChangeSpace: (space: FeatureSpace) => void;
  onOpenFavorite: (conversationId: string) => Promise<void>;
  onUnfavorite: (messageId: string) => Promise<void>;
  onSendToAssistant: (content: string) => Promise<string | undefined>;
}

function timestampLabel(value: string) {
  try { return new Date(value).toLocaleString("zh-CN", { hour12: false }); } catch { return value; }
}

export function FeatureHub(props: FeatureHubProps) {
  const { open, personaId, personas, worldbooks, favorites, onClose, onChangeSpace, onOpenFavorite, onUnfavorite, onSendToAssistant } = props;
  const [data, setData] = useState<SpaceData>(readData);
  const personaKey = personaId || "__default__";
  const personaName = personas.find((item) => item.id === personaId)?.name || "默认人格";

  useEffect(() => localStorage.setItem(storeKey, JSON.stringify(data)), [data]);
  useEffect(() => {
    const reload = () => setData(readData());
    window.addEventListener("atherloom:feature-spaces-restored", reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener("atherloom:feature-spaces-restored", reload);
      window.removeEventListener("storage", reload);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose, open]);

  if (!open) return null;

  const update = <Key extends keyof SpaceData>(key: Key, rows: SpaceData[Key]) => setData((current) => ({ ...current, [key]: rows }));
  const shared = { data, personaKey, personaName, update, onSendToAssistant };

  return (
    <div className="feature-hub-layer">
      <section className="feature-hub" role="dialog" aria-modal="true" aria-label={labels.find(([key]) => key === open)?.[1]}>
        <header className="feature-hub-header">
          <div><span>ATHERLOOM SPACES</span><h2>{labels.find(([key]) => key === open)?.[1]}</h2><p>{personaName}的独立空间</p></div>
          <button type="button" aria-label="关闭" onClick={onClose}>×</button>
        </header>
        <nav className="feature-hub-nav" aria-label="功能空间">{labels.map(([key, label]) => <button type="button" className={open === key ? "active" : ""} onClick={() => onChangeSpace(key)} key={key}>{label}</button>)}</nav>
        <main className="feature-hub-content">
          {open === "favorites" ? <FavoritesSpace favorites={favorites} onOpen={onOpenFavorite} onRemove={onUnfavorite} /> : null}
          {open === "life" ? <LifeSpace {...shared} /> : null}
          {open === "correspondence" ? <CorrespondenceSpace {...shared} /> : null}
          {open === "journal" ? <WritingSpace mode="journal" {...shared} /> : null}
          {open === "board" ? <WritingSpace mode="board" {...shared} /> : null}
          {open === "dream" ? <WritingSpace mode="dream" {...shared} /> : null}
          {open === "reading" ? <ReadingSpace {...shared} /> : null}
          {open === "cinema" ? <CinemaSpace {...shared} /> : null}
          {open === "listening" ? <ListeningSpace {...shared} /> : null}
          {open === "roleplay" ? <RoleplaySpace {...shared} worldbooks={worldbooks} /> : null}
        </main>
      </section>
    </div>
  );
}

function FavoritesSpace({ favorites, onOpen, onRemove }: { favorites: Favorite[]; onOpen: (id: string) => Promise<void>; onRemove: (id: string) => Promise<void> }) {
  const [query, setQuery] = useState("");
  const visible = favorites.filter((item) => !query.trim() || `${item.text_snapshot || ""} ${item.conversation_title_snapshot || ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <section className="space-section"><div className="space-heading"><div><h3>保留某句话当时的模样</h3><p>珍藏保存消息快照，也能回到原对话。</p></div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索珍藏" /></div><div className="space-card-list">{visible.map((favorite) => <article key={favorite.id}><header><strong>{favorite.conversation_title_snapshot || "对话片段"}</strong><time>{timestampLabel(favorite.favorited_at || "")}</time></header><p>{favorite.text_snapshot || "原消息内容为空"}</p><footer>{favorite.source_conversation_id ? <button type="button" onClick={() => void onOpen(favorite.source_conversation_id!)}>回到原对话</button> : null}<button type="button" className="danger-action" onClick={() => void onRemove(favorite.source_message_id)}>取消珍藏</button></footer></article>)}</div>{!visible.length ? <p className="space-empty">还没有符合条件的珍藏。</p> : null}</section>;
}

type SharedProps = {
  data: SpaceData;
  personaKey: string;
  personaName: string;
  update: <Key extends keyof SpaceData>(key: Key, rows: SpaceData[Key]) => void;
  onSendToAssistant: (content: string) => Promise<string | undefined>;
};

function LifeSpace({ data, personaKey, update }: SharedProps) {
  const [draft, setDraft] = useState({ kind: "memo", occurred_at: new Date().toISOString().slice(0, 10), amount: "", title: "", category: "", note: "", visible_to_ai: false });
  const rows = data.life.filter((item) => item.persona_key === personaKey).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const stamp = now();
    update("life", [{ id: id("life"), persona_key: personaKey, created_at: stamp, updated_at: stamp, ...draft, amount: draft.amount ? Number(draft.amount) : undefined }, ...data.life]);
    setDraft((current) => ({ ...current, title: "", amount: "", note: "" }));
  };
  const month = new Date().toISOString().slice(0, 7);
  const total = rows.filter((item) => item.occurred_at.startsWith(month)).reduce((sum, item) => sum + (item.kind === "income" ? Number(item.amount || 0) : item.kind === "expense" ? -Number(item.amount || 0) : 0), 0);
  return <section className="space-section"><div className="space-heading"><div><h3>日常记录</h3><p>本月收支净额 {total.toFixed(2)}；每条记录可单独决定是否让当前人格读取。</p></div></div><form className="space-form" onSubmit={submit}><label>类型<select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value })}><option value="expense">支出</option><option value="income">收入</option><option value="period">生理期</option><option value="meal">饮食</option><option value="anniversary">纪念日</option><option value="countdown">倒数日</option><option value="memo">备忘</option></select></label><label>日期<input type="date" required value={draft.occurred_at} onChange={(event) => setDraft({ ...draft, occurred_at: event.target.value })} /></label>{["expense", "income"].includes(draft.kind) ? <label>金额<input type="number" min="0" step="0.01" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} /></label> : null}<label>标题<input required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label><label>分类<input value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} /></label><label className="span-all">备注<textarea rows={3} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label><label className="check-row span-all"><input type="checkbox" checked={draft.visible_to_ai} onChange={(event) => setDraft({ ...draft, visible_to_ai: event.target.checked })} /><span>允许当前人格读取这条记录</span></label><button className="primary-button">保存记录</button></form><div className="space-card-list">{rows.map((item) => <article key={item.id}><header><strong>{item.title}</strong><time>{item.occurred_at}</time></header><p>{item.category}{item.amount !== undefined ? ` · ¥${item.amount.toFixed(2)}` : ""}{item.note ? ` · ${item.note}` : ""}</p><footer><span>{item.visible_to_ai ? "AI 可见" : "仅自己可见"}</span><button className="danger-action" type="button" onClick={() => update("life", data.life.filter((row) => row.id !== item.id))}>删除</button></footer></article>)}</div></section>;
}

function CorrespondenceSpace({ data, personaKey, update }: SharedProps) {
  const [tab, setTab] = useState<"mail" | "contacts">("mail");
  const [contactDraft, setContactDraft] = useState({ display_name: "", platform: "", stable_id: "" });
  const [mailDraft, setMailDraft] = useState({ contact_id: "", direction: "outbound" as "inbound" | "outbound", subject: "", content: "" });
  const contacts = data.contacts.filter((item) => item.persona_key === personaKey);
  const mail = data.mail.filter((item) => item.persona_key === personaKey).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const addContact = (event: FormEvent) => { event.preventDefault(); const stamp = now(); update("contacts", [{ id: id("contact"), persona_key: personaKey, created_at: stamp, updated_at: stamp, ...contactDraft, ai_approved: true, user_approved: false, blocked: false }, ...data.contacts]); setContactDraft({ display_name: "", platform: "", stable_id: "" }); };
  const addMail = (event: FormEvent) => { event.preventDefault(); const contact = contacts.find((item) => item.id === mailDraft.contact_id && item.user_approved && !item.blocked); if (!contact) return; const stamp = now(); update("mail", [{ id: id("mail"), persona_key: personaKey, created_at: stamp, updated_at: stamp, ...mailDraft, status: "delivered" }, ...data.mail]); setMailDraft((current) => ({ ...current, subject: "", content: "" })); };
  return <section className="space-section"><div className="space-tabs"><button className={tab === "mail" ? "active" : ""} onClick={() => setTab("mail")}>信箱</button><button className={tab === "contacts" ? "active" : ""} onClick={() => setTab("contacts")}>联系人</button><span>AI 会客厅已按你的要求暂缓</span></div>{tab === "contacts" ? <><form className="space-form" onSubmit={addContact}><label>显示名称<input required value={contactDraft.display_name} onChange={(event) => setContactDraft({ ...contactDraft, display_name: event.target.value })} /></label><label>平台<input required value={contactDraft.platform} onChange={(event) => setContactDraft({ ...contactDraft, platform: event.target.value })} /></label><label>稳定联系人 ID<input required minLength={3} value={contactDraft.stable_id} onChange={(event) => setContactDraft({ ...contactDraft, stable_id: event.target.value })} /></label><button className="primary-button">提交联系人申请</button></form><div className="space-card-list">{contacts.map((contact) => <article key={contact.id}><header><strong>{contact.display_name}</strong><span>{contact.platform}</span></header><p>{contact.stable_id}</p><footer><button type="button" onClick={() => update("contacts", data.contacts.map((item) => item.id === contact.id ? { ...item, user_approved: !item.user_approved, updated_at: now() } : item))}>{contact.user_approved ? "取消批准" : "批准联系人"}</button><button type="button" onClick={() => update("contacts", data.contacts.map((item) => item.id === contact.id ? { ...item, blocked: !item.blocked, updated_at: now() } : item))}>{contact.blocked ? "解除屏蔽" : "屏蔽"}</button></footer></article>)}</div></> : <><form className="space-form" onSubmit={addMail}><label>收发方向<select value={mailDraft.direction} onChange={(event) => setMailDraft({ ...mailDraft, direction: event.target.value as "inbound" | "outbound" })}><option value="outbound">写信</option><option value="inbound">录入来信</option></select></label><label>联系人<select required value={mailDraft.contact_id} onChange={(event) => setMailDraft({ ...mailDraft, contact_id: event.target.value })}><option value="">选择已批准联系人</option>{contacts.filter((item) => item.user_approved && !item.blocked).map((contact) => <option value={contact.id} key={contact.id}>{contact.display_name}</option>)}</select></label><label className="span-all">主题<input required value={mailDraft.subject} onChange={(event) => setMailDraft({ ...mailDraft, subject: event.target.value })} /></label><label className="span-all">正文<textarea required rows={7} value={mailDraft.content} onChange={(event) => setMailDraft({ ...mailDraft, content: event.target.value })} /></label><button className="primary-button">保存并投递</button></form><div className="space-card-list">{mail.map((item) => <article key={item.id}><header><strong>{item.direction === "inbound" ? "收" : "发"} · {item.subject}</strong><time>{timestampLabel(item.created_at)}</time></header><p>{item.content}</p><footer><span>{contacts.find((contact) => contact.id === item.contact_id)?.display_name || "未知联系人"}</span><button type="button" onClick={() => setMailDraft({ contact_id: item.contact_id, direction: "outbound", subject: `回复：${item.subject.replace(/^回复：/, "")}`, content: "" })}>回复</button><button className="danger-action" type="button" onClick={() => update("mail", data.mail.filter((row) => row.id !== item.id))}>删除</button></footer></article>)}</div></>}</section>;
}

function WritingSpace({ mode, data, personaKey, update }: SharedProps & { mode: "journal" | "board" | "dream" }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [visibility, setVisibility] = useState("shared");
  const [editing, setEditing] = useState<string | null>(null);
  const rows = mode === "journal" ? data.journals.filter((item) => item.persona_key === personaKey)
    : mode === "board" ? data.board.filter((item) => item.persona_key === personaKey)
      : data.dreams.filter((item) => item.persona_key === personaKey);
  const save = (event: FormEvent) => {
    event.preventDefault();
    const stamp = now();
    if (mode === "journal") {
      const entry: JournalEntry = { id: editing || id("journal"), persona_key: personaKey, created_at: editing ? data.journals.find((item) => item.id === editing)?.created_at || stamp : stamp, updated_at: stamp, title: title || "无题日记", content, space: visibility as JournalEntry["space"], author: "user", visible_to_user: true, visible_to_ai: visibility !== "private" };
      update("journals", [entry, ...data.journals.filter((item) => item.id !== editing)]);
    } else if (mode === "board") {
      const entry: BoardEntry = { id: editing || id("board"), persona_key: personaKey, created_at: editing ? data.board.find((item) => item.id === editing)?.created_at || stamp : stamp, updated_at: stamp, content, author: "user", visible_to_user: true, visible_to_ai: visibility !== "private" };
      update("board", [entry, ...data.board.filter((item) => item.id !== editing)]);
    } else {
      const entry: DreamEntry = { id: editing || id("dream"), persona_key: personaKey, created_at: editing ? data.dreams.find((item) => item.id === editing)?.created_at || stamp : stamp, updated_at: stamp, title: title || "无题梦境", content, owner: "user", isolated: visibility === "private", claimed: visibility === "claimed" };
      update("dreams", [entry, ...data.dreams.filter((item) => item.id !== editing)]);
    }
    setTitle(""); setContent(""); setEditing(null);
  };
  const remove = (entryId: string) => {
    if (mode === "journal") update("journals", data.journals.filter((item) => item.id !== entryId));
    else if (mode === "board") update("board", data.board.filter((item) => item.id !== entryId));
    else update("dreams", data.dreams.filter((item) => item.id !== entryId));
  };
  const edit = (entry: JournalEntry | BoardEntry | DreamEntry) => {
    setEditing(entry.id);
    setTitle("title" in entry ? entry.title : "");
    setContent(entry.content);
    if (mode === "journal") setVisibility((entry as JournalEntry).space);
    else if (mode === "board") setVisibility((entry as BoardEntry).visible_to_ai ? "shared" : "private");
    else setVisibility((entry as DreamEntry).isolated ? "private" : (entry as DreamEntry).claimed ? "claimed" : "shared");
  };
  return <section className="space-section"><div className="space-heading"><div><h3>{mode === "journal" ? "私人、共享与 AI 日记" : mode === "board" ? "写给当前人格的便利贴" : "记录、隔离与认领梦境"}</h3><p>可见范围会随每一条内容单独保存。</p></div></div><form className="space-form" onSubmit={save}>{mode !== "board" ? <label className="span-all">标题<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label> : null}<label className="span-all">内容<textarea required rows={7} value={content} onChange={(event) => setContent(event.target.value)} /></label><label>可见范围<select value={visibility} onChange={(event) => setVisibility(event.target.value)}><option value="private">只对自己可见</option><option value="shared">与当前人格共享</option>{mode === "journal" ? <option value="ai">AI 日记区</option> : null}{mode === "dream" ? <option value="claimed">已认领梦境</option> : null}</select></label><div className="form-actions">{editing ? <button type="button" className="secondary-button" onClick={() => { setEditing(null); setTitle(""); setContent(""); }}>取消修改</button> : null}<button className="primary-button">{editing ? "保存修改" : "保存"}</button></div></form><div className="space-card-list">{rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map((entry) => <article key={entry.id}><header><strong>{"title" in entry ? entry.title : entry.author === "ai" ? "AI 留言" : "我的留言"}</strong><time>{timestampLabel(entry.updated_at)}</time></header><p>{entry.content}</p><footer><span>{mode === "dream" ? (entry as DreamEntry).isolated ? "隔离" : (entry as DreamEntry).claimed ? "已认领" : "共享" : "visible_to_ai" in entry && entry.visible_to_ai ? "AI 可见" : "仅自己"}</span><button type="button" onClick={() => edit(entry)}>修改</button><button type="button" className="danger-action" onClick={() => remove(entry.id)}>删除</button></footer></article>)}</div></section>;
}

async function readBookFile(file: File) {
  const pdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!pdf) {
    if (file.size > 3 * 1024 * 1024) throw new Error("TXT / Markdown 单本暂限 3 MB");
    const bytes = await file.arrayBuffer();
    const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const broken = (utf8.match(/�/g) || []).length;
    if (!broken || broken / Math.max(1, utf8.length) < 0.002) return utf8;
    try {
      return new TextDecoder("gb18030", { fatal: false }).decode(bytes);
    } catch {
      return utf8;
    }
  }
  if (file.size > 12 * 1024 * 1024) throw new Error("PDF 超过 12 MB，请先压缩或拆分后再打开");
  type PdfPage = { getTextContent(): Promise<{ items: Array<{ str?: string }> }> };
  type PdfDocument = { numPages: number; getPage(page: number): Promise<PdfPage> };
  type PdfTask = { promise: Promise<PdfDocument>; destroy(): Promise<void> };
  type PdfJs = { GlobalWorkerOptions: { workerSrc: string }; getDocument(input: { data: Uint8Array }): PdfTask };
  const moduleUrl = new URL("./vendor/pdfjs/pdf.mjs", document.baseURI).href;
  const workerUrl = new URL("./vendor/pdfjs/pdf.worker.mjs", document.baseURI).href;
  const pdfjs = await import(/* @vite-ignore */ moduleUrl) as PdfJs;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const documentProxy = await task.promise;
  if (documentProxy.numPages > 400) {
    await task.destroy();
    throw new Error("PDF 超过 400 页，请拆分后再打开");
  }
  const parts: string[] = [];
  let length = 0;
  for (let pageNumber = 1; pageNumber <= documentProxy.numPages; pageNumber += 1) {
    const page = await documentProxy.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str || "").join(" ").trim();
    parts.push(`第 ${pageNumber} 页\n${text}`);
    length += text.length;
    if (length > 500_000) break;
  }
  await task.destroy();
  const text = parts.join("\n\n").slice(0, 500_000);
  if (!text.trim()) throw new Error("PDF 没有可提取文字，可能是扫描图片版");
  return text;
}

function ReadingSpace({ data, personaKey, update, onSendToAssistant }: SharedProps) {
  const [activeId, setActiveId] = useState(data.books.find((item) => item.persona_key === personaKey)?.id || "");
  const [annotation, setAnnotation] = useState("");
  const readerRef = useRef<HTMLDivElement>(null);
  const books = data.books.filter((item) => item.persona_key === personaKey);
  const active = books.find((item) => item.id === activeId) || null;
  const importBook = async (file: File) => {
    const text = await readBookFile(file);
    const stamp = now();
    const book: BookState = { id: id("book"), persona_key: personaKey, created_at: stamp, updated_at: stamp, title: file.name.replace(/\.[^.]+$/, ""), text: text.slice(0, 500_000), progress: 0, bookmarks: [], annotations: [] };
    update("books", [book, ...data.books]);
    setActiveId(book.id);
  };
  const patchBook = (patch: Partial<BookState>) => {
    if (!active) return;
    update("books", data.books.map((item) => item.id === active.id ? { ...item, ...patch, updated_at: now() } : item));
  };
  const progress = () => {
    const node = readerRef.current;
    return node ? Math.round(node.scrollTop / Math.max(1, node.scrollHeight - node.clientHeight) * 100) : active?.progress || 0;
  };
  return <section className="space-section media-workspace"><aside className="media-library"><label className="primary-button file-button">导入 PDF / TXT / Markdown<input type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importBook(file).catch((error) => window.alert(error instanceof Error ? error.message : "书籍读取失败")); event.target.value = ""; }} /></label>{books.map((book) => <button type="button" className={book.id === active?.id ? "active" : ""} onClick={() => setActiveId(book.id)} key={book.id}><strong>{book.title}</strong><small>进度 {book.progress || 0}%</small></button>)}</aside><div className="media-main">{active ? <><header><div><h3>{active.title}</h3><p>正文留在本机；只把你主动询问时附近的片段发给模型。</p></div><div><button type="button" onClick={() => patchBook({ bookmarks: [...active.bookmarks, { id: id("bookmark"), label: `${progress()}% 处`, progress: progress() }] })}>加书签</button><button type="button" onClick={() => void onSendToAssistant(`【共读】《${active.title}》\n我当前读到约 ${progress()}%。请只依据下面这段本地正文回应，不要编造后文：\n${active.text.slice(Math.max(0, Math.floor(active.text.length * progress() / 100) - 3000), Math.floor(active.text.length * progress() / 100) + 3000)}`)}>一起读这一段</button></div></header><div className="book-reader-react" ref={readerRef} onScroll={() => patchBook({ progress: progress() })}><pre>{active.text}</pre></div><form className="media-note-form" onSubmit={(event) => { event.preventDefault(); if (!annotation.trim()) return; patchBook({ annotations: [...active.annotations, { id: id("annotation"), content: annotation.trim(), progress: progress() }] }); setAnnotation(""); }}><input value={annotation} onChange={(event) => setAnnotation(event.target.value)} placeholder="在当前进度添加批注" /><button>保存批注</button></form><div className="media-notes">{active.bookmarks.map((item) => <button type="button" key={item.id} onClick={() => { const node = readerRef.current; if (node) node.scrollTop = (node.scrollHeight - node.clientHeight) * item.progress / 100; }}>书签 · {item.label}</button>)}{active.annotations.map((item) => <button type="button" key={item.id} onClick={() => { const node = readerRef.current; if (node) node.scrollTop = (node.scrollHeight - node.clientHeight) * item.progress / 100; }}>{item.progress}% · {item.content}</button>)}</div></> : <p className="space-empty">选择一本本地书开始共读。</p>}</div></section>;
}

function parseSrt(value: string) {
  return value.replace(/\r/g, "").split(/\n\n+/).map((block) => {
    const lines = block.split("\n"); const timing = lines.find((line) => line.includes("-->")); if (!timing) return null;
    const seconds = (part: string) => { const values = part.trim().replace(",", ".").split(":").map(Number); return values[0] * 3600 + values[1] * 60 + values[2]; };
    const [start, end] = timing.split("-->").map(seconds);
    return { start, end, text: lines.slice(lines.indexOf(timing) + 1).join(" ") };
  }).filter((item): item is { start: number; end: number; text: string } => Boolean(item));
}

function CinemaSpace({ data, personaKey, update, onSendToAssistant }: SharedProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [source, setSource] = useState("");
  const [title, setTitle] = useState("本地影片");
  const [subtitles, setSubtitles] = useState<Array<{ start: number; end: number; text: string }>>([]);
  const [note, setNote] = useState("");
  const [current, setCurrent] = useState(0);
  const nearby = subtitles.filter((item) => item.start <= current).slice(-12);
  const notes = data.mediaNotes.filter((item) => item.persona_key === personaKey && item.medium === "cinema");
  return <section className="space-section media-room"><div className="media-controls"><label className="file-button">选择本地影片<input type="file" accept="video/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) { setSource(URL.createObjectURL(file)); setTitle(file.name); setCurrent(0); } }} /></label><label className="file-button">载入 SRT 字幕<input type="file" accept=".srt,text/plain" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then((text) => setSubtitles(parseSrt(text))); }} /></label><input placeholder="或粘贴可播放视频链接" onKeyDown={(event) => { if (event.key === "Enter") { setSource(event.currentTarget.value); setTitle(event.currentTarget.value); setCurrent(0); } }} /></div>{source ? <video ref={videoRef} controls src={source} onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)} /> : <p className="space-empty">影片只在这台设备播放，不上传视频文件。</p>}<div className="subtitle-evidence" aria-live="polite">{nearby.slice(-3).map((item) => <p key={item.start}>{item.text}</p>)}</div><form className="media-note-form" onSubmit={(event) => { event.preventDefault(); if (!note.trim()) return; const stamp = now(); update("mediaNotes", [{ id: id("media-note"), persona_key: personaKey, created_at: stamp, updated_at: stamp, medium: "cinema", title, at_seconds: current, note }, ...data.mediaNotes]); setNote(""); }}><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录这一幕" /><button>保存</button><button type="button" onClick={() => void onSendToAssistant(`【一起看电影】${title}\n当前播放点：${Math.round(current)} 秒\n此前字幕证据：\n${nearby.map((item) => item.text).join("\n") || "没有字幕证据"}\n请只依据这些信息回应此刻感受，不要剧透或编造画面。`)}>问这一幕</button></form><div className="media-notes">{notes.map((item) => <button type="button" key={item.id} onClick={() => { if (videoRef.current) videoRef.current.currentTime = item.at_seconds; setCurrent(item.at_seconds); }}>{Math.round(item.at_seconds)} 秒 · {item.note}</button>)}</div></section>;
}

function parseLrc(value: string) {
  return value.split(/\r?\n/).flatMap((line) => { const match = line.match(/\[(\d+):(\d+(?:\.\d+)?)\](.*)/); return match ? [{ time: Number(match[1]) * 60 + Number(match[2]), text: match[3].trim() }] : []; });
}

function ListeningSpace({ data, personaKey, update, onSendToAssistant }: SharedProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [source, setSource] = useState("");
  const [title, setTitle] = useState("本地音频");
  const [lyrics, setLyrics] = useState<Array<{ time: number; text: string }>>([]);
  const [note, setNote] = useState("");
  const [current, setCurrent] = useState(0);
  const evidence = lyrics.filter((item) => item.time <= current).slice(-10);
  const notes = data.mediaNotes.filter((item) => item.persona_key === personaKey && item.medium === "listening");
  return <section className="space-section media-room"><div className="media-controls"><label className="file-button">选择本地音频<input type="file" accept="audio/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) { setSource(URL.createObjectURL(file)); setTitle(file.name); setCurrent(0); } }} /></label><label className="file-button">载入 LRC 歌词<input type="file" accept=".lrc,text/plain" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then((text) => setLyrics(parseLrc(text))); }} /></label></div>{source ? <><h3>{title}</h3><audio ref={audioRef} controls src={source} onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)} /></> : <p className="space-empty">音频只在本机播放，不上传歌曲文件。</p>}<div className="subtitle-evidence" aria-live="polite">{evidence.slice(-3).map((item) => <p key={item.time}>{item.text}</p>)}</div><form className="media-note-form" onSubmit={(event) => { event.preventDefault(); if (!note.trim()) return; const stamp = now(); update("mediaNotes", [{ id: id("media-note"), persona_key: personaKey, created_at: stamp, updated_at: stamp, medium: "listening", title, at_seconds: current, note }, ...data.mediaNotes]); setNote(""); }}><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="记下此刻感受" /><button>保存</button><button type="button" onClick={() => void onSendToAssistant(`【一起听歌】${title}\n当前播放点：${Math.round(current)} 秒\n已出现的歌词：\n${evidence.map((item) => item.text).join("\n") || "没有歌词证据"}\n请只依据这些本地证据陪我聊此刻感受，不要编造歌词或背景。`)}>和他聊这首歌</button></form><div className="media-notes">{notes.map((item) => <button type="button" key={item.id} onClick={() => { if (audioRef.current) audioRef.current.currentTime = item.at_seconds; setCurrent(item.at_seconds); }}>{Math.round(item.at_seconds)} 秒 · {item.note}</button>)}</div></section>;
}

function RoleplaySpace({ data, personaKey, update, onSendToAssistant, worldbooks }: SharedProps & { worldbooks: Worldbook[] }) {
  const [activeId, setActiveId] = useState("");
  const [draft, setDraft] = useState({ title: "", premise: "", player: "", characters: "", worldbook_ids: [] as string[] });
  const [turn, setTurn] = useState("");
  const stories = data.roleplays.filter((item) => item.persona_key === personaKey);
  const active = stories.find((item) => item.id === activeId) || null;
  const create = (event: FormEvent) => { event.preventDefault(); const stamp = now(); const story: RoleplayStory = { id: id("story"), persona_key: personaKey, created_at: stamp, updated_at: stamp, ...draft, status: "active", turns: [] }; update("roleplays", [story, ...data.roleplays]); setActiveId(story.id); };
  const patchStory = (patch: Partial<RoleplayStory>) => active && update("roleplays", data.roleplays.map((item) => item.id === active.id ? { ...item, ...patch, updated_at: now() } : item));
  const exportStory = async () => {
    if (!active) return;
    const safeTitle = active.title.replace(/[\\/:*?"<>|]/g, "-").trim() || "Atherloom-剧本";
    const text = [`《${active.title}》`, "", `前提：${active.premise}`, `玩家：${active.player}`, `角色：${active.characters}`, "", ...active.turns.flatMap((item) => [`${item.role === "user" ? active.player || "玩家" : item.role === "narrator" ? "旁白" : "角色"}：`, item.content, ""])].join("\n");
    await saveFile(`${safeTitle}.txt`, new Blob([text], { type: "text/plain;charset=utf-8" }));
  };
  const deleteStory = () => {
    if (!active || !window.confirm(`确定删除故事《${active.title}》及全部正文吗？`)) return;
    update("roleplays", data.roleplays.filter((item) => item.id !== active.id));
    setActiveId("");
  };
  const sendTurn = async (event: FormEvent) => {
    event.preventDefault(); if (!active || !turn.trim()) return;
    const nextTurns = [...active.turns, { id: id("turn"), role: "user" as const, content: turn.trim(), at: now() }];
    patchStory({ turns: nextTurns }); setTurn("");
    const books = worldbooks.filter((book) => active.worldbook_ids.includes(book.id)).flatMap((book) => book.entries.filter((entry) => entry.enabled !== false).map((entry) => entry.content)).join("\n");
    const response = await onSendToAssistant(`【角色剧场：${active.title}】\n前提：${active.premise}\n玩家：${active.player}\n角色：${active.characters}\n世界书：${books || "无"}\n已有剧本：\n${nextTurns.map((item) => `${item.role}：${item.content}`).join("\n")}\n请让每个角色保持独立身份回应，并由旁白推动这一幕；不要替玩家决定行动。`);
    if (response?.trim()) {
      update("roleplays", data.roleplays.map((item) => item.id === active.id ? { ...item, turns: [...nextTurns, { id: id("turn"), role: "assistant", content: response.trim(), at: now() }], updated_at: now() } : item));
    }
  };
  return <section className="space-section roleplay-layout"><aside className="media-library"><button type="button" className={!active ? "active" : ""} onClick={() => setActiveId("")}>新故事</button>{stories.map((story) => <button type="button" className={story.id === active?.id ? "active" : ""} onClick={() => setActiveId(story.id)} key={story.id}><strong>{story.title}</strong><small>{story.status === "active" ? "进行中" : "已收场"} · {story.turns.length} 段</small></button>)}</aside><div className="media-main">{active ? <><header><div><h3>{active.title}</h3><p>{active.premise}</p></div><div><button type="button" onClick={() => void exportStory()}>导出 TXT</button><button type="button" onClick={() => patchStory({ turns: [] })}>清屏重开</button><button type="button" onClick={() => patchStory({ status: active.status === "active" ? "finished" : "active" })}>{active.status === "active" ? "收场" : "重新开启"}</button><button type="button" className="danger-button" onClick={deleteStory}>删除故事</button></div></header><div className="roleplay-manuscript">{active.turns.map((item) => <article key={item.id}><strong>{item.role === "user" ? active.player || "玩家" : item.role === "narrator" ? "旁白" : "角色"}</strong><p>{item.content}</p><button type="button" onClick={() => patchStory({ turns: active.turns.filter((row) => row.id !== item.id) })}>删除这一段</button></article>)}</div><form className="media-note-form" onSubmit={(event) => void sendTurn(event)}><textarea rows={3} value={turn} onChange={(event) => setTurn(event.target.value)} placeholder="写下玩家这一回合…" /><button>送入当前聊天继续演出</button></form></> : <form className="space-form" onSubmit={create}><label>故事标题<input required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label><label>玩家称呼<input required value={draft.player} onChange={(event) => setDraft({ ...draft, player: event.target.value })} /></label><label className="span-all">故事前提<textarea required rows={4} value={draft.premise} onChange={(event) => setDraft({ ...draft, premise: event.target.value })} /></label><label className="span-all">角色与各自设定<textarea required rows={5} value={draft.characters} onChange={(event) => setDraft({ ...draft, characters: event.target.value })} /></label><fieldset className="span-all"><legend>绑定世界书</legend>{worldbooks.filter((item) => item.enabled !== false).map((book) => <label className="check-row" key={book.id}><input type="checkbox" checked={draft.worldbook_ids.includes(book.id)} onChange={(event) => setDraft({ ...draft, worldbook_ids: event.target.checked ? [...draft.worldbook_ids, book.id] : draft.worldbook_ids.filter((id) => id !== book.id) })} /><span>{book.name}</span></label>)}</fieldset><button className="primary-button">创建故事</button></form>}</div></section>;
}
