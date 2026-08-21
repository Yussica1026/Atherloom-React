import { useEffect, useMemo, useRef, useState } from "react";
import { getApiBase, setApiBase } from "../adapters/fastapi/client";
import { MenuIcon, SparkIcon } from "../components/Icons";
import { isThemeName, type ThemeName } from "../domain/types";
import { Composer } from "../features/chat/Composer";
import { MessageList } from "../features/chat/MessageList";
import { SettingsPanel } from "../features/settings/SettingsPanel";
import { Sidebar } from "../features/shell/Sidebar";
import { useWorkspace } from "../features/workspace/useWorkspace";
import "./styles.css";

const themeKey = "atherloom-react:theme";

function draftKey(conversationId: string | null, personaId: string | null) {
  return `atherloom-react:draft:${personaId || "__default__"}:${conversationId || "__new__"}`;
}

export default function App() {
  const workspace = useWorkspace();
  const [query, setQuery] = useState("");
  const [searchResultIds, setSearchResultIds] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeName>(() => {
    const stored = localStorage.getItem(themeKey);
    return isThemeName(stored) ? stored : "system";
  });
  const chatRef = useRef<HTMLElement>(null);
  const nearBottomRef = useRef(true);

  useEffect(() => {
    localStorage.setItem(themeKey, theme);
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      if (theme === "system") delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = theme;
      const color = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#f7f6f2";
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", color);
    };
    applyTheme();
    if (theme === "system") colorScheme.addEventListener("change", applyTheme);
    return () => colorScheme.removeEventListener("change", applyTheme);
  }, [theme]);

  useEffect(() => {
    const container = chatRef.current;
    if (!container || !nearBottomRef.current) return;
    requestAnimationFrame(() => container.scrollTo({ top: container.scrollHeight, behavior: workspace.busy ? "auto" : "smooth" }));
  }, [workspace.messages, workspace.busy]);

  useEffect(() => {
    setDraft(localStorage.getItem(draftKey(workspace.currentId, workspace.personaId)) || "");
  }, [workspace.currentId, workspace.personaId]);

  useEffect(() => {
    const normalized = query.trim();
    if (!normalized) {
      setSearchResultIds([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void workspace.searchConversations(normalized).then((items) => {
        if (active) setSearchResultIds(items.map((item) => item.id));
      }).catch(() => {
        if (active) setSearchResultIds([]);
      });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, workspace.personaId, workspace.searchConversations]);

  const conversations = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    if (!normalized) return workspace.conversations;
    const remote = new Set(searchResultIds);
    return workspace.conversations.filter((conversation) => remote.has(conversation.id) || conversation.title.toLocaleLowerCase("zh-CN").includes(normalized));
  }, [query, searchResultIds, workspace.conversations]);

  const openConversation = async (id: string) => {
    await workspace.openConversation(id);
    setSidebarOpen(false);
  };

  const newConversation = async () => {
    try {
      await workspace.createConversation();
      setDraft("");
      setSidebarOpen(false);
    } catch {
      setSettingsOpen(true);
    }
  };

  const send = async () => {
    const content = draft;
    if (!content.trim()) return;
    const storageKey = draftKey(workspace.currentId, workspace.personaId);
    localStorage.removeItem(storageKey);
    setDraft("");
    try {
      await workspace.send(content);
    } catch {
      setDraft(content);
      localStorage.setItem(storageKey, content);
      setSettingsOpen(true);
    }
  };

  const changeDraft = (value: string) => {
    setDraft(value);
    const storageKey = draftKey(workspace.currentId, workspace.personaId);
    if (value) localStorage.setItem(storageKey, value); else localStorage.removeItem(storageKey);
  };

  const hasConversationContent = Boolean(workspace.messages.length);

  return (
    <div className={`app-shell${sidebarOpen ? " sidebar-open" : ""}`}>
      <Sidebar
        conversations={conversations}
        personas={workspace.personas}
        personaId={workspace.personaId}
        currentId={workspace.currentId}
        query={query}
        displayName={String(workspace.settings.display_name || "")}
        onQueryChange={setQuery}
        onPersonaChange={(id) => {
          void workspace.setPersonaId(id);
          setQuery("");
        }}
        onNewConversation={() => void newConversation()}
        onOpenConversation={(id) => void openConversation(id)}
        onRenameConversation={workspace.renameConversation}
        onUpdateConversationState={workspace.updateConversationState}
        onDeleteConversation={workspace.deleteConversation}
        onOpenSettings={() => setSettingsOpen(true)}
        onClose={() => setSidebarOpen(false)}
      />
      <button className="mobile-sidebar-backdrop" aria-label="关闭侧栏" onClick={() => setSidebarOpen(false)} />

      <main className="main">
        <header className="topbar">
          <button className="mobile-menu" type="button" aria-label="打开菜单" onClick={() => setSidebarOpen(true)}><MenuIcon /></button>
          <div className="conversation-title">{workspace.currentConversation?.title || "新对话"}</div>
        </header>

        <section
          className="chat-scroll"
          ref={chatRef}
          onScroll={(event) => {
            const target = event.currentTarget;
            nearBottomRef.current = target.scrollHeight - target.scrollTop - target.clientHeight < 180;
          }}
        >
          {workspace.loading ? <div className="center-state"><span className="loader" /><p>正在打开 Atherloom</p></div> : null}
          {!workspace.loading && workspace.error && !workspace.providers.length && !workspace.conversations.length ? (
            <div className="connection-state">
              <img src="./app-icon.svg" alt="" />
              <h1>本地后端还没有连接</h1>
              <p>{workspace.error}</p>
              <div className="connection-actions">
                <button className="primary-button" onClick={() => setSettingsOpen(true)}>设置后端地址</button>
                <button className="secondary-button" onClick={() => void workspace.retry()}>重新连接</button>
              </div>
            </div>
          ) : null}
          {!workspace.loading && !hasConversationContent && !workspace.error ? (
            <div className="welcome">
              <SparkIcon className="welcome-mark" />
              <h1>今天想聊些什么？</h1>
            </div>
          ) : null}
          {workspace.error && hasConversationContent ? <div className="inline-error">{workspace.error}</div> : null}
          <MessageList messages={workspace.messages} />
        </section>

        <Composer
          value={draft}
          busy={workspace.busy}
          providers={workspace.providers}
          personas={workspace.personas}
          providerId={workspace.providerId}
          personaId={workspace.personaId}
          onChange={changeDraft}
          onProviderChange={(id) => id ? workspace.setProviderId(id) : setSettingsOpen(true)}
          onPersonaChange={(id) => void workspace.setPersonaId(id)}
          onSend={() => void send()}
          onStop={workspace.stop}
        />
      </main>

      <SettingsPanel
        open={settingsOpen}
        providers={workspace.providers}
        personas={workspace.personas}
        worldbooks={workspace.worldbooks}
        settings={workspace.settings}
        theme={theme}
        apiBase={getApiBase()}
        onClose={() => setSettingsOpen(false)}
        onThemeChange={setTheme}
        onApiBaseChange={(value) => {
          setApiBase(value);
          window.location.reload();
        }}
        onCreateProvider={workspace.createProvider}
        onUpdateProvider={workspace.updateProvider}
        onDeleteProvider={workspace.deleteProvider}
        onFetchProviderModels={workspace.fetchProviderModels}
        onTestProvider={workspace.testProvider}
        onCreatePersona={workspace.createPersona}
        onUpdatePersona={workspace.updatePersona}
        onDeletePersona={workspace.deletePersona}
        onSettingsChange={workspace.updateSettings}
        onCreateWorldbook={workspace.createWorldbook}
        onUpdateWorldbook={workspace.updateWorldbook}
        onDeleteWorldbook={workspace.deleteWorldbook}
        onExportBackup={workspace.exportBackup}
        onRestoreBackup={workspace.restoreBackup}
      />
    </div>
  );
}
