export type BookSourceFormat = "pdf" | "epub" | "txt" | "markdown" | "legacy";

export interface BookBookmark {
  id: string;
  chapter_index: number;
  progress: number;
  label: string;
  created_at: string;
}

export interface BookRecord {
  id: string;
  persona_key: string;
  title: string;
  author: string;
  language: string;
  format: BookSourceFormat;
  source_name: string;
  source_fingerprint: string;
  total_chapters: number;
  current_chapter: number;
  current_progress: number;
  analysis_instructions: string;
  bookmarks: BookBookmark[];
  legacy_source_id?: string;
  created_at: string;
  updated_at: string;
}

export interface ChapterNote {
  id: string;
  text: string;
  progress: number;
  created_at: string;
}

export interface BookChapter {
  id: string;
  book_id: string;
  index: number;
  title: string;
  content: string;
  source_locator: string;
  content_fingerprint: string;
  notes: ChapterNote[];
  created_at: string;
  updated_at: string;
}

export interface EvidenceRef {
  locator: string;
  note: string;
}

export interface AnalysisFramework {
  name: string;
  when_to_use: string;
  how: string[];
  why: string;
  limitations: string[];
}

export interface AnalysisConcept {
  term: string;
  definition: string;
  evidence_refs: EvidenceRef[];
}

export interface AnalysisMentalModel {
  name: string;
  explanation: string;
  when_to_use: string;
}

export interface AnalysisMethod {
  name: string;
  steps: string[];
  when_to_use: string;
  limitations: string[];
}

export interface AnalysisAntiPattern {
  name: string;
  why: string;
  alternative: string;
}

export interface AnalysisDecisionRule {
  rule: string;
  conditions: string[];
  evidence_refs: EvidenceRef[];
}

export interface AnalysisWorkedExample {
  title: string;
  situation: string;
  application: string;
  result: string;
}

export interface ChapterAnalysisPayload {
  core_idea: string;
  frameworks: AnalysisFramework[];
  concepts: AnalysisConcept[];
  mental_models: AnalysisMentalModel[];
  methods: AnalysisMethod[];
  anti_patterns: AnalysisAntiPattern[];
  decision_rules: AnalysisDecisionRule[];
  worked_examples: AnalysisWorkedExample[];
  key_takeaways: string[];
  topic_tags: string[];
  evidence_refs: EvidenceRef[];
  quality_warnings: Array<{ code: string; message: string }>;
}

export interface StoredChapterAnalysis {
  id: string;
  book_id: string;
  chapter_index: number;
  input_fingerprint: string;
  analysis: ChapterAnalysisPayload;
  cache_hit: boolean;
  provider_id: string;
  model?: string;
  generated_at: string;
}

export type BookForgeJobStatus = "queued" | "analyzing" | "paused" | "interrupted" | "completed" | "failed" | "cancelled";

export interface BookForgeJob {
  id: string;
  book_id: string;
  persona_key: string;
  provider_id: string;
  input_signature: string;
  status: BookForgeJobStatus;
  processed_chapters: number;
  total_chapters: number;
  current_chapter: number | null;
  failed_chapters: number[];
  last_error?: string;
  created_at: string;
  updated_at: string;
}

export interface NormalizedBook {
  title: string;
  author: string;
  language: string;
  format: BookSourceFormat;
  source_name: string;
  source_fingerprint: string;
  chapters: Array<{
    index: number;
    title: string;
    content: string;
    source_locator: string;
    content_fingerprint: string;
  }>;
}

export interface BookModelRequest {
  persona_key: string;
  provider_id: string;
  protocol_instructions: string;
  user_instructions: string;
  source_payload: string;
}

export type BookModelGenerator = (request: BookModelRequest, signal: AbortSignal) => Promise<string>;
