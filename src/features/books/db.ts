import { recordDiagnostic } from "../diagnostics/store";
import { normalizeLegacyBook } from "./ingest";
import type {
  BookChapter,
  BookForgeJob,
  BookRecord,
  NormalizedBook,
  StoredChapterAnalysis,
} from "./types";

const databaseName = "atherloom-react:book-forge:v1";
const databaseVersion = 1;

function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function requestValue<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB 请求失败"));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB 事务已中止"));
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB 事务失败"));
  });
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      const books = database.createObjectStore("books", { keyPath: "id" });
      books.createIndex("persona_key", "persona_key");
      books.createIndex("source_fingerprint", "source_fingerprint");
      const chapters = database.createObjectStore("chapters", { keyPath: "id" });
      chapters.createIndex("book_id", "book_id");
      const analyses = database.createObjectStore("analyses", { keyPath: "id" });
      analyses.createIndex("book_id", "book_id");
      const jobs = database.createObjectStore("jobs", { keyPath: "id" });
      jobs.createIndex("book_id", "book_id");
      jobs.createIndex("persona_key", "persona_key");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开本地书库"));
  });
}

export async function listBooks(personaKey: string) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("books", "readonly");
    const rows = await requestValue(transaction.objectStore("books").index("persona_key").getAll(personaKey)) as BookRecord[];
    await transactionDone(transaction);
    return rows.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  } finally {
    database.close();
  }
}

export async function getBook(bookId: string) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("books", "readonly");
    const row = await requestValue(transaction.objectStore("books").get(bookId)) as BookRecord | undefined;
    await transactionDone(transaction);
    return row || null;
  } finally {
    database.close();
  }
}

export async function saveBook(book: BookRecord) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("books", "readwrite");
    transaction.objectStore("books").put({ ...book, updated_at: new Date().toISOString() });
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function listBookChapters(bookId: string) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("chapters", "readonly");
    const rows = await requestValue(transaction.objectStore("chapters").index("book_id").getAll(bookId)) as BookChapter[];
    await transactionDone(transaction);
    return rows.sort((left, right) => left.index - right.index);
  } finally {
    database.close();
  }
}

export async function saveChapter(chapter: BookChapter) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("chapters", "readwrite");
    transaction.objectStore("chapters").put({ ...chapter, updated_at: new Date().toISOString() });
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function importNormalizedBook(
  normalized: NormalizedBook,
  personaKey: string,
  legacySourceId?: string,
) {
  const existing = (await listBooks(personaKey)).find((book) => (
    book.source_fingerprint === normalized.source_fingerprint || (legacySourceId && book.legacy_source_id === legacySourceId)
  ));
  if (existing) return { book: existing, reused: true };
  const stamp = new Date().toISOString();
  const bookId = makeId("book");
  const book: BookRecord = {
    id: bookId,
    persona_key: personaKey,
    title: normalized.title,
    author: normalized.author,
    language: normalized.language,
    format: normalized.format,
    source_name: normalized.source_name,
    source_fingerprint: normalized.source_fingerprint,
    total_chapters: normalized.chapters.length,
    current_chapter: 0,
    current_progress: 0,
    analysis_instructions: "",
    bookmarks: [],
    legacy_source_id: legacySourceId,
    created_at: stamp,
    updated_at: stamp,
  };
  const chapters: BookChapter[] = normalized.chapters.map((chapter) => ({
    id: `${bookId}:${chapter.index}`,
    book_id: bookId,
    index: chapter.index,
    title: chapter.title,
    content: chapter.content,
    source_locator: chapter.source_locator,
    content_fingerprint: chapter.content_fingerprint,
    notes: [],
    created_at: stamp,
    updated_at: stamp,
  }));
  const database = await openDatabase();
  try {
    const transaction = database.transaction(["books", "chapters"], "readwrite");
    transaction.objectStore("books").put(book);
    for (const chapter of chapters) transaction.objectStore("chapters").put(chapter);
    await transactionDone(transaction);
    recordDiagnostic("info", "book-library", `《${book.title}》已进入本地书库`, { chapters: chapters.length, format: book.format });
    return { book, reused: false };
  } catch (error) {
    recordDiagnostic("error", "book-library", `《${book.title}》保存失败`, error);
    throw error;
  } finally {
    database.close();
  }
}

