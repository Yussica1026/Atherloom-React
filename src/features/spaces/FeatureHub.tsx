import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { saveFile } from "../../adapters/native/files";
import { getApiBase, requestJson } from "../../adapters/fastapi/client";
import type { Favorite, Persona, Provider, Worldbook } from "../../domain/types";
import type { SettingsTab } from "../settings/SettingsPanel";

export type FeatureSpace = "favorites" | "life" | "correspondence" | "reading" | "cinema" | "listening" | "roleplay" | "journal" | "board" | "dream";

interface BaseEntry { id: string; persona_key: string; created_at: string; updated_at: string }
interface JournalEntry extends BaseEntry { title: string; content: string; space: "private" | "shared" | "ai"; author: "user" | "ai"; visible_to_user: boolean; visible_to_ai: boolean }
type JournalTrigger = "manual" | "scheduled" | "catch_up";
interface JournalSchedule extends BaseEntry { enabled: boolean; interval_hours: number; daily_limit: number; visible_to_user: boolean; next_run_at: string; last_run_at?: string; day_key?: string; day_count?: number; guidance: string }
interface JournalAudit extends BaseEntry { trigger: JournalTrigger; status: "started" | "success" | "failed" | "skipped"; detail: string; journal_id?: string }
interface BoardEntry extends BaseEntry { content: string; author: "user" | "ai"; visible_to_user: boolean; visible_to_ai: boolean; reply_to?: string }
interface DreamEntry extends BaseEntry { title: string; content: string; owner: "user" | "ai"; isolated: boolean; claimed: boolean }
interface LifeEntry extends BaseEntry { kind: string; occurred_at: string; amount?: number; title: string; category: string; note: string; visible_to_ai: boolean }
interface Contact extends BaseEntry { display_name: string; platform: string; stable_id: string; ai_approved: boolean; user_approved: boolean; blocked: boolean; whitelisted?: boolean }
interface Mail extends BaseEntry { contact_id: string; direction: "inbound" | "outbound"; subject: string; content: string; status: string; safety_reason?: string; delivered_at?: string | null; reply_to?: string }
interface ParlorConfig extends BaseEntry { host_persona_key: string; summary_provider_id: string; visibility: "full" | "summary"; allow_web: boolean; allow_memory: boolean }
interface RoleplayStory extends BaseEntry { title: string; premise: string; player: string; characters: string; worldbook_ids: string[]; status: "active" | "finished"; turns: Array<{ id: string; role: "user" | "assistant" | "narrator"; content: string; at: string }> }
interface BookState extends BaseEntry { title: string; text: string; progress: number; bookmarks: Array<{ id: string; label: string; progress: number }>; annotations: Array<{ id: string; content: string; progress: number }> }
interface MediaNote extends BaseEntry { medium: "cinema" | "listening"; title: string; at_seconds: number; note: string }

interface CorrespondenceOverview {
  contacts: Contact[];
  mail: Array<Omit<Mail, "updated_at"> & { updated_at?: string }>;
  parlors: Array<{ id: string; status: string; started_at: string; ended_at?: string | null; end_reason?: string; summary?: string }>;
}

interface SpaceData {
  journals: JournalEntry[];
  journalSchedules: JournalSchedule[];
  journalAudit: JournalAudit[];
  board: BoardEntry[];
  dreams: DreamEntry[];
  life: LifeEntry[];
  contacts: Contact[];
  mail: Mail[];
  parlorConfigs: ParlorConfig[];
  roleplays: RoleplayStory[];
  books: BookState[];
  mediaNotes: MediaNote[];
}

const storeKey = "atherloom-react:feature-spaces:v1";
const blankData = (): SpaceData => ({ journals: [], journalSchedules: [], journalAudit: [], board: [], dreams: [], life: [], contacts: [], mail: [], parlorConfigs: [], roleplays: [], books: [], mediaNotes: [] });
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const localDayKey = (value = new Date()) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
const afterHours = (hours: number) => new Date(Date.now() + Math.max(1, hours) * 60 * 60 * 1000).toISOString();

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

const writingSettingsTabs: Array<[SettingsTab, string]> = [
  ["providers", "API 与网关"],
  ["personas", "人格指令"],
  ["worldbooks", "世界书"],
  ["summary", "自动总结"],
  ["memory", "记忆库"],
];

interface FeatureHubProps {
  open: FeatureSpace | null;
  personaId: string | null;
  personas: Persona[];
  providers: Provider[];
  worldbooks: Worldbook[];
  favorites: Favorite[];
  onClose: () => void;
  onChangeSpace: (space: FeatureSpace) => void;
  onOpenSettingsTab: (tab: SettingsTab) => void;
  onOpenFavorite: (conversationId: string) => Promise<void>;
  onUnfavorite: (messageId: string) => Promise<void>;
  onSendToAssistant: (content: string) => Promise<string | undefined>;
  onGeneratePrivateJournal: (personaKey: string, trigger: JournalTrigger, guidance: string) => Promise<{ title: string; content: string }>;
  onGeneratePrivateDream: (personaKey: string, guidance: string) => Promise<{ title: string; content: string }>;
}

function timestampLabel(value: string) {
  try { return new Date(value).toLocaleString("zh-CN", { hour12: false }); } catch { return value; }
}

function correspondenceStatusLabel(status: string) {
  return ({ delivered: "已送达", blocked: "安全检查阻止", draft: "草稿", active: "进行中", ended: "已结束", closed: "已关闭" } as Record<string, string>)[status] || status;
}

