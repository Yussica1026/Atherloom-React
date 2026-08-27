import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  AppSettings,
  BackupBundle,
  BackupPart,
  BackupRestoreResult,
  FontName,
  McpServer,
  McpServerDraft,
  Persona,
  PersonaDraft,
  Provider,
  ProviderDraft,
  ProviderProbeDraft,
  ThemeName,
  Worldbook,
  WorldbookDraft,
} from "../../domain/types";
import { CloseIcon } from "../../components/Icons";
import { BackupSettings } from "./BackupSettings";
import { PersonaSettings } from "./PersonaSettings";
import { ProviderSettings } from "./ProviderSettings";
import { WorldbookSettings } from "./WorldbookSettings";
import { McpSettings } from "./McpSettings";
import { MemorySettings } from "./MemorySettings";
import { SummarySettings } from "./SummarySettings";
import { ToolsSettings } from "./ToolsSettings";
import { RuntimeSettings } from "./RuntimeSettings";
import { VoiceSettings } from "./VoiceSettings";
import { AutomationSettings } from "./AutomationSettings";
import { ExternalImportSettings } from "../imports/ExternalImportSettings";

interface SettingsPanelProps {
  open: boolean;
  initialTab?: SettingsTab;
  providers: Provider[];
  personas: Persona[];
  worldbooks: Worldbook[];
  mcpServers: McpServer[];
  personaId: string | null;
  settings: AppSettings;
  theme: ThemeName;
  font: FontName;
  apiBase: string;
  onClose: () => void;
  onThemeChange: (theme: ThemeName) => void;
  onFontChange: (font: FontName) => void;
  onApiBaseChange: (value: string) => void;
  onSettingsChange: (patch: Partial<AppSettings>) => Promise<AppSettings>;
  onCreateProvider: (draft: ProviderDraft) => Promise<unknown>;
  onUpdateProvider: (id: string, draft: ProviderDraft) => Promise<unknown>;
  onDeleteProvider: (id: string) => Promise<void>;
  onFetchProviderModels: (draft: ProviderProbeDraft) => Promise<{ models: string[] }>;
  onTestProvider: (draft: ProviderDraft) => Promise<{ message: string }>;
  onCreatePersona: (draft: PersonaDraft) => Promise<unknown>;
  onUpdatePersona: (id: string, draft: PersonaDraft) => Promise<unknown>;
  onDeletePersona: (id: string) => Promise<void>;
  onCreateWorldbook: (draft: WorldbookDraft) => Promise<unknown>;
  onUpdateWorldbook: (id: string, draft: WorldbookDraft) => Promise<unknown>;
  onDeleteWorldbook: (id: string) => Promise<void>;
  onExportBackup: (parts: BackupPart[]) => Promise<BackupBundle>;
  onRestoreBackup: (bundle: BackupBundle, parts: BackupPart[]) => Promise<BackupRestoreResult>;
  onCreateMcpServer: (draft: McpServerDraft) => Promise<unknown>;
  onUpdateMcpServer: (id: string, draft: McpServerDraft) => Promise<unknown>;
  onDeleteMcpServer: (id: string) => Promise<void>;
  onTestMcpServer: (draft: McpServerDraft) => Promise<{ message: string }>;
  onRefreshMcpServer: (id: string) => Promise<unknown>;
  onImportCommitted: () => Promise<unknown>;
}

export type SettingsTab = "connection" | "providers" | "personas" | "worldbooks" | "summary" | "memory" | "automation" | "mcp" | "tools" | "voice" | "runtime" | "imports" | "backup" | "appearance";

const tabs: Array<{ value: SettingsTab; label: string }> = [
  { value: "connection", label: "后端连接" },
  { value: "providers", label: "API 与网关" },
  { value: "personas", label: "人格指令" },
  { value: "worldbooks", label: "世界书" },
  { value: "summary", label: "自动总结" },
  { value: "memory", label: "记忆库" },
  { value: "automation", label: "自动唤醒" },
  { value: "mcp", label: "MCP" },
  { value: "tools", label: "工具与权限" },
  { value: "voice", label: "语音通话" },
  { value: "runtime", label: "插件中心" },
  { value: "imports", label: "外部对话导入" },
  { value: "backup", label: "备份与恢复" },
  { value: "appearance", label: "外观" },
];

