import { useMemo, useState, type FormEvent } from "react";
import { readClipboardText } from "../../adapters/native/clipboard";
import type { Provider, ProviderDraft, ProviderProbeDraft } from "../../domain/types";

interface ProviderSettingsProps {
  providers: Provider[];
  visionProviderId: string;
  onVisionProviderChange: (id: string) => Promise<unknown>;
  onCreate: (draft: ProviderDraft) => Promise<unknown>;
  onUpdate: (id: string, draft: ProviderDraft) => Promise<unknown>;
  onDelete: (id: string) => Promise<void>;
  onFetchModels: (draft: ProviderProbeDraft) => Promise<{ models: string[] }>;
  onTest: (draft: ProviderDraft) => Promise<{ message: string }>;
}

const protocolOptions = [
  { value: "openai", label: "OpenAI 兼容" },
  { value: "anthropic", label: "Anthropic Messages" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "glm", label: "智谱 GLM" },
];

function emptyDraft(): ProviderDraft {
  return {
    name: "",
    protocol: "openai",
    base_url: "",
    api_key: "",
    model: "",
    models: [],
    enabled: true,
    custom_headers: "{}",
    prompt_cache: true,
    thinking_enabled: true,
    stream_enabled: true,
    temperature: 0.7,
    top_p: 1,
    max_tokens: 4096,
    vision_mode: "auto",
    cache_mode: "auto",
    prompt_cache_key: "",
    allow_insecure_http: false,
  };
}

function providerModels(provider: Provider) {
  return [...new Set([provider.model, ...(provider.models || [])].map((item) => String(item || "").trim()).filter(Boolean))];
}

function draftFromProvider(provider: Provider): ProviderDraft {
  return {
    ...emptyDraft(),
    name: provider.name,
    protocol: provider.protocol,
    base_url: provider.base_url,
    api_key: "",
    model: provider.model,
    models: providerModels(provider),
    enabled: provider.enabled !== false,
    custom_headers: provider.custom_headers || "{}",
    prompt_cache: provider.prompt_cache !== false,
    thinking_enabled: provider.thinking_enabled !== false,
    stream_enabled: provider.stream_enabled !== false,
    temperature: provider.temperature ?? 0.7,
    top_p: provider.top_p ?? 1,
    max_tokens: provider.max_tokens ?? 4096,
    vision_mode: provider.vision_mode || "auto",
    cache_mode: provider.cache_mode || "auto",
    prompt_cache_key: provider.prompt_cache_key || "",
    allow_insecure_http: provider.allow_insecure_http === true,
    source_provider_id: provider.id,
  };
}

function validateHeaders(value: string) {
  const parsed = JSON.parse(value || "{}") as unknown;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("自定义请求头必须是 JSON 对象");
  }
}

function providerUrlProtocol(value: string) {
  try {
    const parsed = new URL(value.trim());
    if (!parsed.hostname || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) throw new Error();
    return parsed.protocol;
  } catch {
    throw new Error("模型 Base URL 必须是完整的 http:// 或 https:// 地址");
  }
}

function isNativeDirectProviderMode() {
  if (!window.AtherloomNative) return false;
  try {
    return !(window.AtherloomNative.getBackendUrl?.() || "").trim();
  } catch {
    return false;
  }
}

