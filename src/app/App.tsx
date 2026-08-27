import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { fastApi, getApiBase, setApiBase } from "../adapters/fastapi/client";
import { saveFile } from "../adapters/native/files";
import { MenuIcon, SparkIcon } from "../components/Icons";
import { isFontName, isThemeName, type Attachment, type FontName, type Message, type MotivationPayload, type ThemeName } from "../domain/types";
import { Composer } from "../features/chat/Composer";
import { MessageList } from "../features/chat/MessageList";
import { VoiceCall } from "../features/chat/VoiceCall";
import { isOpenGameSessionEffect, parseOpenGameEffect, type OpenGameSessionEffect, type OpenGameSetupEffect } from "../features/games/types";
import { SettingsPanel, type SettingsTab } from "../features/settings/SettingsPanel";
import { Sidebar } from "../features/shell/Sidebar";
import { FeatureHub, type FeatureSpace } from "../features/spaces/FeatureHub";
import { useWorkspace } from "../features/workspace/useWorkspace";
import "./styles.css";

const themeKey = "atherloom-react:theme";
const fontKey = "atherloom-react:font";
const LongWorldHub = lazy(() => import("../features/longworld/LongWorldHub").then((module) => ({ default: module.LongWorldHub })));
const GameHub = lazy(() => import("../features/games/GameHub").then((module) => ({ default: module.GameHub })));
const GameOverlay = lazy(() => import("../features/games/GameOverlay").then((module) => ({ default: module.GameOverlay })));
const driveLabels: Record<string, string> = { connection: "联结", curiosity: "好奇", reflection: "反思", duty: "责任", social: "交流", fatigue: "疲劳", closeness: "亲近", stress: "压力", joy: "愉悦" };

function worldbookSelectionKey(conversationId: string | null) {
  return `atherloom-react:worldbooks:${conversationId || "__new__"}`;
}

function readFile(file: File, mode: "text" | "data") {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error(`无法读取 ${file.name}`));
    reader.onload = () => resolve(String(reader.result || ""));
    if (mode === "text") reader.readAsText(file); else reader.readAsDataURL(file);
  });
}

function draftKey(conversationId: string | null, personaId: string | null) {
  return `atherloom-react:draft:${personaId || "__default__"}:${conversationId || "__new__"}`;
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 70) || "Atherloom-对话";
}

function redactedTranscript(messages: Message[]) {
  const handledParents = new Set<string>();
  const visible = messages.flatMap((message) => {
    if (message.pending || message.error || message.role === "system") return [];
    if (message.role !== "assistant" || !message.parent_message_id) return [message];
    if (handledParents.has(message.parent_message_id)) return [];
    handledParents.add(message.parent_message_id);
    const versions = messages.filter((item) => item.role === "assistant" && item.parent_message_id === message.parent_message_id && !item.pending && !item.error);
    return [versions.find((item) => Boolean(item.selected)) || versions.at(-1) || message];
  });
  const redact = (content: string) => content
    .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, "[已隐藏 API Key]")
    .replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+/gi, "$1[已隐藏]")
    .replace(/((?:api[_ -]?key|token|secret|密码)\s*[:=：]\s*)[^\s,，;；]+/gi, "$1[已隐藏]");
  return visible.map((message) => `## ${message.role === "user" ? "我" : "助手"}\n\n${redact(message.content).trim()}`).join("\n\n---\n\n");
}