const themes: Array<{ value: ThemeName; label: string }> = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "water", label: "水色" },
  { value: "mint", label: "薄荷绿" },
  { value: "lilac", label: "丁香" },
  { value: "blush", label: "腮红" },
];

const fonts: Array<{ value: FontName; label: string; detail: string }> = [
  { value: "kai", label: "文楷", detail: "默认 · 随包离线字体" },
  { value: "song", label: "书卷宋", detail: "长文与日记" },
  { value: "hei", label: "清爽黑", detail: "界面清晰紧凑" },
  { value: "fangsong", label: "仿宋", detail: "更像纸本文稿" },
  { value: "system", label: "系统默认", detail: "跟随设备字体" },
];

export function SettingsPanel({
  open,
  initialTab = "providers",
  providers,
  personas,
  worldbooks,
  mcpServers,
  personaId,
  settings,
  theme,
  font,
  apiBase,
  onClose,
  onThemeChange,
  onFontChange,
  onApiBaseChange,
  onSettingsChange,
  onCreateProvider,
  onUpdateProvider,
  onDeleteProvider,
  onFetchProviderModels,
  onTestProvider,
  onCreatePersona,
  onUpdatePersona,
  onDeletePersona,
  onCreateWorldbook,
  onUpdateWorldbook,
  onDeleteWorldbook,
  onExportBackup,
  onRestoreBackup,
  onCreateMcpServer,
  onUpdateMcpServer,
  onDeleteMcpServer,
  onTestMcpServer,
  onRefreshMcpServer,
  onImportCommitted,
}: SettingsPanelProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [connectionStatus, setConnectionStatus] = useState("");
  const [apiBaseDraft, setApiBaseDraft] = useState(apiBase);
  const [displayNameDraft, setDisplayNameDraft] = useState(String(settings.display_name || ""));
  const [appearanceStatus, setAppearanceStatus] = useState("");
  const navRef = useRef<HTMLElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (open) {
      setTab(initialTab);
      setApiBaseDraft(apiBase);
      setDisplayNameDraft(String(settings.display_name || ""));
      setAppearanceStatus("");
    }
  }, [apiBase, initialTab, open]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const layer = layerRef.current;
    const siblings = layer?.parentElement ? Array.from(layer.parentElement.children).filter((item) => item !== layer) as HTMLElement[] : [];
    const inertState = siblings.map((item) => [item, item.hasAttribute("inert")] as const);
    siblings.forEach((item) => item.setAttribute("inert", ""));
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') || []).filter((item) => !item.hasAttribute("hidden") && item.getClientRects().length > 0);
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
      window.removeEventListener("keydown", handleKey);
      inertState.forEach(([item, wasInert]) => wasInert ? item.setAttribute("inert", "") : item.removeAttribute("inert"));
      const fallback = previousFocus?.closest(".sidebar") && window.matchMedia("(max-width: 760px)").matches ? document.querySelector<HTMLElement>(".mobile-menu") : previousFocus;
      fallback?.focus();
    };
  }, [initialTab, open]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => navRef.current?.querySelector<HTMLElement>("button.active")?.scrollIntoView({ block: "nearest", inline: "center" }));
    return () => window.cancelAnimationFrame(frame);
  }, [open, tab]);

  useEffect(() => {
    if (!open || tab !== initialTab) return;
    const frame = window.requestAnimationFrame(() => {
      const target = tab === "appearance" ? panelRef.current?.querySelector<HTMLInputElement>(".appearance-name-editor input") : navRef.current?.querySelector<HTMLElement>("button.active");
      (target || panelRef.current?.querySelector<HTMLElement>("button"))?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialTab, open, tab]);

  if (!open) return null;

  const submitConnection = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setConnectionStatus("正在保存后端地址…");
    try {
      onApiBaseChange(apiBaseDraft);
      setConnectionStatus("后端地址已保存");
    } catch (error) {
      setConnectionStatus(error instanceof Error ? error.message : "后端地址保存失败");
    }
  };

  return (
    <div ref={layerRef} className="dialog-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={panelRef} className="settings-panel" role="dialog" aria-modal="true" aria-label="设置">
        <header className="settings-header">
          <div><span>LOCAL WORKSPACE</span><h2>设置</h2></div>
          <button type="button" onClick={onClose} aria-label="关闭设置"><CloseIcon /></button>
        </header>
        <div className="settings-layout">
          <nav ref={navRef} className="settings-nav" aria-label="设置分类">
            {tabs.map((item) => <button type="button" className={tab === item.value ? "active" : ""} aria-current={tab === item.value ? "page" : undefined} onClick={() => setTab(item.value)} key={item.value}>{item.label}</button>)}
          </nav>
          <div className="settings-content">
            <div className={`runtime-mode-banner${apiBase ? " connected" : " local"}`}>
              <div>
                <strong>{apiBase ? "FastAPI 连接模式" : "Android 本机模式"}</strong>
                <small>{apiBase ? `数据保存到 ${apiBase}` : "设置、人格、世界书和聊天保存在本机；API Key 使用 Android 加密存储。"}</small>
              </div>
              <button type="button" onClick={() => setTab("connection")}>{apiBase ? "更改连接" : "连接服务器"}</button>
            </div>
            {tab === "connection" ? <section className="settings-section settings-feature">
              <div className="section-heading"><h3>后端连接</h3><p>Android 留空即使用本机模式；需要连接电脑或服务器时再填写 FastAPI 地址。</p></div>
              <form className="settings-form one-column settings-edit-card" onSubmit={submitConnection}>
                <label>FastAPI 根地址<input name="api_base" inputMode="url" value={apiBaseDraft} onChange={(event) => setApiBaseDraft(event.target.value)} placeholder="http://192.168.1.20:8876" /></label>
                <p className="form-hint">清空后保存会切回 Android 本机模式。连接服务器时，手机与电脑需要能够互相访问；公网应使用 HTTPS。</p>
                <p className="form-status" aria-live="polite">{connectionStatus}</p>
                <div className="form-actions"><button className="primary-button">{apiBaseDraft.trim() ? "保存并重新连接" : "启用本机模式"}</button></div>
              </form>
            </section> : null}

            {tab === "providers" ? <ProviderSettings
              providers={providers}
              visionProviderId={String(settings.vision_provider_id || "")}
              onVisionProviderChange={(id) => onSettingsChange({ vision_provider_id: id })}
              onCreate={onCreateProvider}
              onUpdate={onUpdateProvider}
              onDelete={onDeleteProvider}
              onFetchModels={onFetchProviderModels}
              onTest={onTestProvider}
            /> : null}

            {tab === "personas" ? <PersonaSettings
              personas={personas}
              providers={providers}
              settings={settings}
              onSettingsChange={onSettingsChange}
              onCreate={onCreatePersona}
              onUpdate={onUpdatePersona}
              onDelete={onDeletePersona}
            /> : null}

            {tab === "worldbooks" ? <WorldbookSettings
              worldbooks={worldbooks}
              onCreate={onCreateWorldbook}
              onUpdate={onUpdateWorldbook}
              onDelete={onDeleteWorldbook}
            /> : null}

            {tab === "summary" ? <SummarySettings settings={settings} providers={providers} onSave={onSettingsChange} /> : null}

            {tab === "memory" ? <MemorySettings personaKey={personaId || "__default__"} /> : null}

            {tab === "automation" ? <AutomationSettings personaKey={personaId || "__default__"} personas={personas} providers={providers} connected={Boolean(apiBase)} /> : null}

            {tab === "mcp" ? <McpSettings servers={mcpServers} onCreate={onCreateMcpServer} onUpdate={onUpdateMcpServer} onDelete={onDeleteMcpServer} onTest={onTestMcpServer} onRefresh={onRefreshMcpServer} /> : null}

            {tab === "tools" ? <ToolsSettings settings={settings} providers={providers} onSave={onSettingsChange} /> : null}

            {tab === "voice" ? <VoiceSettings settings={settings} onSave={onSettingsChange} /> : null}

            {tab === "runtime" ? <RuntimeSettings personaKey={personaId || "__default__"} personas={personas} providers={providers} worldbooks={worldbooks} mcpServers={mcpServers} onOpenMemory={() => setTab("memory")} onOpenMcp={() => setTab("mcp")} onOpenTools={() => setTab("tools")} /> : null}

            {tab === "imports" ? <ExternalImportSettings
              personas={personas}
              connected={Boolean(apiBase) || Boolean(window.AtherloomNative && !window.AtherloomNative.getBackendUrl())}
              onOpenConnection={() => setTab("connection")}
              onCreatePersona={onCreatePersona}
              onCommitted={onImportCommitted}
            /> : null}

            {tab === "backup" ? <BackupSettings onExport={onExportBackup} onRestore={onRestoreBackup} /> : null}

            {tab === "appearance" ? <section className="settings-section settings-feature">
              <div className="section-heading"><h3>外观</h3><p>跟随系统保留最初的暖米白与暖黑灰；水色、薄荷、丁香和腮红只是可选配色。</p></div>
              <label className="theme-setting">主题<select aria-label="主题" value={theme} onChange={(event) => onThemeChange(event.target.value as ThemeName)}>{themes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <div className="theme-swatches">{themes.map((item) => <button type="button" key={item.value} aria-pressed={theme === item.value} className={`theme-swatch swatch-${item.value}${theme === item.value ? " active" : ""}`} onClick={() => onThemeChange(item.value)}><span /><strong>{item.label}</strong></button>)}</div>
              <div className="font-setting-card">
                <label>正文字体<select aria-label="正文字体" value={font} onChange={(event) => onFontChange(event.target.value as FontName)}>{fonts.map((item) => <option key={item.value} value={item.value}>{item.label} · {item.detail}</option>)}</select></label>
                <blockquote className="font-preview" data-preview-font={font}><strong>灯下翻开一页，字里仍有风声。</strong><span>聊天、日记、梦境与留言会使用这套字形；按钮和代码保持清晰。</span></blockquote>
              </div>
              <form className="appearance-name-editor" onSubmit={(event) => { event.preventDefault(); const nextName = displayNameDraft.trim(); setAppearanceStatus("正在保存用户名…"); void onSettingsChange({ display_name: nextName }).then((saved) => { if (String(saved.display_name || "") !== nextName) throw new Error("后端没有保存用户名，请更新后端后重试"); setAppearanceStatus("用户名已保存"); }).catch((error) => setAppearanceStatus(error instanceof Error ? error.message : "用户名保存失败")); }}>
                <label>用户名<input maxLength={40} value={displayNameDraft} onChange={(event) => setDisplayNameDraft(event.target.value)} placeholder="输入侧栏显示名称" /></label>
                <button className="primary-button">保存用户名</button>
                <p className="form-status" aria-live="polite">{appearanceStatus}</p>
              </form>
              <div className="appearance-options">
                <label>字体大小 <small>{Math.round(Number(settings.font_scale || 100) > 5 ? Number(settings.font_scale || 100) : Number(settings.font_scale || 1) * 100)}%</small><input type="range" min="85" max="130" step="5" value={Math.round(Number(settings.font_scale || 100) > 5 ? Number(settings.font_scale || 100) : Number(settings.font_scale || 1) * 100)} onChange={(event) => void onSettingsChange({ font_scale: Number(event.target.value) })} /></label>
                <label>消息密度<select defaultValue={String(settings.message_density || "comfortable")} onChange={(event) => void onSettingsChange({ message_density: event.target.value as AppSettings["message_density"] })}><option value="compact">紧凑</option><option value="comfortable">舒适</option><option value="relaxed">宽松</option></select></label>
                <label>流式出字速度<select defaultValue={String(settings.stream_speed || "standard")} onChange={(event) => void onSettingsChange({ stream_speed: event.target.value })}><option value="slow">慢速</option><option value="standard">标准</option><option value="fast">快速</option></select></label>
                <label>代码高亮主题<select defaultValue={String(settings.code_theme || "auto")} onChange={(event) => void onSettingsChange({ code_theme: event.target.value })}><option value="auto">跟随主题</option><option value="light">浅色</option><option value="dark">深色</option><option value="contrast">高对比度</option></select></label>
              </div>
            </section> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
