import { unzipSync } from "fflate";
import { recordDiagnostic } from "../diagnostics/store";
import type { BookSourceFormat, NormalizedBook } from "./types";

const maxSourceBytes = 80 * 1024 * 1024;
const maxExpandedBytes = 160 * 1024 * 1024;
const maxChapters = 5_000;

function normalizeText(value: string) {
  return value.normalize("NFC").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

async function sha256(value: Uint8Array | string) {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(normalizeText(value))
    : Uint8Array.from(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

function decodeText(bytes: Uint8Array) {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const broken = (utf8.match(/�/g) || []).length;
  if (!broken || broken / Math.max(1, utf8.length) < 0.002) return utf8;
  try {
    return new TextDecoder("gb18030", { fatal: false }).decode(bytes);
  } catch {
    return utf8;
  }
}

export function detectBookSourceFormat(fileName: string): Exclude<BookSourceFormat, "legacy"> | null {
  const lower = fileName.toLocaleLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".epub")) return "epub";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".txt")) return "txt";
  return null;
}

function cleanTitle(value: string, fallback: string) {
  return normalizeText(value).replace(/^#+\s*/, "").slice(0, 500) || fallback;
}

function splitTextChapters(text: string, format: BookSourceFormat) {
  const normalized = normalizeText(text);
  const headingPattern = format === "markdown"
    ? /^(#{1,3}\s+[^\n]{1,200})$/gmu
    : /^(\s*(?:第[〇零一二三四五六七八九十百千万两\d]{1,16}[章节回卷部篇]|序章|楔子|前言|后记|尾声|Chapter\s+\d+)[^\n]{0,160})$/gimu;
  const matches = [...normalized.matchAll(headingPattern)];
  const chapters: Array<{ title: string; content: string; source_locator: string }> = [];
  if (matches.length) {
    if ((matches[0].index || 0) > 80) {
      const intro = normalized.slice(0, matches[0].index).trim();
      if (intro) chapters.push({ title: "开篇", content: intro, source_locator: "text:0" });
    }
    for (let index = 0; index < matches.length; index += 1) {
      const start = matches[index].index || 0;
      const end = matches[index + 1]?.index ?? normalized.length;
      const content = normalized.slice(start, end).trim();
      if (content) chapters.push({
        title: cleanTitle(matches[index][0], `第 ${index + 1} 章`),
        content,
        source_locator: `text:${start}`,
      });
    }
  }
  if (!chapters.length) {
    const paragraphs = normalized.split(/\n{2,}/).filter(Boolean);
    let current: string[] = [];
    let length = 0;
    const flush = () => {
      if (!current.length) return;
      const content = current.join("\n\n").trim();
      chapters.push({ title: chapters.length ? `第 ${chapters.length + 1} 节` : "正文", content, source_locator: `text:${chapters.length}` });
      current = [];
      length = 0;
    };
    for (const paragraph of paragraphs) {
      if (length && length + paragraph.length > 24_000) flush();
      current.push(paragraph);
      length += paragraph.length;
    }
    flush();
  }
  return chapters.slice(0, maxChapters);
}

type PdfPage = { getTextContent(): Promise<{ items: Array<{ str?: string; transform?: number[] }> }> };
type PdfDocument = { numPages: number; getPage(page: number): Promise<PdfPage>; getMetadata?(): Promise<{ info?: Record<string, unknown>; metadata?: { get(name: string): string | null } }> };
type PdfTask = { promise: Promise<PdfDocument>; destroy(): Promise<void> };
type PdfJs = { GlobalWorkerOptions: { workerSrc: string }; getDocument(input: { data: Uint8Array }): PdfTask };

async function extractPdf(bytes: Uint8Array, fileName: string) {
  const moduleUrl = new URL("./vendor/pdfjs/pdf.mjs", document.baseURI).href;
  const workerUrl = new URL("./vendor/pdfjs/pdf.worker.mjs", document.baseURI).href;
  const pdfjs = await import(/* @vite-ignore */ moduleUrl) as PdfJs;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: bytes });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 5_000) throw new Error("PDF 超过 5000 页，请先拆分");
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = normalizeText(content.items.map((item) => item.str || "").join(" "));
      pages.push(text);
    }
    const meaningful = pages.join("").replace(/[\d\s\p{P}]/gu, "");
    if (meaningful.length < Math.max(40, pdf.numPages * 8)) throw new Error("PDF 没有足够的可提取文字，可能需要先做 OCR");
    let title = fileName.replace(/\.[^.]+$/, "");
    let author = "";
    try {
      const metadata = await pdf.getMetadata?.();
      title = String(metadata?.metadata?.get("dc:title") || metadata?.info?.Title || title);
      author = String(metadata?.metadata?.get("dc:creator") || metadata?.info?.Author || "");
    } catch {
      // Metadata is optional; physical page text remains usable.
    }
    const chapters = [];
    const pagesPerChapter = 20;
    for (let start = 0; start < pages.length; start += pagesPerChapter) {
      const end = Math.min(pages.length, start + pagesPerChapter);
      const content = pages.slice(start, end).map((text, offset) => `第 ${start + offset + 1} 页\n${text}`).join("\n\n").trim();
      if (content) chapters.push({
        title: end === start + 1 ? `第 ${start + 1} 页` : `第 ${start + 1}–${end} 页`,
        content,
        source_locator: `pdf:pages:${start + 1}-${end}`,
      });
    }
    return { title: cleanTitle(title, "未命名 PDF"), author: normalizeText(author).slice(0, 300), language: "", chapters };
  } finally {
    await task.destroy();
  }
}

