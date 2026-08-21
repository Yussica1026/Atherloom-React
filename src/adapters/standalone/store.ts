import type {
  AppSettings,
  BackupBundle,
  BackupPart,
  BackupRestoreResult,
  BootstrapPayload,
  ChatRequest,
  Conversation,
  Message,
  Persona,
  PersonaDraft,
  Provider,
  ProviderDraft,
  ProviderProbeDraft,
  Worldbook,
  WorldbookDraft,
} from "../../domain/types";

const stateKey = "atherloom-react:standalone-state:v1";
const snapshotPrefix = "atherloom-react:standalone-snapshot:";

interface StandaloneState {
  personas: Persona[];
  worldbooks: Worldbook[];
  conversations: Conversation[];
  messages: Record<string, Message[]>;
  settings: AppSettings;
}

export interface StandaloneChatContext {
  conversation: Conversation;
  userMessage: Message;
  operation: {
    provider_id: string;
    system: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    max_tokens: number;
    temperature: number;
    top_p: number;
    thinking_enabled: boolean;
  };
}

export interface StandaloneChatResult {
  content?: string;
  reasoning?: string;
  model?: string;
  usage?: Message["usage"];
}

function emptyState(): StandaloneState {
  return { personas: [], worldbooks: [], conversations: [], messages: {}, settings: {} };
}

function readState(): StandaloneState {
  try {
    const parsed = JSON.parse(localStorage.getItem(stateKey) || "null") as Partial<StandaloneState> | null;
    if (!parsed || typeof parsed !== "object") return emptyState();
    return {
      personas: Array.isArray(parsed.personas) ? parsed.personas : [],
      worldbooks: Array.isArray(parsed.worldbooks) ? parsed.worldbooks : [],
      conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
      messages: parsed.messages && typeof parsed.messages === "object" ? parsed.messages : {},
      settings: parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {},
    };
  } catch {
    return emptyState();
  }
}

function writeState(state: StandaloneState) {
  localStorage.setItem(stateKey, JSON.stringify(state));
}

