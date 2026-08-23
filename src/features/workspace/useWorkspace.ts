import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fastApi, streamChat } from "../../adapters/fastapi/client";
import { isStandaloneAndroid } from "../../adapters/standalone/store";
import type {
  AppSettings,
  Attachment,
  BackupBundle,
  BackupPart,
  Conversation,
  Favorite,
  McpServer,
  McpServerDraft,
  Message,
  Persona,
  PersonaDraft,
  Provider,
  ProviderDraft,
  ProviderProbeDraft,
  Worldbook,
  WorldbookDraft,
} from "../../domain/types";
import { subagentIntentPattern } from "../../domain/toolIntents";
import { normalizeVoiceConfig } from "../voice/types";

const providerKey = "atherloom-react:last-provider";
const personaKey = "atherloom-react:last-persona";
const conversationKey = "atherloom-react:last-conversation";
const voiceConfigKey = "atherloom-react:voice-config:v1";
const privateConversationCleanupKey = "atherloom-react:private-conversation-cleanup:v1";

function readPrivateConversationCleanupQueue() {
  try {
    const parsed = JSON.parse(localStorage.getItem(privateConversationCleanupKey) || "[]") as unknown;
    if (!Array.isArray(parsed)) return [] as string[];
    return [...new Set(parsed.map((value) => String(value || "").trim()).filter(Boolean))];
  } catch {
    return [] as string[];
  }
}

function writePrivateConversationCleanupQueue(ids: string[]) {
  const normalized = [...new Set(ids.map((value) => value.trim()).filter(Boolean))];
  if (normalized.length) localStorage.setItem(privateConversationCleanupKey, JSON.stringify(normalized));
  else localStorage.removeItem(privateConversationCleanupKey);
  return normalized;
}

function queuePrivateConversationCleanup(id: string) {
  return writePrivateConversationCleanupQueue([...readPrivateConversationCleanupQueue(), id]);
}

function removePrivateConversationCleanup(id: string) {
  return writePrivateConversationCleanupQueue(readPrivateConversationCleanupQueue().filter((value) => value !== id));
}

function conversationIsAlreadyDeleted(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error || "");
  return /(?:HTTP|请求失败)\s*404\b|会话不存在|not found/i.test(detail);
}

async function deletePrivateConversationOrQueue(id: string) {
  try {
    await fastApi.deleteConversation(id);
    removePrivateConversationCleanup(id);
    return true;
  } catch (error) {
    if (conversationIsAlreadyDeleted(error)) {
      removePrivateConversationCleanup(id);
      return true;
    }
    queuePrivateConversationCleanup(id);
    return false;
  }
}

async function retryPrivateConversationCleanup(ids: string[]) {
  for (const id of ids) {
    try {
      await deletePrivateConversationOrQueue(id);
    } catch {
      // The ID was already persisted before hydrate; keep it hidden for the next retry.
    }
  }
  return readPrivateConversationCleanupQueue();
}

function readLocalVoiceConfig(): AppSettings["voice_config"] {
  try {
    const raw = localStorage.getItem(voiceConfigKey);
    return raw ? normalizeVoiceConfig(JSON.parse(raw)) : undefined;
  } catch {
    return undefined;
  }
}

function withLocalVoiceConfig(settings: AppSettings): AppSettings {
  const voiceConfig = readLocalVoiceConfig();
  return voiceConfig ? { ...settings, voice_config: voiceConfig } : settings;
}

function personaScope(personaId: string | null) {
  return personaId || "__default__";
}

function scopedConversationKey(personaId: string | null) {
  return `${conversationKey}:${personaScope(personaId)}`;
}

function rememberConversation(conversationId: string | null, personaId: string | null) {
  const key = scopedConversationKey(personaId);
  if (conversationId) {
    localStorage.setItem(key, conversationId);
    localStorage.setItem(conversationKey, conversationId);
  } else {
    localStorage.removeItem(key);
    localStorage.removeItem(conversationKey);
  }
}

function clientId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function localTimeContext() {
  const now = new Date();
  return `${now.toLocaleDateString("zh-CN")} ${now.toLocaleTimeString("zh-CN", { hour12: false })}`;
}

function providerDraft(provider: Provider, model = provider.model): ProviderDraft {
  return {
    name: provider.name,
    protocol: provider.protocol,
    base_url: provider.base_url,
    api_key: "",
    model,
    models: [...new Set([model, ...(provider.models || [])])],
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
  };
}

function parsePrivateJournal(value: string, personaName: string) {
  const normalized = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const candidate = normalized.match(/\{[\s\S]*\}/)?.[0] || "";
  if (candidate) {
    try {
      const parsed = JSON.parse(candidate) as { title?: unknown; content?: unknown };
      const content = String(parsed.content || "").trim();
      if (content) return { title: String(parsed.title || "").trim().slice(0, 120) || `${personaName}的一页日记`, content: content.slice(0, 30000) };
    } catch {
      // Some models still wrap valid diary prose around malformed JSON; preserve the prose below.
    }
  }
  if (!normalized) throw new Error("模型没有返回日记内容");
  return { title: `${personaName}的日记 · ${new Date().toLocaleDateString("zh-CN")}`, content: normalized.slice(0, 30000) };
}

