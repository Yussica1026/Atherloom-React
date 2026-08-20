import type { Conversation } from "../../domain/types";
import { PlusIcon, SearchIcon } from "../../components/Icons";

interface SidebarProps {
  conversations: Conversation[];
  currentId: string | null;
  query: string;
  displayName: string;
  onQueryChange: (value: string) => void;
  onNewConversation: () => void;
  onOpenConversation: (id: string) => void;
  onOpenSettings: () => void;
  onClose: () => void;
}

function conversationGroup(conversation: Conversation) {
  if (!conversation.updated_at) return "对话";
  const updated = new Date(conversation.updated_at);
  const today = new Date();
  if (updated.toDateString() === today.toDateString()) return "今天";
  const days = Math.floor((today.getTime() - updated.getTime()) / 86_400_000);
  return days <= 7 ? "最近 7 天" : "更早";
}

export function Sidebar({
  conversations,
  currentId,
  query,
  displayName,
  onQueryChange,
  onNewConversation,
  onOpenConversation,
  onOpenSettings,
  onClose,
}: SidebarProps) {
  const grouped = conversations.reduce<Record<string, Conversation[]>>((result, conversation) => {
    const label = conversationGroup(conversation);
    (result[label] ||= []).push(conversation);
    return result;
  }, {});

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
      </div>

      <label className="sidebar-search">
        <SearchIcon />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索对话"
          aria-label="搜索对话"
        />
      </label>

      <nav className="history" aria-label="历史对话">
        {Object.entries(grouped).map(([label, items]) => (
          <section className="history-group" key={label}>
            <h2>{label}</h2>
            {items.map((conversation) => (
              <button
                className={`history-item${conversation.id === currentId ? " active" : ""}`}
                type="button"
                key={conversation.id}
                onClick={() => onOpenConversation(conversation.id)}
              >
                <span>{conversation.title || "新对话"}</span>
                {conversation.pinned ? <small>置顶</small> : null}
              </button>
            ))}
          </section>
        ))}
        {!conversations.length ? <p className="sidebar-empty">还没有对话</p> : null}
      </nav>

      <button className="profile-row" type="button" onClick={onOpenSettings}>
        <span className="avatar">{(displayName || "A").slice(0, 1).toUpperCase()}</span>
        <span className="profile-copy">
          <strong>{displayName || "设置用户名"}</strong>
          <small>线路、人格与外观</small>
        </span>
        <span aria-hidden="true">•••</span>
      </button>
    </aside>
  );
}