function id(prefix: string) {
  return `${prefix}-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function timestamp() {
  return new Date().toISOString();
}

function bodyOf(init: RequestInit) {
  if (typeof init.body !== "string" || !init.body) return {} as Record<string, unknown>;
  return JSON.parse(init.body) as Record<string, unknown>;
}

function parseNative<T>(raw: string, label: string): T {
  try {
    const parsed = JSON.parse(raw) as T & { ok?: boolean; error?: string };
    if (parsed && typeof parsed === "object" && parsed.ok === false) throw new Error(parsed.error || `${label}失败`);
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message !== `Unexpected end of JSON input`) throw error;
    throw new Error(`${label}返回了无法识别的数据`);
  }
}

function bridge() {
  const native = window.AtherloomNative;
  if (!native) throw new Error("Android 本机存储桥不可用");
  return native;
}

function listProviders(): Provider[] {
  const raw = bridge().listProviders?.();
  if (typeof raw !== "string") throw new Error("当前 APK 不支持本机 API 线路，请安装最新版本");
  const providers = parseNative<Provider[]>(raw, "读取本机 API 线路");
  if (!Array.isArray(providers)) throw new Error("本机 API 线路格式错误");
  return providers;
}

function saveProvider(draft: ProviderDraft, providerId?: string): Provider {
  const raw = bridge().saveProvider?.(JSON.stringify({ ...draft, id: providerId || "" }));
  if (typeof raw !== "string") throw new Error("当前 APK 不支持加密保存 API Key，请安装最新版本");
  return parseNative<Provider>(raw, "保存 API 线路");
}

function deleteProvider(providerId: string) {
  const raw = bridge().deleteProvider?.(providerId);
  if (typeof raw !== "string") throw new Error("当前 APK 不支持删除本机 API 线路");
  parseNative<Record<string, unknown>>(raw, "删除 API 线路");
}

export function isStandaloneAndroid() {
  return Boolean(window.AtherloomNative && !window.AtherloomNative.getBackendUrl());
}

export function standaloneBootstrap(): BootstrapPayload {
  const state = readState();
  return {
    providers: listProviders(),
    personas: state.personas,
    conversations: state.conversations,
    worldbooks: state.worldbooks,
    settings: state.settings,
  };
}

function findConversation(state: StandaloneState, conversationId: string) {
  const conversation = state.conversations.find((item) => item.id === conversationId);
  if (!conversation) throw new Error("找不到这条本机会话");
  return conversation;
}

function selectedParts(raw: unknown, fallback: BackupPart[] = []) {
  const values = Array.isArray(raw) ? raw : fallback;
  const allowed: BackupPart[] = ["conversations", "personas", "memory", "settings", "games"];
  const result = [...new Set(values.filter((value): value is BackupPart => allowed.includes(value as BackupPart)))];
  if (!result.length) throw new Error("请至少选择一类数据");
  return result;
}

function exportBackup(parts: BackupPart[]): BackupBundle {
  const state = readState();
  const record: Record<string, unknown> = {};
  if (parts.includes("conversations")) {
    record.conversations = state.conversations;
    record.messages = state.messages;
  }
  if (parts.includes("personas")) {
    record.personas = state.personas;
    record.worldbooks = state.worldbooks;
  }
  if (parts.includes("settings")) {
    record.settings = state.settings;
    record.providers = listProviders().map((provider) => ({ ...provider, custom_headers: "{}" }));
  }
  return {
    format: "atherloom-backup",
    version: 2,
    exported_at: timestamp(),
    parts,
    secrets_omitted: ["providers.api_key", "providers.custom_headers"],
    tables: { standalone_state: [record] },
  };
}

function restoreBackup(bundle: BackupBundle, parts: BackupPart[]): BackupRestoreResult {
  const row = bundle.tables?.standalone_state?.[0];
  if (!row || typeof row !== "object") throw new Error("该备份不包含 Android 本机数据");
  const state = readState();
  const snapshot = `${snapshotPrefix}${Date.now()}`;
  localStorage.setItem(snapshot, JSON.stringify(state));
  const restored: Record<string, number> = {};
  if (parts.includes("conversations")) {
    state.conversations = Array.isArray(row.conversations) ? row.conversations as Conversation[] : [];
    state.messages = row.messages && typeof row.messages === "object" ? row.messages as Record<string, Message[]> : {};
    restored.conversations = state.conversations.length;
  }
  if (parts.includes("personas")) {
    state.personas = Array.isArray(row.personas) ? row.personas as Persona[] : [];
    state.worldbooks = Array.isArray(row.worldbooks) ? row.worldbooks as Worldbook[] : [];
    restored.personas = state.personas.length;
    restored.worldbooks = state.worldbooks.length;
  }
  if (parts.includes("settings")) {
    state.settings = row.settings && typeof row.settings === "object" ? row.settings as AppSettings : {};
    if (Array.isArray(row.providers)) {
      for (const provider of row.providers as Provider[]) {
        saveProvider({
          name: provider.name,
          protocol: provider.protocol,
          base_url: provider.base_url,
          api_key: "",
          model: provider.model,
          models: provider.models || [],
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
          source_provider_id: provider.id,
        }, provider.id);
      }
    }
    restored.settings = 1;
    restored.providers = Array.isArray(row.providers) ? row.providers.length : 0;
  }
  writeState(state);
  return { ok: true, parts, tables: restored, snapshot, secrets_restored: false };
}

export async function requestStandaloneJson<T>(
  path: string,
  init: RequestInit,
  providerOperation: <Result>(operation: string, payload: unknown) => Promise<Result>,
): Promise<T> {
  const method = String(init.method || "GET").toUpperCase();
  const body = bodyOf(init);
  const state = readState();

  if (method === "GET" && path === "/api/bootstrap") return standaloneBootstrap() as T;

  const messageMatch = path.match(/^\/api\/conversations\/([^/]+)\/messages$/);
  if (method === "GET" && messageMatch) return (state.messages[decodeURIComponent(messageMatch[1])] || []) as T;

  if (method === "GET" && path.startsWith("/api/search?q=")) {
    const query = decodeURIComponent(path.slice("/api/search?q=".length)).trim().toLocaleLowerCase();
    const matches = state.conversations.filter((conversation) =>
      conversation.title.toLocaleLowerCase().includes(query)
      || (state.messages[conversation.id] || []).some((message) => message.content.toLocaleLowerCase().includes(query)),
    );
    return matches as T;
  }

  if (path === "/api/conversations" && method === "POST") {
    const conversation: Conversation = {
      id: id("conversation"),
      title: "新对话",
      provider_id: typeof body.provider_id === "string" ? body.provider_id : null,
      persona_id: typeof body.persona_id === "string" ? body.persona_id : null,
      created_at: timestamp(),
      updated_at: timestamp(),
    };
    state.conversations.unshift(conversation);
    state.messages[conversation.id] = [];
    writeState(state);
    return conversation as T;
  }

  const conversationStateMatch = path.match(/^\/api\/conversations\/([^/]+)\/state$/);
  if (conversationStateMatch && method === "PATCH") {
    const conversation = findConversation(state, decodeURIComponent(conversationStateMatch[1]));
    Object.assign(conversation, body, { updated_at: timestamp() });
    writeState(state);
    return conversation as T;
  }

  const conversationMatch = path.match(/^\/api\/conversations\/([^/]+)$/);
  if (conversationMatch && method === "PATCH") {
    const conversation = findConversation(state, decodeURIComponent(conversationMatch[1]));
    Object.assign(conversation, body, { updated_at: timestamp() });
    writeState(state);
    return conversation as T;
  }
  if (conversationMatch && method === "DELETE") {
    const conversationId = decodeURIComponent(conversationMatch[1]);
    findConversation(state, conversationId);
    state.conversations = state.conversations.filter((item) => item.id !== conversationId);
    delete state.messages[conversationId];
    writeState(state);
    return { deleted: true } as T;
  }

  if (path === "/api/providers" && method === "POST") return saveProvider(body as unknown as ProviderDraft) as T;
  const providerMatch = path.match(/^\/api\/providers\/([^/]+)$/);
  if (providerMatch && method === "PUT") return saveProvider(body as unknown as ProviderDraft, decodeURIComponent(providerMatch[1])) as T;
  if (providerMatch && method === "DELETE") {
    deleteProvider(decodeURIComponent(providerMatch[1]));
    return { ok: true } as T;
  }
  if (path === "/api/providers/models" && method === "POST") return providerOperation<T>("models", body as unknown as ProviderProbeDraft);
  if (path === "/api/providers/test" && method === "POST") return providerOperation<T>("test", body as unknown as ProviderDraft);

  if (path === "/api/personas" && method === "POST") {
    const persona: Persona = { ...(body as unknown as PersonaDraft), id: id("persona"), created_at: timestamp() };
    state.personas.push(persona);
    writeState(state);
    return persona as T;
  }
  const personaMatch = path.match(/^\/api\/personas\/([^/]+)$/);
  if (personaMatch && method === "PUT") {
    const personaId = decodeURIComponent(personaMatch[1]);
    const index = state.personas.findIndex((item) => item.id === personaId);
    if (index < 0) throw new Error("人格不存在");
    state.personas[index] = { ...(body as unknown as PersonaDraft), id: personaId, created_at: state.personas[index].created_at };
    writeState(state);
    return state.personas[index] as T;
  }
  if (personaMatch && method === "DELETE") {
    const personaId = decodeURIComponent(personaMatch[1]);
    state.personas = state.personas.filter((item) => item.id !== personaId);
    state.conversations = state.conversations.map((item) => item.persona_id === personaId ? { ...item, persona_id: null } : item);
    writeState(state);
    return { ok: true } as T;
  }

  if (path === "/api/settings" && method === "PUT") {
    state.settings = body as AppSettings;
    writeState(state);
    return state.settings as T;
  }

  if (path === "/api/worldbooks" && method === "POST") {
    const worldbook: Worldbook = { ...(body as unknown as WorldbookDraft), id: id("worldbook"), created_at: timestamp(), updated_at: timestamp() };
    state.worldbooks.unshift(worldbook);
    writeState(state);
    return worldbook as T;
  }
  const worldbookMatch = path.match(/^\/api\/worldbooks\/([^/]+)$/);
  if (worldbookMatch && method === "PUT") {
    const worldbookId = decodeURIComponent(worldbookMatch[1]);
    const index = state.worldbooks.findIndex((item) => item.id === worldbookId);
    if (index < 0) throw new Error("世界书不存在");
    state.worldbooks[index] = {
      ...(body as unknown as WorldbookDraft),
      id: worldbookId,
      created_at: state.worldbooks[index].created_at,
      updated_at: timestamp(),
    };
    writeState(state);
    return state.worldbooks[index] as T;
  }
  if (worldbookMatch && method === "DELETE") {
    const worldbookId = decodeURIComponent(worldbookMatch[1]);
    state.worldbooks = state.worldbooks.filter((item) => item.id !== worldbookId);
    writeState(state);
    return { ok: true } as T;
  }

  if (path === "/api/backup/export" && method === "POST") {
    return exportBackup(selectedParts(body.parts)) as T;
  }
  if (path === "/api/backup/restore" && method === "POST") {
    const bundle = body.bundle as BackupBundle;
    if (!bundle || bundle.format !== "atherloom-backup" || bundle.version !== 2) throw new Error("不是有效的 Atherloom 备份文件");
    return restoreBackup(bundle, selectedParts(body.parts, bundle.parts)) as T;
  }

  throw new Error(`Android 本机模式尚不支持 ${method} ${path}`);
}

export function beginStandaloneChat(request: ChatRequest): StandaloneChatContext {
  const state = readState();
  const conversation = findConversation(state, request.conversation_id);
  const provider = listProviders().find((item) => item.id === request.provider_id);
  if (!provider) throw new Error("API 线路不存在，请重新保存线路");
  const persona = state.personas.find((item) => item.id === request.persona_id);
  const history = (state.messages[conversation.id] || [])
    .filter((message): message is Message & { role: "user" | "assistant" } => message.role === "user" || message.role === "assistant")
    .map((message) => ({ role: message.role, content: message.content }));
  const userMessage: Message = {
    id: id("message"),
    role: "user",
    content: request.content,
    provider_id: request.provider_id,
    created_at: timestamp(),
  };
  state.messages[conversation.id] = [...(state.messages[conversation.id] || []), userMessage];
  conversation.updated_at = timestamp();
  writeState(state);
  return {
    conversation,
    userMessage,
    operation: {
      provider_id: request.provider_id,
      system: [persona?.prompt || "", request.local_time ? `<runtime_context>本地时间：${request.local_time}</runtime_context>` : ""].filter(Boolean).join("\n\n"),
      messages: [...history, { role: "user", content: request.content }],
      max_tokens: provider.max_tokens ?? 4096,
      temperature: provider.temperature ?? 0.7,
      top_p: provider.top_p ?? 1,
      thinking_enabled: provider.thinking_enabled !== false,
    },
  };
}

export function completeStandaloneChat(context: StandaloneChatContext, result: StandaloneChatResult) {
  const state = readState();
  const conversation = findConversation(state, context.conversation.id);
  const assistantMessage: Message = {
    id: id("message"),
    role: "assistant",
    content: String(result.content || "").trim(),
    reasoning: String(result.reasoning || ""),
    provider_id: context.operation.provider_id,
    model: result.model,
    usage: result.usage,
    created_at: timestamp(),
  };
  state.messages[conversation.id] = [...(state.messages[conversation.id] || []), assistantMessage];
  if (!conversation.title || conversation.title === "新对话") conversation.title = context.userMessage.content.slice(0, 28) || "新对话";
  conversation.updated_at = timestamp();
  writeState(state);
  return { assistantMessage, title: conversation.title };
}
