import { useRef, useState, type FormEvent } from "react";
import type { AppSettings, Persona, PersonaConfig, PersonaDraft, Provider } from "../../domain/types";

interface PersonaSettingsProps {
  personas: Persona[];
  providers: Provider[];
  settings: AppSettings;
  onSettingsChange: (patch: Partial<AppSettings>) => Promise<unknown>;
  onCreate: (draft: PersonaDraft) => Promise<unknown>;
  onUpdate: (id: string, draft: PersonaDraft) => Promise<unknown>;
  onDelete: (id: string) => Promise<void>;
}

type PersonaPane = "basic" | "prompt" | "memory" | "phrases" | "request" | "regex" | "tools" | "mcp";

interface PersonaFormState {
  name: string;
  prompt: string;
  providerId: string;
  startupChat: "resume" | "new";
  pinned: boolean;
  historyEnabled: boolean;
  summaryFrequency: number;
  messageTemplate: string;
  quickPhrases: string;
  customHeaders: string;
  customBody: string;
  regexRules: string;
  toolTime: boolean;
  toolClipboard: boolean;
  toolTts: boolean;
  toolAskUser: boolean;
  toolCalculator: boolean;
  mcpServers: string;
}

interface SwitchControlProps {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}

function SwitchControl({ label, checked, disabled = false, onChange }: SwitchControlProps) {
  return (
    <button
      className="switch"
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
    >
      <span aria-hidden="true" />
    </button>
  );
}

const panes: Array<{ value: PersonaPane; label: string }> = [
  { value: "basic", label: "基础设置" },
  { value: "prompt", label: "提示词" },
  { value: "memory", label: "记忆" },
  { value: "phrases", label: "快捷短语" },
  { value: "request", label: "自定义请求" },
  { value: "regex", label: "正则替换" },
  { value: "tools", label: "本地工具" },
  { value: "mcp", label: "MCP" },
];

function emptyForm(): PersonaFormState {
  return {
    name: "",
    prompt: "",
    providerId: "",
    startupChat: "resume",
    pinned: false,
    historyEnabled: true,
    summaryFrequency: 20,
    messageTemplate: "{{message}}",
    quickPhrases: "",
    customHeaders: "{}",
    customBody: "{}",
    regexRules: "[]",
    toolTime: true,
    toolClipboard: false,
    toolTts: false,
    toolAskUser: true,
    toolCalculator: true,
    mcpServers: "",
  };
}

function formFromPersona(persona: Persona): PersonaFormState {
  const config = persona.config || {};
  const tools = config.tools || {};
  return {
    ...emptyForm(),
    name: persona.name,
    prompt: persona.prompt,
    providerId: config.provider_id || persona.provider_id || "",
    startupChat: config.startup_chat === "new" ? "new" : "resume",
    pinned: Boolean(config.pinned),
    historyEnabled: config.history_enabled !== false,
    summaryFrequency: config.summary_frequency || 20,
    messageTemplate: config.message_template || "{{message}}",
    quickPhrases: (config.quick_phrases || []).join("\n"),
    customHeaders: JSON.stringify(config.custom_headers || {}, null, 2),
    customBody: JSON.stringify(config.custom_body || {}, null, 2),
    regexRules: JSON.stringify(config.regex_rules || [], null, 2),
    toolTime: tools.time !== false,
    toolClipboard: Boolean(tools.clipboard),
    toolTts: Boolean(tools.tts),
    toolAskUser: tools.ask_user !== false,
    toolCalculator: tools.calculator !== false,
    mcpServers: (config.mcp_servers || []).join("\n"),
  };
}

function parseObject(value: string, label: string) {
  const parsed = JSON.parse(value || "{}") as unknown;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error(`${label}必须是 JSON 对象`);
  return parsed as Record<string, unknown>;
}

