import type {
  BootstrapPayload,
  BackupBundle,
  BackupPart,
  BackupRestoreResult,
  ChatRequest,
  ChatStreamEvent,
  Conversation,
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
    const payload = JSON.parse(text) as { detail?: string; error?: string };
    return payload.detail || payload.error || `请求失败 ${response.status}`;
  } catch {
    return text.trim() || `请求失败 ${response.status}`;
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
  return new Promise<T>((resolve, reject) => {
    nativeRequests.set(callbackId, {
      resolve: (value) => resolve(value as T),
      reject,
    });
    try {
      bridge.apiRequestAsync?.(method, path, body, callbackId);
    } catch (error) {
      nativeRequests.delete(callbackId);
      reject(error instanceof Error ? error : new Error("无法启动 Android 请求"));
    }
  });
}

export async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
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
  updateConversation: (conversationId: string, patch: { title: string }) =>
    requestJson<Conversation>(`/api/conversations/${encodeURIComponent(conversationId)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  updateConversationState: (conversationId: string, patch: Partial<Pick<Conversation, "pinned" | "starred" | "archived">>) =>
    requestJson<Conversation>(`/api/conversations/${encodeURIComponent(conversationId)}/state`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteConversation: (conversationId: string) =>
    requestJson<{ deleted: boolean }>(`/api/conversations/${encodeURIComponent(conversationId)}`, { method: "DELETE" }),
  searchConversations: (query: string) =>
    requestJson<Conversation[]>(`/api/search?q=${encodeURIComponent(query)}`),
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
