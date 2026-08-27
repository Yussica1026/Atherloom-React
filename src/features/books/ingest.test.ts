import assert from "node:assert/strict";
import test from "node:test";
import { detectBookSourceFormat, ingestBookFile, normalizeLegacyBook, normalizeText, sha256 } from "./ingest";

test("text normalization and string fingerprints are stable", async () => {
  assert.equal(normalizeText(" Caf\u0065\u0301  \r\n第二行\r\n"), "Café\n第二行");
  assert.equal(await sha256(" Caf\u0065\u0301  \r\n第二行\r\n"), await sha256("Café\n第二行"));
  assert.notEqual(await sha256(new Uint8Array([1, 2, 3])), await sha256(new Uint8Array([1, 2, 4])));
});

test("source format detection rejects unsupported extensions", () => {
  assert.equal(detectBookSourceFormat("BOOK.MARKDOWN"), "markdown");
  assert.equal(detectBookSourceFormat("book.txt"), "txt");
  assert.equal(detectBookSourceFormat("book.docx"), null);
  assert.equal(detectBookSourceFormat("book"), null);
});

test("markdown ingestion fingerprints the normalized stored chapter", async () => {
  const file = new File(["# 第一章\r\n\r\n正文  \r\n"], "novel.md", { type: "text/markdown" });
  const normalized = await ingestBookFile(file);

  assert.equal(normalized.format, "markdown");
  assert.equal(normalized.chapters.length, 1);
  assert.equal(normalized.chapters[0].title, "第一章");
  assert.equal(
    normalized.chapters[0].content_fingerprint,
    await sha256(`${normalized.chapters[0].title}\n${normalized.chapters[0].content}`),
  );
  await assert.rejects(() => ingestBookFile(new File(["data"], "book.docx")), /支持 PDF/);
});

test("legacy normalization produces stable chapter fingerprints", async () => {
  const first = await normalizeLegacyBook("旧书", "第一章 开始\r\n\r\n内容");
  const second = await normalizeLegacyBook("旧书", "第一章 开始\n\n内容\n");
  assert.equal(first.source_fingerprint, second.source_fingerprint);
  assert.deepEqual(first.chapters, second.chapters);
});
