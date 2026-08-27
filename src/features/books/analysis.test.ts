import assert from "node:assert/strict";
import test from "node:test";
import {
  bookAnalysisSignature,
  chapterAnalysisFingerprint,
  normalizeChapterAnalysis,
  parseChapterAnalysis,
  reuseCachedChapterAnalysis,
  splitChapterChunks,
} from "./analysis";
import type { BookChapter, BookRecord, ChapterAnalysisPayload, StoredChapterAnalysis } from "./types";

const emptyAnalysis = (coreIdea = "核心"): ChapterAnalysisPayload => ({
  core_idea: coreIdea,
  frameworks: [],
  concepts: [],
  mental_models: [],
  methods: [],
  anti_patterns: [],
  decision_rules: [],
  worked_examples: [],
  key_takeaways: [],
  topic_tags: [],
  evidence_refs: [],
  quality_warnings: [],
});

function chapter(overrides: Partial<BookChapter> = {}): BookChapter {
  return {
    id: "book-1:0",
    book_id: "book-1",
    index: 0,
    title: "Caf\u0065\u0301\r\n",
    content: "第一行  \r\n第二行\r\n",
    source_locator: "text:0",
    content_fingerprint: "source-fingerprint",
    notes: [
      { id: "note-b", text: " 后记 ", progress: 80, created_at: "2026-01-02T00:00:00.000Z" },
      { id: "note-a", text: " 提示\r\n", progress: 20, created_at: "2026-01-01T00:00:00.000Z" },
    ],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function book(overrides: Partial<BookRecord> = {}): BookRecord {
  return {
    id: "book-1",
    persona_key: "persona-1",
    title: "测试书",
    author: "作者",
    language: "zh-CN",
    format: "txt",
    source_name: "book.txt",
    source_fingerprint: "abcdef1234567890",
    total_chapters: 1,
    current_chapter: 0,
    current_progress: 0,
    analysis_instructions: " 分析\r\n方法 ",
    bookmarks: [],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("analysis fingerprints are stable across normalized text and note ordering", async () => {
  const first = chapter();
  const second = chapter({
    title: "Café",
    content: "第一行\n第二行",
    notes: [...first.notes].reverse().map((note) => ({ ...note, text: note.text.trim().replace("\r\n", "\n") })),
  });
  const firstBook = book();
  const secondBook = book({ title: "测试书\r\n", author: "作者 " });

  assert.equal(
    await chapterAnalysisFingerprint(first, " 分析\r\n方法 ", firstBook),
    await chapterAnalysisFingerprint(second, "分析\n方法", secondBook),
  );
  assert.notEqual(
    await chapterAnalysisFingerprint(first, "分析\n方法", firstBook),
    await chapterAnalysisFingerprint(chapter({ notes: [{ ...first.notes[0], text: "不同笔记" }] }), "分析\n方法", firstBook),
  );
  assert.notEqual(
    await chapterAnalysisFingerprint(first, "分析\n方法", firstBook),
    await chapterAnalysisFingerprint(first, "分析\n方法", book({ title: "另一本书" })),
  );
  assert.equal(
    await bookAnalysisSignature(firstBook, " 分析\r\n方法 "),
    await bookAnalysisSignature(secondBook, "分析\n方法"),
  );
});

test("chapter chunks respect block boundaries and never split surrogate pairs", () => {
  assert.deepEqual(splitChapterChunks("alpha\n\nbeta\n\ngamma", 11), ["alpha\n\nbeta", "gamma"]);
  assert.deepEqual(splitChapterChunks("😀😀", 1), ["😀", "😀"]);
  assert.throws(() => splitChapterChunks("content", 0), /正数/);
});

test("analysis JSON normalization keeps valid fields and supplies empty arrays", () => {
  const normalized = normalizeChapterAnalysis({
    core_idea: "  核心思想\r\n",
    frameworks: [{ name: " 框架 ", how: ["步骤一", 2], limitations: ["限制"] }, { name: "" }],
    concepts: [{ term: "概念", definition: "定义", evidence_refs: [{ locator: "第 1 章", note: "原文" }, { locator: "" }] }],
    key_takeaways: [" 要点 ", null],
    topic_tags: [" 标签 "],
    quality_warnings: [{ code: "LOW_EVIDENCE", message: " 证据不足 " }, { code: "" }],
  });

  assert.equal(normalized.core_idea, "核心思想");
  assert.deepEqual(normalized.frameworks, [{ name: "框架", when_to_use: "", how: ["步骤一"], why: "", limitations: ["限制"] }]);
  assert.deepEqual(normalized.concepts[0].evidence_refs, [{ locator: "第 1 章", note: "原文" }]);
  assert.deepEqual(normalized.key_takeaways, ["要点"]);
  assert.deepEqual(normalized.topic_tags, ["标签"]);
  assert.deepEqual(normalized.mental_models, []);
  assert.deepEqual(normalized.quality_warnings, [{ code: "LOW_EVIDENCE", message: "证据不足" }]);
  assert.throws(() => normalizeChapterAnalysis({ frameworks: [] }), /core_idea/);
});

test("analysis parser accepts a JSON fence and rejects malformed output", () => {
  const parsed = parseChapterAnalysis(`\`\`\`json\n${JSON.stringify({ core_idea: "核心", key_takeaways: ["一"] })}\n\`\`\``);
  assert.equal(parsed.core_idea, "核心");
  assert.deepEqual(parsed.key_takeaways, ["一"]);
  assert.throws(() => parseChapterAnalysis("not-json"), /JSON/);
});

test("cache reuse requires the exact fingerprint and honors force", () => {
  const cached: StoredChapterAnalysis = {
    id: "book-1:0",
    book_id: "book-1",
    chapter_index: 0,
    input_fingerprint: "fingerprint-a",
    analysis: emptyAnalysis(),
    cache_hit: false,
    provider_id: "provider-1",
    generated_at: "2026-01-01T00:00:00.000Z",
  };

  const reused = reuseCachedChapterAnalysis(cached, "fingerprint-a");
  assert.notEqual(reused, cached);
  assert.equal(reused?.cache_hit, true);
  assert.equal(reuseCachedChapterAnalysis(cached, "fingerprint-b"), null);
  assert.equal(reuseCachedChapterAnalysis(cached, "fingerprint-a", true), null);
});
