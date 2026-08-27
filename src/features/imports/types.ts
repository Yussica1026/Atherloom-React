export type ExternalImportStatus = "previewed" | "committed" | "rolled_back";

export interface ExternalImportWarning {
  code: string;
  message: string;
  conversation_id?: string | null;
  node_id?: string | null;
}

export interface ExternalSourceIdentity {
  id: string;
  platform: string;
  platform_id?: string | null;
  kind: string;
  display_name?: string | null;
  message_count: number;
  roles: string[];
  metadata?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
  derived_from_role?: boolean;
}

export interface ExternalConversationSummary {
  canonical_conversation_id: string;
  source_conversation_id?: string | null;
  title?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  message_count: number;
  role_counts: Record<string, number>;
  branch_count: number;
  non_text_block_count: number;
  attachment_count: number;
  warning_count: number;
  warning_codes: string[];
  selected: boolean;
  source_context?: Record<string, unknown>;
  source_identities: ExternalSourceIdentity[];
  possible_duplicate?: boolean;
  existing_conversation_ids?: string[];
}

export interface ExternalImportStatistics {
  conversation_count: number;
  message_count: number;
  role_counts: Record<string, number>;
  branch_count: number;
  non_text_block_count: number;
  attachment_count: number;
  warning_count: number;
  source_identity_count: number;
  selected_conversation_count: number;
  possible_duplicate_count?: number;
}

export interface ImportedConversationRecord {
  conversation_id: string;
  source_conversation_id?: string | null;
  canonical_conversation_id: string;
  imported_message_count: number;
  created_at: string;
}

export interface ExternalImportBatch {
  id: string;
  format_id: string;
  platform: string;
  source_name?: string | null;
  status: ExternalImportStatus;
  conversation_count: number;
  message_count: number;
  warnings: ExternalImportWarning[];
  created_at: string;
  committed_at?: string | null;
  rolled_back_at?: string | null;
  defaults?: {
    archived: boolean;
    provider_id: null;
    persona_id: null;
    memories_created: number;
  };
  conversation_summaries?: ExternalConversationSummary[];
  preview?: ExternalConversationSummary[];
  statistics?: ExternalImportStatistics;
  selection?: {
    default: string;
    selected_conversation_ids: string[];
    excluded_conversation_ids: string[];
  };
  conversations?: ImportedConversationRecord[];
  created_conversation_ids?: string[];
}

export interface ExternalImportCommitRequest {
  selected_conversation_ids: string[];
  persona_mapping: Record<string, string | null>;
}
