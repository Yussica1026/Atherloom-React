import type {
  BootstrapPayload,
  BackupBundle,
  BackupPart,
  BackupRestoreResult,
  ChatRequest,
  ChatStreamEvent,
  Conversation,
  Favorite,
  McpServer,
  McpServerDraft,
  Memory,
  MemoryDraft,
  MotivationPayload,
  AppSettings,
  Message,
  Persona,
  PersonaDraft,
  Provider,
  ProviderDraft,
  ProviderProbeDraft,
  Worldbook,
  WorldbookDraft,
} from "../../domain/types";
import {
  beginStandaloneChat,
  completeStandaloneChat,
  isStandaloneAndroid,
  requestStandaloneJson,
  updateStandaloneConversationTitle,
  type StandaloneChatResult,
} from "../standalone/store";

const apiBaseKey = "atherloom-react:api-base";

function normalizeBase(value: string) {
  const normalized = value.trim().replace(/\/+$/, "");
  if (!normalized) return "";
  const parsed = new URL(normalized);
  if (!(["http:", "https:"] as string[]).includes(parsed.protocol)) {
    throw new Error("后端地址必须使用 http:// 或 https://");
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("后端地址只填写服务器根地址，例如 http://192.168.1.20:8876");
  }
  return normalized;
}

export function getApiBase() {
  if (window.AtherloomNative) return window.AtherloomNative.getBackendUrl() || "";
  return localStorage.getItem(apiBaseKey) || String(import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
}

export function setApiBase(value: string) {
  const normalized = normalizeBase(value);
  if (window.AtherloomNative) {
    const result = JSON.parse(window.AtherloomNative.setBackendUrl(normalized)) as { ok?: boolean; error?: string };
    if (!result.ok) throw new Error(result.error || "后端地址保存失败");
    return normalized;
  }
  if (normalized) localStorage.setItem(apiBaseKey, normalized);
  else localStorage.removeItem(apiBaseKey);
  return normalized;
}

function endpoint(path: string) {
  return `${getApiBase()}${path}`;
}

async function readError(response: Response) {
  const text = await response.text();
  try {
    const payload = JSON.parse(text) as { detail?: unknown; error?: unknown };
    const rawDetail = payload.detail ?? payload.error;
    const detail = typeof rawDetail === "string" ? rawDetail : rawDetail == null ? "" : JSON.stringify(rawDetail);
    return `HTTP ${response.status}${detail ? ` · ${detail}` : ""}`;
  } catch {
    return `HTTP ${response.status}${text.trim() ? ` · ${text.trim()}` : ""}`;
  }
}

interface NativeResult {
  ok?: boolean;
  status?: number;
  body?: string;
  error?: string;
}

function readNativeResult<T>(raw: string): T {
  let result: NativeResult;
  try {
    result = JSON.parse(raw) as NativeResult;
  } catch {
    throw new Error("Android 原生桥返回了无法识别的数据");
  }
  if (!result.ok) throw new Error(result.error || `请求失败 ${result.status || ""}`.trim());
  try {
    return JSON.parse(result.body || "null") as T;
  } catch {
    throw new Error("后端返回了无法识别的数据");
  }
}

interface NativeRequestHandler {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

const nativeRequests = new Map<string, NativeRequestHandler>();

if (typeof window !== "undefined") {
  window.AtherloomNativeRequest = (callbackId, rawResult) => {
    const handler = nativeRequests.get(callbackId);
    if (!handler) return;
    nativeRequests.delete(callbackId);
    try {
      handler.resolve(readNativeResult<unknown>(rawResult));
    } catch (error) {
      handler.reject(error instanceof Error ? error : new Error("Android 请求失败"));
    }
  };
}

function requestNativeJson<T>(method: string, path: string, body: string): Promise<T> {
  const bridge = window.AtherloomNative;
  if (!bridge) return Promise.reject(new Error("Android 原生桥不可用"));
  if (!bridge.apiRequestAsync) {
    try {
      return Promise.resolve(readNativeResult<T>(bridge.apiRequest(method, path, body)));
    } catch (error) {
      return Promise.reject(error);
    }
  }
  const callbackId = `request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return requestNativeCallback<T>(callbackId, () => bridge.apiRequestAsync?.(method, path, body, callbackId));
}

function requestNativeCallback<T>(callbackId: string, start: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    nativeRequests.set(callbackId, {
      resolve: (value) => resolve(value as T),
      reject,
    });
    try {
      start();
    } catch (error) {
      nativeRequests.delete(callbackId);
      reject(error instanceof Error ? error : new Error("无法启动 Android 请求"));
    }
  });
}

function requestNativeProvider<T>(operation: string, payload: unknown) {
  const bridge = window.AtherloomNative;
  if (!bridge?.providerOperationAsync) {
    return Promise.reject(new Error("当前 APK 不支持本机模型请求，请安装最新版本"));
  }
  const callbackId = `provider-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return requestNativeCallback<T>(callbackId, () => bridge.providerOperationAsync?.(operation, JSON.stringify(payload), callbackId));
}

export async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (isStandaloneAndroid()) return requestStandaloneJson<T>(path, init, requestNativeProvider);
  if (window.AtherloomNative) {
    const method = String(init.method || "GET").toUpperCase();
    const body = typeof init.body === "string" ? init.body : "";
    return requestNativeJson<T>(method, path, body);
  }
  const response = await fetch(endpoint(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<T>;
}

interface NativeStreamHandler {
  onEvent: (event: ChatStreamEvent) => void;
  resolve: () => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}

const nativeStreams = new Map<string, NativeStreamHandler>();

if (typeof window !== "undefined") {
  window.AtherloomNativeStream = (callbackId, rawEvent) => {
    const handler = nativeStreams.get(callbackId);
    if (!handler) return;
    try {
      const event = JSON.parse(rawEvent) as ChatStreamEvent;
      if (event.error) {
        handler.cleanup();
        handler.reject(new Error(event.error));
        return;
      }
      handler.onEvent(event);
      if (event.done) {
        handler.cleanup();
        handler.resolve();
      }
    } catch {
      handler.cleanup();
      handler.reject(new Error("Android 原生桥返回了无法识别的数据"));
    }
  };
}

function streamChatNative(
  request: ChatRequest,
  signal: AbortSignal,
  onEvent: (event: ChatStreamEvent) => void,
) {
  const bridge = window.AtherloomNative;
  if (!bridge) throw new Error("Android 原生桥不可用");
  const callbackId = `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      bridge.cancelStream(callbackId);
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    const cleanup = () => {
      signal.removeEventListener("abort", abort);
      nativeStreams.delete(callbackId);
    };
    if (signal.aborted) {
      abort();
      return;
    }
    nativeStreams.set(callbackId, { onEvent, resolve, reject, cleanup });
    signal.addEventListener("abort", abort, { once: true });
    try {
      bridge.chatStream("/api/chat", JSON.stringify(request), callbackId);
    } catch (error) {
      cleanup();
      reject(error instanceof Error ? error : new Error("无法启动 Android 流式请求"));
    }
  });
}

export const fastApi = {
  bootstrap: () => requestJson<BootstrapPayload>("/api/bootstrap"),
  conversationMessages: (conversationId: string) =>
    requestJson<Message[]>(`/api/conversations/${encodeURIComponent(conversationId)}/messages`),
  createConversation: (providerId: string | null, personaId: string | null) =>
    requestJson<Conversation>("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ provider_id: providerId, persona_id: personaId }),
    }),
  updateConversation: (conversationId: string, patch: { title?: string; provider_id?: string | null }) =>
    requestJson<Conversation>(`/api/conversations/${encodeURIComponent(conversationId)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  updateConversationState: (conversationId: string, patch: Partial<Pick<Conversation, "pinned" | "starred" | "archived">>) =>
    requestJson<Conversation>(`/api/conversations/${encodeURIComponent(conversationId)}/state`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteConversation: (conversationId: string) =>
    requestJson<{ deleted: boolean }>(`/api/conversations/${encodeURIComponent(conversationId)}`, { method: "DELETE" }),
  searchConversations: (query: string) =>
    requestJson<Conversation[]>(`/api/search?q=${encodeURIComponent(query)}`),
  branchConversation: (conversationId: string, messageId: string) =>
    requestJson<Conversation>(`/api/conversations/${encodeURIComponent(conversationId)}/branch/${encodeURIComponent(messageId)}`, { method: "POST" }),
  compressConversation: (conversationId: string, rounds: number, providerId: string) =>
    requestJson<{ ok: boolean; rounds: number; messages: number; summary: string; available_rounds: number }>(`/api/conversations/${encodeURIComponent(conversationId)}/compress`, {
      method: "POST",
      body: JSON.stringify({ rounds, provider_id: providerId }),
    }),
  editMessage: (messageId: string, content: string) =>
    requestJson<Message>(`/api/messages/${encodeURIComponent(messageId)}`, { method: "PATCH", body: JSON.stringify({ content }) }),
  selectMessageVersion: (conversationId: string, parentMessageId: string, assistantMessageId: string) =>
    requestJson<{ ok: boolean }>("/api/messages/selection", {
      method: "PATCH",
      body: JSON.stringify({ conversation_id: conversationId, parent_message_id: parentMessageId, assistant_message_id: assistantMessageId }),
    }),
  deleteMessageVersion: (messageId: string) =>
    requestJson<{ ok: boolean; deleted: string[] }>(`/api/messages/${encodeURIComponent(messageId)}`, { method: "DELETE" }),
  deleteAllMessageVersions: (messageId: string) =>
    requestJson<{ ok: boolean; deleted: string[]; parent_message_id: string }>(`/api/messages/${encodeURIComponent(messageId)}/versions`, { method: "DELETE" }),
  listFavorites: (query = "") => requestJson<Favorite[]>(`/api/favorites?q=${encodeURIComponent(query)}`),
  favoriteMessage: (messageId: string) =>
    requestJson<{ id: string; source_message_id: string; owner: string }>(`/api/favorites/${encodeURIComponent(messageId)}`, { method: "POST", body: JSON.stringify({ owner: "user" }) }),
  unfavoriteMessage: (messageId: string) =>
    requestJson<{ ok: boolean }>(`/api/favorites/${encodeURIComponent(messageId)}?owner=user`, { method: "DELETE" }),
  listMemories: (personaKey: string, query = "", includeArchived = false, includeTrash = false) =>
    requestJson<Memory[]>(`/api/memories?persona_key=${encodeURIComponent(personaKey)}&q=${encodeURIComponent(query)}&include_archived=${includeArchived ? "true" : "false"}&include_trash=${includeTrash ? "true" : "false"}`),
  createMemory: (draft: MemoryDraft) =>
    requestJson<Memory>("/api/memories", { method: "POST", body: JSON.stringify(draft) }),
  updateMemory: (id: string, draft: MemoryDraft) =>
    requestJson<Memory>(`/api/memories/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(draft) }),
  updateMemoryState: (id: string, patch: { starred?: boolean; archived?: boolean; trash?: boolean }) =>
    requestJson<Memory>(`/api/memories/${encodeURIComponent(id)}/state`, { method: "PATCH", body: JSON.stringify(patch) }),
  confirmMemory: (id: string, accept: boolean) =>
    requestJson<Memory>(`/api/memories/${encodeURIComponent(id)}/confirm?accept=${accept ? "true" : "false"}`, { method: "POST", body: "{}" }),
  organizeMemories: async (personaKey: string) => {
    const lifecycle = await requestJson<{ processed: number; faded: number; forgotten: number }>(`/api/memories/lifecycle?persona_key=${encodeURIComponent(personaKey)}`, { method: "POST", body: "{}" });
    const consolidated = await requestJson<{ clusters: number; candidates_created: number; memory_ids: string[] }>(`/api/memories/consolidate?persona_key=${encodeURIComponent(personaKey)}`, { method: "POST", body: "{}" });
    return { lifecycle, consolidated };
  },
  getMotivation: (personaKey: string) =>
    requestJson<MotivationPayload>(`/api/motivation/${encodeURIComponent(personaKey)}`),
  setMotivationEnabled: (personaKey: string, enabled: boolean, offlineMode: string) =>
    requestJson<MotivationPayload>(`/api/motivation/${encodeURIComponent(personaKey)}/enabled`, { method: "PUT", body: JSON.stringify({ enabled, offline_mode: offlineMode }) }),
  tickMotivation: (personaKey: string) =>
    requestJson<MotivationPayload>(`/api/motivation/${encodeURIComponent(personaKey)}/tick`, { method: "POST", body: "{}" }),
  resetMotivation: (personaKey: string) =>
    requestJson<MotivationPayload>(`/api/motivation/${encodeURIComponent(personaKey)}/reset`, { method: "POST", body: "{}" }),
  createMcpServer: (draft: McpServerDraft) =>
    requestJson<McpServer>("/api/mcp-servers", { method: "POST", body: JSON.stringify(draft) }),
  updateMcpServer: (id: string, draft: McpServerDraft) =>
    requestJson<McpServer>(`/api/mcp-servers/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(draft) }),
  deleteMcpServer: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/mcp-servers/${encodeURIComponent(id)}`, { method: "DELETE" }),
  testMcpServer: (draft: McpServerDraft) =>
    requestJson<{ ok: boolean; tool_count: number; tools: McpServer["tools"]; message: string }>("/api/mcp-servers/test", { method: "POST", body: JSON.stringify(draft) }),
  refreshMcpServer: (id: string) =>
    requestJson<McpServer>(`/api/mcp-servers/${encodeURIComponent(id)}/refresh`, { method: "POST", body: "{}" }),
  createProvider: (draft: ProviderDraft) =>
    requestJson<Provider>("/api/providers", { method: "POST", body: JSON.stringify(draft) }),
  updateProvider: (id: string, draft: ProviderDraft) =>
    requestJson<Provider>(`/api/providers/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(draft) }),
  deleteProvider: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/providers/${encodeURIComponent(id)}`, { method: "DELETE" }),
  fetchProviderModels: (draft: ProviderProbeDraft) =>
    requestJson<{ models: string[] }>("/api/providers/models", { method: "POST", body: JSON.stringify(draft) }),
  testProvider: (draft: ProviderDraft) =>
    requestJson<{ ok?: boolean; message: string }>("/api/providers/test", { method: "POST", body: JSON.stringify(draft) }),
  createPersona: (draft: PersonaDraft) =>
    requestJson<Persona>("/api/personas", { method: "POST", body: JSON.stringify(draft) }),
  updatePersona: (id: string, draft: PersonaDraft) =>
    requestJson<Persona>(`/api/personas/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(draft) }),
  deletePersona: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/personas/${encodeURIComponent(id)}`, { method: "DELETE" }),
  updateSettings: (settings: AppSettings) =>
    requestJson<AppSettings>("/api/settings", { method: "PUT", body: JSON.stringify(settings) }),
  createWorldbook: (draft: WorldbookDraft) =>
    requestJson<Worldbook>("/api/worldbooks", { method: "POST", body: JSON.stringify(draft) }),
  updateWorldbook: (id: string, draft: WorldbookDraft) =>
    requestJson<Worldbook>(`/api/worldbooks/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(draft) }),
  deleteWorldbook: (id: string) =>
    requestJson<{ ok: boolean }>(`/api/worldbooks/${encodeURIComponent(id)}`, { method: "DELETE" }),
  exportBackup: (parts: BackupPart[]) =>
    requestJson<BackupBundle>("/api/backup/export", { method: "POST", body: JSON.stringify({ parts }) }),
  restoreBackup: (bundle: BackupBundle, parts: BackupPart[]) =>
    requestJson<BackupRestoreResult>("/api/backup/restore", { method: "POST", body: JSON.stringify({ bundle, parts }) }),
};

