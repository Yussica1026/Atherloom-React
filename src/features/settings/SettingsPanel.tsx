import { useEffect, useState, type FormEvent } from "react";
import type {
  AppSettings,
  BackupBundle,
  BackupPart,
  BackupRestoreResult,
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

interface SettingsPanelProps {
  open: boolean;
  providers: Provider[];
  personas: Persona[];
  worldbooks: Worldbook[];
  mcpServers: McpServer[];
  personaId: string | null;
  settings: AppSettings;
  theme: ThemeName;
  apiBase: string;
  onClose: () => void;
  onThemeChange: (theme: ThemeName) => void;
  onApiBaseChange: (value: string) => void;
  onSettingsChange: (patch: Partial<AppSettings>) => Promise<unknown>;
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
}

type SettingsTab = "connection" | "providers" | "personas" | "worldbooks" | "summary" | "memory" | "mcp" | "tools" | "runtime" | "backup" | "appearance";

const tabs: Array<{ value: SettingsTab; label: string }> = [
  { value: "connection", label: "后端连接" },
  { value: "providers", label: "API 与网关" },
  { value: "personas", label: "人格指令" },
  { value: "worldbooks", label: "世界书" },
  { value: "summary", label: "自动总结" },
  { value: "memory", label: "记忆库" },
  { value: "mcp", label: "MCP" },
  { value: "tools", label: "工具与权限" },
  { value: "runtime", label: "插件中心" },
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

export function SettingsPanel({
  open,
  providers,
  personas,
  worldbooks,
  mcpServers,
  personaId,
  settings,
  theme,
  apiBase,
  onClose,
  onThemeChange,
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
}: SettingsPanelProps) {
  const [tab, setTab] = useState<SettingsTab>("providers");
  const [connectionStatus, setConnectionStatus] = useState("");
  const [apiBaseDraft, setApiBaseDraft] = useState(apiBase);
  const [displayNameDraft, setDisplayNameDraft] = useState(String(settings.display_name || ""));
  const [appearanceStatus, setAppearanceStatus] = useState("");

  useEffect(() => {
    if (open) {
      setApiBaseDraft(apiBase);
      setDisplayNameDraft(String(settings.display_name || ""));
      setAppearanceStatus("");
    }
  }, [apiBase, open, settings.display_name]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose, open]);

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
    <div className="dialog-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="settings-panel" role="dialog" aria-modal="true" aria-label="设置">
        <header className="settings-header">
          <div><span>LOCAL WORKSPACE</span><h2>设置</h2></div>
          <button type="button" onClick={onClose} aria-label="关闭设置"><CloseIcon /></button>
        </header>
        <div className="settings-layout">
          <nav className="settings-nav" aria-label="设置分类">
            {tabs.map((item) => <button type="button" className={tab === item.value ? "active" : ""} onClick={() => setTab(item.value)} key={item.value}>{item.label}</button>)}
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

            {tab === "mcp" ? <McpSettings servers={mcpServers} onCreate={onCreateMcpServer} onUpdate={onUpdateMcpServer} onDelete={onDeleteMcpServer} onTest={onTestMcpServer} onRefresh={onRefreshMcpServer} /> : null}

            {tab === "tools" ? <ToolsSettings settings={settings} providers={providers} onSave={onSettingsChange} /> : null}

            {tab === "runtime" ? <RuntimeSettings personaKey={personaId || "__default__"} personas={personas} providers={providers} worldbooks={worldbooks} mcpServers={mcpServers} onOpenMemory={() => setTab("memory")} onOpenMcp={() => setTab("mcp")} onOpenTools={() => setTab("tools")} /> : null}

            {tab === "backup" ? <BackupSettings onExport={onExportBackup} onRestore={onRestoreBackup} /> : null}

            {tab === "appearance" ? <section className="settings-section settings-feature">
              <div className="section-heading"><h3>外观</h3><p>跟随系统保留最初的暖米白与暖黑灰；水色、薄荷、丁香和腮红只是可选配色。</p></div>
              <label className="theme-setting">主题<select value={theme} onChange={(event) => onThemeChange(event.target.value as ThemeName)}>{themes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <div className="theme-swatches">{themes.map((item) => <button type="button" key={item.value} className={`theme-swatch swatch-${item.value}${theme === item.value ? " active" : ""}`} onClick={() => onThemeChange(item.value)}><span /><strong>{item.label}</strong></button>)}</div>
              <form className="appearance-name-editor" onSubmit={(event) => { event.preventDefault(); setAppearanceStatus("正在保存用户名…"); void onSettingsChange({ display_name: displayNameDraft.trim() }).then(() => setAppearanceStatus("用户名已保存")).catch((error) => setAppearanceStatus(error instanceof Error ? error.message : "用户名保存失败")); }}>
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
