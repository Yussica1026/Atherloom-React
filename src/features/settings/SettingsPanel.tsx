import { useEffect, useState, type FormEvent } from "react";
import type { Persona, PersonaDraft, Provider, ProviderDraft, ThemeName } from "../../domain/types";
import { CloseIcon } from "../../components/Icons";

interface SettingsPanelProps {
  open: boolean;
  providers: Provider[];
  personas: Persona[];
  theme: ThemeName;
  apiBase: string;
  onClose: () => void;
  onThemeChange: (theme: ThemeName) => void;
  onApiBaseChange: (value: string) => void;
  onCreateProvider: (draft: ProviderDraft) => Promise<void>;
  onCreatePersona: (draft: PersonaDraft) => Promise<void>;
}

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
  theme,
  apiBase,
  onClose,
  onThemeChange,
  onApiBaseChange,
  onCreateProvider,
  onCreatePersona,
}: SettingsPanelProps) {
  const [tab, setTab] = useState<"connection" | "providers" | "personas" | "appearance">("connection");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [apiBaseDraft, setApiBaseDraft] = useState(apiBase);

  useEffect(() => {
    if (open) setApiBaseDraft(apiBase);
  }, [apiBase, open]);

  if (!open) return null;

  const submitConnection = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("正在保存后端地址…");
    try {
      onApiBaseChange(apiBaseDraft);
      setStatus("后端地址已保存");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "后端地址保存失败");
    }
  };

  const submitProvider = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setSaving(true);
    setStatus("正在保存线路…");
    try {
      await onCreateProvider({
        name: String(data.get("name") || "").trim(),
        protocol: String(data.get("protocol") || "openai"),
        base_url: String(data.get("base_url") || "").trim(),
        api_key: String(data.get("api_key") || "").trim(),
        model: String(data.get("model") || "").trim(),
        enabled: true,
        custom_headers: "{}",
        prompt_cache: true,
      });
      form.reset();
      setStatus("线路已保存");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "线路保存失败");
    } finally {
      setSaving(false);
    }
  };

  const submitPersona = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setSaving(true);
    setStatus("正在保存人格…");
    try {
      await onCreatePersona({
        name: String(data.get("name") || "").trim(),
        prompt: String(data.get("prompt") || ""),
      });
      form.reset();
      setStatus("人格已保存");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "人格保存失败");
    } finally {
      setSaving(false);
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
            <button className={tab === "connection" ? "active" : ""} onClick={() => setTab("connection")}>后端连接</button>
            <button className={tab === "providers" ? "active" : ""} onClick={() => setTab("providers")}>API 与网关</button>
            <button className={tab === "personas" ? "active" : ""} onClick={() => setTab("personas")}>人格指令</button>
            <button className={tab === "appearance" ? "active" : ""} onClick={() => setTab("appearance")}>外观</button>
          </nav>
          <div className="settings-content">
            {tab === "connection" ? (
              <div className="settings-section">
                <div className="section-heading">
                  <h3>后端连接</h3>
                  <p>Android 版填写运行 Atherloom FastAPI 的电脑或服务器地址；网页同域部署可以留空。</p>
                </div>
                <form className="settings-form one-column" onSubmit={submitConnection}>
                  <label>
                    FastAPI 根地址
                    <input
                      name="api_base"
                      inputMode="url"
                      value={apiBaseDraft}
                      onChange={(event) => setApiBaseDraft(event.target.value)}
                      placeholder="http://192.168.1.20:8876"
                    />
                  </label>
                  <p className="form-hint">手机与电脑需要能够互相访问。公网使用请配置 HTTPS；HTTP 只建议用于可信的同一局域网。</p>
                  <button className="primary-button">保存并重新连接</button>
                </form>
              </div>
            ) : null}
            {tab === "providers" ? (
              <div className="settings-section">
                <div className="section-heading"><h3>API 与网关</h3><p>先迁移最初架构里的真实线路字段；高级参数随后补齐。</p></div>
                <div className="saved-list">
                  {providers.map((provider) => <article key={provider.id}><strong>{provider.name}</strong><small>{provider.protocol} · {provider.model}</small></article>)}
                </div>
                <form className="settings-form" onSubmit={submitProvider}>
                  <label>显示名称<input name="name" required /></label>
                  <label>协议<select name="protocol"><option value="openai">OpenAI 兼容</option><option value="anthropic">Anthropic Messages</option><option value="deepseek">DeepSeek</option><option value="glm">智谱 GLM</option></select></label>
                  <label>Base URL<input name="base_url" required placeholder="https://proxy.example.com/v1" /></label>
                  <label>API Key<input name="api_key" type="password" autoComplete="new-password" /></label>
                  <label>模型 ID<input name="model" required /></label>
                  <button className="primary-button" disabled={saving}>保存线路</button>
                </form>
              </div>
            ) : null}
            {tab === "personas" ? (
              <div className="settings-section">
                <div className="section-heading"><h3>人格指令</h3><p>人格默认保持空白，由使用者自己创建。</p></div>
                <div className="saved-list">
                  {personas.map((persona) => <article key={persona.id}><strong>{persona.name}</strong><small>{persona.prompt.slice(0, 80) || "空白人格"}</small></article>)}
                </div>
                <form className="settings-form one-column" onSubmit={submitPersona}>
                  <label>人格名称<input name="name" required /></label>
                  <label>系统指令<textarea name="prompt" rows={10} /></label>
                  <button className="primary-button" disabled={saving}>保存人格</button>
                </form>
              </div>
            ) : null}
            {tab === "appearance" ? (
              <div className="settings-section">
                <div className="section-heading"><h3>外观</h3><p>跟随系统保留最初的暖米白与暖黑灰；水色、薄荷、丁香和腮红只是可选配色。</p></div>
                <label className="theme-setting">主题<select value={theme} onChange={(event) => onThemeChange(event.target.value as ThemeName)}>{themes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                <div className="theme-swatches">{themes.map((item) => <button key={item.value} className={`theme-swatch swatch-${item.value}${theme === item.value ? " active" : ""}`} onClick={() => onThemeChange(item.value)}><span /><strong>{item.label}</strong></button>)}</div>
              </div>
            ) : null}
            <p className="settings-status" aria-live="polite">{status}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
