import type {
  CasualGameActionResponse,
  CasualGameBehaviorConfig,
  CasualGameId,
  CasualGameResult,
  CasualGameResultRecord,
  CasualGameSession,
  BullsAndCowsState,
  RegisteredCasualGameState,
  RockPaperScissorsChoice,
  RockPaperScissorsState,
  TicTacToeState,
  TwentyQuestionsState,
} from "../../features/games/types";

const storageKey = "atherloom-react:standalone-casual-games:v1";
const supportedGames = new Set<CasualGameId>([
  "tic_tac_toe",
  "rock_paper_scissors",
  "bulls_and_cows",
  "twenty_questions",
]);
const rpsChoices = new Set<RockPaperScissorsChoice>(["rock", "paper", "scissors"]);
const winningLines = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
] as const;

interface PrivateBullsAndCowsState extends BullsAndCowsState {
  user_secret: string;
  persona_secret: string;
}

type StoredCasualGameState = RegisteredCasualGameState | PrivateBullsAndCowsState;

interface StoredSession extends Omit<CasualGameSession<RegisteredCasualGameState>, "state" | "current_actor"> {
  state: StoredCasualGameState;
}

interface StoredResult extends CasualGameResultRecord {
  chat_message_id?: string | null;
  memory_id?: string | null;
  memory_decision?: "approved" | "declined" | null;
}

interface StoredAction {
  session_id: string;
  actor: "user" | "persona";
  actor_id: string;
  expected_revision: number;
  idempotency_key: string;
  action: Record<string, unknown>;
  response: CasualGameActionResponse<RegisteredCasualGameState>;
}

interface CreateKey {
  signature: string;
  session_id: string;
}

interface StandaloneCasualGameStore {
  sessions: Record<string, StoredSession>;
  results: Record<string, StoredResult>;
  actions: StoredAction[];
  create_keys: Record<string, CreateKey>;
  behavior_configs: Record<string, CasualGameBehaviorConfig>;
}

export interface StandaloneCasualGameBinding {
  conversation_id: string;
  persona_id: string;
  player_id: string;
}

export interface StandalonePersonaActionRequest {
  session: CasualGameSession<RegisteredCasualGameState>;
  public_state: RegisteredCasualGameState;
  action_schema: Record<string, unknown>;
  legal_positions?: number[];
  behavior: CasualGameBehaviorConfig;
}

export interface StandaloneGameReplyRequest {
  session: CasualGameSession<RegisteredCasualGameState>;
  result: CasualGameResult;
  behavior: CasualGameBehaviorConfig;
}

export interface StandaloneGameMemoryRequest {
  persona_id: string;
  conversation_id: string;
  game_id: CasualGameId;
  session_id: string;
  result_id: string;
  title: string;
  content: string;
  importance: number;
  approved_by: "user" | "user_setting";
}

export interface StandaloneCasualGameRuntime {
  resolveConversation: (conversationId: string) => StandaloneCasualGameBinding;
  choosePersonaAction: (request: StandalonePersonaActionRequest) => Promise<Record<string, unknown>>;
  createChatReply: (request: StandaloneGameReplyRequest) => Promise<{ assistant_id: string; content: string }>;
  createMemory: (request: StandaloneGameMemoryRequest) => { memory_id: string };
}

function emptyStore(): StandaloneCasualGameStore {
  return { sessions: {}, results: {}, actions: [], create_keys: {}, behavior_configs: {} };
}

function readStore(): StandaloneCasualGameStore {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey) || "null") as Partial<StandaloneCasualGameStore> | null;
    if (!raw || typeof raw !== "object") return emptyStore();
    return {
      sessions: raw.sessions && typeof raw.sessions === "object" ? raw.sessions : {},
      results: raw.results && typeof raw.results === "object" ? raw.results : {},
      actions: Array.isArray(raw.actions) ? raw.actions : [],
      create_keys: raw.create_keys && typeof raw.create_keys === "object" ? raw.create_keys : {},
      behavior_configs: raw.behavior_configs && typeof raw.behavior_configs === "object" ? raw.behavior_configs : {},
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: StandaloneCasualGameStore) {
  localStorage.setItem(storageKey, JSON.stringify(store));
}

