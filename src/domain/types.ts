export const themeNames = ["system", "light", "dark", "water", "mint", "lilac", "blush"] as const;

export type ThemeName = (typeof themeNames)[number];

export type BackupPart = "conversations" | "personas" | "memory" | "settings" | "games";

export interface BackupBundle {
  format: "atherloom-backup";
  version: 2;
  schema_version?: number;
  exported_at: string;
  parts: BackupPart[];
  secrets_omitted?: string[];
  tables: Record<string, Array<Record<string, unknown>>>;
  client_data?: Record<string, string>;
}

export interface BackupRestoreResult {
  ok: boolean;
  parts: BackupPart[];
  tables: Record<string, number>;
  snapshot: string;
  secrets_restored: boolean;
}

export function isThemeName(value: string | null): value is ThemeName {
  return themeNames.some((theme) => theme === value);
}

export interface Provider {
  id: string;
  name: string;
  protocol: string;
  base_url: string;
  model: string;
  models?: string[];
  enabled?: boolean;
  has_api_key?: boolean;
  custom_headers?: string;
  prompt_cache?: boolean;
  thinking_enabled?: boolean;
  stream_enabled?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  vision_mode?: "auto" | "openai" | "anthropic" | "text";
  cache_mode?: "auto" | "off" | "anthropic" | "openai";
  prompt_cache_key?: string;
}

export interface PersonaConfig {
  memory_enabled?: boolean;
  history_enabled?: boolean;
  summary_frequency?: number;
  quick_phrases?: string[];
  custom_headers?: Record<string, unknown>;
  custom_body?: Record<string, unknown>;
  regex_rules?: Array<Record<string, unknown>>;
  tools?: {
    time?: boolean;
    clipboard?: boolean;
    tts?: boolean;
    ask_user?: boolean;
    calculator?: boolean;
  };
  mcp_servers?: string[];
  provider_id?: string;
  stream_enabled?: boolean | null;
  startup_chat?: "resume" | "new";
  pinned?: boolean;
  message_template?: string;
}

export interface Persona {
  id: string;
  name: string;
  prompt: string;
  config?: PersonaConfig;
  provider_id?: string | null;
  created_at?: string;
}

export interface WorldbookEntry {
  id: string;
  name: string;
  content: string;
  enabled: boolean;
  constant: boolean;
  keywords: string[];
  use_regex: boolean;
  case_sensitive: boolean;
  scan_depth: number;
  position: "system_before" | "system_after" | "history_before" | "history_after";
  role: "system" | "user" | "assistant";
  priority: number;
}

export interface Worldbook {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  entries: WorldbookEntry[];
  created_at?: string;
  updated_at?: string;
}

export interface Conversation {
  id: string;
  title: string;
  provider_id?: string | null;
  persona_id?: string | null;
  created_at?: string;
  updated_at?: string;
  pinned?: boolean | number;
  starred?: boolean | number;
  archived?: boolean | number;
  summary?: string;
  archived_message_ids?: string[];
}

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  kind: "image" | "text" | "pdf" | "file";
  data?: string;
  text?: string;
  size: number;
}

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

export interface Message {
  id?: string;
  client_id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  reasoning?: string;
  provider_id?: string | null;
  model?: string;
  parent_message_id?: string | null;
  memory_sources?: Array<string | { title?: string; content?: string }>;
  usage?: Usage;
  created_at?: string;
  pending?: boolean;
  error?: boolean;
  selected?: boolean | number;
  attachments?: Attachment[];
  tool_events?: ToolEvent[];
}

export interface ToolEvent {
  type?: string;
  name?: string;
  tool_name?: string;
  status?: string;
  detail?: string;
  query?: string;
  result?: unknown;
  [key: string]: unknown;
}

export interface Favorite {
  id: string;
  source_message_id: string;
  source_conversation_id?: string;
  role?: "user" | "assistant";
  text_snapshot?: string;
  conversation_title_snapshot?: string;
  message_created_at?: string;
  favorited_at?: string;
  owners?: string[];
}

