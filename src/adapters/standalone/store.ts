import type {
  AppSettings,
  Attachment,
  BackupBundle,
  BackupPart,
  BackupRestoreResult,
  BootstrapPayload,
  ChatRequest,
  Conversation,
  Favorite,
  McpServer,
  Memory,
  MotivationPayload,
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
  favorites: Favorite[];
  memories: Memory[];
  mcpServers: McpServer[];
  motivations: Record<string, MotivationPayload>;
}

export interface StandaloneChatContext {
  conversation: Conversation;
  userMessage: Message;
  autoTitleMode: string;
  operation: {
    provider_id: string;
    system: string;
    messages: Array<{ role: "user" | "assistant"; content: unknown }>;
    max_tokens: number;
    temperature: number;
    top_p: number;
    thinking_enabled: boolean;
    custom_headers?: Record<string, unknown>;
    custom_body?: Record<string, unknown>;
  };
}

export interface StandaloneChatResult {
  content?: string;
  reasoning?: string;
  model?: string;
  usage?: Message["usage"];
}

function emptyState(): StandaloneState {
  return { personas: [], worldbooks: [], conversations: [], messages: {}, settings: {}, favorites: [], memories: [], mcpServers: [], motivations: {} };
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
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
      memories: Array.isArray(parsed.memories) ? parsed.memories : [],
      mcpServers: Array.isArray(parsed.mcpServers) ? parsed.mcpServers : [],
      motivations: parsed.motivations && typeof parsed.motivations === "object" ? parsed.motivations : {},
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
    mcp_servers: state.mcpServers,
  };
}

function findConversation(state: StandaloneState, conversationId: string) {
  const conversation = state.conversations.find((item) => item.id === conversationId);
  if (!conversation) throw new Error("找不到这条本机会话");
  return conversation;
}

function selectedTimeline(messages: Message[], archivedIds: string[] = []) {
  const eligible = messages.filter((message) => !message.error && !message.pending);
  const archived = new Set(archivedIds);
  const selectedByParent = new Map<string, string>();
  for (const message of eligible) {
    if (message.role === "assistant" && message.parent_message_id && message.selected) {
      selectedByParent.set(message.parent_message_id, message.id || message.client_id || "");
    }
  }
  for (let index = eligible.length - 1; index >= 0; index -= 1) {
    const message = eligible[index];
    if (message.role !== "assistant" || !message.parent_message_id || selectedByParent.has(message.parent_message_id)) continue;
    selectedByParent.set(message.parent_message_id, message.id || message.client_id || "");
  }
  return eligible.filter((message) => {
    const messageId = message.id || message.client_id || "";
    if (archived.has(messageId)) return false;
    if (message.role !== "assistant" || !message.parent_message_id) return true;
    const expected = selectedByParent.get(message.parent_message_id);
    if (message.selected === false || message.selected === 0) return false;
    return !expected || expected === messageId;
  });
}

function attachmentMessage(text: string, attachments: Attachment[], provider: Provider): unknown {
  if (!attachments.length) return text;
  if (provider.vision_mode === "text" && attachments.some((item) => item.kind === "image")) {
    throw new Error("当前线路设置为仅文本，不能发送图片");
  }
  const anthropic = provider.vision_mode === "anthropic" || (provider.vision_mode !== "openai" && provider.protocol === "anthropic");
  if (anthropic) {
    const blocks: Array<Record<string, unknown>> = [{ type: "text", text }];
    for (const item of attachments) {
      const encoded = String(item.data || "").split(",", 2)[1] || "";
      if (item.kind === "image" && encoded) blocks.push({ type: "image", source: { type: "base64", media_type: item.mime || "image/jpeg", data: encoded } });
      else if (item.kind === "pdf" && encoded) blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: encoded } });
      else if (item.text) blocks.push({ type: "text", text: `文件：${item.name}\n${item.text.slice(0, 120_000)}` });
      else blocks.push({ type: "text", text: `[无法直接读取文件 ${item.name}]` });
    }
    return blocks;
  }
  const parts: Array<Record<string, unknown>> = [{ type: "text", text }];
  for (const item of attachments) {
    if (item.kind === "image" && item.data) parts.push({ type: "image_url", image_url: { url: item.data } });
    else if (item.text) parts.push({ type: "text", text: `文件：${item.name}\n${item.text.slice(0, 120_000)}` });
    else parts.push({ type: "text", text: `[当前线路无法直接读取文件 ${item.name}]` });
  }
  return parts;
}

