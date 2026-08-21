import { useEffect, useRef, useState, type FormEvent, type TouchEvent } from "react";
import type { Conversation, Persona } from "../../domain/types";
import { PlusIcon, SearchIcon } from "../../components/Icons";
import type { FeatureSpace } from "../spaces/FeatureHub";

interface SidebarProps {
  conversations: Conversation[];
  personas: Persona[];
  personaId: string | null;
  currentId: string | null;
  query: string;
  displayName: string;
  onQueryChange: (value: string) => void;
  onPersonaChange: (id: string | null) => void;
  onNewConversation: () => void;
  onOpenConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => Promise<unknown>;
  onUpdateConversationState: (id: string, patch: Partial<Pick<Conversation, "pinned" | "starred" | "archived">>) => Promise<unknown>;
  onDeleteConversation: (id: string) => Promise<void>;
  onClearPersonaConversations: () => Promise<void>;
  onOpenSettings: () => void;
  onOpenSpace: (space: FeatureSpace) => void;
  onClose: () => void;
}

interface ConversationRowProps {
  conversation: Conversation;
  active: boolean;
  revealed: boolean;
  onOpen: () => void;
  onReveal: () => void;
  onRename: (title: string) => Promise<unknown>;
  onState: (patch: Partial<Pick<Conversation, "pinned" | "starred" | "archived">>) => Promise<unknown>;
  onDelete: () => Promise<void>;
}

function conversationGroup(conversation: Conversation) {
  if (!conversation.updated_at) return "对话";
  const updated = new Date(conversation.updated_at);
  const today = new Date();
  if (updated.toDateString() === today.toDateString()) return "今天";
  const days = Math.floor((today.getTime() - updated.getTime()) / 86_400_000);
  return days <= 7 ? "最近 7 天" : "更早";
}

function groupConversations(conversations: Conversation[]) {
  const result: Array<[string, Conversation[]]> = [];
  const active = conversations.filter((item) => !item.archived);
  const pinned = active.filter((item) => item.pinned);
  const starred = active.filter((item) => item.starred && !item.pinned);
  const recent = active.filter((item) => !item.pinned && !item.starred);
  if (pinned.length) result.push(["置顶", pinned]);
  if (starred.length) result.push(["星标", starred]);
  for (const conversation of recent) {
    const label = conversationGroup(conversation);
    const group = result.find(([name]) => name === label);
    if (group) group[1].push(conversation); else result.push([label, [conversation]]);
  }
  const archived = conversations.filter((item) => item.archived);
  if (archived.length) result.push(["已归档", archived]);
  return result;
}