export type MemoryKind = "fact" | "preference" | "relationship" | "promise" | "event" | "emotion" | "summary" | "diary" | "other";

export interface Memory {
  id: string;
  title: string;
  content: string;
  kind: MemoryKind;
  persona_key: string;
  importance: number;
  confidence: number;
  source_type: "explicit" | "inferred" | "summary" | string;
  memory_status?: "active" | "candidate" | "forgotten" | "superseded" | string;
  strength?: number;
  effective_strength?: number;
  starred?: boolean | number;
  archived?: boolean | number;
  deleted_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface MemoryDraft {
  title: string;
  content: string;
  kind: MemoryKind;
  persona_key: string;
  importance: number;
  confidence: number;
  source_type: "explicit" | "inferred" | "summary" | string;
}

export interface MotivationThought {
  id: string;
  content: string;
  source: string;
  count: number;
  obsession: boolean;
}

export interface MotivationPayload {
  enabled: boolean;
  offline_mode: "frozen" | "limited" | "full" | string;
  catch_up_ticks?: number;
  state: {
    drives: Record<string, number>;
    baselines: Record<string, number>;
    thoughts: MotivationThought[];
    tick_count: number;
    last_tick: string;
  };
  drives: Record<string, { label: string; baseline: number; growth: number; decay: number; threshold: number }>;
  events: string[];
}

export interface McpServer {
  id: string;
  name: string;
  transport: "http" | "stdio";
  url: string;
  token?: string;
  has_token?: boolean;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  tool_policies?: Record<string, "allow" | "ask" | "deny">;
  enabled: boolean;
  tools?: Array<{ name: string; description?: string }>;
  last_status?: string;
  last_detail?: string;
  last_tested_at?: string;
}

export type McpServerDraft = Omit<McpServer, "id" | "tools" | "last_status" | "last_detail" | "last_tested_at" | "has_token">;

export interface AppSettings {
  display_name?: string;
  message_density?: "compact" | "comfortable" | "relaxed";
  font_scale?: number;
  stream_speed?: number | string;
  proactive_questions?: boolean;
  typing_presence_enabled?: boolean;
  vision_provider_id?: string;
  [key: string]: unknown;
}

export interface BootstrapPayload {
  providers: Provider[];
  personas: Persona[];
  conversations: Conversation[];
  worldbooks: Worldbook[];
  settings: AppSettings;
  mcp_servers?: McpServer[];
}

export interface ChatRequest {
  conversation_id: string;
  content: string;
  provider_id: string;
  persona_id: string | null;
  reuse_user_message_id?: string | null;
  local_time?: string;
  vision_provider_id?: string;
  attachments?: Attachment[];
  worldbook_ids?: string[];
  media_context?: string;
  typing_context?: string;
  thinking_enabled?: boolean;
}

export interface ChatStreamEvent {
  delta?: string;
  reasoning_delta?: string;
  memory_sources?: Message["memory_sources"];
  usage?: Usage;
  user_id?: string;
  assistant_id?: string;
  title?: string;
  done?: boolean;
  error?: string;
  tool_event?: ToolEvent;
  [key: string]: unknown;
}

export interface ProviderDraft {
  name: string;
  protocol: string;
  base_url: string;
  api_key: string;
  model: string;
  models: string[];
  enabled: boolean;
  custom_headers: string;
  prompt_cache: boolean;
  thinking_enabled: boolean;
  stream_enabled: boolean;
  temperature: number;
  top_p: number;
  max_tokens: number;
  vision_mode: "auto" | "openai" | "anthropic" | "text";
  cache_mode: "auto" | "off" | "anthropic" | "openai";
  prompt_cache_key: string;
  source_provider_id?: string | null;
}

export interface ProviderProbeDraft {
  protocol: string;
  base_url: string;
  api_key: string;
  custom_headers: string;
  provider_id?: string | null;
}

export interface PersonaDraft {
  name: string;
  prompt: string;
  config: PersonaConfig;
}

export interface WorldbookDraft {
  name: string;
  description: string;
  enabled: boolean;
  entries: WorldbookEntry[];
}
