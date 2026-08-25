export type ActorRef =
  | { kind: "player"; id: string }
  | { kind: "ai_character"; id: string }
  | { kind: "npc"; id: string };

export interface LocationDefinition {
  id: string;
  name: string;
  description: string;
  exits: string[];
}

export interface ItemDefinition {
  id: string;
  name: string;
  description: string;
  initial_location_id: string;
  quantity?: number;
}

export interface NPCDefinition {
  id: string;
  name: string;
  description: string;
  initial_location_id: string;
}

export interface FactDefinition {
  id: string;
  text: string;
  initially_known_by_player?: boolean;
}

export interface QuestDefinition {
  id: string;
  title: string;
  description: string;
  initial_status?: "available" | "active" | "hidden";
}

export interface WorldDefinition {
  name: string;
  description: string;
  starting_location_id: string;
  locations: LocationDefinition[];
  items: ItemDefinition[];
  npcs: NPCDefinition[];
  facts: FactDefinition[];
  quests: QuestDefinition[];
}

export interface WorldSummary {
  id: string;
  name: string;
  description: string;
  current_version: number;
  session_count: number;
  created_at: string;
  updated_at: string;
}

export interface WorldDetail extends Omit<WorldSummary, "session_count"> {
  version: {
    id: string;
    version: number;
    definition: WorldDefinition;
    definition_hash: string;
  };
}

export interface PlayerState {
  id: string;
  display_name: string;
  location_id: string;
}

export interface AICharacterState {
  id: string;
  display_name: string;
  persona_id: string;
  provider_id: string;
  runtime_hash: string;
  location_id: string;
  active: boolean;
}

export interface NPCState {
  id: string;
  name: string;
  description: string;
  location_id: string;
  alive: boolean;
}

export interface LocationState extends LocationDefinition {
  visited: boolean;
}

export type ItemPosition =
  | { kind: "location"; location_id: string }
  | { kind: "actor"; actor: ActorRef }
  | { kind: "removed" };

export interface ItemState {
  id: string;
  name: string;
  description: string;
  quantity: number;
  position: ItemPosition;
}

export interface RelationshipState {
  id: string;
  subject: ActorRef;
  object: ActorRef;
  affinity: number;
  trust: number;
  fear: number;
  respect: number;
}

export interface QuestState {
  id: string;
  title: string;
  description: string;
  status: "hidden" | "available" | "active" | "completed" | "failed";
}

export interface FactState {
  id: string;
  text: string;
  known_by: ActorRef[];
}

export interface WorldState {
  schema_version: 1;
  world_id: string;
  world_version_id: string;
  session_id: string;
  revision: number;
  turn: number;
  clock: { total_minutes: number };
  player: PlayerState;
  ai_characters: Record<string, AICharacterState>;
  npcs: Record<string, NPCState>;
  locations: Record<string, LocationState>;
  items: Record<string, ItemState>;
  relationships: Record<string, RelationshipState>;
  conditions: Record<string, unknown>;
  quests: Record<string, QuestState>;
  open_threads: Record<string, { id: string; title: string; status: string }>;
  facts: Record<string, FactState>;
  phone_threads: Record<string, unknown>;
}

export interface SessionSummary {
  id: string;
  world_id: string;
  world_name: string;
  branch_name: string;
  parent_session_id: string | null;
  parent_revision: number | null;
  current_revision: number;
  state_hash: string;
  player: PlayerState;
  ai_character_count: number;
  created_at: string;
  updated_at: string;
}

export interface SessionDetail {
  id: string;
  world_id: string;
  world_version_id: string;
  branch_name: string;
  parent_session_id: string | null;
  parent_revision: number | null;
  current_revision: number;
  state_hash: string;
  state: WorldState;
  created_at: string;
  updated_at: string;
}

export interface SaveSummary {
  id: string;
  session_id: string;
  revision: number;
  name: string;
  state_hash: string;
  created_at: string;
}

export interface EventRecord {
  id: string;
  turn_id: string;
  revision: number;
  sequence: number;
  type: string;
  event: Record<string, unknown> & { type: string; actor?: ActorRef };
  created_at: string;
}

export type PlayerIntent =
  | { type: "move"; destination_id: string }
  | { type: "take_item"; item_id: string }
  | { type: "drop_item"; item_id: string }
  | { type: "wait"; minutes: number }
  | { type: "help_actor"; target: ActorRef }
  | { type: "accept_quest"; quest_id: string }
  | { type: "freeform" };

export interface ActionCommit {
  action_id: string;
  session_id: string;
  committed_revision: number;
  idempotent_replay: boolean;
  events: Array<Record<string, unknown> & { type: string }>;
  state_hash: string;
  state: WorldState;
}

export interface NarrationPayload {
  text: string;
}

export interface GMTurnCommit extends ActionCommit {
  narration: NarrationPayload | null;
}

export interface NarrativeTurnRecord {
  id: string;
  session_id: string;
  revision: number;
  actor: ActorRef;
  intent: PlayerIntent;
  content: string;
  event_count: number;
  narration: NarrationPayload | null;
  created_at: string;
}

export interface PlayerActionRequest {
  actor: Extract<ActorRef, { kind: "player" }>;
  intent: PlayerIntent;
  content: string;
  expected_revision: number;
  idempotency_key: string;
}

export interface ReplayResult {
  session_id: string;
  revision: number;
  state: WorldState;
  state_hash: string;
  matches_current: boolean;
}