function normalizeZipPath(value: string) {
  const parts: string[] = [];
  for (const part of value.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function resolveZipPath(baseFile: string, href: string) {
  const cleanHref = href.split("#", 1)[0].split("?", 1)[0];
  let decoded = cleanHref;
  try { decoded = decodeURIComponent(cleanHref); } catch { /* keep original href */ }
  const base = baseFile.includes("/") ? baseFile.slice(0, baseFile.lastIndexOf("/") + 1) : "";
  return normalizeZipPath(`${base}${decoded}`);
}

function xmlDocument(value: string, label: string) {
  const documentValue = new DOMParser().parseFromString(value, "application/xml");
  if (documentValue.getElementsByTagName("parsererror").length) throw new Error(`${label} XML 无法解析`);
  return documentValue;
}

function firstNamespacedText(documentValue: Document, localName: string) {
  const values = documentValue.getElementsByTagNameNS("*", localName);
  return normalizeText(values[0]?.textContent || "");
}

function xhtmlText(value: string) {
  let documentValue = new DOMParser().parseFromString(value, "application/xhtml+xml");
  if (documentValue.getElementsByTagName("parsererror").length) documentValue = new DOMParser().parseFromString(value, "text/html");
  documentValue.querySelectorAll("script,style,noscript,svg").forEach((node) => node.remove());
  const blocks = [...documentValue.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,td,th")]
    .map((node) => normalizeText(node.textContent || ""))
    .filter(Boolean);
  return normalizeText(blocks.length ? blocks.join("\n\n") : documentValue.body?.textContent || documentValue.documentElement.textContent || "");
}

function epubNavigation(entries: Record<string, Uint8Array>, opfPath: string, manifest: Map<string, { href: string; media: string; properties: string }>) {
  const titles = new Map<string, string>();
  for (const item of manifest.values()) {
    if (!item.properties.split(/\s+/).includes("nav")) continue;
    const path = resolveZipPath(opfPath, item.href);
    const bytes = entries[path];
    if (!bytes) continue;
    const documentValue = new DOMParser().parseFromString(decodeText(bytes), "text/html");
    documentValue.querySelectorAll("a[href]").forEach((anchor) => {
      const href = anchor.getAttribute("href") || "";
      const target = resolveZipPath(path, href);
      const title = normalizeText(anchor.textContent || "");
      if (target && title && !titles.has(target)) titles.set(target, title.slice(0, 500));
    });
  }
  return titles;
}

function extractEpub(bytes: Uint8Array, fileName: string) {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error("EPUB 压缩包无法解析");
  }
  const names = Object.keys(entries);
  if (names.length > 10_000) throw new Error("EPUB 文件条目过多");
  const expanded = Object.values(entries).reduce((sum, value) => sum + value.byteLength, 0);
  if (expanded > maxExpandedBytes) throw new Error("EPUB 解压后超过 160 MB");
  const pathMap = new Map(names.map((name) => [normalizeZipPath(name), name]));
  const readEntry = (path: string) => {
    const actual = pathMap.get(normalizeZipPath(path));
    return actual ? entries[actual] : undefined;
  };
  const containerBytes = readEntry("META-INF/container.xml");
  if (!containerBytes) throw new Error("EPUB 缺少 META-INF/container.xml");
  const container = xmlDocument(decodeText(containerBytes), "EPUB container");
  const rootfile = container.getElementsByTagNameNS("*", "rootfile")[0];
  const opfPath = normalizeZipPath(rootfile?.getAttribute("full-path") || "");
  const opfBytes = readEntry(opfPath);
  if (!opfPath || !opfBytes) throw new Error("EPUB 找不到 OPF package");
  const opf = xmlDocument(decodeText(opfBytes), "EPUB package");
  const title = cleanTitle(firstNamespacedText(opf, "title"), fileName.replace(/\.[^.]+$/, ""));
  const author = firstNamespacedText(opf, "creator").slice(0, 300);
  const language = firstNamespacedText(opf, "language").slice(0, 40);
  const manifest = new Map<string, { href: string; media: string; properties: string }>();
  for (const item of [...opf.getElementsByTagNameNS("*", "item")]) {
    const id = item.getAttribute("id") || "";
    const href = item.getAttribute("href") || "";
    if (id && href) manifest.set(id, { href, media: item.getAttribute("media-type") || "", properties: item.getAttribute("properties") || "" });
  }
  const navigation = epubNavigation(Object.fromEntries([...pathMap.entries()].map(([normalized, actual]) => [normalized, entries[actual]])), opfPath, manifest);
  const chapters: Array<{ title: string; content: string; source_locator: string }> = [];
  const spine = [...opf.getElementsByTagNameNS("*", "itemref")];
  const ordered = spine.length
    ? spine.filter((item) => item.getAttribute("linear") !== "no").map((item) => manifest.get(item.getAttribute("idref") || "")).filter((item): item is { href: string; media: string; properties: string } => Boolean(item))
    : [...manifest.values()].filter((item) => /xhtml|html/i.test(item.media));
  for (const item of ordered) {
    if (!/xhtml|html/i.test(item.media) && !/\.x?html?$/i.test(item.href)) continue;
    const path = resolveZipPath(opfPath, item.href);
    const chapterBytes = readEntry(path);
    if (!chapterBytes) continue;
    const raw = decodeText(chapterBytes);
    const content = xhtmlText(raw);
    if (content.replace(/\s/g, "").length < 20) continue;
    const documentValue = new DOMParser().parseFromString(raw, "text/html");
    const heading = normalizeText(documentValue.querySelector("h1,h2,h3,title")?.textContent || "");
    chapters.push({
      title: cleanTitle(navigation.get(path) || heading, `第 ${chapters.length + 1} 章`),
      content,
      source_locator: `epub:${path}`,
    });
    if (chapters.length >= maxChapters) break;
  }
  if (!chapters.length) throw new Error("EPUB 的阅读顺序中没有可用正文");
  return { title, author, language, chapters };
}

export async function ingestBookFile(file: File): Promise<NormalizedBook> {
  const format = detectBookSourceFormat(file.name);
  if (!format) throw new Error("当前支持 PDF、EPUB、TXT 和 Markdown");
  if (file.size <= 0) throw new Error("书籍文件为空");
  if (file.size > maxSourceBytes) throw new Error("书籍文件超过 80 MB，请先压缩或拆分");
  recordDiagnostic("info", "book-import", `开始解析 ${file.name}`, { format, bytes: file.size });
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sourceFingerprint = await sha256(bytes);
    const extracted = format === "pdf"
      ? await extractPdf(bytes, file.name)
      : format === "epub"
        ? extractEpub(bytes, file.name)
        : { title: file.name.replace(/\.[^.]+$/, ""), author: "", language: "", chapters: splitTextChapters(decodeText(bytes), format) };
    const chapters = await Promise.all(extracted.chapters.map(async (chapter, index) => {
      const title = cleanTitle(chapter.title, `第 ${index + 1} 章`);
      const content = normalizeText(chapter.content);
      return {
        index,
        title,
        content,
        source_locator: chapter.source_locator,
        content_fingerprint: await sha256(`${title}\n${content}`),
      };
    }));
    if (!chapters.length || chapters.some((chapter) => !chapter.content)) throw new Error("书籍没有可保存的章节正文");
    recordDiagnostic("info", "book-import", `${file.name} 解析完成`, { chapters: chapters.length, format });
    return {
      title: cleanTitle(extracted.title, file.name.replace(/\.[^.]+$/, "")),
      author: normalizeText(extracted.author).slice(0, 300),
      language: normalizeText(extracted.language).slice(0, 40),
      format,
      source_name: file.name.slice(0, 500),
      source_fingerprint: sourceFingerprint,
      chapters,
    };
  } catch (error) {
    recordDiagnostic("error", "book-import", `${file.name} 解析失败`, error);
    throw error;
  }
}

export async function normalizeLegacyBook(title: string, text: string): Promise<NormalizedBook> {
  const chapters = splitTextChapters(text, "legacy");
  return {
    title: cleanTitle(title, "旧版书籍"),
    author: "",
    language: "",
    format: "legacy",
    source_name: title,
    source_fingerprint: await sha256(`legacy\n${title}\n${text}`),
    chapters: await Promise.all(chapters.map(async (chapter, index) => ({
      index,
      title: chapter.title,
      content: chapter.content,
      source_locator: chapter.source_locator,
      content_fingerprint: await sha256(`${chapter.title}\n${chapter.content}`),
    }))),
  };
}

export { normalizeText, sha256 };
