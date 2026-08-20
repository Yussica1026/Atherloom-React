import type {
  BootstrapPayload,
  ChatRequest,
  ChatStreamEvent,
  Conversation,
  Message,
  Persona,
  PersonaDraft,
  Provider,
  ProviderDraft,
} from "../../domain/types";

const configuredBase = String(import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

function endpoint(path: string) {
  return `${configuredBase}${path}`;
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

export async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
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

export const fastApi = {
  bootstrap: () => requestJson<BootstrapPayload>("/api/bootstrap"),
  conversationMessages: (conversationId: string) =>
    requestJson<Message[]>(`/api/conversations/${encodeURIComponent(conversationId)}/messages`),
  createConversation: (providerId: string | null, personaId: string | null) =>
    requestJson<Conversation>("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ provider_id: providerId, persona_id: personaId }),
    }),
  createProvider: (draft: ProviderDraft) =>
    requestJson<Provider>("/api/providers", { method: "POST", body: JSON.stringify(draft) }),
  createPersona: (draft: PersonaDraft) =>
    requestJson<Persona>("/api/personas", { method: "POST", body: JSON.stringify(draft) }),
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