function worldbookContext(state: StandaloneState, ids: string[], scanText: string) {
  const normalized = scanText.toLocaleLowerCase();
  const chunks: string[] = [];
  for (const worldbook of state.worldbooks) {
    if (!ids.includes(worldbook.id) || worldbook.enabled === false) continue;
    for (const entry of worldbook.entries || []) {
      if (entry.enabled === false) continue;
      const triggered = entry.constant || !entry.keywords?.length || entry.keywords.some((keyword) => {
        try {
          return entry.use_regex ? new RegExp(keyword, entry.case_sensitive ? "" : "i").test(scanText)
            : normalized.includes(entry.case_sensitive ? keyword : keyword.toLocaleLowerCase());
        } catch {
          return false;
        }
      });
      if (triggered && entry.content.trim()) chunks.push(`[世界书：${worldbook.name} / ${entry.name}]\n${entry.content.trim()}`);
    }
  }
  return chunks.join("\n\n");
}

function memoryContext(state: StandaloneState, personaKey: string, scanText: string) {
  const bigrams = (value: string) => {
    const clean = value.toLocaleLowerCase().replace(/\s+/g, "");
    const result = new Set<string>();
    for (let index = 0; index < clean.length - 1; index += 1) result.add(clean.slice(index, index + 2));
    return result;
  };
  const query = bigrams(scanText);
  const candidates = state.memories.filter((memory) => memory.persona_key === personaKey
    && memory.memory_status !== "forgotten" && memory.memory_status !== "superseded"
    && !memory.archived && !memory.deleted_at);
  const scored = candidates.map((memory) => {
    const source = bigrams(`${memory.title}${memory.content}`);
    let overlap = 0;
    for (const item of query) if (source.has(item)) overlap += 1;
    const relevance = overlap / Math.max(1, query.size);
    return { memory, relevance, score: relevance + Number(memory.importance || 0.5) * 0.08 + (memory.starred ? 0.2 : 0) };
  }).filter((item) => item.relevance >= 0.02)
    .sort((left, right) => right.score - left.score)
    .slice(0, 8);
  if (!scored.length) return "";
  return `<relevant_memories persona="${personaKey}">\n${scored.map(({ memory }) => `- ${memory.title}：${memory.content}`).join("\n")}\n</relevant_memories>`;
}

const motivationDrives: MotivationPayload["drives"] = {
  connection: { label: "联结", baseline: 35, growth: 0.35, decay: 0.25, threshold: 70 },
  curiosity: { label: "好奇", baseline: 45, growth: 0.2, decay: 0.1, threshold: 60 },
  reflection: { label: "反思", baseline: 40, growth: 0.15, decay: 0.2, threshold: 55 },
  duty: { label: "责任", baseline: 45, growth: 0.1, decay: 0.2, threshold: 70 },
  social: { label: "交流", baseline: 40, growth: 0.1, decay: 0.15, threshold: 65 },
  fatigue: { label: "疲劳", baseline: 25, growth: 0, decay: 0.3, threshold: 80 },
  closeness: { label: "亲近", baseline: 35, growth: 0.2, decay: 0.1, threshold: 70 },
  stress: { label: "压力", baseline: 25, growth: 0, decay: 0.2, threshold: 80 },
  joy: { label: "愉悦", baseline: 35, growth: 0, decay: 0.15, threshold: 80 },
};

function defaultMotivation(): MotivationPayload {
  const values = Object.fromEntries(Object.entries(motivationDrives).map(([key, value]) => [key, value.baseline]));
  return { enabled: false, offline_mode: "limited", state: { drives: { ...values }, baselines: { ...values }, thoughts: [], tick_count: 0, last_tick: timestamp() }, drives: motivationDrives, events: ["contact_message", "conversation", "diary_written", "rest", "discovery", "happy_moment"] };
}

function getLocalMotivation(state: StandaloneState, personaKey: string) {
  if (!state.motivations[personaKey]) state.motivations[personaKey] = defaultMotivation();
  return state.motivations[personaKey];
}

