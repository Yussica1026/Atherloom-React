import { useEffect, useState, type FormEvent } from "react";
import type {
  AppSettings,
  BackupBundle,
  BackupPart,
  BackupRestoreResult,
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

interface SettingsPanelProps {
  open: boolean;
  providers: Provider[];
  personas: Persona[];
  worldbooks: Worldbook[];
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
}

type SettingsTab = "connection" | "providers" | "personas" | "worldbooks" | "backup" | "appearance";

const tabs: Array<{ value: SettingsTab; label: string }> = [
  { value: "connection", label: "后端连接" },
  { value: "providers", label: "API 与网关" },
  { value: "personas", label: "人格指令" },
  { value: "worldbooks", label: "世界书" },
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
}: SettingsPanelProps) {
  const [tab, setTab] = useState<SettingsTab>("providers");
  const [connectionStatus, setConnectionStatus] = useState("");
  const [apiBaseDraft, setApiBaseDraft] = useState(apiBase);

  useEffect(() => {
    if (open) setApiBaseDraft(apiBase);
  }, [apiBase, open]);

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

            {tab === "backup" ? <BackupSettings onExport={onExportBackup} onRestore={onRestoreBackup} /> : null}

            {tab === "appearance" ? <section className="settings-section settings-feature">
              <div className="section-heading"><h3>外观</h3><p>跟随系统保留最初的暖米白与暖黑灰；水色、薄荷、丁香和腮红只是可选配色。</p></div>
              <label className="theme-setting">主题<select value={theme} onChange={(event) => onThemeChange(event.target.value as ThemeName)}>{themes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <div className="theme-swatches">{themes.map((item) => <button type="button" key={item.value} className={`theme-swatch swatch-${item.value}${theme === item.value ? " active" : ""}`} onClick={() => onThemeChange(item.value)}><span /><strong>{item.label}</strong></button>)}</div>
            </section> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
