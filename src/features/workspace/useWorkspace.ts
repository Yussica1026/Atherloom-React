import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fastApi, streamChat } from "../../adapters/fastapi/client";
import type {
  AppSettings,
  BackupBundle,
  BackupPart,
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

const providerKey = "atherloom-react:last-provider";
const personaKey = "atherloom-react:last-persona";
const conversationKey = "atherloom-react:last-conversation";

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

export function useWorkspace() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [worldbooks, setWorldbooks] = useState<Worldbook[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [settings, setSettings] = useState<AppSettings>({});
  const [providerId, setProviderIdState] = useState<string | null>(null);
  const [personaId, setPersonaIdState] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const settingsRef = useRef<AppSettings>({});
  const hydratePromiseRef = useRef<Promise<void> | null>(null);
  const personaRequestRef = useRef(0);

  const hydrate = useCallback(async () => {
    if (hydratePromiseRef.current) return hydratePromiseRef.current;
    const task = (async () => {
      setLoading(true);
      setError("");
      try {
        const payload = await fastApi.bootstrap();
        const nextProviders = payload.providers || [];
        const nextPersonas = payload.personas || [];
        const nextConversations = payload.conversations || [];
        setProviders(nextProviders);
        setPersonas(nextPersonas);
        setWorldbooks(payload.worldbooks || []);
        setConversations(nextConversations);
        setSettings(payload.settings || {});
        settingsRef.current = payload.settings || {};

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
    () => conversations.filter((conversation) => (conversation.persona_id || null) === personaId),
    [conversations, personaId],
  );

  const currentConversation = conversations.find((conversation) => conversation.id === currentId) || null;

  const setProviderId = useCallback((id: string) => {
    setProviderIdState(id || null);
    if (id) localStorage.setItem(providerKey, id);
  }, []);

  const openConversation = useCallback(async (id: string) => {
    if (busy) return;
    setError("");
    try {
      const conversation = conversations.find((item) => item.id === id);
      if (!conversation) throw new Error("找不到这条对话");
      if ((conversation.persona_id || null) !== personaId) throw new Error("这条对话属于其他人格，已阻止串线");
      const nextMessages = await fastApi.conversationMessages(id);
      setCurrentId(id);
      setMessages(nextMessages);
      rememberConversation(id, personaId);
      if (conversation?.provider_id) setProviderId(conversation.provider_id);
    } catch (caught) {
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

  const send = useCallback(async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || busy) return;
    if (!providerId) throw new Error("请先添加并选择 API 线路");

    const conversation = currentId ? conversations.find((item) => item.id === currentId) : await createConversation();
    if (!conversation) throw new Error("无法创建对话");

    const userClientId = clientId("user");
    const assistantClientId = clientId("assistant");
    const provider = providers.find((item) => item.id === providerId);
    setMessages((current) => [
      ...current,
      { client_id: userClientId, role: "user", content: trimmed },
      { client_id: assistantClientId, role: "assistant", content: "", reasoning: "", model: provider?.model, pending: true },
    ]);
    setBusy(true);
    setError("");
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamChat({
        conversation_id: conversation.id,
        content: trimmed,
        provider_id: providerId,
        persona_id: personaId,
        local_time: localTimeContext(),
      }, controller.signal, (event) => {
        if (event.error) throw new Error(event.error);
        setMessages((current) => current.map((message) => {
          if (message.client_id === userClientId && event.user_id) return { ...message, id: event.user_id };
          if (message.client_id !== assistantClientId) return message;
          return {
            ...message,
            id: event.assistant_id || message.id,
            content: message.content + (event.delta || ""),
            reasoning: (message.reasoning || "") + (event.reasoning_delta || ""),
            memory_sources: event.memory_sources || message.memory_sources,
            usage: event.usage || message.usage,
            pending: !event.done,
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
  }, [busy, conversations, createConversation, currentId, personaId, providerId, providers]);

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
    const optimistic = { ...previous, ...patch };
    settingsRef.current = optimistic;
    setSettings(optimistic);
    try {
      const saved = await fastApi.updateSettings(optimistic);
      settingsRef.current = saved;
      setSettings(saved);
      return saved;
    } catch (error) {
      settingsRef.current = previous;
      setSettings(previous);
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

  const exportBackup = useCallback((parts: BackupPart[]) => fastApi.exportBackup(parts), []);
  const restoreBackup = useCallback((bundle: BackupBundle, parts: BackupPart[]) => fastApi.restoreBackup(bundle, parts), []);

  return {
    providers,
    personas,
    worldbooks,
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
    setPersonaId: selectPersona,
    openConversation,
    createConversation,
    deleteConversation,
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
    exportBackup,
    restoreBackup,
    send,
    stop,
    retry: hydrate,
  };
}
