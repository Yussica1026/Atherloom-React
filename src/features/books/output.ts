import { strToU8, zipSync } from "fflate";
import { sha256 } from "./ingest";
import type { BookChapter, BookRecord, ChapterAnalysisPayload, StoredChapterAnalysis } from "./types";

function slug(value: string) {
  const normalized = value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return normalized || "book";
}

function safeName(value: string, fallback: string) {
  const normalized = value.normalize("NFKC").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  return normalized || fallback;
}

function bulletList(values: string[]) {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : "- 暂无";
}

function renderEvidence(values: Array<{ locator: string; note: string }>) {
  return values.length ? values.map((value) => `- **${value.locator}**${value.note ? ` — ${value.note}` : ""}`).join("\n") : "- 暂无";
}

function renderAnalysis(analysis: ChapterAnalysisPayload) {
  const sections = [
    `## 核心思想\n\n${analysis.core_idea}`,
    `## 关键要点\n\n${bulletList(analysis.key_takeaways)}`,
    analysis.frameworks.length ? `## 框架\n\n${analysis.frameworks.map((item) => `### ${item.name}\n\n${item.why}${item.when_to_use ? `\n\n**适用时机：** ${item.when_to_use}` : ""}${item.how.length ? `\n\n${bulletList(item.how)}` : ""}${item.limitations.length ? `\n\n**限制：**\n${bulletList(item.limitations)}` : ""}`).join("\n\n")}` : "",
    analysis.concepts.length ? `## 概念\n\n${analysis.concepts.map((item) => `### ${item.term}\n\n${item.definition}${item.evidence_refs.length ? `\n\n${renderEvidence(item.evidence_refs)}` : ""}`).join("\n\n")}` : "",
    analysis.mental_models.length ? `## 心智模型\n\n${analysis.mental_models.map((item) => `### ${item.name}\n\n${item.explanation}${item.when_to_use ? `\n\n**适用时机：** ${item.when_to_use}` : ""}`).join("\n\n")}` : "",
    analysis.methods.length ? `## 方法\n\n${analysis.methods.map((item) => `### ${item.name}\n\n${bulletList(item.steps)}${item.when_to_use ? `\n\n**适用时机：** ${item.when_to_use}` : ""}${item.limitations.length ? `\n\n**限制：**\n${bulletList(item.limitations)}` : ""}`).join("\n\n")}` : "",
    analysis.anti_patterns.length ? `## 反模式\n\n${analysis.anti_patterns.map((item) => `### ${item.name}\n\n${item.why}${item.alternative ? `\n\n**替代做法：** ${item.alternative}` : ""}`).join("\n\n")}` : "",
    analysis.decision_rules.length ? `## 决策规则\n\n${analysis.decision_rules.map((item) => `- ${item.rule}${item.conditions.length ? `\n  - 条件：${item.conditions.join("；")}` : ""}`).join("\n")}` : "",
    analysis.worked_examples.length ? `## 例子\n\n${analysis.worked_examples.map((item) => `### ${item.title}\n\n${item.situation}${item.application ? `\n\n**应用：** ${item.application}` : ""}${item.result ? `\n\n**结果：** ${item.result}` : ""}`).join("\n\n")}` : "",
    `## 主题标签\n\n${analysis.topic_tags.length ? analysis.topic_tags.map((tag) => `\`${tag}\``).join(" ") : "暂无"}`,
    analysis.evidence_refs.length ? `## 证据定位\n\n${renderEvidence(analysis.evidence_refs)}` : "",
    analysis.quality_warnings.length ? `## 质量提醒\n\n${analysis.quality_warnings.map((item) => `- **${item.code}**：${item.message}`).join("\n")}` : "",
  ];
  return sections.filter(Boolean).join("\n\n");
}

export async function buildAgentSkillArchive(
  book: BookRecord,
  chapters: BookChapter[],
  analyses: StoredChapterAnalysis[],
) {
  const skillSlug = `${slug(book.title)}-${book.source_fingerprint.slice(0, 8)}`;
  const analysisByChapter = new Map(analyses.map((analysis) => [analysis.chapter_index, analysis]));
  const files: Record<string, Uint8Array> = {};
  const referenceRows: Array<{ chapter_index: number; title: string; path: string; input_fingerprint: string }> = [];
  for (const chapter of [...chapters].sort((left, right) => left.index - right.index)) {
    const analysis = analysisByChapter.get(chapter.index);
    if (!analysis) continue;
    const chapterName = `${String(chapter.index + 1).padStart(3, "0")}-${safeName(chapter.title, `chapter-${chapter.index + 1}`)}.md`;
    const path = `${skillSlug}/references/${chapterName}`;
    files[path] = strToU8(`# ${chapter.title}\n\n> 来源：《${book.title}》· ${chapter.source_locator}\n\n${renderAnalysis(analysis.analysis)}\n`);
    referenceRows.push({ chapter_index: chapter.index, title: chapter.title, path: `references/${chapterName}`, input_fingerprint: analysis.input_fingerprint });
  }
  if (!referenceRows.length) throw new Error("没有可导出的章节分析");
  const index = referenceRows.map((row) => `- [${row.title}](${row.path})`).join("\n");
  const description = `按章节检索《${book.title}》的结构化分析；适用于查找本书的概念、框架、方法、决策规则与证据位置。`;
  files[`${skillSlug}/SKILL.md`] = strToU8([
    "---",
    `name: ${skillSlug}`,
    `description: ${JSON.stringify(description)}`,
    "---",
    "",
    `# ${book.title}`,
    "",
    book.author ? `作者：${book.author}` : "",
    "",
    "根据问题选择并读取相关章节文件；回答时区分书中观点、结构化分析与使用者自己的判断。需要原文时回到 Atherloom 本地书库核对，分析文件不替代原书。",
    "",
    "## 章节索引",
    "",
    index,
    "",
  ].filter((line, indexValue, all) => line || all[indexValue - 1] !== "").join("\n"));
  const checksums: Record<string, string> = {};
  for (const [path, bytes] of Object.entries(files)) checksums[path.replace(`${skillSlug}/`, "")] = await sha256(bytes);
  const manifest = {
    format: "atherloom-agent-skill",
    version: 1,
    generator: "Atherloom React · Cove Book Forge port",
    generated_at: new Date().toISOString(),
    book: { title: book.title, author: book.author, source_fingerprint: book.source_fingerprint, total_chapters: book.total_chapters },
    chapters: referenceRows,
    checksums,
  };
  files[`${skillSlug}/manifest.json`] = strToU8(JSON.stringify(manifest, null, 2));
  const archive = Uint8Array.from(zipSync(files, { level: 6 }));
  return {
    fileName: `${skillSlug}.zip`,
    blob: new Blob([archive.buffer], { type: "application/zip" }),
  };
}

export function buildBookAnalysisExport(
  book: BookRecord,
  chapters: BookChapter[],
  analyses: StoredChapterAnalysis[],
) {
  return new Blob([JSON.stringify({
    format: "atherloom-book-analysis",
    version: 1,
    exported_at: new Date().toISOString(),
    book,
    chapters: chapters.map((chapter) => ({ ...chapter, content: undefined })),
    analyses,
  }, null, 2)], { type: "application/json;charset=utf-8" });
}