export function ProviderSettings({
  providers,
  visionProviderId,
  onVisionProviderChange,
  onCreate,
  onUpdate,
  onDelete,
  onFetchModels,
  onTest,
}: ProviderSettingsProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProviderDraft>(emptyDraft);
  const [modelsText, setModelsText] = useState("");
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const editingProvider = useMemo(
    () => providers.find((provider) => provider.id === editingId) || null,
    [editingId, providers],
  );
  const nativeDirectProviderMode = isNativeDirectProviderMode();

  const updateDraft = <Key extends keyof ProviderDraft>(key: Key, value: ProviderDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const openNew = () => {
    setEditingId(null);
    setDraft(emptyDraft());
    setModelsText("");
    setFetchedModels([]);
    setShowKey(false);
    setStatus("");
    setFormOpen(true);
  };

  const openEdit = (provider: Provider) => {
    setEditingId(provider.id);
    setDraft(draftFromProvider(provider));
    setModelsText(providerModels(provider).join("\n"));
    setFetchedModels([]);
    setShowKey(false);
    setStatus("已保存的 Key 会自动用于拉取模型和测试；留空保存不会擦除原密钥。");
    setFormOpen(true);
  };

  const closeForm = (nextStatus = "") => {
    setFormOpen(false);
    setEditingId(null);
    setDraft(emptyDraft());
    setModelsText("");
    setFetchedModels([]);
    setShowKey(false);
    setStatus(nextStatus);
  };

  const normalizedDraft = () => {
    validateHeaders(draft.custom_headers);
    providerUrlProtocol(draft.base_url);
    const models = [...new Set([draft.model, ...modelsText.split(/\r?\n/)]
      .map((item) => item.trim())
      .filter(Boolean))];
    return { ...draft, models, source_provider_id: editingId };
  };

  const approveDirectEndpoint = <Draft extends { base_url: string; allow_insecure_http?: boolean }>(
    payload: Draft,
    action: string,
  ): Draft | null => {
    const protocol = providerUrlProtocol(payload.base_url);
    if (!nativeDirectProviderMode || protocol !== "http:" || payload.allow_insecure_http === true) return payload;
    const approved = window.confirm(
      `${action}将通过 HTTP 明文发送 API Key、对话内容或图片。\n\n仅当这是你信任的本机或局域网服务时继续。`,
    );
    if (!approved) {
      setStatus("已取消：HTTP Direct Provider 尚未获得本次线路确认。");
      return null;
    }
    setDraft((current) => current.base_url.trim() === payload.base_url.trim()
      ? { ...current, allow_insecure_http: true }
      : current);
    return { ...payload, allow_insecure_http: true };
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setStatus(editingId ? "正在保存线路修改…" : "正在保存新线路…");
    try {
      const payload = approveDirectEndpoint(normalizedDraft(), "保存这条 Direct Provider 线路");
      if (!payload) return;
      if (editingId) await onUpdate(editingId, payload);
      else await onCreate(payload);
      closeForm(editingId ? "线路修改已保存" : "线路已保存");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "线路保存失败");
    } finally {
      setBusy(false);
    }
  };

  const addModel = (model = draft.model) => {
    const next = model.trim();
    if (!next) return;
    const models = [...new Set([...modelsText.split(/\r?\n/), next].map((item) => item.trim()).filter(Boolean))];
    setModelsText(models.join("\n"));
    updateDraft("model", next);
  };

  const fetchModels = async () => {
    if (!draft.base_url.trim()) {
      setStatus("请先填写官方或反代 Base URL");
      return;
    }
    setBusy(true);
    setStatus("正在使用当前或已保存的密钥拉取模型…");
    try {
      validateHeaders(draft.custom_headers);
      const payload = approveDirectEndpoint({
        protocol: draft.protocol,
        base_url: draft.base_url,
        api_key: draft.api_key,
        custom_headers: draft.custom_headers,
        provider_id: editingId,
        allow_insecure_http: draft.allow_insecure_http,
      }, "拉取模型列表");
      if (!payload) return;
      const result = await onFetchModels(payload);
      const models = result.models || [];
      setFetchedModels(models);
      setStatus(models.length ? `已读取 ${models.length} 个模型，请从下拉框选择。` : "线路已响应，但没有返回模型。");
    } catch (error) {
      setStatus(`拉取失败：${error instanceof Error ? error.message : "未知错误"}；仍可手动填写模型 ID。`);
    } finally {
      setBusy(false);
    }
  };

  const testConnection = async () => {
    setBusy(true);
    setStatus("正在测试当前模型…");
    try {
      const payload = approveDirectEndpoint(normalizedDraft(), "测试这条 Direct Provider 线路");
      if (!payload) return;
      const result = await onTest(payload);
      setStatus(result.message || "连接成功");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "连接测试失败");
    } finally {
      setBusy(false);
    }
  };

  const changeProtocol = (protocol: string) => {
    const presets: Record<string, Pick<ProviderDraft, "name" | "base_url" | "model">> = {
      deepseek: { name: "DeepSeek", base_url: "https://api.deepseek.com", model: "deepseek-v4-flash" },
      glm: { name: "智谱 GLM", base_url: "https://open.bigmodel.cn/api/paas/v4", model: "glm-5.2" },
    };
    const preset = presets[protocol];
    setDraft((current) => ({
      ...current,
      protocol,
      name: current.name || preset?.name || "",
      base_url: current.base_url || preset?.base_url || "",
      model: current.model || preset?.model || "",
    }));
  };

  return (
    <section className="settings-section settings-feature" aria-labelledby="providers-title">
      <div className="section-heading section-heading-with-action">
        <div>
          <h3 id="providers-title">API 与网关</h3>
          <p>添加多条线路，并在聊天中随时切换。</p>
        </div>
        <button className="primary-button compact-action" type="button" onClick={openNew}>添加线路</button>
      </div>

      <div className="setting-row">
        <div>
          <strong>图片理解线路</strong>
          <small>主聊天使用 DeepSeek／GLM 时，带图片的消息自动改用这条视觉线路；图片会发送给所选渠道。</small>
        </div>
        <select
          aria-label="图片理解线路"
          value={visionProviderId}
          onChange={(event) => void onVisionProviderChange(event.target.value)}
        >
          <option value="">跟随当前聊天线路</option>
          {providers.filter((provider) => provider.enabled !== false).map((provider) => (
            <option key={provider.id} value={provider.id}>{provider.name} · {provider.model}</option>
          ))}
        </select>
      </div>

      <div className="settings-card-list" aria-label="已保存的 API 线路">
        {providers.map((provider) => {
          const models = providerModels(provider);
          return (
            <article className={`settings-list-card${editingId === provider.id ? " editing" : ""}`} key={provider.id}>
              <div className="settings-list-copy">
                <strong>{provider.name}</strong>
                <small>{provider.protocol} · {models.length} 个模型 · 温度 {provider.temperature ?? 0.7} · {provider.has_api_key ? "Key 已保存" : "无 Key"}</small>
                <div className="model-tags">
                  {models.map((model) => <span className={model === provider.model ? "active" : ""} key={model}>{model}</span>)}
                </div>
              </div>
              <div className="card-actions">
                <button type="button" onClick={() => openEdit(provider)}>编辑</button>
                <button className="danger-action" type="button" onClick={() => {
                  if (window.confirm(`删除线路“${provider.name}”？`)) void onDelete(provider.id);
                }}>删除</button>
              </div>
            </article>
          );
        })}
        {!providers.length && !formOpen ? (
          <div className="settings-empty"><p>还没有 API 线路。</p><button className="primary-button" type="button" onClick={openNew}>添加第一条线路</button></div>
        ) : null}
      </div>

      {formOpen ? (
        <form className="settings-form settings-edit-card" onSubmit={submit}>
          {editingProvider ? <div className="edit-state">正在编辑「{editingProvider.name}」</div> : null}
          <label>显示名称<input value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} required placeholder="例如：主线路" /></label>
          <label>供应商 / 协议
            <select value={draft.protocol} onChange={(event) => changeProtocol(event.target.value)}>
              {protocolOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="span-all">官方或反代 Base URL<input value={draft.base_url} onChange={(event) => {
            const baseUrl = event.target.value;
            setDraft((current) => ({
              ...current,
              base_url: baseUrl,
              allow_insecure_http: current.base_url.trim() === baseUrl.trim() ? current.allow_insecure_http : false,
            }));
          }} required inputMode="url" placeholder="https://proxy.example.com/v1" /></label>
          {nativeDirectProviderMode && draft.base_url.trim().toLowerCase().startsWith("http://") ? (
            <p className="direct-provider-warning span-all">HTTP Direct Provider 会明文传输 API Key、对话和图片。仅用于你信任的本机或局域网服务；保存、测试或拉取模型前需要明确确认。</p>
          ) : null}
          <label className="span-all">API Key
            <span className="field-with-actions">
              <input
                value={draft.api_key}
                onChange={(event) => updateDraft("api_key", event.target.value)}
                type={showKey ? "text" : "password"}
                autoComplete="new-password"
                placeholder={editingProvider?.has_api_key ? "已安全保存 · 留空继续使用" : "填写 API Key"}
              />
              <button type="button" onClick={async () => {
                try {
                  const value = await readClipboardText();
                  if (!value.trim()) throw new Error("剪贴板为空");
                  updateDraft("api_key", value.trim());
                  setStatus(`已从 Android 剪贴板粘贴 ${value.trim().length} 个字符`);
                } catch (error) {
                  setStatus(`无法读取剪贴板：${error instanceof Error ? error.message : "系统未授权"}`);
                }
              }}>粘贴</button>
              <button type="button" aria-label={showKey ? "隐藏 API Key" : "显示 API Key"} onClick={() => setShowKey((current) => !current)}>{showKey ? "隐藏" : "显示"}</button>
            </span>
            <small>{editingProvider?.has_api_key ? "密钥已安全保存，不回传明文；留空保存会继续使用原密钥。" : "新线路需要填写 Key；保存后不会把明文重新显示出来。"}</small>
          </label>
          <label className="span-all">当前默认模型
            <span className="field-with-actions model-field">
              <input value={draft.model} onChange={(event) => updateDraft("model", event.target.value)} required placeholder="输入模型 ID" />
              <button type="button" onClick={() => addModel()}>加入列表</button>
              <button type="button" disabled={busy} onClick={() => void fetchModels()}>拉取模型</button>
            </span>
          </label>
          {fetchedModels.length ? (
            <label className="span-all">选择已拉取的模型（{fetchedModels.length}）
              <select aria-label="选择已拉取的模型" value="" onChange={(event) => event.target.value && addModel(event.target.value)}>
                <option value="">请选择模型</option>
                {fetchedModels.map((model) => <option key={model} value={model}>{model}</option>)}
              </select>
            </label>
          ) : null}
          <label className="span-all">已配置的模型（每行一个）
            <textarea rows={4} value={modelsText} onChange={(event) => setModelsText(event.target.value)} placeholder={"deepseek-v4-flash\ndeepseek-v4-pro"} />
            <small>同一套 Base URL 和 API Key 可以保存多个模型；聊天顶部可随时切换。</small>
          </label>
          <label>温度 Temperature<input type="number" min="0" max="2" step="0.1" value={draft.temperature} onChange={(event) => updateDraft("temperature", Number(event.target.value))} /><small>越低越稳定；部分推理模型可能忽略此项。</small></label>
          <label>Top P<input type="number" min="0" max="1" step="0.05" value={draft.top_p} onChange={(event) => updateDraft("top_p", Number(event.target.value))} /></label>
          <label>最大输出 Tokens<input type="number" min="1" max="200000" step="1" value={draft.max_tokens} onChange={(event) => updateDraft("max_tokens", Number(event.target.value))} /></label>
          <label>图片能力
            <select value={draft.vision_mode} onChange={(event) => updateDraft("vision_mode", event.target.value as ProviderDraft["vision_mode"])}>
              <option value="auto">自动按协议选择</option><option value="openai">OpenAI image_url 格式</option><option value="anthropic">Claude base64 图片格式</option><option value="text">仅文本，不允许发送图片</option>
            </select>
          </label>
          <label>提示词缓存
            <select value={draft.cache_mode} onChange={(event) => updateDraft("cache_mode", event.target.value as ProviderDraft["cache_mode"])}>
              <option value="auto">自动按协议选择</option><option value="off">关闭</option><option value="anthropic">Claude 显式缓存</option><option value="openai">OpenAI 缓存键</option>
            </select>
          </label>
          {draft.cache_mode === "openai" ? <label>OpenAI 缓存键<input maxLength={200} value={draft.prompt_cache_key} onChange={(event) => updateDraft("prompt_cache_key", event.target.value)} placeholder="例如：persona-default" /></label> : null}
          <label className="span-all">自定义请求头（JSON）<textarea rows={4} value={draft.custom_headers} onChange={(event) => updateDraft("custom_headers", event.target.value)} placeholder={'{"X-Custom-Header":"value"}'} /></label>
          {draft.cache_mode === "auto" || draft.cache_mode === "anthropic" ? <label className="check-row span-all"><input type="checkbox" checked={draft.prompt_cache} onChange={(event) => updateDraft("prompt_cache", event.target.checked)} /><span>允许显式写入提示词缓存</span></label> : null}
          <label className="check-row span-all"><input type="checkbox" checked={draft.thinking_enabled} onChange={(event) => updateDraft("thinking_enabled", event.target.checked)} /><span>显示模型返回的思考过程（线路支持时）</span></label>
          <label>输出方式<select value={draft.stream_enabled ? "stream" : "complete"} onChange={(event) => updateDraft("stream_enabled", event.target.value === "stream")}><option value="stream">流式 · 边生成边显示</option><option value="complete">非流式 · 完成后一次显示</option></select><small>两种方式都保留思考过程与 Token 数据；线路必须支持对应协议。</small></label>
          <label className="check-row span-all"><input type="checkbox" checked={draft.enabled} onChange={(event) => updateDraft("enabled", event.target.checked)} /><span>启用这条线路</span></label>
          <p className="form-status span-all" aria-live="polite">{status}</p>
          <div className="form-actions">
            <button className="secondary-button" type="button" onClick={() => closeForm()}>取消</button>
            <button className="secondary-button" type="button" disabled={busy || !draft.model || !draft.base_url} onClick={() => void testConnection()}>测试当前模型</button>
            <button className="primary-button" disabled={busy}>{editingId ? "保存线路与模型" : "保存线路与模型"}</button>
          </div>
        </form>
      ) : null}
      {!formOpen ? <p className="form-status" aria-live="polite">{status}</p> : null}
    </section>
  );
}