function ConversationRow({ conversation, active, revealed, onOpen, onReveal, onRename, onState, onDelete }: ConversationRowProps) {
  const timerRef = useRef<number | null>(null);
  const originRef = useRef({ x: 0, y: 0 });
  const suppressClickRef = useRef(false);
  const [armed, setArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(conversation.title || "新对话");
  const [deleteError, setDeleteError] = useState("");

  const cancelPress = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setArmed(false);
  };

  const startPress = (x: number, y: number) => {
    cancelPress();
    originRef.current = { x, y };
    setArmed(true);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      suppressClickRef.current = true;
      setArmed(false);
      onReveal();
      navigator.vibrate?.(35);
    }, 320);
  };

  const movePress = (x: number, y: number) => {
    if (timerRef.current !== null && Math.hypot(x - originRef.current.x, y - originRef.current.y) > 12) cancelPress();
  };

  useEffect(() => cancelPress, []);
  useEffect(() => setTitle(conversation.title || "新对话"), [conversation.title]);

  const touchPoint = (event: TouchEvent) => event.touches[0];

  const remove = async () => {
    setDeleting(true);
    setDeleteError("");
    try {
      await onDelete();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "删除失败");
      setDeleting(false);
    }
  };

  const updateState = async (patch: Partial<Pick<Conversation, "pinned" | "starred" | "archived">>) => {
    setActionBusy(true);
    setDeleteError("");
    try {
      await onState(patch);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "对话状态保存失败");
    } finally {
      setActionBusy(false);
    }
  };

  const rename = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setActionBusy(true);
    setDeleteError("");
    try {
      await onRename(title);
      setRenaming(false);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "重命名失败");
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className={`history-row${revealed ? " delete-revealed" : ""}`}>
      <div className="history-row-main">
        <button
          className={`history-item${active ? " active" : ""}${armed ? " longpress-armed" : ""}`}
          type="button"
          onContextMenu={(event) => event.preventDefault()}
          onTouchStart={(event) => {
            const touch = touchPoint(event);
            if (touch) startPress(touch.clientX, touch.clientY);
          }}
          onTouchMove={(event) => {
            const touch = touchPoint(event);
            if (touch) movePress(touch.clientX, touch.clientY);
          }}
          onTouchEnd={cancelPress}
          onTouchCancel={cancelPress}
          onPointerDown={(event) => {
            if (event.pointerType !== "touch" && event.button === 0) startPress(event.clientX, event.clientY);
          }}
          onPointerMove={(event) => {
            if (event.pointerType !== "touch") movePress(event.clientX, event.clientY);
          }}
          onPointerUp={(event) => {
            if (event.pointerType !== "touch") cancelPress();
          }}
          onPointerCancel={cancelPress}
          onClick={(event) => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              event.preventDefault();
              return;
            }
            onOpen();
          }}
        >
          <span>{conversation.title || "新对话"}</span>
          {conversation.pinned ? <small>置顶</small> : null}
        </button>
        <button className="history-more" type="button" aria-label={`对话操作：${conversation.title || "新对话"}`} aria-expanded={revealed} onClick={onReveal}>•••</button>
      </div>
      {revealed ? (
        <div className="history-delete-panel">
          {renaming ? (
            <form className="history-rename" onSubmit={(event) => void rename(event)}>
              <label><span className="sr-only">对话名称</span><input value={title} maxLength={100} autoFocus onChange={(event) => setTitle(event.target.value)} /></label>
              <button type="submit" disabled={actionBusy || !title.trim()}>保存名称</button>
            </form>
          ) : null}
          <div className="history-state-actions">
            <button type="button" disabled={actionBusy || deleting} onClick={() => setRenaming((current) => !current)}>重命名</button>
            <button type="button" disabled={actionBusy || deleting} onClick={() => void updateState({ pinned: !conversation.pinned })}>{conversation.pinned ? "取消置顶" : "置顶"}</button>
            <button type="button" disabled={actionBusy || deleting} onClick={() => void updateState({ starred: !conversation.starred })}>{conversation.starred ? "取消星标" : "星标"}</button>
            <button type="button" disabled={actionBusy || deleting} onClick={() => void updateState({ archived: !conversation.archived })}>{conversation.archived ? "取消归档" : "归档"}</button>
          </div>
          <button type="button" disabled={deleting} onClick={() => void remove()}>{deleting ? "正在删除…" : "删除这条对话"}</button>
          {deleteError ? <small role="alert">{deleteError}</small> : null}
        </div>
      ) : null}
    </div>
  );
}