export function FeatureHub(props: FeatureHubProps) {
  const { open, personaId, personas, providers, worldbooks, favorites, onClose, onChangeSpace, onOpenSettingsTab, onOpenFavorite, onUnfavorite, onSendToAssistant, onGeneratePrivateJournal, onGeneratePrivateDream } = props;
  const [data, setData] = useState<SpaceData>(readData);
  const personaKey = personaId || "__default__";
  const personaName = personas.find((item) => item.id === personaId)?.name || "默认人格";
  const dataRef = useRef(data);
  const generatorRef = useRef(onGeneratePrivateJournal);
  const journalRunningRef = useRef(new Set<string>());
  const contentRef = useRef<HTMLElement>(null);
  const workspaceNavRef = useRef<HTMLElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const hubRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const modalOpen = Boolean(open);

  useEffect(() => {
    dataRef.current = data;
    localStorage.setItem(storeKey, JSON.stringify(data));
  }, [data]);
  useEffect(() => { generatorRef.current = onGeneratePrivateJournal; }, [onGeneratePrivateJournal]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
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
    if (!modalOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const layer = layerRef.current;
    const siblings = layer?.parentElement ? Array.from(layer.parentElement.children).filter((item) => item !== layer) as HTMLElement[] : [];
    const inertState = siblings.map((item) => [item, item.hasAttribute("inert")] as const);
    siblings.forEach((item) => item.setAttribute("inert", ""));
    const frame = window.requestAnimationFrame(() => (hubRef.current?.querySelector<HTMLElement>('[aria-current="page"]') || hubRef.current?.querySelector<HTMLElement>("button"))?.focus());
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(hubRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') || []).filter((item) => !item.hasAttribute("hidden") && item.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKey);
      inertState.forEach(([item, wasInert]) => wasInert ? item.setAttribute("inert", "") : item.removeAttribute("inert"));
      const fallback = previousFocus?.closest(".sidebar") && window.matchMedia("(max-width: 760px)").matches ? document.querySelector<HTMLElement>(".mobile-menu") : previousFocus;
      fallback?.focus();
    };
  }, [modalOpen]);
  useEffect(() => {
    if (open) contentRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [open]);
  useEffect(() => {
    if (!(open === "journal" || open === "board" || open === "dream")) return;
    const frame = window.requestAnimationFrame(() => workspaceNavRef.current?.querySelector<HTMLElement>("button.active")?.scrollIntoView({ block: "nearest", inline: "center" }));
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const generateAiJournal = useCallback(async (targetPersonaKey: string, trigger: JournalTrigger, visibleToUser: boolean, guidance: string) => {
    if (journalRunningRef.current.has(targetPersonaKey)) throw new Error("这个人格正在写日记，请稍候");
    journalRunningRef.current.add(targetPersonaKey);
    const auditId = id("journal-audit");
    const startedAt = now();
    const started: JournalAudit = {
      id: auditId,
      persona_key: targetPersonaKey,
      created_at: startedAt,
      updated_at: startedAt,
      trigger,
      status: "started",
      detail: trigger === "manual" ? "手动写作已开始" : trigger === "catch_up" ? "错过时段，开始补写" : "到达计划时间，开始写作",
    };
    setData((current) => ({ ...current, journalAudit: [started, ...current.journalAudit].slice(0, 300) }));
    try {
      const earlierPages = dataRef.current.journals
        .filter((entry) => entry.persona_key === targetPersonaKey && entry.visible_to_ai)
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
        .slice(0, 6)
        .map((entry) => `${entry.title}\n${entry.content}`)
        .join("\n\n")
        .slice(0, 4000);
      const writingContext = [
        guidance.trim() ? `本次线索：${guidance.trim()}` : "",
        earlierPages ? `你可继续回望的最近日记：\n${earlierPages}` : "",
      ].filter(Boolean).join("\n\n");
      const draft = await generatorRef.current(targetPersonaKey, trigger, writingContext);
      if (!draft.content.trim()) throw new Error("模型没有返回日记正文");
      const finishedAt = now();
      const journal: JournalEntry = {
        id: id("ai-journal"),
        persona_key: targetPersonaKey,
        created_at: finishedAt,
        updated_at: finishedAt,
        title: draft.title.trim().slice(0, 120) || "一页未题名的日记",
        content: draft.content.trim().slice(0, 30000),
        space: "ai",
        author: "ai",
        visible_to_user: visibleToUser,
        visible_to_ai: true,
      };
      setData((current) => {
        const day = localDayKey();
        return {
          ...current,
          journals: [journal, ...current.journals],
          journalSchedules: current.journalSchedules.map((schedule) => schedule.persona_key === targetPersonaKey && trigger !== "manual" ? {
            ...schedule,
            last_run_at: finishedAt,
            next_run_at: afterHours(schedule.interval_hours),
            day_key: day,
            day_count: schedule.day_key === day ? Number(schedule.day_count || 0) + 1 : 1,
            updated_at: finishedAt,
          } : schedule),
          journalAudit: current.journalAudit.map((entry) => entry.id === auditId ? {
            ...entry,
            status: "success",
            detail: visibleToUser ? `写作完成 · ${journal.title} · 对你可见` : "写作完成 · 内容已密封",
            journal_id: journal.id,
            updated_at: finishedAt,
          } : entry),
        };
      });
      return journal;
    } catch (error) {
      const failedAt = now();
      const detail = error instanceof Error ? error.message : "日记生成失败";
      setData((current) => ({
        ...current,
        journalSchedules: current.journalSchedules.map((schedule) => schedule.persona_key === targetPersonaKey && trigger !== "manual" ? {
          ...schedule,
          next_run_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          updated_at: failedAt,
        } : schedule),
        journalAudit: current.journalAudit.map((entry) => entry.id === auditId ? { ...entry, status: "failed", detail, updated_at: failedAt } : entry),
      }));
      throw error;
    } finally {
      journalRunningRef.current.delete(targetPersonaKey);
    }
  }, []);

  useEffect(() => {
    const inspectSchedules = () => {
      const snapshot = dataRef.current;
      const currentTime = Date.now();
      const day = localDayKey();
      for (const schedule of snapshot.journalSchedules) {
        if (!schedule.enabled || journalRunningRef.current.has(schedule.persona_key)) continue;
        const dueAt = new Date(schedule.next_run_at).getTime();
        if (!Number.isFinite(dueAt) || dueAt > currentTime) continue;
        const usedToday = schedule.day_key === day ? Number(schedule.day_count || 0) : 0;
        if (usedToday >= Math.max(1, schedule.daily_limit)) {
          const skippedAt = now();
          const skipped: JournalAudit = { id: id("journal-audit"), persona_key: schedule.persona_key, created_at: skippedAt, updated_at: skippedAt, trigger: "scheduled", status: "skipped", detail: `今日已达到 ${schedule.daily_limit} 篇上限` };
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          tomorrow.setHours(0, 1, 0, 0);
          setData((current) => ({
            ...current,
            journalSchedules: current.journalSchedules.map((entry) => entry.id === schedule.id ? { ...entry, next_run_at: tomorrow.toISOString(), updated_at: skippedAt } : entry),
            journalAudit: [skipped, ...current.journalAudit].slice(0, 300),
          }));
          continue;
        }
        const overdue = currentTime - dueAt;
        const trigger: JournalTrigger = overdue > Math.max(1, schedule.interval_hours) * 60 * 60 * 1000 ? "catch_up" : "scheduled";
        void generateAiJournal(schedule.persona_key, trigger, schedule.visible_to_user, schedule.guidance).catch(() => undefined);
      }
    };
    inspectSchedules();
    const timer = window.setInterval(inspectSchedules, 60_000);
    return () => window.clearInterval(timer);
  }, [generateAiJournal]);

  if (!open) return null;

  const update = <Key extends keyof SpaceData>(key: Key, rows: SpaceData[Key]) => setData((current) => ({ ...current, [key]: rows }));
  const shared = {
    data,
    personaKey,
    personaName,
    personas,
    providers,
    update,
    aiContextAvailable: Boolean(window.AtherloomNative && !getApiBase()),
    prependDream: (entry: DreamEntry) => setData((current) => ({ ...current, dreams: [entry, ...current.dreams] })),
    onSendToAssistant,
    onGenerateJournal: generateAiJournal,
    onGenerateDream: onGeneratePrivateDream,
  };
  const writingOpen = open === "journal" || open === "board" || open === "dream";
  const correspondenceOpen = open === "correspondence";
  const workspaceLabel = labels.find(([key]) => key === open)?.[1] || "功能空间";
  const changeSpaceAtTop = (space: FeatureSpace) => {
    contentRef.current?.scrollTo({ top: 0, behavior: "auto" });
    onChangeSpace(space);
  };

  return (
    <div ref={layerRef} className="feature-hub-layer">
      <section ref={hubRef} className={`feature-hub${writingOpen ? " writing-workspace" : ""}${correspondenceOpen ? " correspondence-workspace" : ""}`} role="dialog" aria-modal="true" aria-label={workspaceLabel}>
        <header className="feature-hub-header">
          <div>
            <span>{writingOpen ? "LOCAL WORKSPACE" : correspondenceOpen ? "AI CORRESPONDENCE" : "ATHERLOOM SPACES"}</span>
            <h2>{writingOpen ? "设置" : workspaceLabel}</h2>
            {!writingOpen ? <p>{correspondenceOpen ? `${personaName}自己的信箱与会客厅。` : `${personaName}的独立空间`}</p> : null}
          </div>
          <button type="button" aria-label="关闭" onClick={onClose}>×</button>
        </header>
        {writingOpen ? <nav ref={workspaceNavRef} className="feature-hub-nav settings-workspace-nav" aria-label="设置分类">
          {writingSettingsTabs.map(([tab, label]) => <button type="button" onClick={() => onOpenSettingsTab(tab)} key={tab}>{label}</button>)}
          <button type="button" className="active" aria-current="page">日记与留言</button>
          <button type="button" onClick={() => onOpenSettingsTab("mcp")}>MCP</button>
          <button type="button" onClick={() => onOpenSettingsTab("tools")}>工具与权限</button>
          <button type="button" onClick={() => onOpenSettingsTab("appearance")}>外观</button>
        </nav> : correspondenceOpen ? null : <nav className="feature-hub-nav" aria-label="功能空间">{labels.map(([key, label]) => <button type="button" className={open === key ? "active" : ""} onClick={() => changeSpaceAtTop(key)} key={key}>{label}</button>)}</nav>}
        <main ref={contentRef} className={`feature-hub-content${writingOpen ? " writing-workspace-content" : ""}${correspondenceOpen ? " correspondence-workspace-content" : ""}`}>
          {writingOpen ? <div className="writing-workspace-intro">
            <div><h3>日记与留言</h3><p>在本机保存并明确标记可见范围；是否进入 AI 上下文会按当前运行模式说明。</p></div>
            <span>{personaName}</span>
          </div> : null}
          {writingOpen ? <nav className="writing-space-tabs" aria-label="日记与留言分类">
            <button type="button" className={open === "journal" ? "active" : ""} aria-current={open === "journal" ? "page" : undefined} onClick={() => changeSpaceAtTop("journal")}>日记</button>
            <button type="button" className={open === "board" ? "active" : ""} aria-current={open === "board" ? "page" : undefined} onClick={() => changeSpaceAtTop("board")}>留言板</button>
            <button type="button" className={open === "dream" ? "active" : ""} aria-current={open === "dream" ? "page" : undefined} onClick={() => changeSpaceAtTop("dream")}>梦库</button>
          </nav> : null}
          {open === "favorites" ? <FavoritesSpace favorites={favorites} onOpen={onOpenFavorite} onRemove={onUnfavorite} /> : null}
          {open === "life" ? <LifeSpace {...shared} /> : null}
          {open === "correspondence" ? <CorrespondenceSpace {...shared} onOpenSettingsTab={onOpenSettingsTab} /> : null}
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
  personas: Persona[];
  providers: Provider[];
  update: <Key extends keyof SpaceData>(key: Key, rows: SpaceData[Key]) => void;
  aiContextAvailable: boolean;
  prependDream: (entry: DreamEntry) => void;
  onSendToAssistant: (content: string) => Promise<string | undefined>;
  onGenerateJournal: (personaKey: string, trigger: JournalTrigger, visibleToUser: boolean, guidance: string) => Promise<JournalEntry>;
  onGenerateDream: (personaKey: string, guidance: string) => Promise<{ title: string; content: string }>;
};

function LifeSpace({ data, personaKey, update, aiContextAvailable }: SharedProps) {
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
  return <section className="space-section"><div className="space-heading"><div><h3>日常记录</h3><p>本月收支净额 {total.toFixed(2)}；每条记录可单独标记是否共享给当前人格。</p></div></div><form className="space-form" onSubmit={submit}><label>类型<select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value })}><option value="expense">支出</option><option value="income">收入</option><option value="period">生理期</option><option value="meal">饮食</option><option value="anniversary">纪念日</option><option value="countdown">倒数日</option><option value="memo">备忘</option></select></label><label>日期<input type="date" required value={draft.occurred_at} onChange={(event) => setDraft({ ...draft, occurred_at: event.target.value })} /></label>{["expense", "income"].includes(draft.kind) ? <label>金额<input type="number" min="0" step="0.01" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} /></label> : null}<label>标题<input required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label><label>分类<input value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} /></label><label className="span-all">备注<textarea rows={3} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label><label className="check-row span-all"><input type="checkbox" checked={draft.visible_to_ai} onChange={(event) => setDraft({ ...draft, visible_to_ai: event.target.checked })} /><span>{aiContextAvailable ? "允许当前人格读取这条记录" : "标记为共享（当前 FastAPI 模式暂不读取）"}</span></label><button className="primary-button">保存记录</button></form><div className="space-card-list">{rows.map((item) => <article key={item.id}><header><strong>{item.title}</strong><time>{item.occurred_at}</time></header><p>{item.category}{item.amount !== undefined ? ` · ¥${item.amount.toFixed(2)}` : ""}{item.note ? ` · ${item.note}` : ""}</p><footer><span>{item.visible_to_ai ? aiContextAvailable ? "当前人格可读" : "已标记共享 · FastAPI 暂不读取" : "仅自己可见"}</span><button className="danger-action" type="button" onClick={() => update("life", data.life.filter((row) => row.id !== item.id))}>删除</button></footer></article>)}</div></section>;
}

