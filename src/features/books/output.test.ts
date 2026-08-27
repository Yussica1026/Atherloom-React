import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { sha256 } from "./ingest";
import { buildAgentSkillArchive, buildBookAnalysisExport } from "./output";
import type { BookChapter, BookRecord, ChapterAnalysisPayload, StoredChapterAnalysis } from "./types";

const analysisPayload = (coreIdea: string): ChapterAnalysisPayload => ({
  core_idea: coreIdea,
  frameworks: [{ name: "框架", when_to_use: "判断时", how: ["第一步"], why: "有效", limitations: ["有限"] }],
  concepts: [],
  mental_models: [],
  methods: [],
  anti_patterns: [],
  decision_rules: [],
  worked_examples: [],
  key_takeaways: ["要点"],
  topic_tags: ["标签"],
  evidence_refs: [{ locator: "第 1 章", note: "证据" }],
  quality_warnings: [],
});

const book: BookRecord = {
  id: "book-1",
  persona_key: "persona-1",
  title: "测试 / 书",
  author: "作者",
  language: "zh-CN",
  format: "markdown",
  source_name: "book.md",
  source_fingerprint: "abcdef1234567890",
  total_chapters: 2,
  current_chapter: 0,
  current_progress: 0,
  analysis_instructions: "",
  bookmarks: [],
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const chapter = (index: number, title: string, content: string): BookChapter => ({
  id: `${book.id}:${index}`,
  book_id: book.id,
  index,
  title,
  content,
  source_locator: `text:${index}`,
  content_fingerprint: `chapter-${index}`,
  notes: [],
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
});

const storedAnalysis = (index: number, coreIdea: string): StoredChapterAnalysis => ({
  id: `${book.id}:${index}`,
  book_id: book.id,
  chapter_index: index,
  input_fingerprint: `analysis-${index}`,
  analysis: analysisPayload(coreIdea),
  cache_hit: false,
  provider_id: "provider-1",
  generated_at: "2026-01-01T00:00:00.000Z",
});

test("agent skill ZIP contains ordered references, manifest, and valid checksums", async () => {
  const chapters = [chapter(1, "第二章", "RAW_SECOND"), chapter(0, "第一章", "RAW_FIRST")];
  const analyses = [storedAnalysis(1, "第二章核心"), storedAnalysis(0, "第一章核心")];
  const archive = await buildAgentSkillArchive(book, chapters, analyses);
  const files = unzipSync(new Uint8Array(await archive.blob.arrayBuffer()));
  const root = "测试-书-abcdef12";
  const skillPath = `${root}/SKILL.md`;
  const firstReferencePath = `${root}/references/001-第一章.md`;
  const secondReferencePath = `${root}/references/002-第二章.md`;
  const manifestPath = `${root}/manifest.json`;

  assert.equal(archive.fileName, `${root}.zip`);
  assert.ok(files[skillPath]);
  assert.ok(files[firstReferencePath]);
  assert.ok(files[secondReferencePath]);
  assert.ok(files[manifestPath]);

  const skill = strFromU8(files[skillPath]);
  const firstReference = strFromU8(files[firstReferencePath]);
  const manifest = JSON.parse(strFromU8(files[manifestPath])) as {
    chapters: Array<{ chapter_index: number; path: string }>;
    checksums: Record<string, string>;
  };
  assert.match(skill, /references\/001-第一章\.md/);
  assert.match(firstReference, /第一章核心/);
  assert.doesNotMatch(firstReference, /RAW_FIRST/);
  assert.deepEqual(manifest.chapters.map((item) => item.chapter_index), [0, 1]);
  assert.deepEqual(manifest.chapters.map((item) => item.path), ["references/001-第一章.md", "references/002-第二章.md"]);
  assert.equal(manifest.checksums["SKILL.md"], await sha256(files[skillPath]));
  assert.equal(manifest.checksums["references/001-第一章.md"], await sha256(files[firstReferencePath]));
});

test("skill archive naming is deterministic when the title has no slug characters", async () => {
  const emojiBook = { ...book, title: "😀" };
  const result = await buildAgentSkillArchive(emojiBook, [chapter(0, "第一章", "正文")], [storedAnalysis(0, "核心")]);
  assert.equal(result.fileName, "book-abcdef12.zip");
});

test("book analysis JSON export omits source chapter content", async () => {
  const result = buildBookAnalysisExport(book, [chapter(0, "第一章", "RAW_SECRET")], [storedAnalysis(0, "核心")]);
  const exported = JSON.parse(await result.text()) as {
    format: string;
    chapters: Array<Record<string, unknown>>;
    analyses: StoredChapterAnalysis[];
  };
  assert.equal(exported.format, "atherloom-book-analysis");
  assert.equal("content" in exported.chapters[0], false);
  assert.equal(exported.analyses[0].analysis.core_idea, "核心");
});

test("skill archive rejects export without any analyzed chapter", async () => {
  await assert.rejects(() => buildAgentSkillArchive(book, [chapter(0, "第一章", "正文")], []), /没有可导出的章节分析/);
});