export function Sidebar({
  conversations,
  personas,
  personaId,
  currentId,
  query,
  displayName,
  onQueryChange,
  onPersonaChange,
  onNewConversation,
  onOpenConversation,
  onRenameConversation,
  onUpdateConversationState,
  onDeleteConversation,
  onClearPersonaConversations,
  onOpenSettings,
  onOpenSpace,
  onClose,
}: SidebarProps) {
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const grouped = groupConversations(conversations);
  const orderedPersonas = [...personas].sort((left, right) => Number(Boolean(right.config?.pinned)) - Number(Boolean(left.config?.pinned)));

  useEffect(() => {
    if (revealedId && !conversations.some((item) => item.id === revealedId)) setRevealedId(null);
  }, [conversations, revealedId]);

  return (
    <aside className="sidebar" aria-label="Atherloom 侧栏">
      <div className="sidebar-top">
        <button className="brand-button" type="button" onClick={onClose} aria-label="收起侧栏">
          <img src="./app-icon.svg" alt="" />
          <span>Atherloom</span>
        </button>
        <button className="new-chat" type="button" onClick={onNewConversation}>
          <PlusIcon />
          新对话
        </button>
        <nav className="sidebar-feature-list" aria-label="功能空间">
          <button type="button" onClick={() => onOpenSpace("favorites")}><span aria-hidden="true">☆</span>珍藏</button>
          <button type="button" onClick={() => onOpenSpace("life")}><span aria-hidden="true">▥</span>生活簿</button>
          <button type="button" onClick={() => onOpenSpace("correspondence")}><span aria-hidden="true">✉</span>往来</button>
          <details className="sidebar-hub">
            <summary><span aria-hidden="true">⌘</span><strong>共创空间</strong><i aria-hidden="true">⌄</i></summary>
            <div className="sidebar-hub-panel">
              <button type="button" onClick={() => onOpenSpace("reading")}><span>▤</span><span><strong>一起读书</strong><small>书签、批注与 AI 陪读</small></span></button>
              <button type="button" onClick={() => onOpenSpace("cinema")}><span>▷</span><span><strong>一起看电影</strong><small>本地影片与字幕陪看</small></span></button>
              <button type="button" onClick={() => onOpenSpace("listening")}><span>♪</span><span><strong>一起听歌</strong><small>本地音频、歌词与陪听</small></span></button>
              <button type="button" onClick={() => onOpenSpace("roleplay")}><span>⌘</span><span><strong>角色剧场</strong><small>旁白、世界书与故事存档</small></span></button>
            </div>
          </details>
          <details className="sidebar-hub">
            <summary><span aria-hidden="true">◇</span><strong>日记与留言</strong><i aria-hidden="true">⌄</i></summary>
            <div className="sidebar-hub-panel">
              <button type="button" onClick={() => onOpenSpace("journal")}><span>▱</span><span><strong>日记</strong><small>私人、共享与 AI 日记</small></span></button>
              <button type="button" onClick={() => onOpenSpace("board")}><span>□</span><span><strong>留言板</strong><small>写给当前人格的便利贴</small></span></button>
              <button type="button" onClick={() => onOpenSpace("dream")}><span>☾</span><span><strong>梦库</strong><small>做梦、隔离与认领梦境</small></span></button>
            </div>
          </details>
        </nav>
      </div>

      <nav className="sidebar-personas" aria-label="人格工作区">
        <button type="button" className={personaId === null ? "active" : ""} aria-pressed={personaId === null} onClick={() => onPersonaChange(null)} title="默认空间">
          <span aria-hidden="true">A</span><small>默认</small>
        </button>
        {orderedPersonas.map((persona) => (
          <button type="button" className={persona.id === personaId ? "active" : ""} aria-pressed={persona.id === personaId} onClick={() => onPersonaChange(persona.id)} title={persona.name} key={persona.id}>
            <span aria-hidden="true">{persona.name.slice(0, 1).toUpperCase()}</span><small>{persona.name}</small>
          </button>
        ))}
      </nav>

      <label className="sidebar-search">
        <SearchIcon />
        <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索当前人格的对话" aria-label="搜索当前人格的对话" />
      </label>

      <nav className="history" aria-label="历史对话">
        {grouped.map(([label, items]) => (
          <section className="history-group" key={label}>
            <h2>{label}</h2>
            {items.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                active={conversation.id === currentId}
                revealed={conversation.id === revealedId}
                onOpen={() => onOpenConversation(conversation.id)}
                onReveal={() => setRevealedId((current) => current === conversation.id ? null : conversation.id)}
                onRename={(title) => onRenameConversation(conversation.id, title)}
                onState={(patch) => onUpdateConversationState(conversation.id, patch)}
                onDelete={() => onDeleteConversation(conversation.id)}
              />
            ))}
          </section>
        ))}
        {!conversations.length ? <p className="sidebar-empty">当前人格还没有对话</p> : null}
        {conversations.length ? <button className="clear-persona-chats" type="button" onClick={() => {
          if (!window.confirm(`清空当前人格的全部 ${conversations.length} 条对话？聊天正文、回答版本和对应珍藏会一并删除，其他人格不受影响。`)) return;
          void onClearPersonaConversations().catch((error) => window.alert(error instanceof Error ? error.message : "清空失败"));
        }}>清空当前人格全部对话（{conversations.length}）</button> : null}
      </nav>

      <button className="profile-row" type="button" onClick={onOpenSettings} aria-label="打开设置">
        <span className="avatar">{displayName ? displayName.slice(0, 1).toUpperCase() : "·"}</span>
        <span className="profile-copy"><strong>{displayName || "设置用户名"}</strong><small>线路、人格、备份与外观</small></span>
        <span aria-hidden="true">•••</span>
      </button>
    </aside>
  );
}
