import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fastApi, streamChat } from "../../adapters/fastapi/client";
import type {
  AppSettings,
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

  const hydrate = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await fastApi.bootstrap();
      setProviders(payload.providers || []);
      setPersonas(payload.personas || []);
      setWorldbooks(payload.worldbooks || []);
      setConversations(payload.conversations || []);
      setSettings(payload.settings || {});
      settingsRef.current = payload.settings || {};

      const storedProvider = localStorage.getItem(providerKey);
      const storedPersona = localStorage.getItem(personaKey);
      const nextProvider = payload.providers.some((item) => item.id === storedProvider) ? storedProvider : payload.providers[0]?.id || null;
      const nextPersona = payload.personas.some((item) => item.id === storedPersona) ? storedPersona : payload.personas[0]?.id || null;
      setProviderIdState(nextProvider);
      setPersonaIdState(nextPersona);

      const storedConversation = localStorage.getItem(conversationKey);
      const match = payload.conversations.find((item) => item.id === storedConversation && (item.persona_id || null) === nextPersona);
      if (match) {
        setCurrentId(match.id);
        setMessages(await fastApi.conversationMessages(match.id));
        if (match.provider_id) setProviderIdState(match.provider_id);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法连接 Atherloom 后端");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void hydrate(); }, [hydrate]);

  const visibleConversations = useMemo(
    () => conversations.filter((conversation) => !conversation.archived && (conversation.persona_id || null) === personaId),
    [conversations, personaId],
  );

  const currentConversation = conversations.find((conversation) => conversation.id === currentId) || null;

  const setProviderId = useCallback((id: string) => {
    setProviderIdState(id || null);
    if (id) localStorage.setItem(providerKey, id);
  }, []);

  const setPersonaId = useCallback((id: string | null) => {
    setPersonaIdState(id);
    if (id) localStorage.setItem(personaKey, id); else localStorage.removeItem(personaKey);
    const persona = personas.find((item) => item.id === id);
    if (persona?.provider_id) setProviderId(persona.provider_id);
    setCurrentId(null);
    setMessages([]);
    localStorage.removeItem(conversationKey);
  }, [personas, setProviderId]);

  const openConversation = useCallback(async (id: string) => {
    if (busy) return;
    setError("");
    try {
      const conversation = conversations.find((item) => item.id === id);
      const nextMessages = await fastApi.conversationMessages(id);
      setCurrentId(id);
      setMessages(nextMessages);
      localStorage.setItem(conversationKey, id);
      if (conversation?.provider_id) setProviderId(conversation.provider_id);
      if ((conversation?.persona_id || null) !== personaId) setPersonaIdState(conversation?.persona_id || null);
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
    localStorage.setItem(conversationKey, conversation.id);
    return conversation;
  }, [personaId, providerId]);

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
    setPersonaId(persona.id);
    return persona;
  }, [setPersonaId]);

  const updatePersona = useCallback(async (id: string, draft: PersonaDraft) => {
    const persona = await fastApi.updatePersona(id, draft);
    setPersonas((current) => current.map((item) => item.id === id ? persona : item));
    return persona;
  }, []);

  const deletePersona = useCallback(async (id: string) => {
    await fastApi.deletePersona(id);
    const remaining = personas.filter((item) => item.id !== id);
    setPersonas(remaining);
    setConversations((current) => current.map((item) => item.persona_id === id ? { ...item, persona_id: null } : item));
    if (personaId === id) setPersonaId(remaining[0]?.id || null);
  }, [personaId, personas, setPersonaId]);

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const saved = await fastApi.updateSettings({ ...settingsRef.current, ...patch });
    settingsRef.current = saved;
    setSettings(saved);
    return saved;
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
    setPersonaId,
    openConversation,
    createConversation,
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
    send,
    stop,
    retry: hydrate,
  };
}