export async function migrateLegacyBooks(
  personaKey: string,
  rows: Array<{ id: string; title: string; text: string; progress?: number; bookmarks?: Array<{ id: string; label: string; progress: number }>; created_at?: string; updated_at?: string }>,
) {
  let imported = 0;
  for (const row of rows) {
    if (!row.id || !row.text?.trim()) continue;
    const current = (await listBooks(personaKey)).find((book) => book.legacy_source_id === row.id);
    if (current) continue;
    const normalized = await normalizeLegacyBook(row.title, row.text);
    const result = await importNormalizedBook(normalized, personaKey, row.id);
    if (result.reused) continue;
    result.book.current_progress = Math.max(0, Math.min(100, Number(row.progress || 0)));
    result.book.bookmarks = (row.bookmarks || []).map((bookmark) => ({
      id: bookmark.id || makeId("bookmark"),
      chapter_index: 0,
      progress: Math.max(0, Math.min(100, Number(bookmark.progress || 0))),
      label: String(bookmark.label || "旧版书签").slice(0, 120),
      created_at: row.created_at || new Date().toISOString(),
    }));
    await saveBook(result.book);
    imported += 1;
  }
  return imported;
}

export async function getChapterAnalysis(bookId: string, chapterIndex: number) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("analyses", "readonly");
    const row = await requestValue(transaction.objectStore("analyses").get(`${bookId}:${chapterIndex}`)) as StoredChapterAnalysis | undefined;
    await transactionDone(transaction);
    return row || null;
  } finally {
    database.close();
  }
}

export async function listBookAnalyses(bookId: string) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("analyses", "readonly");
    const rows = await requestValue(transaction.objectStore("analyses").index("book_id").getAll(bookId)) as StoredChapterAnalysis[];
    await transactionDone(transaction);
    return rows.sort((left, right) => left.chapter_index - right.chapter_index);
  } finally {
    database.close();
  }
}

export async function saveChapterAnalysis(analysis: StoredChapterAnalysis) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("analyses", "readwrite");
    transaction.objectStore("analyses").put(analysis);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function listBookJobs(bookId: string) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("jobs", "readonly");
    const rows = await requestValue(transaction.objectStore("jobs").index("book_id").getAll(bookId)) as BookForgeJob[];
    await transactionDone(transaction);
    return rows.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  } finally {
    database.close();
  }
}

export async function saveBookJob(job: BookForgeJob) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("jobs", "readwrite");
    transaction.objectStore("jobs").put({ ...job, updated_at: new Date().toISOString() });
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function recoverInterruptedJobs(personaKey: string) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction("jobs", "readwrite");
    const store = transaction.objectStore("jobs");
    const rows = await requestValue(store.index("persona_key").getAll(personaKey)) as BookForgeJob[];
    const stamp = new Date().toISOString();
    for (const job of rows) {
      if (job.status !== "analyzing") continue;
      store.put({ ...job, status: "interrupted", updated_at: stamp, last_error: "应用在任务运行中关闭，可从已有章节继续" });
    }
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function deleteBook(bookId: string) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(["books", "chapters", "analyses", "jobs"], "readwrite");
    const chapterStore = transaction.objectStore("chapters");
    const analysisStore = transaction.objectStore("analyses");
    const jobStore = transaction.objectStore("jobs");
    const [chapterKeys, analysisKeys, jobKeys] = await Promise.all([
      requestValue(chapterStore.index("book_id").getAllKeys(bookId)),
      requestValue(analysisStore.index("book_id").getAllKeys(bookId)),
      requestValue(jobStore.index("book_id").getAllKeys(bookId)),
    ]);
    for (const key of chapterKeys) chapterStore.delete(key);
    for (const key of analysisKeys) analysisStore.delete(key);
    for (const key of jobKeys) jobStore.delete(key);
    transaction.objectStore("books").delete(bookId);
    await transactionDone(transaction);
    recordDiagnostic("info", "book-library", "已从本地书库删除一本书", { book_id: bookId });
  } finally {
    database.close();
  }
}