export default function App() {
  const workspace = useWorkspace();
  const [query, setQuery] = useState("");
  const [searchResultIds, setSearchResultIds] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentStatus, setAttachmentStatus] = useState("");
  const [selectedWorldbookIds, setSelectedWorldbookIds] = useState<string[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("providers");
  const [featureSpace, setFeatureSpace] = useState<FeatureSpace | null>(null);
  const [activeGame, setActiveGame] = useState<OpenGameSessionEffect | null>(null);
  const [pendingGameSetup, setPendingGameSetup] = useState<OpenGameSetupEffect | null>(null);
  const [callOpen, setCallOpen] = useState(false);
  const [compressOpen, setCompressOpen] = useState(false);
  const [compressRounds, setCompressRounds] = useState(1);
  const [compressProviderId, setCompressProviderId] = useState("");
  const [compressStatus, setCompressStatus] = useState("");
  const [compressBusy, setCompressBusy] = useState(false);
  const [chatStatusOpen, setChatStatusOpen] = useState(false);
  const [motivation, setMotivation] = useState<MotivationPayload | null>(null);
  const [motivationStatus, setMotivationStatus] = useState("");
  const [streamModeStatus, setStreamModeStatus] = useState("");
  const [theme, setTheme] = useState<ThemeName>(() => {
    const stored = localStorage.getItem(themeKey);
    return isThemeName(stored) ? stored : "system";
  });
  const [font, setFont] = useState<FontName>(() => {
    const stored = localStorage.getItem(fontKey);
    return isFontName(stored) ? stored : "kai";
  });
  const chatRef = useRef<HTMLElement>(null);
  const nearBottomRef = useRef(true);
  const typingStartedRef = useRef(0);
  const typingLastRef = useRef(0);

  function openSettings(tab: SettingsTab = "providers") {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }

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
    localStorage.setItem(fontKey, font);
    document.documentElement.dataset.font = font;
  }, [font]);

  useEffect(() => {
    const rawScale = Number(workspace.settings.font_scale || 100);
    const scale = Math.max(0.85, Math.min(1.3, rawScale > 5 ? rawScale / 100 : rawScale));
    document.documentElement.style.setProperty("--font-scale", String(scale));
    document.documentElement.dataset.codeTheme = String(workspace.settings.code_theme || "auto");
  }, [workspace.settings.code_theme, workspace.settings.font_scale]);

  useEffect(() => {
    const pending = workspace.pendingToolEffects[0];
    if (!pending) return;
    workspace.consumeToolEffect(pending.id);
    const effect = parseOpenGameEffect(pending.event.effect);
    if (!effect) return;
    setSidebarOpen(false);
    setSettingsOpen(false);
    setFeatureSpace(isOpenGameSessionEffect(effect) ? null : "games");
    setCallOpen(false);
    setCompressOpen(false);
    setChatStatusOpen(false);
    if (isOpenGameSessionEffect(effect)) {
      setPendingGameSetup(null);
      setActiveGame(effect);
    } else {
      setActiveGame(null);
      setPendingGameSetup(effect);
    }
  }, [workspace.consumeToolEffect, workspace.pendingToolEffects]);

  useEffect(() => {
    const handleBack = (event: Event) => {
      if (activeGame) setActiveGame(null);
      else if (callOpen) setCallOpen(false);
      else if (compressOpen) setCompressOpen(false);
      else if (featureSpace) {
        if (featureSpace === "games") setPendingGameSetup(null);
        setFeatureSpace(null);
      }
      else if (chatStatusOpen) setChatStatusOpen(false);
      else if (settingsOpen) setSettingsOpen(false);
      else if (sidebarOpen) setSidebarOpen(false);
      else return;
      event.preventDefault();
    };
    window.addEventListener("atherloom:back", handleBack);
    return () => window.removeEventListener("atherloom:back", handleBack);
  }, [activeGame, callOpen, chatStatusOpen, compressOpen, featureSpace, settingsOpen, sidebarOpen]);

  useEffect(() => {
    if (!chatStatusOpen) return;
    let active = true;
    setMotivationStatus("正在读取当前人格状态…");
    void fastApi.getMotivation(workspace.personaId || "__default__").then((payload) => {
      if (!active) return;
      setMotivation(payload);
      setMotivationStatus("");
    }).catch((error) => {
      if (!active) return;
      setMotivation(null);
      setMotivationStatus(error instanceof Error ? error.message : "欲望状态读取失败");
    });
    return () => { active = false; };
  }, [chatStatusOpen, workspace.busy, workspace.personaId]);

  useEffect(() => {
    const container = chatRef.current;
    if (!container || !nearBottomRef.current) return;
    requestAnimationFrame(() => container.scrollTo({ top: container.scrollHeight, behavior: workspace.busy ? "auto" : "smooth" }));
  }, [workspace.messages, workspace.busy]);

  useEffect(() => {
    setDraft(localStorage.getItem(draftKey(workspace.currentId, workspace.personaId)) || "");
    setAttachments([]);
    try {
      const stored = JSON.parse(localStorage.getItem(worldbookSelectionKey(workspace.currentId)) || "[]") as unknown;
      setSelectedWorldbookIds(Array.isArray(stored) ? stored.filter((item): item is string => typeof item === "string") : []);
    } catch {
      setSelectedWorldbookIds([]);
    }
  }, [workspace.currentId, workspace.personaId]);

  useEffect(() => {
    if (!attachmentStatus) return;
    const timer = window.setTimeout(() => setAttachmentStatus(""), 6_000);
    return () => window.clearTimeout(timer);
  }, [attachmentStatus]);

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
      openSettings("providers");
    }
  };

  const send = async () => {
    const content = draft.trim() || (attachments.length ? "请查看附件" : "");
    if (!content) return;
    const pendingAttachments = attachments;
    const typingContext = workspace.settings.typing_presence_enabled === false || !typingStartedRef.current ? "" : (() => {
      const seconds = Math.max(1, Math.round((Date.now() - typingStartedRef.current) / 1000));
      const pause = Math.max(0, Math.round((Date.now() - typingLastRef.current) / 1000));
      return `用户本次输入约 ${seconds} 秒，发送前停顿约 ${pause} 秒；未发送任何草稿正文。`;
    })();
    const storageKey = draftKey(workspace.currentId, workspace.personaId);
    localStorage.removeItem(storageKey);
    setDraft("");
    setAttachments([]);
    typingStartedRef.current = 0;
    typingLastRef.current = 0;
    try {
      await workspace.send(content, pendingAttachments, selectedWorldbookIds, typingContext);
    } catch {
      setDraft(content);
      setAttachments(pendingAttachments);
      localStorage.setItem(storageKey, content);
      openSettings("providers");
    }
  };

  const addFiles = async (files: File[]) => {
    setAttachmentStatus("");
    const available = Math.max(0, 8 - attachments.length);
    const accepted = files.slice(0, available);
    const rejected: string[] = [];
    const prepared: Attachment[] = [];
    for (const file of accepted) {
      if (file.size > 12 * 1024 * 1024) {
        rejected.push(`${file.name} 超过 12 MB`);
        continue;
      }
      try {
        const image = file.type.startsWith("image/");
        const text = file.type.startsWith("text/") || /\.(md|txt|json|csv|js|ts|tsx|py|html|css)$/i.test(file.name);
        const pdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
        prepared.push({
          id: crypto.randomUUID?.() || `attachment-${Date.now()}-${Math.random()}`,
          name: file.name,
          mime: file.type || "application/octet-stream",
          kind: image ? "image" : text ? "text" : pdf ? "pdf" : "file",
          data: image || pdf ? await readFile(file, "data") : undefined,
          text: text ? (await readFile(file, "text")).slice(0, 120_000) : undefined,
          size: file.size,
        });
      } catch (error) {
        rejected.push(`${file.name}：${error instanceof Error ? error.message : "读取失败"}`);
      }
    }
    setAttachments((current) => [...current, ...prepared].slice(0, 8));
    if (files.length > available) rejected.push(`一次最多保留 8 个附件`);
    if (rejected.length) setAttachmentStatus(rejected.join("；"));
  };

  const updateWorldbookSelection = (ids: string[]) => {
    const valid = [...new Set(ids)].filter((id) => workspace.worldbooks.some((book) => book.id === id && book.enabled !== false));
    setSelectedWorldbookIds(valid);
    localStorage.setItem(worldbookSelectionKey(workspace.currentId), JSON.stringify(valid));
  };

  const openCompress = () => {
    const available = Math.max(0, workspace.messages.filter((item) => item.role === "user").length - 1);
    setCompressRounds(Math.max(1, Math.min(10, available)));
    setCompressProviderId(workspace.providerId || workspace.providers[0]?.id || "");
    setCompressStatus(available ? `当前最多可压缩约 ${available} 轮，始终保留最近一轮原文。` : "当前没有可压缩的旧轮次。");
    setCompressOpen(true);
  };

  const compressConversation = async () => {
    setCompressBusy(true);
    setCompressStatus("正在整理较早对话，原文暂不改动…");
    try {
      const result = await workspace.compressConversation(compressRounds, compressProviderId);
      setCompressStatus(`已压缩 ${result.rounds} 轮（${result.messages} 条消息），还可继续压缩约 ${result.available_rounds} 轮。`);
    } catch (error) {
      setCompressStatus(`压缩失败：${error instanceof Error ? error.message : "未知错误"}。原文未改动。`);
    } finally {
      setCompressBusy(false);
    }
  };

  const changeDraft = (value: string) => {
    if (value && !typingStartedRef.current) typingStartedRef.current = Date.now();
    if (value) typingLastRef.current = Date.now();
    else {
      typingStartedRef.current = 0;
      typingLastRef.current = 0;
    }
    setDraft(value);
    const storageKey = draftKey(workspace.currentId, workspace.personaId);
    if (value) localStorage.setItem(storageKey, value); else localStorage.removeItem(storageKey);
  };

  const hasConversationContent = Boolean(workspace.messages.length);
  const favoriteMessageIds = useMemo(
    () => new Set(workspace.favorites.filter((item) => (item.owners || []).includes("user")).map((item) => item.source_message_id)),
    [workspace.favorites],
  );
  const currentProvider = workspace.providers.find((item) => item.id === workspace.providerId) || null;
  const prominentDrives = Object.entries(motivation?.state.drives || {}).sort((left, right) => right[1] - left[1]).slice(0, 4);

  const changeStreamMode = async (enabled: boolean) => {
    setStreamModeStatus("正在保存输出方式…");
    try {
      await workspace.setProviderStreamMode(enabled);
      setStreamModeStatus(enabled ? "已切换为流式输出" : "已切换为非流式输出");
    } catch (error) {
      setStreamModeStatus(error instanceof Error ? error.message : "输出方式保存失败");
    }
  };

  const chooseQuestionOption = (question: string, option: string) => {
    const prefix = `关于「${question}」，我的选择是：`;
    const line = `${prefix}${option}`;
    const lines = draft.trim() ? draft.trim().split("\n") : [];
    const existing = lines.findIndex((item) => item.startsWith(prefix));
    if (existing >= 0) lines[existing] = line; else lines.push(line);
    changeDraft(lines.join("\n"));
  };

  const exportConversationMarkdown = async () => {
    const title = workspace.currentConversation?.title || "Atherloom-对话";
    const transcript = redactedTranscript(workspace.messages);
    if (!transcript) {
      setAttachmentStatus("当前没有可导出的消息。");
      return;
    }
    try {
      const markdown = `# ${title}\n\n> 由 Atherloom 导出；系统提示、思考过程、附件原始数据和密钥已排除。\n\n${transcript}\n`;
      const result = await saveFile(`${safeFileName(title)}.md`, new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
      setAttachmentStatus(result);
    } catch (error) {
      setAttachmentStatus(`导出失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  };

  return (
    <div className={`app-shell density-${workspace.settings.message_density || "comfortable"}${sidebarOpen ? " sidebar-open" : ""}`}>
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
        onClearPersonaConversations={workspace.clearPersonaConversations}
        onOpenSettings={() => {
          setSidebarOpen(false);
          openSettings("appearance");
        }}
        onOpenSpace={(space) => {
          setFeatureSpace(space);
          setSidebarOpen(false);
        }}
        onClose={() => setSidebarOpen(false)}
      />
      <button className="mobile-sidebar-backdrop" aria-label="关闭侧栏" onClick={() => setSidebarOpen(false)} />

      <main className="main">
        <header className="topbar">
          <button className="mobile-menu" type="button" aria-label="打开菜单" onClick={() => setSidebarOpen(true)}><MenuIcon /></button>
          <div className="conversation-title"><strong>{workspace.currentConversation?.title || "新对话"}</strong><small>{workspace.busy ? "正在生成" : "就绪"} · {workspace.personas.find((item) => item.id === workspace.personaId)?.name || "默认人格"} · {workspace.providers.find((item) => item.id === workspace.providerId)?.model || "未选模型"}</small></div>
          <div className="topbar-actions"><button className="topbar-action" type="button" title="导出脱敏 Markdown" aria-label="导出脱敏 Markdown" onClick={() => void exportConversationMarkdown()}>↓</button><button className="topbar-action" type="button" title="主动压缩对话" aria-label="主动压缩对话" onClick={openCompress}>⇲</button><button className={`topbar-action${chatStatusOpen ? " active" : ""}`} type="button" title="欲望与聊天状态" aria-label="打开或关闭欲望与聊天状态" aria-expanded={chatStatusOpen} onClick={() => setChatStatusOpen((current) => !current)}>◌</button><button className="topbar-action" type="button" title="语音通话" aria-label="语音通话" onClick={() => setCallOpen(true)}>♩</button></div>
        </header>

        {chatStatusOpen ? <aside className="chat-status-card" aria-label="欲望与聊天状态">
          <header><div><span>INNER STATE</span><strong>{workspace.personas.find((item) => item.id === workspace.personaId)?.name || "默认人格"} 的状态</strong></div><button type="button" aria-label="关闭欲望状态" onClick={() => setChatStatusOpen(false)}>×</button></header>
          {prominentDrives.length ? <div className="chat-drive-grid">{prominentDrives.map(([key, value]) => <article key={key}><span>{motivation?.drives?.[key]?.label || driveLabels[key] || key}</span><strong>{Number(value).toFixed(1)}</strong><i style={{ "--drive-value": `${Math.max(0, Math.min(100, Number(value)))}%` } as CSSProperties} /></article>)}</div> : <p className="chat-status-message">{motivationStatus || "当前还没有欲望状态数据"}</p>}
          <div className="chat-status-facts"><span><small>心跳</small><strong>{motivation?.state.tick_count || 0} 次</strong></span><span><small>模型</small><strong>{currentProvider?.model || "未选择"}</strong></span><span><small>输出</small><strong>{currentProvider?.stream_enabled === false ? "非流式" : "流式"}</strong></span><span><small>思考</small><strong>{currentProvider?.thinking_enabled === false ? "关闭" : "开启"}</strong></span></div>
          <div className="stream-mode-switch" aria-label="输出方式"><button type="button" className={currentProvider?.stream_enabled !== false ? "active" : ""} disabled={!currentProvider || workspace.busy} onClick={() => void changeStreamMode(true)}>流式</button><button type="button" className={currentProvider?.stream_enabled === false ? "active" : ""} disabled={!currentProvider || workspace.busy} onClick={() => void changeStreamMode(false)}>非流式</button></div>
          <p className="chat-status-message" aria-live="polite">{streamModeStatus || motivationStatus}</p>
        </aside> : null}

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
                <button className="primary-button" onClick={() => openSettings("connection")}>设置后端地址</button>
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
          <MessageList
            messages={workspace.messages}
            favoriteMessageIds={favoriteMessageIds}
            busy={workspace.busy}
            onFavorite={workspace.toggleFavorite}
            onEdit={workspace.editMessage}
            onRegenerate={workspace.regenerateMessage}
            onSelectVersion={workspace.selectMessageVersion}
            onBranch={workspace.branchFromMessage}
            onDeleteVersion={workspace.deleteMessageVersion}
            onDeleteAllVersions={workspace.deleteAllMessageVersions}
            onQuestionOption={chooseQuestionOption}
          />
        </section>

        {workspace.settings.typing_presence_enabled !== false && draft.trim() ? <div className="typing-presence">正在向 {workspace.personas.find((item) => item.id === workspace.personaId)?.name || "当前人格"} 共享输入状态（不会发送未完成正文）</div> : null}
        <Composer
          value={draft}
          busy={workspace.busy}
          attachments={attachments}
          providers={workspace.providers}
          personas={workspace.personas}
          worldbooks={workspace.worldbooks}
          selectedWorldbookIds={selectedWorldbookIds}
          quickPhrases={workspace.personas.find((item) => item.id === workspace.personaId)?.config?.quick_phrases || []}
          providerId={workspace.providerId}
          personaId={workspace.personaId}
          onChange={changeDraft}
          onProviderChange={(value) => value ? void workspace.selectProviderModel(value) : openSettings("providers")}
          onPersonaChange={(id) => void workspace.setPersonaId(id)}
          onAddFiles={addFiles}
          onRemoveAttachment={(id) => setAttachments((current) => current.filter((item) => item.id !== id))}
          onWorldbookSelectionChange={updateWorldbookSelection}
          onSend={() => void send()}
          onStop={workspace.stop}
        />
        {attachmentStatus ? <div className="composer-status" role="alert"><span>{attachmentStatus}</span><button type="button" aria-label="关闭提示" onClick={() => setAttachmentStatus("")}>×</button></div> : null}
      </main>

      {compressOpen ? (
        <div className="dialog-layer compact-dialog-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setCompressOpen(false)}>
          <section className="compact-dialog" role="dialog" aria-modal="true" aria-labelledby="compress-title">
            <header><div><span>CONTEXT</span><h2 id="compress-title">主动压缩对话</h2></div><button type="button" aria-label="关闭" onClick={() => setCompressOpen(false)}>×</button></header>
            <label>压缩线路<select value={compressProviderId} onChange={(event) => setCompressProviderId(event.target.value)}>{workspace.providers.filter((item) => item.enabled !== false).map((provider) => <option value={provider.id} key={provider.id}>{provider.name} · {provider.model}</option>)}</select></label>
            <label>压缩较早轮数<input type="number" min="1" max={Math.max(1, workspace.messages.filter((item) => item.role === "user").length - 1)} value={compressRounds} onChange={(event) => setCompressRounds(Math.max(1, Number(event.target.value) || 1))} /></label>
            <p className="form-status" aria-live="polite">{compressStatus}</p>
            <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setCompressOpen(false)}>关闭</button><button type="button" className="primary-button" disabled={compressBusy || !compressProviderId || workspace.messages.filter((item) => item.role === "user").length < 2} onClick={() => void compressConversation()}>{compressBusy ? "正在压缩…" : "开始压缩"}</button></div>
          </section>
        </div>
      ) : null}

      <SettingsPanel
        open={settingsOpen}
        initialTab={settingsTab}
        providers={workspace.providers}
        personas={workspace.personas}
        worldbooks={workspace.worldbooks}
        mcpServers={workspace.mcpServers}
        personaId={workspace.personaId}
        settings={workspace.settings}
        theme={theme}
        font={font}
        apiBase={getApiBase()}
        onClose={() => setSettingsOpen(false)}
        onThemeChange={setTheme}
        onFontChange={setFont}
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
        onCreateMcpServer={workspace.createMcpServer}
        onUpdateMcpServer={workspace.updateMcpServer}
        onDeleteMcpServer={workspace.deleteMcpServer}
        onTestMcpServer={workspace.testMcpServer}
        onRefreshMcpServer={workspace.refreshMcpServer}
        onImportCommitted={workspace.retry}
      />
      {featureSpace === "longworld" ? <Suspense fallback={<div className="dialog-layer"><section className="compact-dialog"><p>正在打开长期世界引擎…</p></section></div>}><LongWorldHub
          personas={workspace.personas}
          providers={workspace.providers}
          playerDisplayName={String(workspace.settings.display_name || "")}
          onClose={() => setFeatureSpace(null)}
          onOpenConnectionSettings={() => {
            setFeatureSpace(null);
            openSettings("connection");
          }}
        /></Suspense> : null}
      {featureSpace === "games" ? <Suspense fallback={<div className="dialog-layer"><section className="compact-dialog"><p>正在打开休闲游戏…</p></section></div>}><GameHub
        conversationId={pendingGameSetup?.conversation_id || workspace.currentId}
        conversationTitle={workspace.conversations.find((item) => item.id === pendingGameSetup?.conversation_id)?.title || workspace.currentConversation?.title || "当前对话"}
        personaId={pendingGameSetup?.persona_id || workspace.currentConversation?.persona_id || workspace.personaId || "__default__"}
        personaName={workspace.personas.find((item) => item.id === (pendingGameSetup?.persona_id || workspace.currentConversation?.persona_id || workspace.personaId))?.name || "默认人格"}
        requestedGameId={pendingGameSetup?.game_id || null}
        onClose={() => {
          setPendingGameSetup(null);
          setFeatureSpace(null);
        }}
        onOpenGame={(effect) => {
          setPendingGameSetup(null);
          setFeatureSpace(null);
          setActiveGame(effect);
        }}
      /></Suspense> : null}
      <FeatureHub
        open={featureSpace === "longworld" || featureSpace === "games" ? null : featureSpace}
        personaId={workspace.personaId}
        personas={workspace.personas}
        providers={workspace.providers}
        worldbooks={workspace.worldbooks}
        favorites={workspace.favorites}
        onClose={() => setFeatureSpace(null)}
        onChangeSpace={setFeatureSpace}
        onOpenSettingsTab={(tab) => {
          setFeatureSpace(null);
          openSettings(tab);
        }}
        onOpenFavorite={async (conversationId) => {
          await workspace.openConversation(conversationId);
          setFeatureSpace(null);
        }}
        onUnfavorite={workspace.toggleFavorite}
        onSendToAssistant={async (content) => {
          try {
            return await workspace.send(content, [], selectedWorldbookIds);
          } catch {
            openSettings("providers");
            return "";
          }
        }}
        onGenerateBookText={workspace.generateBookText}
        onGeneratePrivateJournal={workspace.generatePrivateJournal}
        onGeneratePrivateDream={workspace.generatePrivateDream}
      />
      <VoiceCall
        open={callOpen}
        personaKey={workspace.personaId || "__default__"}
        personaName={workspace.personas.find((item) => item.id === workspace.personaId)?.name || "当前人格"}
        voiceConfig={workspace.settings.voice_config}
        onClose={() => setCallOpen(false)}
        onOpenSettings={() => { setCallOpen(false); openSettings("voice"); }}
        onTranscript={async (content) => (await workspace.send(content, [], selectedWorldbookIds)) || ""}
        onCancelTranscript={workspace.stop}
      />
      {activeGame ? <Suspense fallback={<div className="dialog-layer"><section className="compact-dialog" role="status"><p>正在铺开棋盘…</p></section></div>}><GameOverlay
        key={activeGame.session_id}
        effect={activeGame}
        personaName={workspace.personas.find((item) => item.id === activeGame.persona_id)?.name || "默认人格"}
        conversationTitle={workspace.conversations.find((item) => item.id === activeGame.conversation_id)?.title || workspace.currentConversation?.title || "原对话"}
        onClose={() => setActiveGame(null)}
        onConversationUpdated={workspace.refreshConversationMessages}
      /></Suspense> : null}
    </div>
  );
}
