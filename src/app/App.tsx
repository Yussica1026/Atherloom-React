import { useEffect, useMemo, useRef, useState } from "react";
import { MenuIcon, SettingsIcon, SparkIcon } from "../components/Icons";
import { isThemeName, type ThemeName } from "../domain/types";
import { Composer } from "../features/chat/Composer";
import { MessageList } from "../features/chat/MessageList";
import { SettingsPanel } from "../features/settings/SettingsPanel";
import { Sidebar } from "../features/shell/Sidebar";
import { useWorkspace } from "../features/workspace/useWorkspace";
import "./styles.css";

const themeKey = "atherloom-react:theme";

export default function App() {
  const workspace = useWorkspace();
  const [query, setQuery] = useState("");
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

  const conversations = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    if (!normalized) return workspace.conversations;
    return workspace.conversations.filter((conversation) => conversation.title.toLocaleLowerCase("zh-CN").includes(normalized));
  }, [query, workspace.conversations]);

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
    setDraft("");
    try {
      await workspace.send(content);
    } catch {
      setDraft(content);
      setSettingsOpen(true);
    }
  };

  const hasConversationContent = Boolean(workspace.currentId || workspace.messages.length);

  return (
    <div className={`app-shell${sidebarOpen ? " sidebar-open" : ""}`}>
      <Sidebar
        conversations={conversations}
        currentId={workspace.currentId}
        query={query}
        displayName={String(workspace.settings.display_name || "")}
        onQueryChange={setQuery}
        onNewConversation={() => void newConversation()}
        onOpenConversation={(id) => void openConversation(id)}
        onOpenSettings={() => setSettingsOpen(true)}
        onClose={() => setSidebarOpen(false)}
      />
      <button className="mobile-sidebar-backdrop" aria-label="关闭侧栏" onClick={() => setSidebarOpen(false)} />

      <main className="main">
        <header className="topbar">
          <button className="mobile-menu" type="button" aria-label="打开菜单" onClick={() => setSidebarOpen(true)}><MenuIcon /></button>
          <div className="conversation-title">{workspace.currentConversation?.title || "新对话"}</div>
          <button className="icon-button" type="button" aria-label="打开设置" onClick={() => setSettingsOpen(true)}><SettingsIcon /></button>
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
              <img src="/app-icon.svg" alt="" />
              <h1>本地后端还没有连接</h1>
              <p>{workspace.error}</p>
              <button className="primary-button" onClick={() => void workspace.retry()}>重新连接</button>
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
          onChange={setDraft}
          onProviderChange={(id) => id ? workspace.setProviderId(id) : setSettingsOpen(true)}
          onPersonaChange={workspace.setPersonaId}
          onSend={() => void send()}
          onStop={workspace.stop}
        />
      </main>

      <SettingsPanel
        open={settingsOpen}
        providers={workspace.providers}
        personas={workspace.personas}
        theme={theme}
        onClose={() => setSettingsOpen(false)}
        onThemeChange={setTheme}
        onCreateProvider={workspace.createProvider}
        onCreatePersona={workspace.createPersona}
      />
    </div>
  );
}
