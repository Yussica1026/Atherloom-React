export const casualGameIds = [
  "tic_tac_toe",
  "rock_paper_scissors",
  "bulls_and_cows",
  "twenty_questions",
] as const;

export type CasualGameId = (typeof casualGameIds)[number];
export type CasualGameActor = "user" | "persona";
export type CasualGameStatus = "active" | "finished" | "abandoned";

export interface OpenGameEffect {
  type: "open_game";
  game_id: CasualGameId;
  session_id: string;
  conversation_id: string;
  persona_id: string;
}

export function parseOpenGameEffect(value: unknown): OpenGameEffect | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const effect = value as Record<string, unknown>;
  if (effect.type !== "open_game") return null;
  if (!casualGameIds.includes(effect.game_id as CasualGameId)) return null;
  if (![effect.session_id, effect.conversation_id, effect.persona_id].every((item) => typeof item === "string" && item.trim())) return null;
  return {
    type: "open_game",
    game_id: effect.game_id as CasualGameId,
    session_id: String(effect.session_id),
    conversation_id: String(effect.conversation_id),
    persona_id: String(effect.persona_id),
  };
}

export interface TicTacToeState {
  status: "active" | "finished" | "abandoned";
  turn: CasualGameActor | null;
  board: Array<"X" | "O" | null>;
  move_count: number;
}

export type RockPaperScissorsChoice = "rock" | "paper" | "scissors";

export interface RockPaperScissorsState {
  status: "active" | "finished" | "abandoned";
  turn: CasualGameActor | null;
  user_choice?: RockPaperScissorsChoice | null;
  user_choice_committed?: boolean;
  persona_choice?: RockPaperScissorsChoice | null;
}

export type RegisteredCasualGameState = TicTacToeState | RockPaperScissorsState;

export type CasualGameAction =
  | { position: number }
  | { choice: RockPaperScissorsChoice };

export interface CasualGameSession<State = Record<string, unknown>> {
  id: string;
  game_id: CasualGameId;
  rules_version: number;
  conversation_id: string;
  persona_id: string;
  player_id: string;
  state: State;
  current_actor: CasualGameActor | null;
  status: CasualGameStatus;
  revision: number;
  result_id: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface CasualGameParticipant {
  kind: CasualGameActor;
  id: string;
}

export interface CasualGameResult {
  game_id: CasualGameId;
  session_id: string;
  outcome: string;
  participants: CasualGameParticipant[];
  score?: Record<string, number> | null;
  notable_events: string[];
  started_at: string;
  finished_at: string;
}

export interface CasualGameResultRecord {
  id: string;
  session_id: string;
  result: CasualGameResult;
  created_at: string;
}

export interface CasualGameActionResponse<State = Record<string, unknown>> {
  session_id: string;
  game_id: CasualGameId;
  revision: number;
  status: CasualGameStatus;
  state: State;
  current_actor: CasualGameActor | null;
  events: Array<Record<string, unknown>>;
  result: CasualGameResult | null;
  result_id: string | null;
  idempotent_replay?: boolean;
}

export interface CasualGameBehaviorConfig {
  persona_id: string;
  game_id: CasualGameId;
  instructions?: string | null;
  strategy_instructions?: string | null;
  reaction_instructions?: string | null;
  memory_instructions?: string | null;
  memory_mode: "off" | "ask" | "auto";
}

export interface CasualGameSessionList {
  sessions: Array<CasualGameSession<RegisteredCasualGameState>>;
}

export interface CasualGameChatReply {
  conversation_id?: string;
  assistant_id?: string;
  [key: string]: unknown;
}

export interface CasualGameMemoryDecision {
  approved?: boolean;
  memory_id?: string | null;
  status?: string;
  [key: string]: unknown;
}