function formToDraft(form: PersonaFormState): PersonaDraft {
  const regexRules = JSON.parse(form.regexRules || "[]") as unknown;
  if (!Array.isArray(regexRules)) throw new Error("正则规则必须是 JSON 数组");
  const config: PersonaConfig = {
    provider_id: form.providerId,
    startup_chat: form.startupChat,
    pinned: form.pinned,
    memory_enabled: true,
    history_enabled: form.historyEnabled,
    summary_frequency: form.summaryFrequency,
    message_template: form.messageTemplate.trim() || "{{message}}",
    quick_phrases: form.quickPhrases.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
    custom_headers: parseObject(form.customHeaders, "自定义 Header"),
    custom_body: parseObject(form.customBody, "自定义 Body"),
    regex_rules: regexRules as Array<Record<string, unknown>>,
    tools: {
      time: form.toolTime,
      clipboard: form.toolClipboard,
      tts: form.toolTts,
      ask_user: form.toolAskUser,
      calculator: form.toolCalculator,
    },
    mcp_servers: form.mcpServers.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
  };
  return { name: form.name.trim(), prompt: form.prompt, config };
}

function renderTemplate(template: string, role: string, message: string) {
  const now = new Date();
  return (template || "{{message}}").replace(/\{\{\s*(role|message|time|date)\s*\}\}/g, (_, key: string) => ({
    role,
    message,
    time: now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
    date: now.toLocaleDateString("zh-CN"),
  })[key as "role" | "message" | "time" | "date"]);
}