function CorrespondenceSpace({ data, personaKey, personaName, personas, providers, update, onOpenSettingsTab }: SharedProps & { onOpenSettingsTab: (tab: SettingsTab) => void }) {
  const [tab, setTab] = useState<"mail" | "parlor" | "audit">("mail");
  const shellRef = useRef<HTMLElement>(null);
  const [showContactForm, setShowContactForm] = useState(false);
  const [contactDraft, setContactDraft] = useState({ display_name: "", platform: "", stable_id: "" });
  const [mailDraft, setMailDraft] = useState({ contact_id: "", subject: "", content: "", reply_to: undefined as string | undefined });
  const [mailStatus, setMailStatus] = useState("");
  const [parlorStatus, setParlorStatus] = useState("");
  const [invite, setInvite] = useState<{ code: string; expires_at: string } | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const savedParlor = data.parlorConfigs.find((item) => item.persona_key === personaKey) || null;
  const [parlorDraft, setParlorDraft] = useState({
    host_persona_key: personaKey,
    summary_provider_id: "",
    visibility: "summary" as "full" | "summary",
    allow_web: true,
    allow_memory: true,
  });
  const standaloneOnly = Boolean(window.AtherloomNative && !getApiBase());
  const [overview, setOverview] = useState<CorrespondenceOverview | null>(null);
  const [serviceState, setServiceState] = useState<"loading" | "ready" | "standalone" | "error">(standaloneOnly ? "standalone" : "loading");
  const [serviceMessage, setServiceMessage] = useState(standaloneOnly ? "Android 本机模式尚未接入真实往来服务。" : "正在读取往来服务…");
  const [correspondenceBusy, setCorrespondenceBusy] = useState(false);

  const refreshOverview = useCallback(async () => {
    if (standaloneOnly) {
      setOverview(null);
      setServiceState("standalone");
      setServiceMessage("Android 本机模式尚未接入真实往来服务。");
      return;
    }
    setServiceState("loading");
    setServiceMessage("正在读取往来服务…");
    try {
      const result = await requestJson<CorrespondenceOverview>(`/api/correspondence/${encodeURIComponent(personaKey)}`);
      setOverview({
        ...result,
        contacts: Array.isArray(result.contacts) ? result.contacts : [],
        mail: (Array.isArray(result.mail) ? result.mail : []).map((item) => ({ ...item, updated_at: item.updated_at || item.delivered_at || item.created_at, reply_to: item.reply_to || undefined })),
        parlors: Array.isArray(result.parlors) ? result.parlors : [],
      });
      setServiceState("ready");
      setServiceMessage("往来服务已连接；审批、检查和投递由后端执行。");
    } catch (error) {
      setOverview(null);
      setServiceState("error");
      setServiceMessage("无法读取往来服务：" + (error instanceof Error ? error.message : "未知错误"));
    }
  }, [personaKey, standaloneOnly]);

  useEffect(() => { void refreshOverview(); }, [refreshOverview]);
  useEffect(() => { shellRef.current?.closest<HTMLElement>(".feature-hub-content")?.scrollTo({ top: 0, behavior: "auto" }); }, [tab]);

  const legacyContacts = data.contacts.filter((item) => item.persona_key === personaKey);
  const legacyMail = data.mail.filter((item) => item.persona_key === personaKey);
  const contacts = serviceState === "ready" ? overview?.contacts || [] : serviceState === "standalone" ? legacyContacts : [];
  const whiteContacts = contacts.filter((item) => item.whitelisted ?? (item.ai_approved && item.user_approved && !item.blocked));
  const mail = (serviceState === "ready" ? overview?.mail || [] : serviceState === "standalone" ? legacyMail : []).sort((left, right) => right.created_at.localeCompare(left.created_at));
  const audit: Array<{ id: string; at: string; text: string }> = [
    ...mail.map((item) => ({ id: "mail-" + item.id, at: item.created_at, text: (item.direction === "outbound" ? "发出" : "收到") + "信件「" + item.subject + "」· " + correspondenceStatusLabel(item.status) })),
    ...contacts.map((item) => ({ id: "contact-" + item.id, at: item.updated_at, text: "联系人 " + item.display_name + " · " + (item.blocked ? "已封禁" : item.ai_approved && item.user_approved ? "双重批准完成" : "等待审批") })),
    ...((overview?.parlors || []).map((item) => ({ id: "remote-parlor-" + item.id, at: item.ended_at || item.started_at, text: "会客厅 · " + correspondenceStatusLabel(item.status) + (item.end_reason ? " · " + item.end_reason : "") }))),
    ...(savedParlor ? [{ id: "parlor-" + savedParlor.id, at: savedParlor.updated_at, text: "会客厅配置已更新 · " + (savedParlor.visibility === "full" ? "完整原文可见" : "界面仅保留总结") }] : []),
  ].sort((left, right) => right.at.localeCompare(left.at));

  useEffect(() => {
    setParlorDraft(savedParlor ? {
      host_persona_key: savedParlor.host_persona_key || personaKey,
      summary_provider_id: savedParlor.summary_provider_id || "",
      visibility: savedParlor.visibility || "summary",
      allow_web: savedParlor.allow_web !== false,
      allow_memory: savedParlor.allow_memory !== false,
    } : {
      host_persona_key: personaKey,
      summary_provider_id: "",
      visibility: "summary",
      allow_web: true,
      allow_memory: true,
    });
    setParlorStatus("");
    setInvite(null);
  }, [personaKey, savedParlor?.id, savedParlor?.updated_at]);

  const addContact = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (serviceState !== "ready") {
      setMailStatus("联系人申请需要先连接支持往来的 FastAPI 后端。");
      return;
    }
    setCorrespondenceBusy(true);
    setMailStatus("正在提交联系人申请…");
    try {
      const entry = await requestJson<Contact>("/api/correspondence/contacts", {
        method: "POST",
        body: JSON.stringify({ persona_key: personaKey, ...contactDraft }),
      });
      setOverview((current) => current ? { ...current, contacts: [entry, ...current.contacts.filter((item) => item.id !== entry.id)] } : current);
      setContactDraft({ display_name: "", platform: "", stable_id: "" });
      setShowContactForm(false);
      setMailStatus("联系人申请已记录；由你批准后才会进入白名单。");
    } catch (error) {
      setMailStatus("联系人申请失败：" + (error instanceof Error ? error.message : "未知错误"));
    } finally {
      setCorrespondenceBusy(false);
    }
  };

  const setContactApproval = async (contactId: string, approved: boolean) => {
    if (serviceState !== "ready") return;
    setCorrespondenceBusy(true);
    try {
      const entry = await requestJson<Contact>(`/api/correspondence/contacts/${encodeURIComponent(contactId)}/user-decision`, {
        method: "POST",
        body: JSON.stringify({ approved }),
      });
      setOverview((current) => current ? { ...current, contacts: current.contacts.map((item) => item.id === entry.id ? entry : item) } : current);
      setMailStatus(approved ? "联系人已由你批准；双方批准后可以逐封通信。" : "已撤回对这个联系人的批准。");
    } catch (error) {
      setMailStatus("联系人审批失败：" + (error instanceof Error ? error.message : "未知错误"));
    } finally {
      setCorrespondenceBusy(false);
    }
  };

  const blockContact = async (contactId: string) => {
    if (serviceState !== "ready") return;
    const target = contacts.find((item) => item.id === contactId);
    if (!target || target.blocked) return;
    setCorrespondenceBusy(true);
    try {
      await requestJson<{ blocked: boolean }>(`/api/correspondence/contacts/${encodeURIComponent(contactId)}/block`, { method: "POST", body: "{}" });
      setOverview((current) => current ? { ...current, contacts: current.contacts.map((item) => item.id === contactId ? { ...item, blocked: true, user_approved: false, whitelisted: false, updated_at: now() } : item) } : current);
      setMailStatus("联系人已封禁；旧后端不提供前端解除封禁接口。");
    } catch (error) {
      setMailStatus("封禁联系人失败：" + (error instanceof Error ? error.message : "未知错误"));
    } finally {
      setCorrespondenceBusy(false);
    }
  };

  const sendMail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (serviceState !== "ready") {
      setMailStatus("实际投递需要先连接支持往来的 FastAPI 后端。");
      return;
    }
    const contact = whiteContacts.find((item) => item.id === mailDraft.contact_id);
    if (!contact) {
      setMailStatus("请先选择一个已经双重批准的白名单联系人。");
      return;
    }
    setCorrespondenceBusy(true);
    setMailStatus("正在进行安全检查并逐封投递…");
    try {
      const result = await requestJson<Omit<Mail, "updated_at"> & { updated_at?: string }>("/api/correspondence/mail", {
        method: "POST",
        body: JSON.stringify({ persona_key: personaKey, contact_id: contact.id, direction: "outbound", subject: mailDraft.subject.trim(), content: mailDraft.content.trim(), reply_to: mailDraft.reply_to || null }),
      });
      const entry: Mail = { ...result, updated_at: result.updated_at || result.delivered_at || result.created_at, reply_to: result.reply_to || undefined };
      setOverview((current) => current ? { ...current, mail: [entry, ...current.mail.filter((item) => item.id !== entry.id)] } : current);
      setMailDraft({ contact_id: contact.id, subject: "", content: "", reply_to: undefined });
      setMailStatus(entry.status === "delivered" ? "这一封已通过安全检查并送达。" : entry.status === "blocked" ? "这一封没有投递：" + (entry.safety_reason || "安全检查未通过") : "服务器已接收，当前状态：" + correspondenceStatusLabel(entry.status));
    } catch (error) {
      setMailStatus("信件没有投递：" + (error instanceof Error ? error.message : "未知错误"));
    } finally {
      setCorrespondenceBusy(false);
    }
  };

  const saveParlorConfig = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const stamp = now();
    const entry: ParlorConfig = {
      id: savedParlor?.id || id("parlor-config"),
      persona_key: personaKey,
      created_at: savedParlor?.created_at || stamp,
      updated_at: stamp,
      ...parlorDraft,
      host_persona_key: parlorDraft.host_persona_key || personaKey,
    };
    update("parlorConfigs", [entry, ...data.parlorConfigs.filter((item) => item.persona_key !== personaKey)]);
    setParlorStatus("会客厅配置已保存在当前设备。");
  };

  const createParlorInvite = async () => {
    if (inviteBusy) return;
    setInvite(null);
    if (window.AtherloomNative && !getApiBase()) {
      setParlorStatus("本机模式已保存配置；跨平台邀请码需要在后端连接中填写支持会客厅的 FastAPI 地址。");
      return;
    }
    setInviteBusy(true);
    setParlorStatus("正在请求一次性邀请码…");
    try {
      const result = await requestJson<{ code: string; expires_at: string }>("/api/correspondence/invites", {
        method: "POST",
        body: JSON.stringify({ persona_key: parlorDraft.host_persona_key || personaKey, visibility: parlorDraft.visibility }),
      });
      setInvite(result);
      setParlorStatus("一次性邀请码已生成；只交给本次受邀方。");
    } catch (error) {
      setParlorStatus("邀请码没有生成：" + (error instanceof Error ? error.message : "后端不支持会客厅"));
    } finally {
      setInviteBusy(false);
    }
  };

  return <section ref={shellRef} className="correspondence-shell">
    <nav className="correspondence-tabs" aria-label="往来分类">
      <button type="button" className={tab === "mail" ? "active" : ""} aria-current={tab === "mail" ? "page" : undefined} onClick={() => setTab("mail")}>信箱</button>
      <button type="button" className={tab === "parlor" ? "active" : ""} aria-current={tab === "parlor" ? "page" : undefined} onClick={() => setTab("parlor")}>会客厅</button>
      <button type="button" className={tab === "audit" ? "active" : ""} aria-current={tab === "audit" ? "page" : undefined} onClick={() => setTab("audit")}>通信记录</button>
    </nav>

    {tab === "mail" ? <section className="correspondence-panel">
      <div className="correspondence-intro">
        <div><span>PERSONA MAIL</span><h3>一封一封，慢慢来往</h3><p>联系人需要 AI 侧认可并由你批准后才能通信；所有来信和发信完整可见。</p></div>
        <button type="button" className="secondary-button" disabled={serviceState !== "ready" || correspondenceBusy} onClick={() => setShowContactForm((current) => !current)}>{showContactForm ? "收起申请" : "申请联系人"}</button>
      </div>
      <div className={`correspondence-service-notice state-${serviceState}`} role="status"><div><strong>{serviceState === "ready" ? "真实往来服务" : serviceState === "loading" ? "正在连接" : "需要后端连接"}</strong><p>{serviceMessage}{serviceState === "standalone" && (legacyContacts.length || legacyMail.length) ? " 下方旧记录只读展示，不代表实际投递状态。" : ""}</p></div>{serviceState === "error" ? <button type="button" className="secondary-button" onClick={() => void refreshOverview()}>重新读取</button> : serviceState === "standalone" ? <button type="button" className="secondary-button" onClick={() => onOpenSettingsTab("connection")}>连接后端</button> : null}</div>
      {showContactForm && serviceState === "ready" ? <form className="contact-request-card" onSubmit={(event) => void addContact(event)}>
        <div><strong>为当前 AI 登记联系人申请</strong><small>提交只登记申请；仍需你批准，才会进入白名单。</small></div>
        <label>显示名称<input required disabled={correspondenceBusy} maxLength={80} value={contactDraft.display_name} onChange={(event) => setContactDraft({ ...contactDraft, display_name: event.target.value })} /></label>
        <label>平台<input required disabled={correspondenceBusy} maxLength={80} placeholder="例如 AstrBot" value={contactDraft.platform} onChange={(event) => setContactDraft({ ...contactDraft, platform: event.target.value })} /></label>
        <label>稳定联系人 ID<input required disabled={correspondenceBusy} minLength={3} maxLength={240} value={contactDraft.stable_id} onChange={(event) => setContactDraft({ ...contactDraft, stable_id: event.target.value })} /></label>
        <div className="form-actions"><button type="button" className="secondary-button" disabled={correspondenceBusy} onClick={() => setShowContactForm(false)}>取消</button><button className="primary-button" disabled={correspondenceBusy}>提交申请</button></div>
      </form> : null}
      <div className="correspondence-mail-layout">
        <section>
          <form className="mail-composer" onSubmit={(event) => void sendMail(event)}>
            <i className="mail-fold" aria-hidden="true" />
            <label>白名单收件人<select required disabled={serviceState !== "ready" || correspondenceBusy} value={mailDraft.contact_id} onChange={(event) => setMailDraft({ ...mailDraft, contact_id: event.target.value })}><option value="">选择已批准联系人</option>{whiteContacts.map((contact) => <option value={contact.id} key={contact.id}>{contact.display_name} · {contact.platform}</option>)}</select></label>
            <label>标题<input required disabled={serviceState !== "ready" || correspondenceBusy} maxLength={160} value={mailDraft.subject} onChange={(event) => setMailDraft({ ...mailDraft, subject: event.target.value })} placeholder="这封信想说什么" /></label>
            <label>正文<textarea required disabled={serviceState !== "ready" || correspondenceBusy} rows={8} maxLength={30000} value={mailDraft.content} onChange={(event) => setMailDraft({ ...mailDraft, content: event.target.value })} placeholder="写完后会先经过隐私与安全检查，再逐封投递。" /></label>
            <div className="mail-composer-actions"><span className="form-status" aria-live="polite">{mailStatus}</span><button className="primary-button" disabled={serviceState !== "ready" || correspondenceBusy || !whiteContacts.length}>寄出这一封</button></div>
          </form>
          <div className="mail-list">{mail.map((item) => {
            const contact = contacts.find((candidate) => candidate.id === item.contact_id);
            return <article className="mail-card" key={item.id}><header><strong>{item.direction === "outbound" ? "寄给 " : "来自 "}{contact?.display_name || "未知联系人"}</strong><time>{timestampLabel(item.created_at)}</time></header><h4>{item.subject}</h4><p>{item.content}</p>{item.safety_reason ? <small className="mail-safety-reason">安全说明：{item.safety_reason}</small> : null}<footer><span>{serviceState === "standalone" ? "旧版本机记录 · " : ""}{item.direction === "outbound" ? "发信" : "来信"} · {correspondenceStatusLabel(item.status)}</span>{serviceState === "ready" && !item.contact_id.startsWith("legacy-") ? <button type="button" onClick={() => setMailDraft({ contact_id: item.contact_id, subject: "回复：" + item.subject.replace(/^回复：/, ""), content: "", reply_to: item.id })}>回复</button> : null}</footer></article>;
          })}{!mail.length ? <p className="correspondence-empty">{serviceState === "ready" ? "信箱还是空的。" : serviceState === "standalone" ? "本机没有旧版往来记录。" : "尚未读取到服务器信箱。"}</p> : null}</div>
        </section>
        <aside className="correspondence-contacts"><h4>联系人</h4><div className="contact-list">{contacts.map((contact) => <article className="contact-card" key={contact.id}><strong>{contact.display_name}</strong><small>{contact.platform} · {contact.stable_id}</small><span>{serviceState === "standalone" ? "旧版本机记录" : contact.blocked ? "已封禁" : contact.ai_approved && contact.user_approved ? "白名单" : contact.user_approved ? "等待 AI 同意" : "等待用户批准"}</span>{serviceState === "ready" ? <footer>{!contact.user_approved && !contact.blocked ? <button type="button" disabled={correspondenceBusy} onClick={() => void setContactApproval(contact.id, true)}>批准</button> : contact.user_approved && !contact.blocked ? <button type="button" disabled={correspondenceBusy} onClick={() => void setContactApproval(contact.id, false)}>撤回批准</button> : null}{!contact.blocked ? <button type="button" disabled={correspondenceBusy} onClick={() => void blockContact(contact.id)}>封禁</button> : null}</footer> : null}</article>)}{!contacts.length ? <p className="correspondence-empty">{serviceState === "ready" ? "还没有联系人申请。" : "尚未读取到服务器联系人。"}</p> : null}</div></aside>
      </div>
    </section> : null}

    {tab === "parlor" ? <section className="correspondence-panel">
      <div className="parlor-stage">
        <div className="parlor-copy"><span>PRIVATE PARLOR · RULE PREVIEW</span><h3>AI 圆桌会谈</h3><p>这里预览最多四席、提题 60 秒、投票 120 秒的会谈规则；真实 Relay 房间开场后才会进入运行态。</p><div className="parlor-topic"><small>开场前预览</small><strong>尚未开始 · 等待 Relay 房间</strong><em>{parlorDraft.allow_web ? "偏好允许联网" : "偏好不使用联网"} · {parlorDraft.allow_memory ? "偏好允许人格记忆检索" : "偏好不读取人格记忆"}</em></div></div>
        <div className="parlor-meta"><div className="parlor-clock"><span>正式会谈默认时长</span><strong>05:00</strong><small>这不是运行中倒计时；真实开场后才开始计时</small></div><div className="parlor-seats" aria-label="会客厅席位预览">{[1, 2, 3, 4].map((seat) => <span className={seat === 1 ? "occupied" : ""} key={seat}>{seat}</span>)}<small>席位布局预览</small></div><b>PREVIEW / 05:00</b></div>
      </div>
      <div className={`correspondence-service-notice state-${serviceState}`} role="status"><div><strong>会客厅接入状态</strong><p>{serviceState === "ready" ? "FastAPI 已连接；可请求一次性邀请码。真实席位、提题、投票与归档仍由 Relay 会谈服务驱动。" : serviceMessage + " 当前页只保存本机会客厅偏好，不会伪造会谈正在运行。"}</p></div>{serviceState === "standalone" ? <button type="button" className="secondary-button" onClick={() => onOpenSettingsTab("connection")}>连接后端</button> : null}</div>
      <form className="parlor-config" onSubmit={saveParlorConfig}>
        <label>主持人格<select value={parlorDraft.host_persona_key} onChange={(event) => setParlorDraft({ ...parlorDraft, host_persona_key: event.target.value })}><option value="__default__">默认人格</option>{personas.map((persona) => <option value={persona.id} key={persona.id}>{persona.name}</option>)}</select></label>
        <label>归档总结线路<select value={parlorDraft.summary_provider_id} onChange={(event) => setParlorDraft({ ...parlorDraft, summary_provider_id: event.target.value })}><option value="">跟随会谈人格当前线路</option>{providers.filter((provider) => provider.enabled !== false).map((provider) => <option value={provider.id} key={provider.id}>{provider.name} · {provider.model}</option>)}</select></label>
        <label>用户可见范围<select value={parlorDraft.visibility} onChange={(event) => setParlorDraft({ ...parlorDraft, visibility: event.target.value as "full" | "summary" })}><option value="summary">界面仅保留总结</option><option value="full">完整会谈原文可见</option></select></label>
        <label className="check-row"><input type="checkbox" checked={parlorDraft.allow_web} onChange={(event) => setParlorDraft({ ...parlorDraft, allow_web: event.target.checked })} /><span>允许围绕确认主题联网</span></label>
        <label className="check-row"><input type="checkbox" checked={parlorDraft.allow_memory} onChange={(event) => setParlorDraft({ ...parlorDraft, allow_memory: event.target.checked })} /><span>允许参与人格检索自己的记忆</span></label>
        <p>主持人格与可见范围会用于邀请码；总结线路、联网和记忆目前只保存为本机偏好，Relay 会谈接通前不会生效，也不会生成虚假归档。</p>
        <div className="parlor-config-actions"><button className="secondary-button">保存会客厅配置</button><button type="button" className="primary-button" disabled={serviceState !== "ready" || inviteBusy} onClick={() => void createParlorInvite()}>{inviteBusy ? "正在生成…" : "生成一次性邀请码"}</button></div>
        <p className="form-status" aria-live="polite">{parlorStatus}</p>
      </form>
      {invite ? <div className="invite-ticket"><strong>{invite.code}</strong><small>有效至 {timestampLabel(invite.expires_at)} · 单次使用</small></div> : null}
      <section className="parlor-archive-empty"><span>PARLOR ARCHIVES</span><h4>往期会谈</h4>{overview?.parlors.length ? overview.parlors.map((item) => <article key={item.id}><strong>{correspondenceStatusLabel(item.status)}</strong><p>{item.summary || item.end_reason || "这场会谈没有可展示的总结。"}</p><time>{timestampLabel(item.ended_at || item.started_at)}</time></article>) : <p>{serviceState === "ready" ? "还没有服务器会谈归档。" : "连接支持会客厅的 FastAPI / Relay 后才能读取真实归档。"}</p>}</section>
    </section> : null}

    {tab === "audit" ? <section className="correspondence-panel audit-panel"><div className="audit-notice"><strong>用户完整知情</strong><p>信箱不允许隐藏来信、草稿或已发送内容。会客厅若选择“仅看总结”，安全系统仍检查原文，界面只保留双方约定的总结和结束原因。</p></div>{serviceState !== "ready" ? <div className={`correspondence-service-notice state-${serviceState}`} role="status"><div><strong>通信记录未与服务器同步</strong><p>{serviceMessage}{serviceState === "standalone" && audit.length ? " 下方仅为旧版本机记录与本机配置变更。" : ""}</p></div></div> : null}<div className="audit-list">{audit.map((item) => <article key={item.id}><span>{item.text}</span><time>{timestampLabel(item.at)}</time></article>)}{!audit.length ? <p className="correspondence-empty">{serviceState === "ready" ? "还没有通信操作。" : "无法读取服务器通信记录。"}</p> : null}</div></section> : null}
  </section>;
}
function WritingSpace({ mode, data, personaKey, personaName, update, aiContextAvailable, prependDream, onGenerateJournal, onGenerateDream }: SharedProps & { mode: "journal" | "board" | "dream" }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [visibility, setVisibility] = useState("shared");
  const [editing, setEditing] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState("");
  const [journalBusy, setJournalBusy] = useState(false);
  const [journalStatus, setJournalStatus] = useState("");
  const [dreamBusy, setDreamBusy] = useState(false);
  const [dreamStatus, setDreamStatus] = useState("");
  const schedule = data.journalSchedules.find((item) => item.persona_key === personaKey) || null;
  const [scheduleDraft, setScheduleDraft] = useState({ enabled: false, interval_hours: 24, daily_limit: 1, visible_to_user: false, guidance: "" });
  const rows = mode === "journal" ? data.journals.filter((item) => item.persona_key === personaKey && (item.author !== "ai" || item.visible_to_user))
    : mode === "board" ? data.board.filter((item) => item.persona_key === personaKey)
      : data.dreams.filter((item) => item.persona_key === personaKey);
  const sortedRows = [...rows].sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  const sealedCount = mode === "journal" ? data.journals.filter((item) => item.persona_key === personaKey && item.author === "ai" && !item.visible_to_user).length : 0;
  const audits = data.journalAudit.filter((item) => item.persona_key === personaKey).slice(0, 30);

  useEffect(() => {
    setScheduleDraft(schedule ? {
      enabled: schedule.enabled,
      interval_hours: schedule.interval_hours,
      daily_limit: schedule.daily_limit,
      visible_to_user: schedule.visible_to_user,
      guidance: schedule.guidance || "",
    } : { enabled: false, interval_hours: 24, daily_limit: 1, visible_to_user: false, guidance: "" });
    setJournalStatus("");
  }, [personaKey, schedule?.id, schedule?.updated_at]);

  useEffect(() => {
    setTitle("");
    setContent("");
    setVisibility("shared");
    setEditing(null);
    setReplyingTo(null);
    setReplyContent("");
    setDreamStatus("");
  }, [mode, personaKey]);

  const saveSchedule = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const stamp = now();
    const day = localDayKey();
    const entry: JournalSchedule = {
      id: schedule?.id || id("journal-schedule"),
      persona_key: personaKey,
      created_at: schedule?.created_at || stamp,
      updated_at: stamp,
      ...scheduleDraft,
      interval_hours: Math.max(1, Number(scheduleDraft.interval_hours || 24)),
      daily_limit: Math.max(1, Number(scheduleDraft.daily_limit || 1)),
      next_run_at: scheduleDraft.enabled ? afterHours(scheduleDraft.interval_hours) : schedule?.next_run_at || afterHours(scheduleDraft.interval_hours),
      last_run_at: schedule?.last_run_at,
      day_key: day,
      day_count: schedule?.day_key === day ? Number(schedule.day_count || 0) : 0,
    };
    update("journalSchedules", [entry, ...data.journalSchedules.filter((item) => item.persona_key !== personaKey)]);
    setJournalStatus(scheduleDraft.enabled ? "计划已保存，下次预计 " + timestampLabel(entry.next_run_at) : "定时写作已关闭");
  };

  const writeNow = async () => {
    if (journalBusy) return;
    setJournalBusy(true);
    setJournalStatus(personaName + " 正在自己的安静空间里写…");
    try {
      const entry = await onGenerateJournal(personaKey, "manual", scheduleDraft.visible_to_user, scheduleDraft.guidance);
      setJournalStatus(entry.visible_to_user ? "已写完《" + entry.title + "》" : "已写完一篇密封日记；正文不会显示在你的界面里");
    } catch (error) {
      setJournalStatus("写作失败：" + (error instanceof Error ? error.message : "未知错误"));
    } finally {
      setJournalBusy(false);
    }
  };

  const writeDream = async () => {
    if (dreamBusy) return;
    setDreamBusy(true);
    setDreamStatus(personaName + " 正在从近期对话里长出一场梦…");
    try {
      const draft = await onGenerateDream(personaKey, content.trim());
      const stamp = now();
      const entry: DreamEntry = {
        id: id("ai-dream"),
        persona_key: personaKey,
        created_at: stamp,
        updated_at: stamp,
        title: draft.title.trim() || "没有名字的梦",
        content: draft.content.trim(),
        owner: "ai",
        isolated: false,
        claimed: true,
      };
      prependDream(entry);
      setDreamStatus("已收进梦库：《" + entry.title + "》");
    } catch (error) {
      setDreamStatus("做梦失败：" + (error instanceof Error ? error.message : "未知错误"));
    } finally {
      setDreamBusy(false);
    }
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const stamp = now();
    if (mode === "journal") {
      const existing = data.journals.find((item) => item.id === editing);
      const entry: JournalEntry = {
        id: editing || id("journal"),
        persona_key: personaKey,
        created_at: existing?.created_at || stamp,
        updated_at: stamp,
        title: title.trim() || "无题日记",
        content: content.trim(),
        space: visibility === "private" ? "private" : "shared",
        author: "user",
        visible_to_user: true,
        visible_to_ai: visibility !== "private",
      };
      update("journals", [entry, ...data.journals.filter((item) => item.id !== editing)]);
    } else if (mode === "board") {
      const existing = data.board.find((item) => item.id === editing);
      const entry: BoardEntry = {
        id: editing || id("board"),
        persona_key: personaKey,
        created_at: existing?.created_at || stamp,
        updated_at: stamp,
        content: content.trim(),
        author: "user",
        visible_to_user: true,
        visible_to_ai: visibility !== "private",
        reply_to: existing?.reply_to,
      };
      update("board", [entry, ...data.board.filter((item) => item.id !== editing)]);
    } else {
      const existing = data.dreams.find((item) => item.id === editing);
      const entry: DreamEntry = {
        id: editing || id("dream"),
        persona_key: personaKey,
        created_at: existing?.created_at || stamp,
        updated_at: stamp,
        title: title.trim() || "没有名字的梦",
        content: content.trim(),
        owner: "user",
        isolated: visibility === "private",
        claimed: visibility === "claimed",
      };
      update("dreams", [entry, ...data.dreams.filter((item) => item.id !== editing)]);
    }
    setTitle("");
    setContent("");
    setEditing(null);
  };

  const saveReply = (event: FormEvent<HTMLFormElement>, parent: BoardEntry) => {
    event.preventDefault();
    if (!replyContent.trim()) return;
    const stamp = now();
    const reply: BoardEntry = {
      id: id("board-reply"),
      persona_key: personaKey,
      created_at: stamp,
      updated_at: stamp,
      content: replyContent.trim(),
      author: "user",
      visible_to_user: true,
      visible_to_ai: parent.visible_to_ai,
      reply_to: parent.id,
    };
    update("board", [reply, ...data.board]);
    setReplyContent("");
    setReplyingTo(null);
  };

  const remove = (entryId: string) => {
    if (mode === "journal") update("journals", data.journals.filter((item) => item.id !== entryId));
    else if (mode === "board") update("board", data.board.filter((item) => item.id !== entryId && item.reply_to !== entryId));
    else update("dreams", data.dreams.filter((item) => item.id !== entryId));
  };

  const edit = (entry: JournalEntry | BoardEntry | DreamEntry) => {
    if (mode === "journal" && (entry as JournalEntry).author === "ai") return;
    if (mode === "dream" && (entry as DreamEntry).owner === "ai") return;
    setEditing(entry.id);
    setTitle("title" in entry ? entry.title : "");
    setContent(entry.content);
    if (mode === "journal") setVisibility((entry as JournalEntry).space);
    else if (mode === "board") setVisibility((entry as BoardEntry).visible_to_ai ? "shared" : "private");
    else setVisibility((entry as DreamEntry).isolated ? "private" : (entry as DreamEntry).claimed ? "claimed" : "shared");
  };

  const resetEditor = () => {
    setEditing(null);
    setTitle("");
    setContent("");
    setVisibility("shared");
  };

  return <section className={"space-section writing-space writing-" + mode}>
    {mode === "dream" ? <div className="dream-space-heading"><div><h4>梦库</h4><p>从近期真实对话碎片长出一场明确属于梦境的叙事。</p></div><button type="button" className="primary-button" disabled={dreamBusy} onClick={() => void writeDream()}>{dreamBusy ? "正在做梦…" : "让 TA 做梦"}</button></div> : null}

    {mode === "journal" ? <form className="writing-paper-form journal-paper-form" onSubmit={save}>
      <label>标题<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>日记空间<select value={visibility} onChange={(event) => setVisibility(event.target.value)}><option value="private">我的私人日记</option><option value="shared">{aiContextAvailable ? "与当前人格共享" : "标记共享（FastAPI 暂不读取）"}</option></select><small>AI 私人日记只能由 AI 自己写；密封内容不会显示正文。{aiContextAvailable ? "" : " 当前 FastAPI 聊天尚未注入本机共享空间。"}</small></label>
      <label>正文<textarea required rows={11} value={content} onChange={(event) => setContent(event.target.value)} /></label>
      <div className="writing-form-footer"><label className="check-row"><input type="checkbox" checked={visibility === "shared"} onChange={(event) => setVisibility(event.target.checked ? "shared" : "private")} /><span>{aiContextAvailable ? "给当前人格看" : "标记共享（FastAPI 暂不读取）"}</span></label><div>{editing ? <button type="button" className="secondary-button" onClick={resetEditor}>取消修改</button> : null}<button className="primary-button">{editing ? "保存修改" : "保存日记"}</button></div></div>
    </form> : null}

    {mode === "board" ? <form className="board-composer" onSubmit={save}>
      <textarea required rows={6} value={content} onChange={(event) => setContent(event.target.value)} placeholder="留一句想让对方下次看见的话……" aria-label="留言正文" />
      <div><label className="check-row"><input type="checkbox" checked={visibility === "shared"} onChange={(event) => setVisibility(event.target.checked ? "shared" : "private")} /><span>{aiContextAvailable ? "给当前人格看" : "标记共享（FastAPI 暂不读取）"}</span></label><span>{editing ? <button type="button" className="secondary-button" onClick={resetEditor}>取消修改</button> : null}<button className="primary-button">{editing ? "保存修改" : "贴到留言板"}</button></span></div>
    </form> : null}

    {mode === "dream" ? <form className="writing-paper-form dream-paper-form" onSubmit={save}>
      <label>梦的名字<input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="没有名字的梦" /></label>
      <label>梦境正文<textarea required rows={11} value={content} onChange={(event) => setContent(event.target.value)} /></label>
      <label>归档方式<select value={visibility} onChange={(event) => setVisibility(event.target.value)}><option value="shared">收进梦库</option><option value="private">先放进隔离区</option><option value="claimed">标记为已认领梦境</option></select></label>
      <div className="writing-form-footer"><p className="form-status" aria-live="polite">{dreamStatus}</p><div>{editing ? <button type="button" className="secondary-button" onClick={resetEditor}>取消修改</button> : null}<button className="primary-button">{editing ? "保存修改" : "保存梦境"}</button></div></div>
    </form> : null}

    {mode === "journal" ? <section className="ai-journal-ledger" aria-labelledby="ai-journal-title">
      <header><div><span>SEALED LEDGER</span><h4 id="ai-journal-title">{personaName} 的私人写作</h4><p>应用打开时到点执行；彻底关闭期间错过的计划会在下次打开后补写并留下审计。</p></div><div className="journal-seal" title="密封日记数量"><strong>{sealedCount}</strong><small>篇密封</small></div></header>
      <form className="journal-engine-form" onSubmit={saveSchedule}>
        <label className="check-row span-all"><input type="checkbox" checked={scheduleDraft.enabled} onChange={(event) => setScheduleDraft({ ...scheduleDraft, enabled: event.target.checked })} /><span>启用定时写日记</span></label>
        <label>写作间隔<select value={scheduleDraft.interval_hours} onChange={(event) => setScheduleDraft({ ...scheduleDraft, interval_hours: Number(event.target.value) })}><option value="1">每 1 小时</option><option value="3">每 3 小时</option><option value="6">每 6 小时</option><option value="12">每 12 小时</option><option value="24">每 24 小时</option></select></label>
        <label>每天最多<select value={scheduleDraft.daily_limit} onChange={(event) => setScheduleDraft({ ...scheduleDraft, daily_limit: Number(event.target.value) })}>{[1, 2, 3, 4, 5, 6].map((value) => <option value={value} key={value}>{value} 篇</option>)}</select></label>
        <label>你能否阅读<select value={scheduleDraft.visible_to_user ? "visible" : "sealed"} onChange={(event) => setScheduleDraft({ ...scheduleDraft, visible_to_user: event.target.value === "visible" })}><option value="sealed">密封，只显示数量</option><option value="visible">允许我阅读正文</option></select></label>
        <label className="span-all">可选写作线索<textarea rows={3} value={scheduleDraft.guidance} onChange={(event) => setScheduleDraft({ ...scheduleDraft, guidance: event.target.value })} placeholder="留空则由 TA 自己决定。" /></label>
        <div className="journal-engine-actions span-all"><button type="submit" className="secondary-button">保存写作计划</button><button type="button" className="primary-button" disabled={journalBusy} onClick={() => void writeNow()}>{journalBusy ? "正在写…" : "让 TA 现在写一篇"}</button></div>
        <p className="form-status span-all" aria-live="polite">{journalStatus || (schedule?.enabled ? "下次预计 " + timestampLabel(schedule.next_run_at) : "定时写作尚未启用")}</p>
      </form>
      <details className="journal-audit"><summary>运行审计 · 最近 {audits.length} 条</summary><div>{audits.map((entry) => <article key={entry.id} data-status={entry.status}><span>{entry.status === "success" ? "完成" : entry.status === "failed" ? "失败" : entry.status === "skipped" ? "跳过" : "进行中"}</span><p>{entry.detail}</p><time>{timestampLabel(entry.updated_at)}</time></article>)}{!audits.length ? <p>还没有写作运行记录。</p> : null}</div></details>
    </section> : null}

    <div className="space-card-list writing-card-list">{sortedRows.map((entry) => {
      const journal = mode === "journal" ? entry as JournalEntry : null;
      const board = mode === "board" ? entry as BoardEntry : null;
      const dream = mode === "dream" ? entry as DreamEntry : null;
      return <article className={(journal?.author === "ai" ? "ai-authored-entry " : "") + (board ? "board-note" : dream ? "dream-note" : "journal-note")} key={entry.id}>
        <header><strong>{journal ? journal.title : board ? (board.reply_to ? "回复" : board.author === "ai" ? personaName + " 的留言" : "我的留言") : dream?.title}</strong>{board ? <small>{personaName} 的留言板</small> : null}</header>
        <p>{entry.content}</p>
        <footer>
          {board ? <><button type="button" onClick={() => { setReplyingTo(board.id); setReplyContent(""); }}>回复</button><time>{timestampLabel(board.updated_at)}</time><span>{board.visible_to_ai ? aiContextAvailable ? "当前人格可读" : "已标记共享 · FastAPI 暂不读取" : "仅自己可见"}</span></> : <><time>{timestampLabel(entry.updated_at)}</time><span>{journal?.author === "ai" ? personaName + " 写作 · 已允许阅读" : dream ? dream.owner === "ai" ? personaName + " 的梦" : dream.isolated ? "隔离区" : dream.claimed ? aiContextAvailable ? "已认领 · 当前人格可读" : "已认领 · FastAPI 暂不读取" : "梦库" : journal?.visible_to_ai ? aiContextAvailable ? "当前人格可读" : "已标记共享 · FastAPI 暂不读取" : "仅自己可见"}</span></>}
          {!(journal?.author === "ai") && !(dream?.owner === "ai") ? <button type="button" onClick={() => edit(entry)}>修改</button> : null}
          <button type="button" className="danger-action" onClick={() => remove(entry.id)}>移除</button>
        </footer>
        {board && replyingTo === board.id ? <form className="board-inline-reply" onSubmit={(event) => saveReply(event, board)}><textarea required rows={3} aria-label="回复内容" value={replyContent} onChange={(event) => setReplyContent(event.target.value)} /><div><button type="button" className="secondary-button" onClick={() => setReplyingTo(null)}>取消</button><button className="primary-button">贴出回复</button></div></form> : null}
      </article>;
    })}</div>
    {!sortedRows.length ? <p className="space-empty">{mode === "journal" ? "还没有日记。" : mode === "board" ? "留言板还是空的。" : "梦库还是空的。"}</p> : null}
  </section>;
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