function tickLocalMotivation(payload: MotivationPayload) {
  for (const [key, config] of Object.entries(motivationDrives)) {
    const current = Number(payload.state.drives[key] ?? config.baseline);
    const baseline = Number(payload.state.baselines[key] ?? config.baseline);
    const next = current + config.growth - (current > baseline ? config.decay : current < baseline ? -config.decay : 0);
    payload.state.drives[key] = Math.round(Math.max(0, Math.min(100, next)) * 100) / 100;
  }
  payload.state.tick_count += 1;
  payload.state.last_tick = timestamp();
  return payload;
}

function motivationContext(state: StandaloneState, personaKey: string) {
  const payload = getLocalMotivation(state, personaKey);
  if (!payload.enabled) return "";
  payload.state.drives.connection = Math.max(0, Number(payload.state.drives.connection || 0) - 5);
  payload.state.drives.closeness = Math.min(100, Number(payload.state.drives.closeness || 0) + 3);
  payload.state.drives.joy = Math.min(100, Number(payload.state.drives.joy || 0) + 2);
  tickLocalMotivation(payload);
  const active = Object.entries(payload.state.drives).sort((left, right) => right[1] - left[1]).slice(0, 3);
  return `<motivation_state persona="${personaKey}">当前较突出的内部驱动：${active.map(([key, value]) => `${motivationDrives[key]?.label || key} ${Math.round(value)}/100`).join("、")}。这是行为参考，不是必须表演的情绪，也不得绕过工具权限。</motivation_state>`;
}

