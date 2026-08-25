import { useCallback, useEffect, useRef, useState } from "react";
import { longWorldApi, type ResidentSeed } from "./api";
import type {
  EventRecord,
  NarrativeTurnRecord,
  PlayerActionRequest,
  PlayerIntent,
  ReplayResult,
  SaveSummary,
  SessionDetail,
  SessionSummary,
  WorldDefinition,
  WorldDetail,
  WorldSummary,
} from "./types";

function randomId(prefix: string) {
  const token = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${token}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}

interface PendingAction {
  sessionId: string;
  request: PlayerActionRequest;
  mode: "rules" | "gm";
  providerId: string | null;
}

interface PendingOperation {
  signature: string;
  idempotencyKey: string;
}

export function useLongWorld() {
  const [worlds, setWorlds] = useState<WorldSummary[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [world, setWorld] = useState<WorldDetail | null>(null);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [turns, setTurns] = useState<NarrativeTurnRecord[]>([]);
  const [saves, setSaves] = useState<SaveSummary[]>([]);
  const [replay, setReplay] = useState<ReplayResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pendingActionRef = useRef<PendingAction | null>(null);
  const preparedWorldRef = useRef<(PendingOperation & { world?: WorldDetail }) | null>(null);
  const pendingSessionRef = useRef<(PendingOperation & { body: Parameters<typeof longWorldApi.createSession>[0] }) | null>(null);
  const pendingSaveRef = useRef<PendingOperation | null>(null);
  const pendingBranchRef = useRef<PendingOperation | null>(null);

  const refreshLibrary = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const [nextWorlds, nextSessions] = await Promise.all([
        longWorldApi.listWorlds(),
        longWorldApi.listSessions(),
      ]);
      setWorlds(nextWorlds);
      setSessions(nextSessions);
    } catch (loadError) {
      setError(`长期世界没有连上服务器：${errorMessage(loadError)}`);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => { void refreshLibrary(); }, [refreshLibrary]);

  const openSession = useCallback(async (sessionId: string) => {
    setBusy(true);
    setError("");
    setNotice("正在重建这条世界线…");
    setReplay(null);
    try {
      const nextSession = await longWorldApi.getSession(sessionId);
      const [nextWorld, nextEvents, nextTurns, nextSaves] = await Promise.all([
        longWorldApi.getWorld(nextSession.world_id),
        longWorldApi.listEvents(sessionId),
        longWorldApi.listTurns(sessionId),
        longWorldApi.listSaves(sessionId),
      ]);
      setSession(nextSession);
      setWorld(nextWorld);
      setEvents(nextEvents);
      setTurns(nextTurns);
      setSaves(nextSaves);
      setNotice(`已回到「${nextSession.branch_name}」第 ${nextSession.current_revision} 次修订。`);
      pendingActionRef.current = null;
    } catch (loadError) {
      setError(`无法打开世界线：${errorMessage(loadError)}`);
      setNotice("");
    } finally {
      setBusy(false);
    }
  }, []);

  const startSession = useCallback(async (options: {
    definition?: WorldDefinition;
    worldId?: string;
    playerName: string;
    branchName: string;
    resident?: Omit<ResidentSeed, "id" | "active">;
  }) => {
    setBusy(true);
    setError("");
    setNotice("正在钉住世界的第一条事实…");
    try {
      const definitionSignature = options.definition ? JSON.stringify(options.definition) : "";
      let createdWorld: WorldDetail | null = null;
      if (options.definition) {
        const prepared = preparedWorldRef.current?.signature === definitionSignature
          ? preparedWorldRef.current
          : { signature: definitionSignature, idempotencyKey: randomId("create-world") };
        preparedWorldRef.current = prepared;
        createdWorld = prepared.world || await longWorldApi.createWorld(options.definition, prepared.idempotencyKey);
        preparedWorldRef.current = { ...prepared, world: createdWorld };
      }
      const worldId = createdWorld?.id || options.worldId;
      if (!worldId) throw new Error("还没有选择世界");
      const aiCharacters: ResidentSeed[] = options.resident ? [{
        ...options.resident,
        id: randomId("resident"),
        active: true,
      }] : [];
      const selectedWorld = createdWorld || await longWorldApi.getWorld(worldId);
      const sessionSeed = {
        world_id: worldId,
        player_id: randomId("player"),
        player_display_name: options.playerName.trim(),
        branch_name: options.branchName.trim(),
        ai_characters: aiCharacters,
      };
      const sessionSignature = JSON.stringify({
        worldId,
        playerName: options.playerName.trim(),
        branchName: options.branchName.trim(),
        resident: options.resident || null,
      });
      const pendingSession = pendingSessionRef.current?.signature === sessionSignature
        ? pendingSessionRef.current
        : { signature: sessionSignature, idempotencyKey: randomId("create-session"), body: sessionSeed };
      pendingSessionRef.current = pendingSession;
      const createdSession = await longWorldApi.createSession(pendingSession.body, pendingSession.idempotencyKey);
      pendingSessionRef.current = null;
      setSession(createdSession);
      setWorld(selectedWorld);
      setEvents([]);
      setTurns([]);
      setSaves([]);
      setReplay(null);
      pendingActionRef.current = null;
      preparedWorldRef.current = null;
      setNotice("世界线已经建立。现在的每一步都会先经过规则校验再写入事实。 ");
      await refreshLibrary(true);
      try {
        const [nextEvents, nextTurns, nextSaves] = await Promise.all([
          longWorldApi.listEvents(createdSession.id),
          longWorldApi.listTurns(createdSession.id),
          longWorldApi.listSaves(createdSession.id),
        ]);
        setEvents(nextEvents);
        setTurns(nextTurns);
        setSaves(nextSaves);
      } catch (supplementError) {
        setError(`世界线已经建立，但叙事、纪事或存档列表暂时没有读回：${errorMessage(supplementError)}`);
      }
    } catch (startError) {
      setError(`世界没有成功开始：${errorMessage(startError)}`);
      setNotice("");
    } finally {
      setBusy(false);
    }
  }, [refreshLibrary]);

  const finishAction = useCallback(async (target: PendingAction) => {
    const committed = target.mode === "gm" && target.providerId
      ? await longWorldApi.commitGMTurn(target.sessionId, target.providerId, target.request)
      : await longWorldApi.commitAction(target.sessionId, target.request);
    const [authoritativeSession, nextEvents, nextTurns] = await Promise.all([
      longWorldApi.getSession(target.sessionId),
      longWorldApi.listEvents(target.sessionId),
      longWorldApi.listTurns(target.sessionId),
    ]);
    setSession(authoritativeSession);
    setEvents(nextEvents);
    setTurns(nextTurns);
    setReplay(null);
    setNotice(committed.idempotent_replay && authoritativeSession.current_revision > committed.committed_revision
      ? `已确认旧行动提交在 revision ${committed.committed_revision}；世界当前已前进到 revision ${authoritativeSession.current_revision}。`
      : committed.idempotent_replay
        ? `已确认：第 ${committed.committed_revision} 次修订此前已经安全提交。`
      : target.mode === "gm"
        ? `GM 候选已通过规则校验，世界事实已提交为 revision ${committed.committed_revision}。`
        : `规则通过，世界事实已提交为 revision ${committed.committed_revision}。`);
    pendingActionRef.current = null;
    void refreshLibrary(true);
  }, [refreshLibrary]);

  const commitAction = useCallback(async (intent: PlayerIntent, content: string, providerId: string | null = null) => {
    if (!session || busy) return false;
    const target: PendingAction = {
      sessionId: session.id,
      mode: providerId ? "gm" : "rules",
      providerId,
      request: {
        actor: { kind: "player", id: session.state.player.id },
        intent,
        content,
        expected_revision: session.current_revision,
        idempotency_key: randomId("ui-action"),
      },
    };
    pendingActionRef.current = target;
    setBusy(true);
    setError("");
    setNotice(providerId ? "GM 正在提出候选变化；规则引擎会在写入前逐项核对…" : "规则引擎正在核对这一步…");
    try {
      await finishAction(target);
      return true;
    } catch (actionError) {
      setError(`这一步没有得到提交确认：${errorMessage(actionError)}`);
      setNotice("如果只是网络中断，可用同一幂等键安全重试；不会重复执行行动。");
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, finishAction, session]);

  const retryPendingAction = useCallback(async () => {
    const target = pendingActionRef.current;
    if (!target || busy) return;
    setBusy(true);
    setError("");
    setNotice("正在用原来的幂等键确认上一步…");
    try {
      await finishAction(target);
    } catch (actionError) {
      setError(`仍未得到提交确认：${errorMessage(actionError)}`);
    } finally {
      setBusy(false);
    }
  }, [busy, finishAction]);

  const createSave = useCallback(async (name: string) => {
    if (!session || busy) return;
    setBusy(true);
    setError("");
    try {
      const signature = JSON.stringify({ sessionId: session.id, name, revision: session.current_revision });
      const pending = pendingSaveRef.current?.signature === signature
        ? pendingSaveRef.current
        : { signature, idempotencyKey: randomId("create-save") };
      pendingSaveRef.current = pending;
      const created = await longWorldApi.createSave(session.id, name, session.current_revision, pending.idempotencyKey);
      pendingSaveRef.current = null;
      setSaves((current) => [created, ...current]);
      setNotice(`「${created.name}」已钉在 revision ${created.revision}。`);
    } catch (saveError) {
      setError(`存档失败：${errorMessage(saveError)}`);
    } finally {
      setBusy(false);
    }
  }, [busy, session]);

  const branchFromSave = useCallback(async (saveId: string, branchName: string) => {
    if (!session || busy) return;
    setBusy(true);
    setError("");
    try {
      const signature = JSON.stringify({ sessionId: session.id, saveId, branchName });
      const pending = pendingBranchRef.current?.signature === signature
        ? pendingBranchRef.current
        : { signature, idempotencyKey: randomId("create-branch") };
      pendingBranchRef.current = pending;
      const branch = await longWorldApi.branchFromSave(session.id, saveId, branchName, pending.idempotencyKey);
      pendingBranchRef.current = null;
      setSession(branch);
      setEvents([]);
      setTurns([]);
      setSaves([]);
      setReplay(null);
      pendingActionRef.current = null;
      setNotice(`已从存档分出「${branch.branch_name}」。原世界线没有被覆盖。`);
      await refreshLibrary(true);
      try {
        const [nextEvents, nextTurns, nextSaves] = await Promise.all([
          longWorldApi.listEvents(branch.id),
          longWorldApi.listTurns(branch.id),
          longWorldApi.listSaves(branch.id),
        ]);
        setEvents(nextEvents);
        setTurns(nextTurns);
        setSaves(nextSaves);
      } catch (supplementError) {
        setError(`分支已经建立，但叙事、纪事或存档列表暂时没有读回：${errorMessage(supplementError)}`);
      }
    } catch (branchError) {
      setError(`分支失败：${errorMessage(branchError)}`);
    } finally {
      setBusy(false);
    }
  }, [busy, refreshLibrary, session]);

  const verifyReplay = useCallback(async () => {
    if (!session || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await longWorldApi.replay(session.id);
      setReplay(result);
      setNotice(result.matches_current
        ? `重放通过：revision ${result.revision} 的 canonical hash 与当前事实一位不差。`
        : "重放结果与当前事实不一致，请停止继续行动并检查数据。 ");
    } catch (replayError) {
      setError(`重放校验失败：${errorMessage(replayError)}`);
    } finally {
      setBusy(false);
    }
  }, [busy, session]);

  const closeSession = useCallback(() => {
    setSession(null);
    setWorld(null);
    setEvents([]);
    setTurns([]);
    setSaves([]);
    setReplay(null);
    setError("");
    setNotice("");
    pendingActionRef.current = null;
    pendingSessionRef.current = null;
    pendingSaveRef.current = null;
    pendingBranchRef.current = null;
    void refreshLibrary();
  }, [refreshLibrary]);

  return {
    worlds,
    sessions,
    session,
    world,
    events,
    turns,
    saves,
    replay,
    loading,
    busy,
    error,
    notice,
    hasPendingAction: Boolean(pendingActionRef.current),
    refreshLibrary,
    openSession,
    startSession,
    commitAction,
    retryPendingAction,
    createSave,
    branchFromSave,
    verifyReplay,
    closeSession,
  };
}