function parseEventLine(line: string): ChatStreamEvent | null {
  let value = line.trim();
  if (!value || value.startsWith(":")) return null;
  if (value.startsWith("data:")) value = value.slice(5).trim();
  if (!value || value === "[DONE]") return null;
  return JSON.parse(value) as ChatStreamEvent;
}

export async function streamChat(
  request: ChatRequest,
  signal: AbortSignal,
  onEvent: (event: ChatStreamEvent) => void,
) {
  if (isStandaloneAndroid()) {
    const context = beginStandaloneChat(request);
    onEvent({ user_id: context.userMessage.id });
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const result = await requestNativeProvider<StandaloneChatResult>("chat", context.operation);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const saved = completeStandaloneChat(context, result);
    if (context.autoTitleMode === "model" && (!saved.title || saved.title === "新对话")) {
      try {
        const named = await requestNativeProvider<StandaloneChatResult>("chat", {
          ...context.operation,
          system: "请为这段新对话生成一个不超过18个汉字的简洁标题。只回复标题，不要引号和解释。",
          messages: [{ role: "user", content: context.userMessage.content }, { role: "assistant", content: saved.assistantMessage.content.slice(0, 1200) }],
          max_tokens: 40,
          temperature: 0.2,
          thinking_enabled: false,
        });
        saved.title = updateStandaloneConversationTitle(context.conversation.id, String(named.content || ""));
      } catch {
        // Naming is optional and must never discard a completed assistant reply.
      }
    }
    onEvent({
      assistant_id: saved.assistantMessage.id,
      delta: saved.assistantMessage.content,
      reasoning_delta: saved.assistantMessage.reasoning,
      usage: saved.assistantMessage.usage,
      title: saved.title,
      done: true,
    });
    return;
  }
  if (window.AtherloomNative) return streamChatNative(request, signal, onEvent);
  const response = await fetch(endpoint("/api/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok) throw new Error(await readError(response));
  if (!response.body) throw new Error("模型响应没有可读取的数据流");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  while (true) {
    const { value, done } = await reader.read();
    pending += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || "";
    for (const line of lines) {
      const event = parseEventLine(line);
      if (event) onEvent(event);
    }
    if (done) break;
  }

  if (pending.trim()) {
    const event = parseEventLine(pending);
    if (event) onEvent(event);
  }
}
