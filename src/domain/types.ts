export const themeNames = ["system", "light", "dark", "water", "mint", "lilac", "blush"] as const;

export type ThemeName = (typeof themeNames)[number];

export function isThemeName(value: string | null): value is ThemeName {
  return themeNames.some((theme) => theme === value);
}

export interface Provider {
  id: string;
  name: string;
  protocol: string;
  base_url: string;
  model: string;
  enabled?: boolean;
  has_api_key?: boolean;
  custom_headers?: string;
  prompt_cache?: boolean;
}

export interface Persona {
  id: string;
  name: string;
  prompt: string;
  provider_id?: string | null;
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
}

export interface AppSettings {
  display_name?: string;
  message_density?: "compact" | "comfortable" | "relaxed";
  font_scale?: number;
  stream_speed?: number | string;
  [key: string]: unknown;
}

export interface BootstrapPayload {
  providers: Provider[];
  personas: Persona[];
  conversations: Conversation[];
  settings: AppSettings;
}

export interface ChatRequest {
  conversation_id: string;
  content: string;
  provider_id: string;
  persona_id: string | null;
  reuse_user_message_id?: string | null;
  local_time?: string;
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
  [key: string]: unknown;
}

export interface ProviderDraft {
  name: string;
  protocol: string;
  base_url: string;
  api_key: string;
  model: string;
  enabled: boolean;
  custom_headers: string;
  prompt_cache: boolean;
}

export interface PersonaDraft {
  name: string;
  prompt: string;
}