export function PersonaSettings({ personas, providers, settings, onSettingsChange, onCreate, onUpdate, onDelete }: PersonaSettingsProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activePane, setActivePane] = useState<PersonaPane>("basic");
  const [form, setForm] = useState<PersonaFormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [globalBusy, setGlobalBusy] = useState(false);
  const [status, setStatus] = useState("");
  const templateRef = useRef<HTMLTextAreaElement>(null);

  const sortedPersonas = [...personas].sort((a, b) => Number(Boolean(b.config?.pinned)) - Number(Boolean(a.config?.pinned)) || a.name.localeCompare(b.name, "zh-CN"));
  const editingPersona = personas.find((persona) => persona.id === editingId) || null;

  const update = <Key extends keyof PersonaFormState>(key: Key, value: PersonaFormState[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const reset = () => {
    setEditingId(null);
    setActivePane("basic");
    setForm(emptyForm());
    setStatus("");
  };

  const edit = (persona: Persona) => {
    setEditingId(persona.id);
    setActivePane("basic");
    setForm(formFromPersona(persona));
    setStatus("");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setActivePane("basic");
      setStatus("请先填写助手名称");
      return;
    }
    setBusy(true);
    setStatus("正在保存人格…");
    try {
      const payload = formToDraft(form);
      if (editingId) await onUpdate(editingId, payload);
      else {
        await onCreate(payload);
        setEditingId(null);
        setActivePane("basic");
        setForm(emptyForm());
      }
      setStatus(`已保存「${payload.name}」`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "人格保存失败");
    } finally {
      setBusy(false);
    }
  };

  const toggleGlobal = async (patch: Partial<AppSettings>, pendingText: string) => {
    if (globalBusy) return;
    setGlobalBusy(true);
    setStatus(pendingText);
    try {
      await onSettingsChange(patch);
      setStatus("设置已保存");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "设置保存失败");
    } finally {
      setGlobalBusy(false);
    }
  };

  const insertTemplateVariable = (value: string) => {
    const input = templateRef.current;
    const start = input?.selectionStart ?? form.messageTemplate.length;
    const end = input?.selectionEnd ?? start;
    update("messageTemplate", `${form.messageTemplate.slice(0, start)}${value}${form.messageTemplate.slice(end)}`);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + value.length, start + value.length);
    });
  };

  return (
    <section className="settings-section settings-feature" aria-labelledby="personas-title">
      <div className="section-heading">
        <h3 id="personas-title">人格指令</h3>
        <p>为不同助手保存独立身份、关系和边界。</p>
      </div>

      <div className="setting-row">
        <div><strong>允许助手主动提问</strong><small>开启后，助手可以自然追问、发起话题或给出选项；关闭后会尽量直接回答。</small></div>
        <SwitchControl label="允许助手主动提问" checked={Boolean(settings.proactive_questions)} disabled={globalBusy} onChange={(checked) => void toggleGlobal({ proactive_questions: checked }, "正在保存主动提问设置…")} />
      </div>
      <div className="setting-row">
        <div><strong>共享正在输入状态</strong><small>只传递开始输入、停顿与耗时，不会读取或发送尚未发出的正文。</small></div>
        <SwitchControl label="共享正在输入状态" checked={settings.typing_presence_enabled !== false} disabled={globalBusy} onChange={(checked) => void toggleGlobal({ typing_presence_enabled: checked }, "正在保存输入状态设置…")} />
      </div>

      <form className="settings-form settings-edit-card persona-form" onSubmit={submit}>
        {editingPersona ? <div className="edit-state">正在编辑「{editingPersona.name}」</div> : <div className="edit-state neutral">新建人格</div>}
        <nav className="persona-tabs span-all" aria-label="人格功能">
          {panes.map((pane) => <button type="button" className={activePane === pane.value ? "active" : ""} onClick={() => setActivePane(pane.value)} key={pane.value}>{pane.label}</button>)}
        </nav>

        {activePane === "basic" ? <div className="persona-pane span-all">
          <label>助手名称<input required value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="例如：私人助手" /></label>
          <div className="setting-row"><div><strong>置顶人格</strong><small>置顶后显示在人格列表最上方。</small></div><SwitchControl label="置顶人格" checked={form.pinned} onChange={(checked) => update("pinned", checked)} /></div>
          <div className="setting-row"><div><strong>专属模型线路</strong><small>新窗口默认使用这条线路，窗口内仍可单独切换。</small></div><select aria-label="专属模型线路" value={form.providerId} onChange={(event) => update("providerId", event.target.value)}><option value="">尚未绑定</option>{providers.map((provider) => <option value={provider.id} key={provider.id}>{provider.name} · {provider.model}</option>)}</select></div>
          <div className="setting-row"><div><strong>打开时进入</strong><small>进入人格时继续上次窗口或新建窗口。</small></div><select aria-label="打开人格时进入" value={form.startupChat} onChange={(event) => update("startupChat", event.target.value as PersonaFormState["startupChat"])}><option value="resume">继续上次对话</option><option value="new">自动新建对话</option></select></div>
        </div> : null}

        {activePane === "prompt" ? <div className="persona-pane span-all">
          <label>系统提示词<textarea rows={12} value={form.prompt} onChange={(event) => update("prompt", event.target.value)} placeholder="身份、关系、说话方式、做事边界……" /></label>
          <label>聊天内容模板<textarea ref={templateRef} rows={4} value={form.messageTemplate} onChange={(event) => update("messageTemplate", event.target.value)} /></label>
          <div className="template-help"><strong>可用变量（点击插入）</strong><div>{["{{role}}", "{{message}}", "{{time}}", "{{date}}"].map((variable) => <button type="button" key={variable} onClick={() => insertTemplateVariable(variable)}><code>{variable}</code></button>)}</div><small>模板只改变发送给模型的聊天内容，不会改写你看到或保存的消息原文。</small></div>
          <div className="template-preview"><strong>预览</strong><p><span>用户</span>{renderTemplate(form.messageTemplate, "用户", "你好啊")}</p><p><span>助手</span>{renderTemplate(form.messageTemplate, "助手", "你好，有什么我可以帮你的吗？")}</p></div>
        </div> : null}

        {activePane === "memory" ? <div className="persona-pane span-all">
          <div className="setting-row"><div><strong>搜索人格记忆</strong><small>所有人格始终可以检索各自隔离的长期记忆。</small></div><SwitchControl label="搜索人格记忆" checked disabled /></div>
          <div className="setting-row"><div><strong>参考历史聊天记录</strong><small>关闭后只读取当前消息与人格提示词。</small></div><SwitchControl label="参考历史聊天记录" checked={form.historyEnabled} onChange={(checked) => update("historyEnabled", checked)} /></div>
          <label>摘要更新频率（消息条数）<input type="number" min="1" max="200" value={form.summaryFrequency} onChange={(event) => update("summaryFrequency", Number(event.target.value))} /></label>
        </div> : null}

        {activePane === "phrases" ? <div className="persona-pane span-all"><label>快捷短语<textarea rows={10} value={form.quickPhrases} onChange={(event) => update("quickPhrases", event.target.value)} placeholder={"每行一条，例如：\n继续说下去\n帮我整理成清单"} /><small>保存后可作为该人格的常用输入短语。</small></label></div> : null}

        {activePane === "request" ? <div className="persona-pane span-all">
          <label>自定义 Header（JSON）<textarea rows={7} value={form.customHeaders} onChange={(event) => update("customHeaders", event.target.value)} /></label>
          <label>自定义 Body（JSON）<textarea rows={9} value={form.customBody} onChange={(event) => update("customBody", event.target.value)} /></label>
          <p className="privacy-note">只允许合法 JSON；模型、消息、API Key 等核心字段仍由线路安全管理。</p>
        </div> : null}

        {activePane === "regex" ? <div className="persona-pane span-all"><label>正则规则（JSON 数组）<textarea rows={12} value={form.regexRules} onChange={(event) => update("regexRules", event.target.value)} placeholder={'[{"pattern":"原文","replacement":"替换","flags":"g","target":"assistant"}]'} /><small>目标可选 user、assistant 或 both。错误规则不会执行。</small></label></div> : null}

        {activePane === "tools" ? <div className="persona-pane span-all"><div className="persona-tool-list">
          {([
            ["toolTime", "时间信息"], ["toolClipboard", "剪贴板（需系统授权）"], ["toolTts", "文字转语音"], ["toolAskUser", "询问用户"], ["toolCalculator", "计算器"],
          ] as Array<[keyof PersonaFormState, string]>).map(([key, label]) => <label className="check-row tool-choice" key={key}><input type="checkbox" checked={Boolean(form[key])} onChange={(event) => update(key, event.target.checked as never)} /><span>{label}</span></label>)}
        </div></div> : null}

        {activePane === "mcp" ? <div className="persona-pane span-all"><label>绑定 MCP 服务<textarea rows={8} value={form.mcpServers} onChange={(event) => update("mcpServers", event.target.value)} placeholder="每行一个已配置的 MCP 服务名称" /><small>仅绑定全局已配置并通过测试的服务，不在这里保存访问令牌。</small></label></div> : null}

        <p className="form-status span-all" aria-live="polite">{status}</p>
        <div className="form-actions">
          {editingId ? <button className="secondary-button" type="button" onClick={reset}>取消编辑</button> : null}
          <button className="primary-button" disabled={busy}>{editingId ? "保存修改" : "保存人格"}</button>
        </div>
      </form>

      <div className="settings-card-list persona-list" aria-label="已保存的人格">
        {sortedPersonas.map((persona) => <article className={`settings-list-card${editingId === persona.id ? " editing" : ""}`} key={persona.id}>
          <div className="settings-list-copy"><strong>{persona.config?.pinned ? "● " : ""}{persona.name}</strong><small>{persona.prompt.slice(0, 90) || "空白人格"}</small></div>
          <div className="card-actions"><button type="button" onClick={() => edit(persona)}>编辑</button><button className="danger-action" type="button" onClick={() => { if (window.confirm(`删除人格“${persona.name}”？已绑定对话会切回默认人格。`)) void onDelete(persona.id); }}>删除</button></div>
        </article>)}
        {!personas.length ? <p className="settings-empty-copy">还没有人格；填写上面的基础设置即可创建。</p> : null}
      </div>
    </section>
  );
}