function now() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function objectOf(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须是对象`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: string[], label: string) {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) throw new Error(`${label} 包含不支持的字段：${extras.join("、")}`);
}

function supportedGameId(value: unknown): CasualGameId {
  const gameId = String(value || "") as CasualGameId;
  if (!supportedGames.has(gameId)) throw new Error("当前只开放井字棋、猜拳、猜数字和二十问");
  return gameId;
}

function currentActor(state: StoredCasualGameState) {
  return state.status === "active" && (state.turn === "user" || state.turn === "persona") ? state.turn : null;
}

function publicState(session: StoredSession): RegisteredCasualGameState {
  if (session.game_id === "bulls_and_cows") {
    const state = structuredCopy(session.state) as Partial<PrivateBullsAndCowsState>;
    delete state.user_secret;
    delete state.persona_secret;
    return state as BullsAndCowsState;
  }
  if (session.game_id === "rock_paper_scissors") {
    const state = session.state as RockPaperScissorsState;
    if (state.status === "active" && state.turn === "persona") {
      return {
        status: state.status,
        turn: state.turn,
        persona_choice: null,
        user_choice_committed: true,
      } satisfies RockPaperScissorsState;
    }
    return structuredCopy(state);
  }
  return structuredCopy(session.state as RegisteredCasualGameState);
}

function structuredCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function publicSession(session: StoredSession): CasualGameSession<RegisteredCasualGameState> {
  const state = publicState(session);
  return {
    id: session.id,
    game_id: session.game_id,
    rules_version: session.rules_version,
    conversation_id: session.conversation_id,
    persona_id: session.persona_id,
    player_id: session.player_id,
    state,
    current_actor: session.status === "abandoned" ? null : currentActor(state),
    status: session.status,
    revision: session.revision,
    result_id: session.result_id,
    created_at: session.created_at,
    updated_at: session.updated_at,
    finished_at: session.finished_at,
  };
}

function behaviorKey(personaId: string, gameId: CasualGameId) {
  return `${encodeURIComponent(personaId)}:${gameId}`;
}

function behaviorConfig(store: StandaloneCasualGameStore, personaId: string, gameId: CasualGameId): CasualGameBehaviorConfig {
  return store.behavior_configs[behaviorKey(personaId, gameId)] || {
    persona_id: personaId,
    game_id: gameId,
    memory_mode: "ask",
  };
}

function requireDistinctDigits(value: unknown, label: string) {
  const digits = typeof value === "string" ? value : "";
  if (!/^[0-9]{4}$/.test(digits) || new Set(digits).size !== 4) {
    throw new Error(`${label}必须是四位互不重复的数字`);
  }
  return digits;
}

function randomDistinctDigits() {
  const digits = [..."0123456789"];
  for (let index = digits.length - 1; index > 0; index -= 1) {
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    const swapIndex = random[0] % (index + 1);
    [digits[index], digits[swapIndex]] = [digits[swapIndex], digits[index]];
  }
  return digits.slice(0, 4).join("");
}

function createInitialState(gameId: CasualGameId, optionsValue: unknown): StoredCasualGameState {
  const options = optionsValue === undefined ? {} : objectOf(optionsValue, "options");
  if (gameId === "tic_tac_toe") {
    exactKeys(options, ["first_actor"], "options");
    const firstActor = options.first_actor === undefined ? "user" : options.first_actor;
    if (firstActor !== "user" && firstActor !== "persona") throw new Error("first_actor 必须是 user 或 persona");
    return { status: "active", turn: firstActor, board: Array(9).fill(null), move_count: 0 } satisfies TicTacToeState;
  }
  if (gameId === "rock_paper_scissors") {
    exactKeys(options, [], "options");
    return { status: "active", turn: "user", user_choice: null, persona_choice: null } satisfies RockPaperScissorsState;
  }
  if (gameId === "bulls_and_cows") {
    exactKeys(options, ["user_secret"], "options");
    const userSecret = requireDistinctDigits(options.user_secret, "秘密数字");
    return {
      status: "active",
      turn: "user",
      round: 1,
      history: [],
      user_secret: userSecret,
      persona_secret: randomDistinctDigits(),
    } satisfies PrivateBullsAndCowsState;
  }
  exactKeys(options, [], "options");
  return {
    status: "active",
    turn: "persona",
    question_count: 0,
    max_questions: 20,
    pending: null,
    transcript: [],
  } satisfies TwentyQuestionsState;
}

export function createStandaloneCasualGameSession(
  bodyValue: unknown,
  runtime: StandaloneCasualGameRuntime,
  idempotencyKey = "",
) {
  const body = objectOf(bodyValue, "创建请求");
  exactKeys(body, ["game_id", "conversation_id", "options"], "创建请求");
  const gameId = supportedGameId(body.game_id);
  const conversationId = String(body.conversation_id || "").trim();
  if (!conversationId) throw new Error("必须从当前聊天创建游戏");
  const binding = runtime.resolveConversation(conversationId);
  if (binding.conversation_id !== conversationId || !binding.persona_id) throw new Error("当前聊天尚未绑定 Persona");
  const signature = JSON.stringify({ game_id: gameId, conversation_id: conversationId, options: body.options || {} });
  const store = readStore();
  if (idempotencyKey && store.create_keys[idempotencyKey]) {
    const existing = store.create_keys[idempotencyKey];
    if (existing.signature !== signature) throw new Error("同一创建请求标识已用于其他游戏");
    const session = store.sessions[existing.session_id];
    if (session) return publicSession(session);
  }
  const stamp = now();
  const session: StoredSession = {
    id: makeId("casual-session"),
    game_id: gameId,
    rules_version: 1,
    conversation_id: conversationId,
    persona_id: binding.persona_id,
    player_id: binding.player_id || "local_user",
    state: createInitialState(gameId, body.options),
    status: "active",
    revision: 0,
    result_id: null,
    created_at: stamp,
    updated_at: stamp,
    finished_at: null,
  };
  store.sessions[session.id] = session;
  if (idempotencyKey) store.create_keys[idempotencyKey] = { signature, session_id: session.id };
  writeStore(store);
  return publicSession(session);
}

function resultFrom(
  session: StoredSession,
  outcome: "user_win" | "persona_win" | "draw",
  score: Record<string, number>,
  notableEvents: string[],
  finishedAt: string,
): CasualGameResult {
  return {
    game_id: session.game_id,
    session_id: session.id,
    outcome,
    participants: [
      { kind: "user", id: session.player_id },
      { kind: "persona", id: session.persona_id },
    ],
    score,
    notable_events: notableEvents,
    started_at: session.created_at,
    finished_at: finishedAt,
  };
}

function scoreBullsAndCows(secret: string, guess: string) {
  let bulls = 0;
  for (let index = 0; index < secret.length; index += 1) {
    if (secret[index] === guess[index]) bulls += 1;
  }
  const cows = [...guess].filter((digit) => secret.includes(digit)).length - bulls;
  return { bulls, cows };
}

function applyAction(session: StoredSession, actor: "user" | "persona", actionValue: unknown) {
  if (session.status !== "active") throw new Error("这局游戏已经结束");
  if (currentActor(session.state) !== actor) throw new Error("当前不是这个参与者的回合");
  const action = objectOf(actionValue, "action");
  if (session.game_id === "tic_tac_toe") {
    exactKeys(action, ["position"], "action");
    const position = action.position;
    if (!Number.isInteger(position) || Number(position) < 0 || Number(position) > 8) throw new Error("落子位置必须是 0 到 8 的整数");
    const state = session.state as TicTacToeState;
    const board = [...state.board];
    if (board[Number(position)] !== null) throw new Error("这个格子已经有棋子了");
    const mark = actor === "user" ? "X" : "O";
    board[Number(position)] = mark;
    const moveCount = state.move_count + 1;
    const events: Array<Record<string, unknown>> = [{ type: "mark_placed", actor, position, mark }];
    const winningLine = winningLines.find((line) => line.every((index) => board[index] === mark));
    let result: CasualGameResult | null = null;
    const finishedAt = now();
    if (winningLine) {
      const outcome = actor === "user" ? "user_win" : "persona_win";
      session.state = { status: "finished", turn: null, board, move_count: moveCount };
      result = resultFrom(session, outcome, { user: actor === "user" ? 1 : 0, persona: actor === "persona" ? 1 : 0 }, [`winning_line:${winningLine.join(",")}`], finishedAt);
      events.push({ type: "game_finished", outcome, winner: actor });
    } else if (moveCount === 9) {
      session.state = { status: "finished", turn: null, board, move_count: moveCount };
      result = resultFrom(session, "draw", { user: 0, persona: 0 }, ["board_filled"], finishedAt);
      events.push({ type: "game_finished", outcome: "draw", winner: "draw" });
    } else {
      session.state = { status: "active", turn: actor === "user" ? "persona" : "user", board, move_count: moveCount };
    }
    return { action, events, result };
  }

  if (session.game_id === "rock_paper_scissors") {
    exactKeys(action, ["choice"], "action");
    const choice = action.choice as RockPaperScissorsChoice;
    if (!rpsChoices.has(choice)) throw new Error("猜拳只能选择石头、布或剪刀");
    const state = session.state as RockPaperScissorsState;
    if (actor === "user") {
      session.state = { status: "active", turn: "persona", user_choice: choice, persona_choice: null };
      return { action, events: [{ type: "choice_committed", actor: "user" }], result: null };
    }
    const userChoice = state.user_choice;
    if (!userChoice || !rpsChoices.has(userChoice)) throw new Error("用户选择尚未提交");
    const beats: Record<RockPaperScissorsChoice, RockPaperScissorsChoice> = { rock: "scissors", paper: "rock", scissors: "paper" };
    const outcome = userChoice === choice ? "draw" : beats[userChoice] === choice ? "user_win" : "persona_win";
    const winner = outcome === "draw" ? "draw" : outcome === "user_win" ? "user" : "persona";
    const score = { user: outcome === "user_win" ? 1 : 0, persona: outcome === "persona_win" ? 1 : 0 };
    const finishedAt = now();
    session.state = { status: "finished", turn: null, user_choice: userChoice, persona_choice: choice };
    return {
      action,
      events: [
        { type: "choices_revealed", user_choice: userChoice, persona_choice: choice },
        { type: "game_finished", outcome, winner },
      ],
      result: resultFrom(session, outcome, score, [`user:${userChoice}`, `persona:${choice}`], finishedAt),
    };
  }

  if (session.game_id === "bulls_and_cows") {
    exactKeys(action, ["guess"], "action");
    const guess = requireDistinctDigits(action.guess, "猜测");
    const state = session.state as PrivateBullsAndCowsState;
    const secret = actor === "user" ? state.persona_secret : state.user_secret;
    const { bulls, cows } = scoreBullsAndCows(secret, guess);
    const entry = { actor, guess, bulls, cows, round: state.round };
    const history = [...state.history, entry];
    const events: Array<Record<string, unknown>> = [{ type: "guess_scored", ...entry }];
    if (bulls === 4) {
      const outcome = actor === "user" ? "user_win" : "persona_win";
      session.state = { ...state, status: "finished", turn: null, history };
      events.push({ type: "game_finished", outcome, winner: actor });
      return {
        action,
        events,
        result: resultFrom(
          session,
          outcome,
          { user: actor === "user" ? 1 : 0, persona: actor === "persona" ? 1 : 0 },
          [`solved_in_round:${state.round}`],
          now(),
        ),
      };
    }
    session.state = {
      ...state,
      turn: actor === "user" ? "persona" : "user",
      round: actor === "persona" ? state.round + 1 : state.round,
      history,
    };
    return { action, events, result: null };
  }

  const state = session.state as TwentyQuestionsState;
  if (actor === "persona") {
    exactKeys(action, ["kind", "text"], "action");
    const kind = action.kind;
    const text = typeof action.text === "string" ? action.text.trim() : "";
    if (kind !== "question" && kind !== "guess") throw new Error("二十问行动必须是提问或猜答案");
    if (!text) throw new Error("二十问的问题或答案不能为空");
    if (state.question_count >= state.max_questions) throw new Error("二十问次数已经用完");
    const ordinal = state.question_count + 1;
    const pending: NonNullable<TwentyQuestionsState["pending"]> = {
      kind: kind as "question" | "guess",
      text,
      ordinal,
    };
    session.state = {
      ...state,
      turn: "user",
      question_count: ordinal,
      pending,
      transcript: [...state.transcript, pending],
    };
    return {
      action,
      events: [{ type: kind === "question" ? "question_asked" : "guess_made", text, ordinal }],
      result: null,
    };
  }

  const pending = state.pending;
  if (!pending) throw new Error("当前没有等待用户回答的问题");
  const transcript = [...state.transcript];
  const latest = transcript[transcript.length - 1];
  const events: Array<Record<string, unknown>> = [];
  if (pending.kind === "question") {
    exactKeys(action, ["answer"], "action");
    const answer = action.answer;
    if (answer !== "yes" && answer !== "no" && answer !== "unknown") throw new Error("回答必须是 yes、no 或 unknown");
    transcript[transcript.length - 1] = { ...latest, answer };
    events.push({ type: "question_answered", answer, ordinal: pending.ordinal });
    if (pending.ordinal >= state.max_questions) {
      session.state = { ...state, status: "finished", turn: null, pending: null, transcript };
      events.push({ type: "game_finished", outcome: "user_win", winner: "user" });
      return {
        action,
        events,
        result: resultFrom(session, "user_win", { user: 1, persona: 0 }, ["question_limit_reached"], now()),
      };
    }
  } else {
    exactKeys(action, ["verdict"], "action");
    const verdict = action.verdict;
    if (verdict !== "correct" && verdict !== "incorrect") throw new Error("判断必须是 correct 或 incorrect");
    transcript[transcript.length - 1] = { ...latest, verdict };
    events.push({ type: "guess_judged", verdict, ordinal: pending.ordinal });
    if (verdict === "correct") {
      session.state = { ...state, status: "finished", turn: null, pending: null, transcript };
      events.push({ type: "game_finished", outcome: "persona_win", winner: "persona" });
      return {
        action,
        events,
        result: resultFrom(session, "persona_win", { user: 0, persona: 1 }, [`guessed_on_question:${pending.ordinal}`], now()),
      };
    }
    if (pending.ordinal >= state.max_questions) {
      session.state = { ...state, status: "finished", turn: null, pending: null, transcript };
      events.push({ type: "game_finished", outcome: "user_win", winner: "user" });
      return {
        action,
        events,
        result: resultFrom(session, "user_win", { user: 1, persona: 0 }, ["question_limit_reached"], now()),
      };
    }
  }
  session.state = { ...state, turn: "persona", pending: null, transcript };
  return { action, events, result: null };
}

function existingAction(
  store: StandaloneCasualGameStore,
  session: StoredSession,
  actor: "user" | "persona",
  actorId: string,
  expectedRevision: number,
  idempotencyKey: string,
  action?: Record<string, unknown>,
) {
  const existing = store.actions.find((item) => item.session_id === session.id && item.idempotency_key === idempotencyKey);
  if (!existing) return null;
  const same = existing.actor === actor
    && existing.actor_id === actorId
    && existing.expected_revision === expectedRevision
    && (action === undefined || JSON.stringify(existing.action) === JSON.stringify(action));
  if (!same) throw new Error("同一请求标识已用于不同的游戏动作");
  return { ...structuredCopy(existing.response), idempotent_replay: true };
}

function commitAction(
  sessionId: string,
  actor: "user" | "persona",
  bodyValue: unknown,
  runtime: StandaloneCasualGameRuntime,
) {
  const body = objectOf(bodyValue, "动作请求");
  exactKeys(body, ["action", "expected_revision", "idempotency_key"], "动作请求");
  const expectedRevision = Number(body.expected_revision);
  const idempotencyKey = String(body.idempotency_key || "").trim();
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new Error("expected_revision 无效");
  if (!idempotencyKey) throw new Error("缺少 idempotency_key");
  const action = objectOf(body.action, "action");
  const store = readStore();
  const session = store.sessions[sessionId];
  if (!session) throw new Error("游戏 Session 不存在");
  const actorId = actor === "user" ? session.player_id : session.persona_id;
  const replay = existingAction(store, session, actor, actorId, expectedRevision, idempotencyKey, action);
  if (replay) return replay;
  const binding = runtime.resolveConversation(session.conversation_id);
  if (binding.persona_id !== session.persona_id) throw new Error("当前聊天已经切换 Persona，不能继续这局");
  if (session.status !== "active") throw new Error("这局游戏已经结束");
  if (session.revision !== expectedRevision) throw new Error(`revision 冲突：当前为 ${session.revision}，请求为 ${expectedRevision}`);
  const transition = applyAction(session, actor, action);
  session.revision += 1;
  session.updated_at = now();
  session.status = transition.result ? "finished" : "active";
  session.finished_at = transition.result?.finished_at || null;
  if (transition.result) {
    const resultId = makeId("casual-result");
    session.result_id = resultId;
    store.results[resultId] = {
      id: resultId,
      session_id: session.id,
      result: transition.result,
      chat_message_id: null,
      memory_id: null,
      memory_decision: null,
      created_at: transition.result.finished_at,
    };
  }
  const response: CasualGameActionResponse<RegisteredCasualGameState> = {
    session_id: session.id,
    game_id: session.game_id,
    revision: session.revision,
    status: session.status,
    state: publicState(session),
    current_actor: currentActor(session.state),
    events: transition.events,
    result: transition.result,
    result_id: session.result_id,
  };
  store.actions.push({
    session_id: session.id,
    actor,
    actor_id: actorId,
    expected_revision: expectedRevision,
    idempotency_key: idempotencyKey,
    action: structuredCopy(action),
    response: structuredCopy(response),
  });
  store.sessions[session.id] = session;
  writeStore(store);
  return response;
}

async function personaTurn(sessionId: string, bodyValue: unknown, runtime: StandaloneCasualGameRuntime) {
  const body = objectOf(bodyValue, "Persona 回合请求");
  exactKeys(body, ["expected_revision", "idempotency_key"], "Persona 回合请求");
  const expectedRevision = Number(body.expected_revision);
  const idempotencyKey = String(body.idempotency_key || "").trim();
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0 || !idempotencyKey) throw new Error("Persona 回合请求无效");
  let store = readStore();
  let session = store.sessions[sessionId];
  if (!session) throw new Error("游戏 Session 不存在");
  const replay = existingAction(store, session, "persona", session.persona_id, expectedRevision, idempotencyKey);
  if (replay) return replay;
  const binding = runtime.resolveConversation(session.conversation_id);
  if (binding.persona_id !== session.persona_id) throw new Error("当前聊天已经切换 Persona，不能继续这局");
  if (session.status !== "active" || currentActor(session.state) !== "persona") throw new Error("当前不是 Persona 回合");
  if (session.revision !== expectedRevision) throw new Error(`revision 冲突：当前为 ${session.revision}，请求为 ${expectedRevision}`);
  const visible = publicSession(session);
  const actionSchema = session.game_id === "tic_tac_toe"
    ? { type: "object", properties: { position: { type: "integer", minimum: 0, maximum: 8 } }, required: ["position"], additionalProperties: false }
    : session.game_id === "rock_paper_scissors"
      ? { type: "object", properties: { choice: { type: "string", enum: ["rock", "paper", "scissors"] } }, required: ["choice"], additionalProperties: false }
      : session.game_id === "bulls_and_cows"
        ? { type: "object", properties: { guess: { type: "string", pattern: "^(?!.*([0-9]).*\\1)[0-9]{4}$" } }, required: ["guess"], additionalProperties: false }
        : {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["question", "guess"] },
            text: { type: "string", minLength: 1 },
          },
          required: ["kind", "text"],
          additionalProperties: false,
        };
  const action = await runtime.choosePersonaAction({
    session: visible,
    public_state: visible.state,
    action_schema: actionSchema,
    ...(session.game_id === "tic_tac_toe" ? { legal_positions: (visible.state as TicTacToeState).board.flatMap((mark, index) => mark === null ? [index] : []) } : {}),
    behavior: behaviorConfig(store, session.persona_id, session.game_id),
  });
  store = readStore();
  session = store.sessions[sessionId];
  if (!session) throw new Error("游戏 Session 不存在");
  const racedReplay = existingAction(store, session, "persona", session.persona_id, expectedRevision, idempotencyKey);
  if (racedReplay) return racedReplay;
  return commitAction(sessionId, "persona", { action, expected_revision: expectedRevision, idempotency_key: idempotencyKey }, runtime);
}

function gameMemoryText(session: StoredSession, result: CasualGameResult) {
  const outcome = result.outcome === "user_win" ? "用户获胜" : result.outcome === "persona_win" ? "我获胜" : "平局";
  if (session.game_id === "tic_tac_toe") return { title: "与用户完成一局井字棋", content: `我和用户完成了一局井字棋，结果是${outcome}。` };
  if (session.game_id === "bulls_and_cows") {
    const state = session.state as PrivateBullsAndCowsState;
    return {
      title: "与用户完成一局猜数字",
      content: `我和用户完成了一局猜数字，共进行了${state.round}轮，结果是${outcome}。`,
    };
  }
  if (session.game_id === "twenty_questions") {
    const state = session.state as TwentyQuestionsState;
    return {
      title: "与用户完成一局二十问",
      content: `我和用户完成了一局二十问，共问了${state.question_count}次，结果是${outcome}。`,
    };
  }
  const names: Record<string, string> = { rock: "石头", paper: "布", scissors: "剪刀" };
  const state = session.state as RockPaperScissorsState;
  return {
    title: "与用户完成一局猜拳",
    content: `我和用户完成了一局猜拳；用户出了${names[String(state.user_choice)]}，我出了${names[String(state.persona_choice)]}，结果是${outcome}。`,
  };
}

function headerValue(headers: HeadersInit | undefined, key: string) {
  if (!headers) return "";
  const normalized = key.toLowerCase();
  if (headers instanceof Headers) return headers.get(key) || "";
  if (Array.isArray(headers)) return String(headers.find(([name]) => name.toLowerCase() === normalized)?.[1] || "");
  const record = headers as Record<string, string>;
  const found = Object.keys(record).find((name) => name.toLowerCase() === normalized);
  return found ? String(record[found] || "") : "";
}

export function isStandaloneCasualGamePath(path: string) {
  return path === "/api/casual-games" || path.startsWith("/api/casual-games/");
}

export async function requestStandaloneCasualGameJson<T>(
  path: string,
  init: RequestInit,
  runtime: StandaloneCasualGameRuntime,
): Promise<T> {
  const method = String(init.method || "GET").toUpperCase();
  const body = typeof init.body === "string" && init.body ? JSON.parse(init.body) as Record<string, unknown> : {};
  if (path === "/api/casual-games" && method === "GET") {
    return { games: [
      { id: "tic_tac_toe", label: "井字棋", rules_version: 1 },
      { id: "rock_paper_scissors", label: "猜拳", rules_version: 1 },
      { id: "bulls_and_cows", label: "猜数字", rules_version: 1 },
      { id: "twenty_questions", label: "二十问", rules_version: 1 },
    ] } as T;
  }
  if (path.startsWith("/api/casual-games/sessions?") && method === "GET") {
    const url = new URL(path, "https://standalone.atherloom.local");
    const conversationId = url.searchParams.get("conversation_id") || "";
    const personaId = url.searchParams.get("persona_id") || "";
    const status = url.searchParams.get("status") || "";
    const sessions = Object.values(readStore().sessions)
      .filter((session) => !conversationId || session.conversation_id === conversationId)
      .filter((session) => !personaId || session.persona_id === personaId)
      .filter((session) => !status || session.status === status)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .slice(0, 100)
      .map(publicSession);
    return { sessions } as T;
  }
  if (path === "/api/casual-games/sessions" && method === "POST") {
    return createStandaloneCasualGameSession(body, runtime, headerValue(init.headers, "Idempotency-Key")) as T;
  }
  const sessionMatch = path.match(/^\/api\/casual-games\/sessions\/([^/?]+)$/);
  if (sessionMatch && method === "GET") {
    const session = readStore().sessions[decodeURIComponent(sessionMatch[1])];
    if (!session) throw new Error("游戏 Session 不存在");
    return publicSession(session) as T;
  }
  const actionsMatch = path.match(/^\/api\/casual-games\/sessions\/([^/?]+)\/actions$/);
  if (actionsMatch && method === "POST") return commitAction(decodeURIComponent(actionsMatch[1]), "user", body, runtime) as T;
  const personaMatch = path.match(/^\/api\/casual-games\/sessions\/([^/?]+)\/persona-turn$/);
  if (personaMatch && method === "POST") return await personaTurn(decodeURIComponent(personaMatch[1]), body, runtime) as T;
  const abandonMatch = path.match(/^\/api\/casual-games\/sessions\/([^/?]+)\/abandon(?:\?expected_revision=(\d+))?$/);
  if (abandonMatch && method === "POST") {
    const store = readStore();
    const session = store.sessions[decodeURIComponent(abandonMatch[1])];
    if (!session) throw new Error("游戏 Session 不存在");
    if (session.status === "finished") throw new Error("已经完成的游戏不能放弃");
    if (session.status === "active" && abandonMatch[2] !== undefined && session.revision !== Number(abandonMatch[2])) throw new Error("revision 冲突");
    if (session.status === "active") {
      session.status = "abandoned";
      session.state = { ...session.state, status: "abandoned", turn: null } as RegisteredCasualGameState;
      session.finished_at = now();
      session.updated_at = session.finished_at;
      writeStore(store);
    }
    return publicSession(session) as T;
  }
  const resultMatch = path.match(/^\/api\/casual-games\/results\/([^/?]+)$/);
  if (resultMatch && method === "GET") {
    const record = readStore().results[decodeURIComponent(resultMatch[1])];
    if (!record) throw new Error("游戏 Result 不存在");
    return structuredCopy(record) as T;
  }
  const chatReplyMatch = path.match(/^\/api\/casual-games\/results\/([^/?]+)\/chat-reply$/);
  if (chatReplyMatch && method === "POST") {
    const resultId = decodeURIComponent(chatReplyMatch[1]);
    let store = readStore();
    let record = store.results[resultId];
    if (!record) throw new Error("游戏 Result 不存在");
    const session = store.sessions[record.session_id];
    if (!session || session.status !== "finished" || session.result_id !== resultId) throw new Error("游戏结果与 Session 不一致");
    if (record.chat_message_id) return { result_id: resultId, assistant_id: record.chat_message_id, conversation_id: session.conversation_id, persona_id: session.persona_id, idempotent_replay: true } as T;
    const reply = await runtime.createChatReply({ session: publicSession(session), result: record.result, behavior: behaviorConfig(store, session.persona_id, session.game_id) });
    store = readStore();
    record = store.results[resultId];
    if (!record) throw new Error("游戏 Result 不存在");
    if (!record.chat_message_id) {
      record.chat_message_id = reply.assistant_id;
      writeStore(store);
    }
    return { result_id: resultId, assistant_id: record.chat_message_id, conversation_id: session.conversation_id, persona_id: session.persona_id, content: reply.content, idempotent_replay: false } as T;
  }
  const memoryMatch = path.match(/^\/api\/casual-games\/results\/([^/?]+)\/memory-decision$/);
  if (memoryMatch && method === "POST") {
    const resultId = decodeURIComponent(memoryMatch[1]);
    const approved = body.approved === true;
    const desired = approved ? "approved" : "declined";
    const store = readStore();
    const record = store.results[resultId];
    if (!record) throw new Error("游戏 Result 不存在");
    const session = store.sessions[record.session_id];
    if (!session || session.status !== "finished" || session.result_id !== resultId) throw new Error("游戏结果与 Session 不一致");
    if (record.memory_decision) {
      if (record.memory_decision !== desired) throw new Error("这条游戏结果已经记录了另一种记忆决定");
      return { result_id: resultId, decision: desired, memory_id: record.memory_id || null, idempotent_replay: true } as T;
    }
    if (!approved) {
      record.memory_decision = "declined";
      writeStore(store);
      return { result_id: resultId, decision: "declined", memory_id: null, idempotent_replay: false } as T;
    }
    const behavior = behaviorConfig(store, session.persona_id, session.game_id);
    if (behavior.memory_mode === "off") throw new Error("当前 Persona 已关闭这款游戏的长期记忆写入");
    const importance = body.importance === undefined ? 0.4 : Number(body.importance);
    if (!Number.isFinite(importance) || importance < 0.1 || importance > 1) throw new Error("记忆重要度必须在 0.1 到 1 之间");
    const summary = gameMemoryText(session, record.result);
    const saved = runtime.createMemory({
      persona_id: session.persona_id,
      conversation_id: session.conversation_id,
      game_id: session.game_id,
      session_id: session.id,
      result_id: resultId,
      ...summary,
      importance,
      approved_by: behavior.memory_mode === "auto" ? "user_setting" : "user",
    });
    record.memory_decision = "approved";
    record.memory_id = saved.memory_id;
    writeStore(store);
    return {
      result_id: resultId,
      decision: "approved",
      memory_id: saved.memory_id,
      idempotent_replay: false,
      provenance: { source: "casual_game", reality_scope: "real_interaction", game_id: session.game_id, session_id: session.id, result_id: resultId, approved_by: behavior.memory_mode === "auto" ? "user_setting" : "user" },
    } as T;
  }
  const behaviorMatch = path.match(/^\/api\/casual-games\/behavior-configs\/([^/?]+)\/([^/?]+)$/);
  if (behaviorMatch && method === "GET") {
    const personaId = decodeURIComponent(behaviorMatch[1]);
    const gameId = supportedGameId(decodeURIComponent(behaviorMatch[2]));
    return behaviorConfig(readStore(), personaId, gameId) as T;
  }
  throw new Error(`Android 本机游戏尚不支持 ${method} ${path}`);
}
