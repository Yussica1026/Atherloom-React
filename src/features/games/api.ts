import { requestJson } from "../../adapters/fastapi/client";
import type {
  CasualGameActionResponse,
  CasualGameBehaviorConfig,
  CasualGameChatReply,
  CasualGameMemoryDecision,
  CasualGameResultRecord,
  CasualGameSession,
} from "./types";

function sessionPath(sessionId: string) {
  return `/api/casual-games/sessions/${encodeURIComponent(sessionId)}`;
}

function resultPath(resultId: string) {
  return `/api/casual-games/results/${encodeURIComponent(resultId)}`;
}

export const casualGameApi = {
  getSession: <State>(sessionId: string) =>
    requestJson<CasualGameSession<State>>(sessionPath(sessionId)),

  commitUserAction: <State>(sessionId: string, action: Record<string, unknown>, expectedRevision: number, idempotencyKey: string) =>
    requestJson<CasualGameActionResponse<State>>(`${sessionPath(sessionId)}/actions`, {
      method: "POST",
      body: JSON.stringify({ action, expected_revision: expectedRevision, idempotency_key: idempotencyKey }),
    }),

  requestPersonaTurn: <State>(sessionId: string, expectedRevision: number, idempotencyKey: string) =>
    requestJson<CasualGameActionResponse<State>>(`${sessionPath(sessionId)}/persona-turn`, {
      method: "POST",
      body: JSON.stringify({ expected_revision: expectedRevision, idempotency_key: idempotencyKey }),
    }),

  getResult: (resultId: string) =>
    requestJson<CasualGameResultRecord>(resultPath(resultId)),

  createChatReply: (resultId: string) =>
    requestJson<CasualGameChatReply>(`${resultPath(resultId)}/chat-reply`, { method: "POST" }),

  decideMemory: (resultId: string, approved: boolean, importance?: number) =>
    requestJson<CasualGameMemoryDecision>(`${resultPath(resultId)}/memory-decision`, {
      method: "POST",
      body: JSON.stringify({ approved, ...(importance === undefined ? {} : { importance }) }),
    }),

  getBehaviorConfig: (personaId: string, gameId: string) =>
    requestJson<CasualGameBehaviorConfig>(`/api/casual-games/behavior-configs/${encodeURIComponent(personaId)}/${encodeURIComponent(gameId)}`),

  abandonSession: <State>(sessionId: string, expectedRevision: number) =>
    requestJson<CasualGameSession<State>>(`${sessionPath(sessionId)}/abandon?expected_revision=${expectedRevision}`, { method: "POST" }),
};
