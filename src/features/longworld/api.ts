import { requestJson } from "../../adapters/fastapi/client";
import type {
  ActionCommit,
  EventRecord,
  GMTurnCommit,
  NarrativeTurnRecord,
  PlayerActionRequest,
  ReplayResult,
  SaveSummary,
  SessionDetail,
  SessionSummary,
  WorldDefinition,
  WorldDetail,
  WorldSummary,
} from "./types";

export interface ResidentSeed {
  id: string;
  display_name: string;
  persona_id: string;
  provider_id: string;
  initial_location_id?: string;
  active: boolean;
}

function operationHeaders(idempotencyKey: string) {
  return { "Idempotency-Key": idempotencyKey };
}

function operationPath(path: string, idempotencyKey: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}idempotency_key=${encodeURIComponent(idempotencyKey)}`;
}

export const longWorldApi = {
  listWorlds: async () => (await requestJson<{ worlds: WorldSummary[] }>("/api/game-worlds")).worlds,
  createWorld: (definition: WorldDefinition, idempotencyKey: string) => requestJson<WorldDetail>(operationPath("/api/game-worlds", idempotencyKey), {
    method: "POST",
    headers: operationHeaders(idempotencyKey),
    body: JSON.stringify(definition),
  }),
  getWorld: (worldId: string) => requestJson<WorldDetail>(`/api/game-worlds/${encodeURIComponent(worldId)}`),
  listSessions: async (worldId?: string) => {
    const suffix = worldId ? `?world_id=${encodeURIComponent(worldId)}` : "";
    return (await requestJson<{ sessions: SessionSummary[] }>(`/api/game-sessions${suffix}`)).sessions;
  },
  createSession: (body: {
    world_id: string;
    player_id: string;
    player_display_name: string;
    branch_name: string;
    ai_characters: ResidentSeed[];
  }, idempotencyKey: string) => requestJson<SessionDetail>(operationPath("/api/game-sessions", idempotencyKey), {
    method: "POST",
    headers: operationHeaders(idempotencyKey),
    body: JSON.stringify(body),
  }),
  getSession: (sessionId: string) => requestJson<SessionDetail>(`/api/game-sessions/${encodeURIComponent(sessionId)}`),
  listEvents: async (sessionId: string) => (
    await requestJson<{ events: EventRecord[] }>(`/api/game-sessions/${encodeURIComponent(sessionId)}/events`)
  ).events,
  commitAction: (sessionId: string, action: PlayerActionRequest) => requestJson<ActionCommit>(
    `/api/game-sessions/${encodeURIComponent(sessionId)}/actions`,
    {
      method: "POST",
      body: JSON.stringify(action),
    },
  ),
  commitGMTurn: (sessionId: string, providerId: string, action: PlayerActionRequest) => requestJson<GMTurnCommit>(
    `/api/game-sessions/${encodeURIComponent(sessionId)}/gm-turns?provider_id=${encodeURIComponent(providerId)}`,
    {
      method: "POST",
      body: JSON.stringify(action),
    },
  ),
  listTurns: async (sessionId: string) => (
    await requestJson<{ turns: NarrativeTurnRecord[] }>(`/api/game-sessions/${encodeURIComponent(sessionId)}/turns`)
  ).turns,
  replay: (sessionId: string) => requestJson<ReplayResult>(`/api/game-sessions/${encodeURIComponent(sessionId)}/replay`),
  listSaves: async (sessionId: string) => (
    await requestJson<{ saves: SaveSummary[] }>(`/api/game-sessions/${encodeURIComponent(sessionId)}/saves`)
  ).saves,
  createSave: (sessionId: string, name: string, revision: number | undefined, idempotencyKey: string) => requestJson<SaveSummary>(
    operationPath(`/api/game-sessions/${encodeURIComponent(sessionId)}/saves`, idempotencyKey),
    { method: "POST", headers: operationHeaders(idempotencyKey), body: JSON.stringify({ name, revision }) },
  ),
  branchFromSave: (sessionId: string, saveId: string, branchName: string, idempotencyKey: string) => requestJson<SessionDetail>(
    operationPath(`/api/game-sessions/${encodeURIComponent(sessionId)}/saves/${encodeURIComponent(saveId)}/branch`, idempotencyKey),
    { method: "POST", headers: operationHeaders(idempotencyKey), body: JSON.stringify({ branch_name: branchName }) },
  ),
};