function featureSpaceContext(personaKey: string) {
  try {
    const data = JSON.parse(localStorage.getItem("atherloom-react:feature-spaces:v1") || "{}") as Record<string, Array<Record<string, unknown>>>;
    const chunks: string[] = [];
    const samePersona = (item: Record<string, unknown>) => String(item.persona_key || "") === personaKey;
    for (const item of (data.life || []).filter(samePersona).filter((row) => row.visible_to_ai).slice(0, 20)) chunks.push(`生活记录：${String(item.title || "")} ${String(item.note || "")}`.trim());
    for (const item of (data.journals || []).filter(samePersona).filter((row) => row.visible_to_ai).slice(0, 12)) chunks.push(`日记《${String(item.title || "无题") }》：${String(item.content || "")}`);
    for (const item of (data.board || []).filter(samePersona).filter((row) => row.visible_to_ai).slice(0, 20)) chunks.push(`留言板：${String(item.content || "")}`);
    for (const item of (data.dreams || []).filter(samePersona).filter((row) => !row.isolated && row.claimed).slice(0, 10)) chunks.push(`已认领梦境《${String(item.title || "无题") }》：${String(item.content || "")}`);
    if (!chunks.length) return "";
    return `<persona_visible_spaces persona="${personaKey}">\n${chunks.join("\n").slice(0, 6000)}\n</persona_visible_spaces>`;
  } catch {
    return "";
  }
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
  if (parts.includes("memory")) record.memories = state.memories;
  if (parts.includes("settings")) {
    record.settings = { ...state.settings, search_api_key: "" };
    record.mcpServers = state.mcpServers;
    record.motivations = state.motivations;
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
  if (parts.includes("memory")) {
    state.memories = Array.isArray(row.memories) ? row.memories as Memory[] : [];
    restored.memories = state.memories.length;
  }
  if (parts.includes("settings")) {
    state.settings = row.settings && typeof row.settings === "object" ? row.settings as AppSettings : {};
    state.mcpServers = Array.isArray(row.mcpServers) ? row.mcpServers as McpServer[] : [];
    state.motivations = row.motivations && typeof row.motivations === "object" ? row.motivations as Record<string, MotivationPayload> : {};
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
    state.favorites = state.favorites.filter((item) => item.source_conversation_id !== conversationId);
    delete state.messages[conversationId];
    writeState(state);
    return { deleted: true } as T;
  }

  const branchMatch = path.match(/^\/api\/conversations\/([^/]+)\/branch\/([^/]+)$/);
  if (branchMatch && method === "POST") {
    const sourceId = decodeURIComponent(branchMatch[1]);
    const pivotId = decodeURIComponent(branchMatch[2]);
    const source = findConversation(state, sourceId);
    const sourceMessages = selectedTimeline(state.messages[sourceId] || []);
    const pivotIndex = sourceMessages.findIndex((item) => item.id === pivotId);
    if (pivotIndex < 0) throw new Error("找不到要分支的消息");
    const copiedIds = new Map<string, string>();
    const copied = sourceMessages.slice(0, pivotIndex + 1).map((message) => {
      const nextId = id("message");
      if (message.id) copiedIds.set(message.id, nextId);
      return { ...message, id: nextId, client_id: undefined, selected: message.selected };
    }).map((message) => ({
      ...message,
      parent_message_id: message.parent_message_id ? copiedIds.get(message.parent_message_id) || message.parent_message_id : message.parent_message_id,
    }));
    const conversation: Conversation = {
      ...source,
      id: id("conversation"),
      title: `${source.title} · 分支`,
      pinned: false,
      starred: false,
      archived: false,
      summary: "",
      archived_message_ids: [],
      created_at: timestamp(),
      updated_at: timestamp(),
    };
    state.conversations.unshift(conversation);
    state.messages[conversation.id] = copied;
    writeState(state);
    return conversation as T;
  }

  const compressMatch = path.match(/^\/api\/conversations\/([^/]+)\/compress$/);
  if (compressMatch && method === "POST") {
    const conversation = findConversation(state, decodeURIComponent(compressMatch[1]));
    const providerId = String(body.provider_id || conversation.provider_id || "");
    const provider = listProviders().find((item) => item.id === providerId && item.enabled !== false);
    if (!provider) throw new Error("请先为当前对话选择可用模型线路");
    const timeline = selectedTimeline(state.messages[conversation.id] || [], conversation.archived_message_ids || []);
    const userRounds = timeline.filter((item) => item.role === "user").length;
    const availableRounds = Math.max(0, userRounds - 1);
    if (availableRounds < 1) throw new Error("至少保留最近一轮原文，当前没有可压缩的旧对话");
    const chosenRounds = Math.min(Math.max(1, Number(body.rounds) || 1), availableRounds);
    let consumedUsers = 0;
    const batch: Message[] = [];
    for (const message of timeline) {
      if (message.role === "user" && consumedUsers >= chosenRounds) break;
      batch.push(message);
      if (message.role === "user") consumedUsers += 1;
    }
    while (batch.length && batch.at(-1)?.role === "user") batch.pop();
    const transcript = batch.map((item) => `${item.role === "user" ? "用户" : "助手"}：${item.content}`).join("\n\n");
    const result = await providerOperation<StandaloneChatResult>("chat", {
      provider_id: providerId,
      system: "请把对话压缩成准确、简洁、可供后续聊天继续使用的中文摘要。保留人物、约定、事实、未完成事项与情绪变化，不要添加原文没有的信息。",
      messages: [{ role: "user", content: `已有摘要：${conversation.summary || "暂无"}\n\n需要整理的对话：\n${transcript}` }],
      max_tokens: Math.min(2000, Math.max(640, provider.max_tokens || 4096)),
      temperature: 0.2,
      top_p: 1,
      thinking_enabled: false,
    });
    const summary = String(result.content || "").trim();
    if (!summary) throw new Error("压缩模型没有返回摘要");
    const archived = new Set(conversation.archived_message_ids || []);
    for (const message of batch) if (message.id) archived.add(message.id);
    conversation.summary = summary;
    conversation.archived_message_ids = [...archived];
    conversation.updated_at = timestamp();
    writeState(state);
    return { ok: true, rounds: chosenRounds, messages: batch.length, summary, available_rounds: availableRounds - chosenRounds } as T;
  }

  if (path === "/api/messages/selection" && method === "PATCH") {
    const conversationId = String(body.conversation_id || "");
    const parentId = String(body.parent_message_id || "");
    const assistantId = String(body.assistant_message_id || "");
    const rows = state.messages[conversationId] || [];
    for (const message of rows) {
      if (message.role === "assistant" && message.parent_message_id === parentId) message.selected = message.id === assistantId;
    }
    const conversation = findConversation(state, conversationId);
    conversation.summary = "";
    conversation.archived_message_ids = [];
    writeState(state);
    return { ok: true } as T;
  }

  const messageVersionsMatch = path.match(/^\/api\/messages\/([^/?]+)\/versions$/);
  if (messageVersionsMatch && method === "DELETE") {
    const messageId = decodeURIComponent(messageVersionsMatch[1]);
    for (const [conversationId, rows] of Object.entries(state.messages)) {
      const message = rows.find((item) => item.id === messageId);
      if (!message) continue;
      const parentId = message.role === "assistant" ? message.parent_message_id : message.id;
      const deleted = rows.filter((item) => message.role === "assistant" ? item.parent_message_id === parentId : item.id === message.id || item.parent_message_id === message.id).map((item) => item.id).filter(Boolean) as string[];
      state.messages[conversationId] = rows.filter((item) => !deleted.includes(item.id || ""));
      state.favorites = state.favorites.filter((item) => !deleted.includes(item.source_message_id));
      const conversation = findConversation(state, conversationId);
      conversation.summary = "";
      conversation.archived_message_ids = [];
      writeState(state);
      return { ok: true, deleted, parent_message_id: parentId } as T;
    }
    throw new Error("消息不存在");
  }

  const messageMatchById = path.match(/^\/api\/messages\/([^/?]+)$/);
  if (messageMatchById && method === "PATCH") {
    const messageId = decodeURIComponent(messageMatchById[1]);
    for (const [conversationId, rows] of Object.entries(state.messages)) {
      const message = rows.find((item) => item.id === messageId);
      if (!message) continue;
      message.content = String(body.content || "").trim();
      const conversation = findConversation(state, conversationId);
      conversation.summary = "";
      conversation.archived_message_ids = [];
      writeState(state);
      return message as T;
    }
    throw new Error("消息不存在");
  }
  if (messageMatchById && method === "DELETE") {
    const messageId = decodeURIComponent(messageMatchById[1]);
    for (const [conversationId, rows] of Object.entries(state.messages)) {
      const message = rows.find((item) => item.id === messageId);
      if (!message) continue;
      const deleted = rows.filter((item) => item.id === messageId || (message.role === "user" && item.parent_message_id === messageId)).map((item) => item.id).filter(Boolean) as string[];
      state.messages[conversationId] = rows.filter((item) => !deleted.includes(item.id || ""));
      state.favorites = state.favorites.filter((item) => !deleted.includes(item.source_message_id));
      if (message.role === "assistant" && message.parent_message_id) {
        const remaining = state.messages[conversationId].filter((item) => item.role === "assistant" && item.parent_message_id === message.parent_message_id);
        if (remaining.length && !remaining.some((item) => item.selected)) remaining[remaining.length - 1].selected = true;
      }
      const conversation = findConversation(state, conversationId);
      conversation.summary = "";
      conversation.archived_message_ids = [];
      writeState(state);
      return { ok: true, deleted } as T;
    }
    throw new Error("消息不存在");
  }

  if (path.startsWith("/api/favorites?") && method === "GET") {
    const query = decodeURIComponent(path.split("q=")[1] || "").toLocaleLowerCase();
    return state.favorites.filter((item) => !query || `${item.text_snapshot || ""} ${item.conversation_title_snapshot || ""}`.toLocaleLowerCase().includes(query)) as T;
  }
  const favoriteMatch = path.match(/^\/api\/favorites\/([^?]+)(?:\?owner=([^&]+))?$/);
  if (favoriteMatch && method === "POST") {
    const messageId = decodeURIComponent(favoriteMatch[1]);
    for (const [conversationId, rows] of Object.entries(state.messages)) {
      const message = rows.find((item) => item.id === messageId);
      if (!message) continue;
      const existing = state.favorites.find((item) => item.source_message_id === messageId);
      if (existing) {
        existing.owners = [...new Set([...(existing.owners || []), "user"])];
        writeState(state);
        return { id: existing.id, source_message_id: messageId, owner: "user" } as T;
      }
      const conversation = state.conversations.find((item) => item.id === conversationId);
      const favorite: Favorite = {
        id: id("favorite"),
        source_message_id: messageId,
        source_conversation_id: conversationId,
        role: message.role === "assistant" ? "assistant" : "user",
        text_snapshot: message.content,
        conversation_title_snapshot: conversation?.title || "新对话",
        message_created_at: message.created_at,
        favorited_at: timestamp(),
        owners: ["user"],
      };
      state.favorites.unshift(favorite);
      writeState(state);
      return { id: favorite.id, source_message_id: messageId, owner: "user" } as T;
    }
    throw new Error("该消息不可珍藏");
  }
  if (favoriteMatch && method === "DELETE") {
    const messageId = decodeURIComponent(favoriteMatch[1]);
    state.favorites = state.favorites.filter((item) => item.source_message_id !== messageId);
    writeState(state);
    return { ok: true } as T;
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

  const motivationMatch = path.match(/^\/api\/motivation\/([^/?]+)(?:\/(enabled|tick|reset))?$/);
  if (motivationMatch) {
    const personaKey = decodeURIComponent(motivationMatch[1]);
    const action = motivationMatch[2] || "";
    let payload = getLocalMotivation(state, personaKey);
    if (!action && method === "GET") return payload as T;
    if (action === "enabled" && method === "PUT") {
      payload.enabled = Boolean(body.enabled);
      payload.offline_mode = String(body.offline_mode || "limited");
    } else if (action === "tick" && method === "POST") {
      if (payload.enabled) tickLocalMotivation(payload);
    } else if (action === "reset" && method === "POST") {
      const enabled = payload.enabled;
      const offlineMode = payload.offline_mode;
      payload = { ...defaultMotivation(), enabled, offline_mode: offlineMode };
      state.motivations[personaKey] = payload;
    } else {
      throw new Error(`Android 本机模式尚不支持 ${method} ${path}`);
    }
    writeState(state);
    return payload as T;
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

  if (method === "POST" && path.startsWith("/api/memories/lifecycle?")) {
    const params = new URL(path, "https://local.atherloom").searchParams;
    const personaKey = params.get("persona_key") || "__default__";
    const rows = state.memories.filter((memory) => memory.persona_key === personaKey && (memory.memory_status || "active") === "active" && !memory.deleted_at);
    let faded = 0;
    let forgotten = 0;
    const current = Date.now();
    for (const memory of rows) {
      const ageDays = Math.max(0, (current - new Date(memory.updated_at || memory.created_at || current).getTime()) / 86_400_000);
      const base = Number(memory.strength ?? 0.65);
      const effective = Math.max(0, base * Math.pow(0.5, ageDays / 90));
      memory.effective_strength = Math.round(effective * 10_000) / 10_000;
      if (effective < base - 0.01) faded += 1;
      if (effective < 0.06 && !memory.starred && Number(memory.importance || 0) < 0.75) {
        memory.memory_status = "forgotten";
        memory.updated_at = timestamp();
        forgotten += 1;
      }
    }
    writeState(state);
    return { processed: rows.length, faded, forgotten } as T;
  }
  if (method === "POST" && path.startsWith("/api/memories/consolidate?")) {
    return { clusters: 0, candidates_created: 0, memory_ids: [] } as T;
  }
  if (method === "GET" && path.startsWith("/api/memories?")) {
    const params = new URL(path, "https://local.atherloom").searchParams;
    const personaKey = params.get("persona_key") || "__default__";
    const query = (params.get("q") || "").trim().toLocaleLowerCase();
    return state.memories.filter((memory) => memory.persona_key === personaKey && (
      !query || `${memory.title}\n${memory.content}`.toLocaleLowerCase().includes(query)
    )).sort((left, right) => String(right.updated_at || "").localeCompare(String(left.updated_at || ""))) as T;
  }
  if (path === "/api/memories" && method === "POST") {
    const memory: Memory = {
      id: id("memory"),
      title: String(body.title || "").trim(),
      content: String(body.content || "").trim(),
      kind: String(body.kind || "fact") as Memory["kind"],
      persona_key: String(body.persona_key || "__default__"),
      importance: Number(body.importance ?? 0.5),
      confidence: Number(body.confidence ?? 1),
      source_type: String(body.source_type || "explicit"),
      memory_status: body.source_type === "inferred" && Number(body.confidence ?? 1) < 0.7 ? "candidate" : "active",
      strength: 0.65,
      created_at: timestamp(),
      updated_at: timestamp(),
    };
    if (!memory.title || !memory.content) throw new Error("记忆标题和内容不能为空");
    state.memories.unshift(memory);
    writeState(state);
    return memory as T;
  }
  const memoryStateMatch = path.match(/^\/api\/memories\/([^/?]+)\/state$/);
  if (memoryStateMatch && method === "PATCH") {
    const memory = state.memories.find((item) => item.id === decodeURIComponent(memoryStateMatch[1]));
    if (!memory) throw new Error("记忆不存在");
    if (typeof body.starred === "boolean") memory.starred = body.starred;
    if (typeof body.archived === "boolean") memory.archived = body.archived;
    if (typeof body.trash === "boolean") memory.deleted_at = body.trash ? timestamp() : null;
    memory.updated_at = timestamp();
    writeState(state);
    return memory as T;
  }
  const memoryConfirmMatch = path.match(/^\/api\/memories\/([^/?]+)\/confirm\?accept=(true|false)$/);
  if (memoryConfirmMatch && method === "POST") {
    const memory = state.memories.find((item) => item.id === decodeURIComponent(memoryConfirmMatch[1]));
    if (!memory) throw new Error("记忆不存在");
    const accepted = memoryConfirmMatch[2] === "true";
    memory.memory_status = accepted ? "active" : "forgotten";
    memory.confidence = accepted ? 1 : 0;
    memory.updated_at = timestamp();
    writeState(state);
    return memory as T;
  }
  const memoryItemMatch = path.match(/^\/api\/memories\/([^/?]+)$/);
  if (memoryItemMatch && method === "PUT") {
    const memory = state.memories.find((item) => item.id === decodeURIComponent(memoryItemMatch[1]));
    if (!memory) throw new Error("记忆不存在");
    Object.assign(memory, body, { id: memory.id, memory_status: "active", updated_at: timestamp() });
    writeState(state);
    return memory as T;
  }

  if (path === "/api/mcp-servers/test" && method === "POST") {
    throw new Error("Android 本机模式可以保存 MCP 配置，但测试和执行需要先连接 FastAPI 后端");
  }
  if (path === "/api/mcp-servers" && method === "POST") {
    const server: McpServer = {
      ...(body as unknown as Omit<McpServer, "id">),
      id: id("mcp"),
      name: String(body.name || "").trim(),
      transport: body.transport === "stdio" ? "stdio" : "http",
      url: String(body.url || ""),
      command: String(body.command || ""),
      enabled: body.enabled !== false,
      has_token: Boolean(body.token),
      token: body.token ? "" : undefined,
      tools: [],
      last_status: "saved-local",
      last_detail: "已保存；连接 FastAPI 后可发现并执行工具",
    };
    if (!server.name) throw new Error("请填写 MCP 服务名称");
    state.mcpServers.unshift(server);
    writeState(state);
    return server as T;
  }
  const mcpRefreshMatch = path.match(/^\/api\/mcp-servers\/([^/?]+)\/refresh$/);
  if (mcpRefreshMatch && method === "POST") throw new Error("Android 本机模式暂不执行 MCP，请先连接 FastAPI 后端");
  const mcpMatch = path.match(/^\/api\/mcp-servers\/([^/?]+)$/);
  if (mcpMatch && method === "PUT") {
    const server = state.mcpServers.find((item) => item.id === decodeURIComponent(mcpMatch[1]));
    if (!server) throw new Error("MCP 服务不存在");
    const previousToken = server.has_token;
    Object.assign(server, body, { id: server.id, has_token: Boolean(body.token) || previousToken, token: undefined });
    writeState(state);
    return server as T;
  }
  if (mcpMatch && method === "DELETE") {
    state.mcpServers = state.mcpServers.filter((item) => item.id !== decodeURIComponent(mcpMatch[1]));
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
  const requestedProviderId = request.vision_provider_id && request.attachments?.some((item) => item.kind === "image")
    ? request.vision_provider_id
    : request.provider_id;
  const provider = listProviders().find((item) => item.id === requestedProviderId);
  if (!provider) throw new Error("API 线路不存在，请重新保存线路");
  const persona = state.personas.find((item) => item.id === request.persona_id);
  let historyRows = persona?.config?.history_enabled === false ? [] : selectedTimeline(state.messages[conversation.id] || [], conversation.archived_message_ids || []);
  if (request.reuse_user_message_id) {
    const pivot = historyRows.findIndex((message) => message.id === request.reuse_user_message_id);
    if (pivot >= 0) historyRows = historyRows.slice(0, pivot + 1);
  }
  const history = historyRows
    .filter((message): message is Message & { role: "user" | "assistant" } => message.role === "user" || message.role === "assistant")
    .map((message) => ({ role: message.role, content: message.content }));
  const existingUser = request.reuse_user_message_id
    ? (state.messages[conversation.id] || []).find((message) => message.id === request.reuse_user_message_id && message.role === "user")
    : null;
  if (request.reuse_user_message_id && !existingUser) throw new Error("找不到要重新生成的提问");
  const userMessage: Message = existingUser || {
    id: id("message"),
    role: "user",
    content: request.content,
    provider_id: requestedProviderId,
    attachments: request.attachments || [],
    created_at: timestamp(),
  };
  if (!existingUser) state.messages[conversation.id] = [...(state.messages[conversation.id] || []), userMessage];
  conversation.updated_at = timestamp();
  const personaKey = request.persona_id || "__default__";
  const driveContext = motivationContext(state, personaKey);
  writeState(state);
  const date = new Date();
  const templatedContent = String(persona?.config?.message_template || "{{message}}")
    .replaceAll("{{role}}", "user")
    .replaceAll("{{message}}", request.content)
    .replaceAll("{{time}}", date.toLocaleTimeString("zh-CN", { hour12: false }))
    .replaceAll("{{date}}", date.toLocaleDateString("zh-CN"));
  return {
    conversation,
    userMessage,
    autoTitleMode: String(state.settings.auto_title_mode || "local"),
    operation: {
      provider_id: requestedProviderId,
      system: [
        persona?.prompt || "",
        state.settings.proactive_questions === false
          ? "尽量直接回答，不要在结尾主动追问或发起新话题。"
          : "需要用户选择时，可以在正文末尾附加 <questions>JSON数组</questions>；每项包含 question 与至少两个 options，最多四题。除此以外保持自然对话。",
        conversation.summary ? `<conversation_summary>\n${conversation.summary}\n</conversation_summary>` : "",
        memoryContext(state, personaKey, `${historyRows.map((item) => item.content).join("\n")}\n${request.content}`),
        featureSpaceContext(personaKey),
        driveContext,
        worldbookContext(state, request.worldbook_ids || [], `${historyRows.map((item) => item.content).join("\n")}\n${request.content}`),
        request.local_time ? `<runtime_context>本地时间：${request.local_time}</runtime_context>` : "",
      ].filter(Boolean).join("\n\n"),
      messages: request.reuse_user_message_id
        ? history
        : [...history, { role: "user", content: attachmentMessage(templatedContent, request.attachments || [], provider) }],
      max_tokens: provider.max_tokens ?? 4096,
      temperature: provider.temperature ?? 0.7,
      top_p: provider.top_p ?? 1,
      thinking_enabled: provider.thinking_enabled !== false,
      custom_headers: persona?.config?.custom_headers,
      custom_body: persona?.config?.custom_body,
    },
  };
}

export function completeStandaloneChat(context: StandaloneChatContext, result: StandaloneChatResult) {
  const state = readState();
  const conversation = findConversation(state, context.conversation.id);
  const persona = state.personas.find((item) => item.id === conversation.persona_id);
  let content = String(result.content || "").trim();
  for (const rule of persona?.config?.regex_rules || []) {
    const target = String(rule.target || "both");
    if (target !== "assistant" && target !== "both") continue;
    try {
      content = content.replace(new RegExp(String(rule.pattern || ""), String(rule.flags || "g")), String(rule.replacement || ""));
    } catch {
      // Invalid persona rules stay saved for correction but never break a completed reply.
    }
  }
  const assistantMessage: Message = {
    id: id("message"),
    role: "assistant",
    content,
    reasoning: String(result.reasoning || ""),
    provider_id: context.operation.provider_id,
    model: result.model,
    usage: result.usage,
    created_at: timestamp(),
    parent_message_id: context.userMessage.id,
    selected: true,
  };
  const previous = state.messages[conversation.id] || [];
  for (const message of previous) {
    if (message.role === "assistant" && message.parent_message_id === context.userMessage.id) message.selected = false;
  }
  state.messages[conversation.id] = [...previous, assistantMessage];
  if ((!conversation.title || conversation.title === "新对话") && context.autoTitleMode === "local") {
    conversation.title = context.userMessage.content.slice(0, 28) || "新对话";
  }
  conversation.updated_at = timestamp();
  writeState(state);
  return { assistantMessage, title: conversation.title };
}

export function updateStandaloneConversationTitle(conversationId: string, value: string) {
  const state = readState();
  const conversation = findConversation(state, conversationId);
  const title = value.replace(/[\r\n"“”]/g, " ").replace(/^(标题|对话标题)[:：]\s*/, "").trim().slice(0, 40);
  if (title) conversation.title = title;
  conversation.updated_at = timestamp();
  writeState(state);
  return conversation.title;
}