export function useWorkspace() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [worldbooks, setWorldbooks] = useState<Worldbook[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [settings, setSettings] = useState<AppSettings>({});
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [providerId, setProviderIdState] = useState<string | null>(null);
  const [personaId, setPersonaIdState] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [privateCleanupIds, setPrivateCleanupIds] = useState<string[]>(readPrivateConversationCleanupQueue);
  const abortRef = useRef<AbortController | null>(null);
  const settingsRef = useRef<AppSettings>({});
  const settingsSaveRef = useRef<Promise<unknown>>(Promise.resolve());
  const settingsRevisionRef = useRef(0);
  const hydratePromiseRef = useRef<Promise<void> | null>(null);
  const personaRequestRef = useRef(0);
  const privateGenerationRef = useRef(false);

  const hydrate = useCallback(async () => {
    if (hydratePromiseRef.current) return hydratePromiseRef.current;
    const task = (async () => {
      setLoading(true);
      setError("");
      try {
        const queuedCleanupIds = readPrivateConversationCleanupQueue();
        setPrivateCleanupIds(queuedCleanupIds);
        const [payload, nextFavorites, remainingCleanupIds] = await Promise.all([
          fastApi.bootstrap(),
          fastApi.listFavorites().catch(() => [] as Favorite[]),
          retryPrivateConversationCleanup(queuedCleanupIds),
        ]);
        const hiddenCleanupIds = new Set([...queuedCleanupIds, ...remainingCleanupIds]);
        const nextProviders = payload.providers || [];
        const nextPersonas = payload.personas || [];
        const nextConversations = (payload.conversations || []).filter((conversation) => !hiddenCleanupIds.has(conversation.id));
        setPrivateCleanupIds(readPrivateConversationCleanupQueue());
        setProviders(nextProviders);
        setPersonas(nextPersonas);
        setWorldbooks(payload.worldbooks || []);
        setConversations(nextConversations);
        const nextSettings = withLocalVoiceConfig(payload.settings || {});
        setSettings(nextSettings);
        setFavorites(nextFavorites);
        setMcpServers(payload.mcp_servers || []);
        settingsRef.current = nextSettings;

        const storedProvider = localStorage.getItem(providerKey);
        const storedPersona = localStorage.getItem(personaKey);
        const nextPersona = nextPersonas.some((item) => item.id === storedPersona) ? storedPersona : nextPersonas[0]?.id || null;
        const persona = nextPersonas.find((item) => item.id === nextPersona) || null;
        const personaProvider = persona?.config?.provider_id || persona?.provider_id || null;
        const nextProvider = nextProviders.some((item) => item.id === personaProvider)
          ? personaProvider
          : nextProviders.some((item) => item.id === storedProvider) ? storedProvider : nextProviders[0]?.id || null;
        setProviderIdState(nextProvider);
        setPersonaIdState(nextPersona);

        const scoped = nextConversations.filter((item) => !item.archived && (item.persona_id || null) === nextPersona);
        const storedConversation = localStorage.getItem(scopedConversationKey(nextPersona)) || localStorage.getItem(conversationKey);
        const storedMatch = scoped.find((item) => item.id === storedConversation) || null;
        const resume = storedMatch || scoped[0] || null;
        const shouldCreate = persona?.config?.startup_chat === "new" || !resume;
        if (shouldCreate && nextProvider) {
          const conversation = await fastApi.createConversation(nextProvider, nextPersona);
          setConversations((current) => [conversation, ...current]);
          setCurrentId(conversation.id);
          setMessages([]);
          rememberConversation(conversation.id, nextPersona);
        } else if (resume) {
          setCurrentId(resume.id);
          setMessages(await fastApi.conversationMessages(resume.id));
          rememberConversation(resume.id, nextPersona);
          if (resume.provider_id) setProviderIdState(resume.provider_id);
        } else {
          setCurrentId(null);
          setMessages([]);
          rememberConversation(null, nextPersona);
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "无法连接 Atherloom 后端");
      } finally {
        setLoading(false);
      }
    })();
    hydratePromiseRef.current = task;
    try {
      await task;
    } finally {
      if (hydratePromiseRef.current === task) hydratePromiseRef.current = null;
    }
  }, []);

  useEffect(() => { void hydrate(); }, [hydrate]);

  const visibleConversations = useMemo(
    () => conversations.filter((conversation) => !privateCleanupIds.includes(conversation.id) && (conversation.persona_id || null) === personaId),
    [conversations, personaId, privateCleanupIds],
  );

  const currentConversation = privateCleanupIds.includes(currentId || "") ? null : conversations.find((conversation) => conversation.id === currentId) || null;

  const setProviderId = useCallback((id: string) => {
    setProviderIdState(id || null);
    if (id) localStorage.setItem(providerKey, id);
  }, []);

  const openConversation = useCallback(async (id: string) => {
    if (busy) return;
    const requestId = ++personaRequestRef.current;
    setError("");
    try {
      const conversation = conversations.find((item) => item.id === id);
      if (!conversation) throw new Error("找不到这条对话");
      if ((conversation.persona_id || null) !== personaId) throw new Error("这条对话属于其他人格，已阻止串线");
      const nextMessages = await fastApi.conversationMessages(id);
      if (requestId !== personaRequestRef.current) return;
      setCurrentId(id);
      setMessages(nextMessages);
      rememberConversation(id, personaId);
      if (conversation?.provider_id) setProviderId(conversation.provider_id);
    } catch (caught) {
      if (requestId !== personaRequestRef.current) return;
      setError(caught instanceof Error ? caught.message : "读取对话失败");
    }
  }, [busy, conversations, personaId, setProviderId]);

  const createConversation = useCallback(async () => {
    if (!providerId) throw new Error("请先添加并选择 API 线路");
    const conversation = await fastApi.createConversation(providerId, personaId);
    setConversations((current) => [conversation, ...current]);
    setCurrentId(conversation.id);
    setMessages([]);
    rememberConversation(conversation.id, personaId);
    return conversation;
  }, [personaId, providerId]);

  const selectPersona = useCallback(async (id: string | null) => {
    if (busy || (id === personaId && currentId)) return;
    const requestId = ++personaRequestRef.current;
    setError("");
    const persona = personas.find((item) => item.id === id) || null;
    const preferredProvider = persona?.config?.provider_id || persona?.provider_id || providerId || providers[0]?.id || null;
    setPersonaIdState(id);
    if (id) localStorage.setItem(personaKey, id); else localStorage.removeItem(personaKey);
    if (preferredProvider) setProviderId(preferredProvider);
    setCurrentId(null);
    setMessages([]);

    try {
      const scoped = conversations.filter((item) => !item.archived && (item.persona_id || null) === id);
      const storedId = localStorage.getItem(scopedConversationKey(id));
      const resume = scoped.find((item) => item.id === storedId) || scoped[0] || null;
      const shouldCreate = persona?.config?.startup_chat === "new" || !resume;
      if (shouldCreate) {
        if (!preferredProvider) {
          rememberConversation(null, id);
          return;
        }
        const conversation = await fastApi.createConversation(preferredProvider, id);
        if (requestId !== personaRequestRef.current) return;
        setConversations((current) => [conversation, ...current]);
        setCurrentId(conversation.id);
        setMessages([]);
        rememberConversation(conversation.id, id);
        return;
      }
      const nextMessages = await fastApi.conversationMessages(resume.id);
      if (requestId !== personaRequestRef.current) return;
      setCurrentId(resume.id);
      setMessages(nextMessages);
      rememberConversation(resume.id, id);
      if (resume.provider_id) setProviderId(resume.provider_id);
    } catch (caught) {
      if (requestId !== personaRequestRef.current) return;
      rememberConversation(null, id);
      setError(caught instanceof Error ? caught.message : "切换人格失败");
    }
  }, [busy, conversations, currentId, personaId, personas, providerId, providers, setProviderId]);

  const deleteConversation = useCallback(async (id: string) => {
    if (busy) throw new Error("请先停止当前生成，再删除对话");
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) throw new Error("找不到这条对话");
    if ((conversation.persona_id || null) !== personaId) throw new Error("不能从当前人格删除其他人格的对话");

    const previousConversations = conversations;
    const previousMessages = messages;
    const wasCurrent = currentId === id;
    const remaining = conversations.filter((item) => item.id !== id);
    setConversations(remaining);
    if (wasCurrent) {
      setCurrentId(null);
      setMessages([]);
      rememberConversation(null, personaId);
    }

    try {
      await fastApi.deleteConversation(id);
    } catch (caught) {
      setConversations(previousConversations);
      if (wasCurrent) {
        setCurrentId(id);
        setMessages(previousMessages);
        rememberConversation(id, personaId);
      }
      throw caught;
    }

    if (!wasCurrent) return;
    const next = remaining.find((item) => !item.archived && (item.persona_id || null) === personaId) || null;
    if (!next) return;
    try {
      const nextMessages = await fastApi.conversationMessages(next.id);
      setCurrentId(next.id);
      setMessages(nextMessages);
      rememberConversation(next.id, personaId);
      if (next.provider_id) setProviderId(next.provider_id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "对话已删除，但下一条对话读取失败");
    }
  }, [busy, conversations, currentId, messages, personaId, setProviderId]);

  const clearPersonaConversations = useCallback(async () => {
    if (busy) throw new Error("请先停止当前生成，再清空对话");
    const scoped = conversations.filter((item) => (item.persona_id || null) === personaId);
    if (!scoped.length) return;
    const ids = new Set(scoped.map((item) => item.id));
    const previousConversations = conversations;
    const previousCurrentId = currentId;
    const previousMessages = messages;
    setConversations((current) => current.filter((item) => !ids.has(item.id)));
    setCurrentId(null);
    setMessages([]);
    rememberConversation(null, personaId);
    const failures: string[] = [];
    for (const id of ids) {
      try {
        await fastApi.deleteConversation(id);
      } catch (error) {
        failures.push(`${id}：${error instanceof Error ? error.message : "删除失败"}`);
      }
    }
    if (!failures.length) return;
    try {
      const payload = await fastApi.bootstrap();
      setConversations(payload.conversations || []);
      setFavorites(await fastApi.listFavorites(personaId || "__default__"));
    } catch {
      setConversations(previousConversations);
      setCurrentId(previousCurrentId);
      setMessages(previousMessages);
      rememberConversation(previousCurrentId, personaId);
    }
    throw new Error(`没有全部删完：${failures[0]}`);
  }, [busy, conversations, currentId, messages, personaId]);

  const renameConversation = useCallback(async (id: string, title: string) => {
    const normalized = title.trim();
    if (!normalized) throw new Error("对话名称不能为空");
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) throw new Error("找不到这条对话");
    if ((conversation.persona_id || null) !== personaId) throw new Error("不能修改其他人格的对话");
    const saved = await fastApi.updateConversation(id, { title: normalized });
    setConversations((current) => current.map((item) => item.id === id ? saved : item));
    return saved;
  }, [conversations, personaId]);

  const updateConversationState = useCallback(async (
    id: string,
    patch: Partial<Pick<Conversation, "pinned" | "starred" | "archived">>,
  ) => {
    if (busy) throw new Error("请先停止当前生成，再修改对话状态");
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) throw new Error("找不到这条对话");
    if ((conversation.persona_id || null) !== personaId) throw new Error("不能修改其他人格的对话");
    const previousConversations = conversations;
    const previousMessages = messages;
    const optimistic = { ...conversation, ...patch };
    const archivesCurrent = currentId === id && Boolean(patch.archived);
    setConversations((current) => current.map((item) => item.id === id ? optimistic : item));
    if (archivesCurrent) {
      setCurrentId(null);
      setMessages([]);
      rememberConversation(null, personaId);
    }
    let saved: Conversation;
    try {
      saved = await fastApi.updateConversationState(id, patch);
      setConversations((current) => current.map((item) => item.id === id ? saved : item));
    } catch (caught) {
      setConversations(previousConversations);
      if (archivesCurrent) {
        setCurrentId(id);
        setMessages(previousMessages);
        rememberConversation(id, personaId);
      }
      throw caught;
    }
    if (!archivesCurrent) return saved;
    const next = previousConversations.find((item) => item.id !== id && !item.archived && (item.persona_id || null) === personaId) || null;
    if (!next) return saved;
    try {
      setCurrentId(next.id);
      setMessages(await fastApi.conversationMessages(next.id));
      rememberConversation(next.id, personaId);
      if (next.provider_id) setProviderId(next.provider_id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "对话已归档，但下一条对话读取失败");
    }
    return saved;
  }, [busy, conversations, currentId, messages, personaId, setProviderId]);

  const searchConversations = useCallback(async (query: string) => {
    const matches = await fastApi.searchConversations(query);
    return matches.filter((item) => (item.persona_id || null) === personaId);
  }, [personaId]);

  const runGeneration = useCallback(async (
    content: string,
    reuseUserMessageId: string | null = null,
    attachments: Attachment[] = [],
    worldbookIds: string[] = [],
    typingContext = "",
  ) => {
    const trimmed = content.trim();
    if (!trimmed || busy) return;
    if (!providerId) throw new Error("请先添加并选择 API 线路");
    const toolPermissions = settingsRef.current.tool_permissions && typeof settingsRef.current.tool_permissions === "object"
      ? settingsRef.current.tool_permissions as Record<string, unknown>
      : {};
    const writingToolIntent = /日记|留言板|便利贴|便笺|留给你的话|给我留言|写下来/u.test(trimmed);
    const lifeRecordToolIntent = /备忘录|备忘一下|记个备忘|生活簿|待办|待办清单|任务清单|(?:备忘|便签).{0,12}(?:风格|颜色|色调|主题|版式)|(?:风格|颜色|色调|主题|版式).{0,12}(?:备忘|便签)/u.test(trimmed);
    const subagentToolIntent = subagentIntentPattern.test(trimmed);
    const approvedToolPermissions: string[] = [];
    if (writingToolIntent && String(toolPermissions.diary_write || "ask") === "ask" && window.confirm(
      "允许 AI 在本轮按需写日记或在留言板贴便笺吗？\n\n只对本轮有效；密封内容不会显示在聊天里。",
    )) approvedToolPermissions.push("diary_write");
    if (lifeRecordToolIntent && String(toolPermissions.life_records || "ask") === "ask" && window.confirm(
      "允许 AI 在本轮新增一条备忘或待办吗？\n\nAI 可以选择版式与主题色调；只允许新增，不允许删除或改写已有记录。",
    )) approvedToolPermissions.push("life_records");
    if (subagentToolIntent && String(toolPermissions.subagent_run || "ask") === "ask" && window.confirm(
      "允许 AI 在本轮调用当前人格已启用的子代理吗？\n\n子代理只会收到这次明确委托的任务，不会获得完整聊天记录。",
    )) approvedToolPermissions.push("subagent_run");

    const conversation = currentId ? conversations.find((item) => item.id === currentId) : await createConversation();
    if (!conversation) throw new Error("无法创建对话");

    const userClientId = reuseUserMessageId ? "" : clientId("user");
    const assistantClientId = clientId("assistant");
    const provider = providers.find((item) => item.id === providerId);
    setMessages((current) => [
      ...current.filter((message) => !(reuseUserMessageId && message.role === "assistant" && message.parent_message_id === reuseUserMessageId && message.error)),
      ...(reuseUserMessageId ? [] : [{ client_id: userClientId, role: "user" as const, content: trimmed, attachments }]),
      {
        client_id: assistantClientId,
        role: "assistant" as const,
        content: "",
        reasoning: "",
        model: provider?.model,
        parent_message_id: reuseUserMessageId,
        pending: true,
        selected: true,
      },
    ]);
    setBusy(true);
    setError("");
    const controller = new AbortController();
    let assistantText = "";
    abortRef.current = controller;

    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (!reuseUserMessageId && currentId) {
        const userRounds = messages.filter((item) => item.role === "user").length;
        const estimatedTokens = Math.ceil(messages.reduce((sum, item) => sum + item.content.length, 0) * 0.9);
        const roundTrigger = settingsRef.current.summary_enabled !== false
          && userRounds >= Math.max(4, Number(settingsRef.current.summary_trigger_rounds || 24));
        const tokenTrigger = Boolean(settingsRef.current.summary_token_enabled)
          && estimatedTokens >= Math.max(1000, Number(settingsRef.current.summary_token_threshold || 32000));
        const summaryProviderId = String(settingsRef.current.summary_provider_id || providerId);
        if ((roundTrigger || tokenTrigger) && summaryProviderId && userRounds > 1) {
          try {
            const compressed = await fastApi.compressConversation(currentId, Math.max(1, userRounds - 1), summaryProviderId);
            setConversations((current) => current.map((item) => item.id === currentId ? { ...item, summary: compressed.summary } : item));
          } catch {
            // Automatic compression is best effort; a failed summary must never consume or block the user's message.
          }
        }
      }
      await streamChat({
        conversation_id: conversation.id,
        content: trimmed,
        provider_id: providerId,
        persona_id: personaId,
        reuse_user_message_id: reuseUserMessageId,
        local_time: localTimeContext(),
        vision_provider_id: String(settingsRef.current.vision_provider_id || ""),
        attachments,
        worldbook_ids: worldbookIds,
        typing_context: reuseUserMessageId ? "" : typingContext,
        thinking_enabled: provider?.thinking_enabled !== false,
        approved_tool_permissions: approvedToolPermissions,
      }, controller.signal, (event) => {
        if (event.error) throw new Error(event.error);
        assistantText += event.delta || "";
        setMessages((current) => current.map((message) => {
          if (message.client_id === userClientId && event.user_id) return { ...message, id: event.user_id };
          const parentId = reuseUserMessageId || event.user_id || null;
          if (event.done && parentId && message.role === "assistant" && message.client_id !== assistantClientId && message.parent_message_id === parentId) {
            return { ...message, selected: false };
          }
          if (message.client_id !== assistantClientId) return message;
          return {
            ...message,
            id: event.assistant_id || message.id,
            parent_message_id: parentId || message.parent_message_id,
            content: message.content + (event.delta || ""),
            reasoning: (message.reasoning || "") + (event.reasoning_delta || ""),
            memory_sources: event.memory_sources || message.memory_sources,
            usage: event.usage || message.usage,
            tool_events: event.tool_event ? [...(message.tool_events || []), event.tool_event] : message.tool_events,
            pending: !event.done,
            selected: event.done ? true : message.selected,
          };
        }));
        if (event.title) {
          setConversations((current) => current.map((item) => item.id === conversation.id ? { ...item, title: event.title || item.title } : item));
        }
      });
    } catch (caught) {
      if (controller.signal.aborted) {
        setMessages((current) => current.map((message) => message.client_id === assistantClientId ? { ...message, pending: false } : message));
      } else {
        const detail = caught instanceof Error ? caught.message : "生成失败";
        setMessages((current) => current.map((message) => message.client_id === assistantClientId ? { ...message, content: message.content || `连接失败：${detail}`, pending: false, error: true } : message));
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
    return assistantText.trim();
  }, [busy, conversations, createConversation, currentId, messages, personaId, providerId, providers]);

  const send = useCallback((content: string, attachments: Attachment[] = [], worldbookIds: string[] = [], typingContext = "") => (
    runGeneration(content, null, attachments, worldbookIds, typingContext)
  ), [runGeneration]);

  const generatePrivateJournal = useCallback(async (targetPersonaKey: string, trigger: "manual" | "scheduled" | "catch_up", guidance = "", visibleToUser = false) => {
    if (busy) throw new Error("当前聊天正在生成，请稍后再写日记");
    if (privateGenerationRef.current) throw new Error("已有一篇私人日记正在生成");
    const targetPersonaId = targetPersonaKey === "__default__" ? null : targetPersonaKey;
    const targetPersona = targetPersonaId ? personas.find((item) => item.id === targetPersonaId) || null : null;
    if (targetPersonaId && !targetPersona) throw new Error("日记计划所属人格已不存在");
    const targetProviderId = targetPersona?.config?.provider_id || targetPersona?.provider_id || (targetPersonaId === personaId ? providerId : null) || providers.find((item) => item.enabled !== false)?.id || null;
    if (!targetProviderId) throw new Error("请先为这个人格选择可用的 API 线路");
    if (!isStandaloneAndroid()) {
      throw new Error("当前旧 FastAPI 没有无副作用的日记草稿模式。为避免重复写入或泄露密封内容，服务器模式暂不执行 AI 日记生成。");
    }

    privateGenerationRef.current = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 180_000);
    let temporary: Conversation | null = null;
    let output = "";
    try {
      temporary = await fastApi.createConversation(targetProviderId, targetPersonaId);
      const triggerLabel = trigger === "manual" ? "你此刻主动想写" : trigger === "catch_up" ? "应用重新打开后补写错过的时段" : "到了你预定的写作时间";
      const prompt = [
        "【AI 私人日记写作】",
        `现在是${new Date().toLocaleString("zh-CN", { hour12: false })}，${triggerLabel}。`,
        "请以你自己、也就是当前人格的第一人称写一篇真正属于你的日记。它不是回复用户，不要问候、解释任务或提到系统提示。可以回望你能读取的共同经历、记忆与既有日记，也可以诚实记录此刻没有大事发生。不要虚构你看不到的现实事件。",
        guidance.trim() ? `这次可参考的私人写作上下文：\n${guidance.trim().slice(0, 5000)}` : "这次没有额外写作线索，请自行决定最想留下的内容。",
        "只输出 JSON 对象，不要 Markdown 代码围栏：{\"title\":\"简短标题\",\"content\":\"日记正文\"}",
      ].join("\n");
      await streamChat({
        conversation_id: temporary.id,
        content: prompt,
        provider_id: targetProviderId,
        persona_id: targetPersonaId,
        local_time: localTimeContext(),
        attachments: [],
        worldbook_ids: [],
        typing_context: "",
        thinking_enabled: false,
        writing_context_mode: visibleToUser ? "none" : "private",
        tool_mode: "none",
      }, controller.signal, (event) => {
        if (event.error) throw new Error(event.error);
        output += event.delta || "";
      });
      if (controller.signal.aborted) throw new Error("私人日记生成超时，请稍后重试");
      return parsePrivateJournal(output, targetPersona?.name || "默认人格");
    } catch (error) {
      if (controller.signal.aborted) throw new Error("私人日记生成超时，请稍后重试");
      throw error;
    } finally {
      window.clearTimeout(timeout);
      privateGenerationRef.current = false;
      if (temporary) {
        await deletePrivateConversationOrQueue(temporary.id);
        setPrivateCleanupIds(readPrivateConversationCleanupQueue());
      }
    }
  }, [busy, personaId, personas, providerId, providers]);

  const generatePrivateDream = useCallback(async (targetPersonaKey: string) => {
    if (busy) throw new Error("当前聊天正在生成，请稍后再让 TA 做梦");
    if (privateGenerationRef.current) throw new Error("已有一项私人写作正在生成");
    const targetPersonaId = targetPersonaKey === "__default__" ? null : targetPersonaKey;
    const targetPersona = targetPersonaId ? personas.find((item) => item.id === targetPersonaId) || null : null;
    if (targetPersonaId && !targetPersona) throw new Error("梦库所属人格已不存在");
    const targetProviderId = targetPersona?.config?.provider_id || targetPersona?.provider_id || (targetPersonaId === personaId ? providerId : null) || providers.find((item) => item.enabled !== false)?.id || null;
    if (!targetProviderId) throw new Error("请先为这个人格选择可用的 API 线路");

    privateGenerationRef.current = true;
    try {
      const draft = await fastApi.generateDream(targetPersonaKey, targetProviderId);
      const content = draft.raw_text.trim();
      if (!content) throw new Error("模型没有返回梦境内容");
      return {
        title: draft.title.trim().slice(0, 120) || `${targetPersona?.name || "默认人格"}的一场梦`,
        content: content.slice(0, 30000),
      };
    } finally {
      privateGenerationRef.current = false;
    }
  }, [busy, personaId, personas, providerId, providers]);

  const regenerateMessage = useCallback(async (message: Message) => {
    const userId = message.role === "user" ? message.id : message.parent_message_id;
    if (!userId) throw new Error("这条消息还没有保存，暂时不能重新 Roll");
    const userMessage = messages.find((item) => item.id === userId && item.role === "user");
    if (!userMessage) throw new Error("找不到这条回答对应的用户消息");
    await runGeneration(userMessage.content, userId);
  }, [messages, runGeneration]);

  const editMessage = useCallback(async (messageId: string, content: string) => {
    const normalized = content.trim();
    if (!normalized) throw new Error("消息内容不能为空");
    const saved = await fastApi.editMessage(messageId, normalized);
    setMessages((current) => current.map((item) => item.id === messageId ? { ...item, content: saved.content } : item));
    setConversations((current) => current.map((item) => item.id === currentId ? { ...item, summary: "" } : item));
    return saved;
  }, [currentId]);

  const selectProviderModel = useCallback(async (value: string) => {
    const separator = value.indexOf("::");
    const nextProviderId = separator >= 0 ? value.slice(0, separator) : value;
    const model = separator >= 0 ? decodeURIComponent(value.slice(separator + 2)) : "";
    const provider = providers.find((item) => item.id === nextProviderId);
    if (!provider) throw new Error("模型线路不存在");
    let savedProvider = provider;
    if (model && model !== provider.model) {
      savedProvider = await fastApi.updateProvider(provider.id, providerDraft(provider, model));
      setProviders((current) => current.map((item) => item.id === provider.id ? savedProvider : item));
    }
    setProviderId(nextProviderId);
    if (currentId) {
      const savedConversation = await fastApi.updateConversation(currentId, { provider_id: nextProviderId });
      setConversations((current) => current.map((item) => item.id === currentId ? savedConversation : item));
    }
    return savedProvider;
  }, [currentId, providers, setProviderId]);

  const setProviderStreamMode = useCallback(async (enabled: boolean) => {
    if (busy) throw new Error("请先停止当前生成，再切换输出方式");
    const provider = providers.find((item) => item.id === providerId);
    if (!provider) throw new Error("当前没有可修改的模型线路");
    const saved = await fastApi.updateProvider(provider.id, { ...providerDraft(provider), stream_enabled: enabled });
    setProviders((current) => current.map((item) => item.id === provider.id ? saved : item));
    return saved;
  }, [busy, providerId, providers]);

  const selectMessageVersion = useCallback(async (parentMessageId: string, assistantMessageId: string) => {
    if (!currentId) throw new Error("当前没有打开的对话");
    const previous = messages;
    setMessages((current) => current.map((item) => item.role === "assistant" && item.parent_message_id === parentMessageId
      ? { ...item, selected: item.id === assistantMessageId }
      : item));
    try {
      await fastApi.selectMessageVersion(currentId, parentMessageId, assistantMessageId);
      setConversations((current) => current.map((item) => item.id === currentId ? { ...item, summary: "" } : item));
    } catch (caught) {
      setMessages(previous);
      throw caught;
    }
  }, [currentId, messages]);

  const deleteMessageVersion = useCallback(async (messageId: string) => {
    const result = await fastApi.deleteMessageVersion(messageId);
    const removed = new Set(result.deleted || [messageId]);
    setMessages((current) => current.filter((item) => !item.id || !removed.has(item.id)));
    setFavorites((current) => current.filter((item) => !removed.has(item.source_message_id)));
    setConversations((current) => current.map((item) => item.id === currentId ? { ...item, summary: "" } : item));
  }, [currentId]);

  const deleteAllMessageVersions = useCallback(async (messageId: string) => {
    const result = await fastApi.deleteAllMessageVersions(messageId);
    const removed = new Set(result.deleted || []);
    setMessages((current) => current.filter((item) => !item.id || !removed.has(item.id)));
    setFavorites((current) => current.filter((item) => !removed.has(item.source_message_id)));
    setConversations((current) => current.map((item) => item.id === currentId ? { ...item, summary: "" } : item));
  }, [currentId]);

  const branchFromMessage = useCallback(async (messageId: string) => {
    if (!currentId) throw new Error("当前没有打开的对话");
    const requestId = ++personaRequestRef.current;
    const conversation = await fastApi.branchConversation(currentId, messageId);
    const nextMessages = await fastApi.conversationMessages(conversation.id);
    if (requestId !== personaRequestRef.current) return conversation;
    setConversations((current) => [conversation, ...current]);
    setCurrentId(conversation.id);
    setMessages(nextMessages);
    rememberConversation(conversation.id, personaId);
    return conversation;
  }, [currentId, personaId]);

  const compressConversation = useCallback(async (rounds: number, compressionProviderId: string) => {
    if (busy) throw new Error("请先等待当前回复完成或停止生成");
    if (!currentId) throw new Error("当前还没有可压缩的对话");
    const result = await fastApi.compressConversation(currentId, rounds, compressionProviderId);
    setConversations((current) => current.map((item) => item.id === currentId ? { ...item, summary: result.summary } : item));
    return result;
  }, [busy, currentId]);

  const toggleFavorite = useCallback(async (messageId: string) => {
    const existing = favorites.some((item) => item.source_message_id === messageId && (item.owners || []).includes("user"));
    if (existing) await fastApi.unfavoriteMessage(messageId);
    else await fastApi.favoriteMessage(messageId);
    setFavorites(await fastApi.listFavorites());
  }, [favorites]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const createProvider = useCallback(async (draft: ProviderDraft) => {
    const provider = await fastApi.createProvider(draft);
    setProviders((current) => [...current, provider]);
    setProviderId(provider.id);
  }, [setProviderId]);

  const updateProvider = useCallback(async (id: string, draft: ProviderDraft) => {
    const provider = await fastApi.updateProvider(id, draft);
    setProviders((current) => current.map((item) => item.id === id ? provider : item));
    return provider;
  }, []);

  const deleteProvider = useCallback(async (id: string) => {
    await fastApi.deleteProvider(id);
    const remaining = providers.filter((item) => item.id !== id);
    setProviders(remaining);
    if (providerId === id) setProviderId(remaining[0]?.id || "");
  }, [providerId, providers, setProviderId]);

  const fetchProviderModels = useCallback((draft: ProviderProbeDraft) => fastApi.fetchProviderModels(draft), []);
  const testProvider = useCallback((draft: ProviderDraft) => fastApi.testProvider(draft), []);

  const createPersona = useCallback(async (draft: PersonaDraft) => {
    const persona = await fastApi.createPersona(draft);
    setPersonas((current) => [...current, persona]);
    personaRequestRef.current += 1;
    setPersonaIdState(persona.id);
    localStorage.setItem(personaKey, persona.id);
    const preferredProvider = persona.config?.provider_id || persona.provider_id;
    if (preferredProvider) setProviderId(preferredProvider);
    setCurrentId(null);
    setMessages([]);
    rememberConversation(null, persona.id);
    if (preferredProvider) {
      try {
        const conversation = await fastApi.createConversation(preferredProvider, persona.id);
        setConversations((current) => [conversation, ...current]);
        setCurrentId(conversation.id);
        rememberConversation(conversation.id, persona.id);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "人格已保存，但启动对话创建失败");
      }
    }
    return persona;
  }, [setProviderId]);

  const updatePersona = useCallback(async (id: string, draft: PersonaDraft) => {
    const persona = await fastApi.updatePersona(id, draft);
    setPersonas((current) => current.map((item) => item.id === id ? persona : item));
    return persona;
  }, []);

  const deletePersona = useCallback(async (id: string) => {
    await fastApi.deletePersona(id);
    const remaining = personas.filter((item) => item.id !== id);
    const remappedConversations = conversations.map((item) => item.persona_id === id ? { ...item, persona_id: null } : item);
    setPersonas(remaining);
    setConversations(remappedConversations);
    if (personaId === id) {
      personaRequestRef.current += 1;
      const nextId = remaining[0]?.id || null;
      setPersonaIdState(nextId);
      if (nextId) localStorage.setItem(personaKey, nextId); else localStorage.removeItem(personaKey);
      const nextPersona = remaining[0] || null;
      const preferredProvider = nextPersona?.config?.provider_id || nextPersona?.provider_id || providerId || providers[0]?.id || null;
      if (preferredProvider) setProviderId(preferredProvider);
      setCurrentId(null);
      setMessages([]);
      rememberConversation(null, nextId);
      try {
        const scoped = remappedConversations.filter((item) => !item.archived && (item.persona_id || null) === nextId);
        const storedId = localStorage.getItem(scopedConversationKey(nextId));
        const resume = scoped.find((item) => item.id === storedId) || scoped[0] || null;
        if ((nextPersona?.config?.startup_chat === "new" || !resume) && preferredProvider) {
          const conversation = await fastApi.createConversation(preferredProvider, nextId);
          setConversations((current) => [conversation, ...current]);
          setCurrentId(conversation.id);
          rememberConversation(conversation.id, nextId);
        } else if (resume) {
          setCurrentId(resume.id);
          setMessages(await fastApi.conversationMessages(resume.id));
          rememberConversation(resume.id, nextId);
          if (resume.provider_id) setProviderId(resume.provider_id);
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "人格已删除，但下一个工作区打开失败");
      }
    }
  }, [conversations, personaId, personas, providerId, providers, setProviderId]);

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const previous = settingsRef.current;
    const includesVoiceConfig = Object.prototype.hasOwnProperty.call(patch, "voice_config");
    const previousLocalVoiceConfig = includesVoiceConfig ? localStorage.getItem(voiceConfigKey) : null;
    const normalizedPatch = includesVoiceConfig
      ? { ...patch, voice_config: normalizeVoiceConfig(patch.voice_config) }
      : patch;
    if (includesVoiceConfig) localStorage.setItem(voiceConfigKey, JSON.stringify(normalizedPatch.voice_config));
    const optimistic = { ...previous, ...normalizedPatch };
    const revision = ++settingsRevisionRef.current;
    settingsRef.current = optimistic;
    setSettings(optimistic);
    const task = settingsSaveRef.current.catch(() => undefined).then(() => fastApi.updateSettings(optimistic));
    settingsSaveRef.current = task;
    try {
      const saved = withLocalVoiceConfig(await task);
      if (settingsRevisionRef.current === revision) {
        settingsRef.current = saved;
        setSettings(saved);
      }
      return saved;
    } catch (error) {
      if (settingsRevisionRef.current === revision) {
        if (includesVoiceConfig) {
          if (previousLocalVoiceConfig === null) localStorage.removeItem(voiceConfigKey);
          else localStorage.setItem(voiceConfigKey, previousLocalVoiceConfig);
        }
        settingsRef.current = previous;
        setSettings(previous);
      }
      throw error;
    }
  }, []);

  const createWorldbook = useCallback(async (draft: WorldbookDraft) => {
    const worldbook = await fastApi.createWorldbook(draft);
    setWorldbooks((current) => [worldbook, ...current]);
    return worldbook;
  }, []);

  const updateWorldbook = useCallback(async (id: string, draft: WorldbookDraft) => {
    const worldbook = await fastApi.updateWorldbook(id, draft);
    setWorldbooks((current) => current.map((item) => item.id === id ? worldbook : item));
    return worldbook;
  }, []);

  const deleteWorldbook = useCallback(async (id: string) => {
    await fastApi.deleteWorldbook(id);
    setWorldbooks((current) => current.filter((item) => item.id !== id));
  }, []);

  const createMcpServer = useCallback(async (draft: McpServerDraft) => {
    const server = await fastApi.createMcpServer(draft);
    setMcpServers((current) => [server, ...current]);
    return server;
  }, []);

  const updateMcpServer = useCallback(async (id: string, draft: McpServerDraft) => {
    const server = await fastApi.updateMcpServer(id, draft);
    setMcpServers((current) => current.map((item) => item.id === id ? server : item));
    return server;
  }, []);

  const deleteMcpServer = useCallback(async (id: string) => {
    await fastApi.deleteMcpServer(id);
    setMcpServers((current) => current.filter((item) => item.id !== id));
  }, []);

  const refreshMcpServer = useCallback(async (id: string) => {
    const server = await fastApi.refreshMcpServer(id);
    setMcpServers((current) => current.map((item) => item.id === id ? server : item));
    return server;
  }, []);

  const exportBackup = useCallback(async (parts: BackupPart[]) => {
    return fastApi.exportBackup(parts);
  }, []);
  const restoreBackup = useCallback(async (bundle: BackupBundle, parts: BackupPart[]) => {
    const result = await fastApi.restoreBackup(bundle, parts);
    await hydrate();
    return result;
  }, [hydrate]);

  return {
    providers,
    personas,
    worldbooks,
    mcpServers,
    favorites,
    conversations: visibleConversations,
    settings,
    providerId,
    personaId,
    currentId,
    currentConversation,
    messages,
    loading,
    busy,
    error,
    setProviderId,
    selectProviderModel,
    setProviderStreamMode,
    setPersonaId: selectPersona,
    openConversation,
    createConversation,
    deleteConversation,
    clearPersonaConversations,
    renameConversation,
    updateConversationState,
    searchConversations,
    createProvider,
    updateProvider,
    deleteProvider,
    fetchProviderModels,
    testProvider,
    createPersona,
    updatePersona,
    deletePersona,
    updateSettings,
    createWorldbook,
    updateWorldbook,
    deleteWorldbook,
    createMcpServer,
    updateMcpServer,
    deleteMcpServer,
    refreshMcpServer,
    testMcpServer: fastApi.testMcpServer,
    exportBackup,
    restoreBackup,
    send,
    generatePrivateJournal,
    generatePrivateDream,
    regenerateMessage,
    editMessage,
    selectMessageVersion,
    deleteMessageVersion,
    deleteAllMessageVersions,
    branchFromMessage,
    compressConversation,
    toggleFavorite,
    stop,
    retry: hydrate,
  };
}
