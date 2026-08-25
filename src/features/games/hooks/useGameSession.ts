import { useCallback, useEffect, useRef, useState } from "react";
import { casualGameApi } from "../api";
import type {
  CasualGameAction,
  CasualGameActionResponse,
  CasualGameResult,
  CasualGameSession,
  RegisteredCasualGameState,
} from "../types";

type GamePhase = "loading" | "idle" | "user_turn" | "persona_turn" | "abandoning";
type ReplyStatus = "idle" | "pending" | "saved" | "error";
type MemoryStatus = "idle" | "pending" | "accepted" | "declined" | "error";

function requestKey(prefix: string) {
  return crypto.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random()}`;
}

function mergeAction(
  session: CasualGameSession<RegisteredCasualGameState>,
  response: CasualGameActionResponse<RegisteredCasualGameState>,
): CasualGameSession<RegisteredCasualGameState> {
  return {
    ...session,
    state: response.state,
    current_actor: response.current_actor,
    status: response.status,
    revision: response.revision,
    result_id: response.result_id,
    updated_at: response.result?.finished_at || session.updated_at,
    finished_at: response.status === "finished" ? response.result?.finished_at || session.finished_at : session.finished_at,
  };
}

interface UseGameSessionOptions {
  onConversationUpdated: (conversationId: string) => Promise<unknown> | unknown;
}

export function useGameSession(sessionId: string, { onConversationUpdated }: UseGameSessionOptions) {
  const [session, setSession] = useState<CasualGameSession<RegisteredCasualGameState> | null>(null);
  const [result, setResult] = useState<CasualGameResult | null>(null);
  const [pendingUserAction, setPendingUserAction] = useState<CasualGameAction | null>(null);
  const [phase, setPhase] = useState<GamePhase>("loading");
  const [error, setError] = useState("");
  const [replyStatus, setReplyStatus] = useState<ReplyStatus>("idle");
  const [replyError, setReplyError] = useState("");
  const [memoryMode, setMemoryMode] = useState<"off" | "ask" | "auto">("ask");
  const [memoryStatus, setMemoryStatus] = useState<MemoryStatus>("idle");
  const [memoryError, setMemoryError] = useState("");
  const loadRequestRef = useRef(0);
  const sessionRef = useRef(session);
  const personaRevisionRef = useRef<string | null>(null);
  const replyResultRef = useRef<string | null>(null);
  const autoMemoryResultRef = useRef<string | null>(null);
  sessionRef.current = session;

  const loadSession = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setPhase("loading");
    setError("");
    try {
      const loaded = await casualGameApi.getSession<RegisteredCasualGameState>(sessionId);
      if (requestId !== loadRequestRef.current) return loaded;
      setSession(loaded);
      if (loaded.result_id) {
        const record = await casualGameApi.getResult(loaded.result_id);
        if (requestId === loadRequestRef.current) setResult(record.result);
      }
      return loaded;
    } catch (caught) {
      if (requestId === loadRequestRef.current) setError(caught instanceof Error ? caught.message : "读取游戏失败");
      return null;
    } finally {
      if (requestId === loadRequestRef.current) setPhase("idle");
    }
  }, [sessionId]);

  useEffect(() => {
    setSession(null);
    setResult(null);
    setPendingUserAction(null);
    setError("");
    setReplyStatus("idle");
    setReplyError("");
    setMemoryMode("ask");
    setMemoryStatus("idle");
    setMemoryError("");
    personaRevisionRef.current = null;
    replyResultRef.current = null;
    autoMemoryResultRef.current = null;
    void loadSession();
    return () => { loadRequestRef.current += 1; };
  }, [loadSession]);

  useEffect(() => {
    if (!session) return;
    let active = true;
    void casualGameApi.getBehaviorConfig(session.persona_id, session.game_id).then((config) => {
      if (active) setMemoryMode(config.memory_mode);
    }).catch(() => {
      if (active) setMemoryMode("ask");
    });
    return () => { active = false; };
  }, [session?.game_id, session?.persona_id]);

  const synchronizeAfterConflict = useCallback(async () => {
    try {
      const loaded = await casualGameApi.getSession<RegisteredCasualGameState>(sessionId);
      setSession(loaded);
      setPendingUserAction(null);
      if (loaded.result_id) {
        const record = await casualGameApi.getResult(loaded.result_id);
        setResult(record.result);
      }
    } catch {
      // Keep the original actionable error if synchronization also fails.
    }
  }, [sessionId]);

  const commitPersonaTurn = useCallback(async (current: CasualGameSession<RegisteredCasualGameState>) => {
    const revisionKey = `${current.id}:${current.revision}`;
    personaRevisionRef.current = revisionKey;
    setPhase("persona_turn");
    setError("");
    try {
      const response = await casualGameApi.requestPersonaTurn<RegisteredCasualGameState>(
        current.id,
        current.revision,
        `persona-turn-${current.id}-${current.revision}`,
      );
      setSession((latest) => latest && latest.id === current.id ? mergeAction(latest, response) : latest);
      setPendingUserAction(null);
      if (response.result) setResult(response.result);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "人格行动失败";
      if (message.includes("HTTP 409")) await synchronizeAfterConflict();
      setError(message);
    } finally {
      setPhase("idle");
    }
  }, [synchronizeAfterConflict]);

  useEffect(() => {
    if (!session || phase !== "idle" || session.status !== "active" || session.current_actor !== "persona") return;
    const revisionKey = `${session.id}:${session.revision}`;
    if (personaRevisionRef.current === revisionKey) return;
    void commitPersonaTurn(session);
  }, [commitPersonaTurn, phase, session]);

  const playAction = useCallback(async (action: CasualGameAction) => {
    const current = sessionRef.current;
    if (!current || phase !== "idle" || current.status !== "active" || current.current_actor !== "user") return;
    setPendingUserAction(action);
    setPhase("user_turn");
    setError("");
    try {
      const response = await casualGameApi.commitUserAction<RegisteredCasualGameState>(
        current.id,
        action,
        current.revision,
        requestKey("user-turn"),
      );
      setSession((latest) => latest && latest.id === current.id ? mergeAction(latest, response) : latest);
      if (response.status !== "active" || response.current_actor !== "persona") setPendingUserAction(null);
      if (response.result) setResult(response.result);
    } catch (caught) {
      setPendingUserAction(null);
      const message = caught instanceof Error ? caught.message : "行动提交失败";
      if (message.includes("HTTP 409")) await synchronizeAfterConflict();
      setError(message);
    } finally {
      setPhase("idle");
    }
  }, [phase, synchronizeAfterConflict]);

  const retryPersonaTurn = useCallback(() => {
    const current = sessionRef.current;
    if (!current || phase !== "idle" || current.status !== "active" || current.current_actor !== "persona") return;
    personaRevisionRef.current = null;
    void commitPersonaTurn(current);
  }, [commitPersonaTurn, phase]);

  const sendChatReply = useCallback(async () => {
    const current = sessionRef.current;
    if (!current?.result_id) return;
    const resultId = current.result_id;
    replyResultRef.current = resultId;
    setReplyStatus("pending");
    setReplyError("");
    try {
      await casualGameApi.createChatReply(resultId);
      setReplyStatus("saved");
      await onConversationUpdated(current.conversation_id);
    } catch (caught) {
      setReplyStatus("error");
      setReplyError(caught instanceof Error ? caught.message : "赛后回复生成失败");
    }
  }, [onConversationUpdated]);

  useEffect(() => {
    if (!session?.result_id || session.status !== "finished" || replyResultRef.current === session.result_id) return;
    void sendChatReply();
  }, [sendChatReply, session?.result_id, session?.status]);

  const retryChatReply = useCallback(() => {
    replyResultRef.current = null;
    void sendChatReply();
  }, [sendChatReply]);

  const decideMemory = useCallback(async (approved: boolean) => {
    const current = sessionRef.current;
    if (!current?.result_id || memoryStatus === "pending") return;
    setMemoryStatus("pending");
    setMemoryError("");
    try {
      await casualGameApi.decideMemory(current.result_id, approved);
      setMemoryStatus(approved ? "accepted" : "declined");
    } catch (caught) {
      setMemoryStatus("error");
      setMemoryError(caught instanceof Error ? caught.message : "记忆选择保存失败");
    }
  }, [memoryStatus]);

  useEffect(() => {
    if (
      memoryMode !== "auto"
      || memoryStatus !== "idle"
      || session?.status !== "finished"
      || !session.result_id
      || autoMemoryResultRef.current === session.result_id
    ) return;
    autoMemoryResultRef.current = session.result_id;
    void decideMemory(true);
  }, [decideMemory, memoryMode, memoryStatus, session?.result_id, session?.status]);

  const abandon = useCallback(async () => {
    const current = sessionRef.current;
    if (!current || current.status !== "active" || phase !== "idle") return false;
    setPhase("abandoning");
    setError("");
    try {
      const abandoned = await casualGameApi.abandonSession<RegisteredCasualGameState>(current.id, current.revision);
      setSession(abandoned);
      setPendingUserAction(null);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "结束游戏失败");
      return false;
    } finally {
      setPhase("idle");
    }
  }, [phase]);

  return {
    session,
    result,
    phase,
    busy: phase !== "idle",
    error,
    replyStatus,
    replyError,
    memoryMode,
    memoryStatus,
    memoryError,
    pendingUserAction,
    playAction,
    retryPersonaTurn,
    retryChatReply,
    decideMemory,
    abandon,
    reload: loadSession,
  };
}
