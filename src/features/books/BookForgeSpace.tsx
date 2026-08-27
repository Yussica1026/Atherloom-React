import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { saveFile } from "../../adapters/native/files";
import type { Provider } from "../../domain/types";
import { analyzeChapter, bookAnalysisSignature, chapterAnalysisFingerprint } from "./analysis";
import {
  deleteBook,
  importNormalizedBook,
  listBookAnalyses,
  listBookChapters,
  listBookJobs,
  listBooks,
  migrateLegacyBooks,
  recoverInterruptedJobs,
  saveBook,
  saveBookJob,
  saveChapter,
} from "./db";
import { ingestBookFile } from "./ingest";
import { buildAgentSkillArchive, buildBookAnalysisExport } from "./output";
import type {
  BookChapter,
  BookForgeJob,
  BookModelGenerator,
  BookRecord,
  StoredChapterAnalysis,
} from "./types";
import "./books.css";

interface LegacyBook {
  id: string;
  title: string;
  text: string;
  progress?: number;
  bookmarks?: Array<{ id: string; label: string; progress: number }>;
  created_at?: string;
  updated_at?: string;
}

export interface BookForgeSpaceProps {
  personaKey: string;
  personaName: string;
  providers: Provider[];
  providerId?: string | null;
  legacyBooks?: LegacyBook[];
  onGenerate: BookModelGenerator;
  onSendToAssistant: (content: string) => Promise<string | void>;
}

type Notice = { tone: "info" | "error"; text: string } | null;

function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function formatName(format: BookRecord["format"]) {
  return format === "markdown" ? "Markdown" : format === "legacy" ? "旧版迁移" : format.toLocaleUpperCase();
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim().slice(0, 90) || "Atherloom-书籍分析";
}

function jobStatusLabel(status: BookForgeJob["status"]) {
  const labels: Record<BookForgeJob["status"], string> = {
    queued: "等待开始",
    analyzing: "正在炼制",
    paused: "已暂停",
    interrupted: "上次中断",
    completed: "已完成",
    failed: "有章节失败",
    cancelled: "已取消",
  };
  return labels[status];
}

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export function BookForgeSpace({
  personaKey,
  personaName,
  providers,
  providerId,
  legacyBooks = [],
  onGenerate,
  onSendToAssistant,
}: BookForgeSpaceProps) {
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [activeBookId, setActiveBookId] = useState("");
  const [chapters, setChapters] = useState<BookChapter[]>([]);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [analyses, setAnalyses] = useState<StoredChapterAnalysis[]>([]);
  const [latestJob, setLatestJob] = useState<BookForgeJob | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState(providerId || "");
  const [instructions, setInstructions] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [chapterBusy, setChapterBusy] = useState(false);
  const [jobBusy, setJobBusy] = useState(false);
  const [pausePending, setPausePending] = useState(false);
  const readerRef = useRef<HTMLDivElement>(null);
  const pendingProgressRef = useRef<number | null>(null);
  const progressTimerRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const migrationRef = useRef<{ key: string; promise: Promise<number> } | null>(null);
  const pauseRef = useRef(false);
  const cancelRef = useRef(false);

  const activeBook = useMemo(
    () => books.find((book) => book.id === activeBookId) || null,
    [activeBookId, books],
  );
  const activeChapter = chapters.find((chapter) => chapter.index === chapterIndex) || chapters[0] || null;
  const activeAnalysis = analyses.find((analysis) => analysis.chapter_index === activeChapter?.index) || null;
  const analysisByChapter = useMemo(
    () => new Map(analyses.map((analysis) => [analysis.chapter_index, analysis])),
    [analyses],
  );
  const legacyBooksKey = legacyBooks.map((book) => `${book.id}:${book.updated_at || ""}:${book.text.length}`).join("|");
  const enabledProviders = providers.filter((provider) => provider.enabled !== false);

  const refreshBooks = useCallback(async (preferredId?: string) => {
    const rows = await listBooks(personaKey);
    setBooks(rows);
    setActiveBookId((current) => {
      if (preferredId && rows.some((book) => book.id === preferredId)) return preferredId;
      if (rows.some((book) => book.id === current)) return current;
      return rows[0]?.id || "";
    });
    return rows;
  }, [personaKey]);

  const refreshBookDetails = useCallback(async (book: BookRecord) => {
    const [chapterRows, analysisRows, jobRows] = await Promise.all([
      listBookChapters(book.id),
      listBookAnalyses(book.id),
      listBookJobs(book.id),
    ]);
    setChapters(chapterRows);
    setAnalyses(analysisRows);
    setLatestJob(jobRows[0] || null);
    setChapterIndex((current) => (
      chapterRows.some((chapter) => chapter.index === current)
        ? current
        : chapterRows.some((chapter) => chapter.index === book.current_chapter)
          ? book.current_chapter
          : chapterRows[0]?.index || 0
    ));
    setInstructions(book.analysis_instructions || "");
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotice(null);
    setBooks([]);
    setActiveBookId("");
    void (async () => {
      try {
        await recoverInterruptedJobs(personaKey);
        if (legacyBooks.length) {
          const migrationKey = `${personaKey}:${legacyBooksKey}`;
          if (migrationRef.current?.key !== migrationKey) {
            migrationRef.current = { key: migrationKey, promise: migrateLegacyBooks(personaKey, legacyBooks) };
          }
          await migrationRef.current.promise;
        }
        if (!cancelled) await refreshBooks();
      } catch (error) {
        if (!cancelled) setNotice({ tone: "error", text: error instanceof Error ? error.message : "本地书库打开失败" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [legacyBooksKey, personaKey, refreshBooks]);

  useEffect(() => {
    if (!activeBook) {
      setChapters([]);
      setAnalyses([]);
      setLatestJob(null);
      return;
    }
    let cancelled = false;
    void refreshBookDetails(activeBook).catch((error) => {
      if (!cancelled) setNotice({ tone: "error", text: error instanceof Error ? error.message : "书籍内容读取失败" });
    });
    return () => { cancelled = true; };
  }, [activeBook?.id, refreshBookDetails]);

  useEffect(() => {
    setSelectedProviderId(providerId || "");
  }, [personaKey, providerId]);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (progressTimerRef.current !== null) window.clearTimeout(progressTimerRef.current);
  }, []);

  useEffect(() => {
    const value = pendingProgressRef.current;
    if (value === null) return;
    pendingProgressRef.current = null;
    window.requestAnimationFrame(() => {
      const node = readerRef.current;
      if (node) node.scrollTop = (node.scrollHeight - node.clientHeight) * value / 100;
    });
  }, [chapterIndex]);

  const readerProgress = useCallback(() => {
    const node = readerRef.current;
    if (!node) return activeBook?.current_progress || 0;
    return Math.max(0, Math.min(100, Math.round(node.scrollTop / Math.max(1, node.scrollHeight - node.clientHeight) * 100)));
  }, [activeBook?.current_progress]);

  const persistReadingPosition = useCallback((progress: number) => {
    if (!activeBook) return;
    const next = { ...activeBook, current_chapter: activeChapter?.index || 0, current_progress: progress };
    setBooks((rows) => rows.map((book) => book.id === next.id ? next : book));
    if (progressTimerRef.current !== null) window.clearTimeout(progressTimerRef.current);
    progressTimerRef.current = window.setTimeout(() => {
      progressTimerRef.current = null;
      void saveBook(next).catch((error) => setNotice({ tone: "error", text: error instanceof Error ? error.message : "阅读进度保存失败" }));
    }, 450);
  }, [activeBook, activeChapter?.index]);

  const openChapter = useCallback((index: number, progress = 0) => {
    if (!activeBook) return;
    pendingProgressRef.current = progress;
    setChapterIndex(index);
    const next = { ...activeBook, current_chapter: index, current_progress: progress };
    setBooks((rows) => rows.map((book) => book.id === next.id ? next : book));
    void saveBook(next);
  }, [activeBook]);

  const importFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    if (!files.length || importing) return;
    setImporting(true);
    setNotice({ tone: "info", text: `正在解析 ${files.length} 个文件…` });
    let preferredId = "";
    try {
      for (let index = 0; index < files.length; index += 1) {
        setNotice({ tone: "info", text: `正在解析 ${index + 1}/${files.length}：${files[index].name}` });
        const normalized = await ingestBookFile(files[index]);
        const result = await importNormalizedBook(normalized, personaKey);
        preferredId ||= result.book.id;
      }
      await refreshBooks(preferredId);
      setNotice({ tone: "info", text: files.length === 1 ? "书籍已进入本地书库" : `${files.length} 本书已进入本地书库` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "书籍导入失败" });
    } finally {
      setImporting(false);
    }
  };

  const saveInstructions = async () => {
    if (!activeBook) return null;
    const next = { ...activeBook, analysis_instructions: instructions.trim() };
    if (next.analysis_instructions !== activeBook.analysis_instructions) {
      await saveBook(next);
      setBooks((rows) => rows.map((book) => book.id === next.id ? next : book));
    }
    return next;
  };

  const runChapterAnalysis = async (force = false) => {
    if (!activeBook || !activeChapter || chapterBusy || jobBusy) return;
    if (!selectedProviderId) {
      setNotice({ tone: "error", text: "先选择用于分析的模型服务" });
      return;
    }
    setChapterBusy(true);
    setNotice({ tone: "info", text: `正在分析「${activeChapter.title}」…` });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const book = await saveInstructions() || activeBook;
      const result = await analyzeChapter(book, activeChapter, selectedProviderId, onGenerate, controller.signal, force);
      setAnalyses((rows) => [...rows.filter((item) => item.chapter_index !== result.chapter_index), result].sort((a, b) => a.chapter_index - b.chapter_index));
      setNotice({ tone: "info", text: result.cache_hit ? "已读取相同内容的本地分析" : "本章分析已保存" });
    } catch (error) {
      if (!isAbort(error)) setNotice({ tone: "error", text: error instanceof Error ? error.message : "章节分析失败" });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setChapterBusy(false);
    }
  };

  const writeJob = async (job: BookForgeJob, patch: Partial<BookForgeJob>) => {
    const next = { ...job, ...patch, updated_at: new Date().toISOString() };
    await saveBookJob(next);
    setLatestJob(next);
    return next;
  };

  const runWholeBook = async (resume?: BookForgeJob) => {
    if (!activeBook || !chapters.length || jobBusy || chapterBusy) return;
    if (!selectedProviderId) {
      setNotice({ tone: "error", text: "先选择用于分析的模型服务" });
      return;
    }
    const book = await saveInstructions() || activeBook;
    const signature = await bookAnalysisSignature(book, book.analysis_instructions);
    const exact = new Set<number>();
    for (const chapter of chapters) {
      const stored = analysisByChapter.get(chapter.index);
      if (stored?.input_fingerprint === await chapterAnalysisFingerprint(chapter, book.analysis_instructions, book)) exact.add(chapter.index);
    }
    const pending = chapters.length - exact.size;
    if (!resume) {
      const message = pending
        ? `整书共有 ${chapters.length} 章，其中 ${exact.size} 章可直接使用缓存，还需调用模型分析 ${pending} 章。现在开始吗？`
        : `整书 ${chapters.length} 章都已有相同内容的分析。要重新核对并完成导出准备吗？`;
      if (!window.confirm(message)) return;
    }
    const stamp = new Date().toISOString();
    let job: BookForgeJob = resume && resume.input_signature === signature ? {
      ...resume,
      provider_id: selectedProviderId,
      status: "analyzing",
      processed_chapters: exact.size,
      failed_chapters: [],
      last_error: undefined,
      updated_at: stamp,
    } : {
      id: makeId("book-job"),
      book_id: book.id,
      persona_key: personaKey,
      provider_id: selectedProviderId,
      input_signature: signature,
      status: "analyzing",
      processed_chapters: exact.size,
      total_chapters: chapters.length,
      current_chapter: null,
      failed_chapters: [],
      created_at: stamp,
      updated_at: stamp,
    };
    pauseRef.current = false;
    cancelRef.current = false;
    setPausePending(false);
    setJobBusy(true);
    await saveBookJob(job);
    setLatestJob(job);
    setNotice({ tone: "info", text: pending ? `整书任务开始，待分析 ${pending} 章` : "正在核对已有分析…" });
    const failed: number[] = [];
    try {
      for (const chapter of chapters) {
        if (cancelRef.current) {
          job = await writeJob(job, { status: "cancelled", current_chapter: null, failed_chapters: failed });
          setNotice({ tone: "info", text: "整书任务已取消，已有分析仍然保留" });
          return;
        }
        if (pauseRef.current) {
          job = await writeJob(job, { status: "paused", current_chapter: null, failed_chapters: failed });
          setNotice({ tone: "info", text: "整书任务已在章节边界暂停" });
          return;
        }
        if (exact.has(chapter.index)) continue;
        job = await writeJob(job, { status: "analyzing", current_chapter: chapter.index, failed_chapters: failed });
        setNotice({ tone: "info", text: `正在分析 ${chapter.index + 1}/${chapters.length}：${chapter.title}` });
        const controller = new AbortController();
        abortRef.current = controller;
        try {
          const result = await analyzeChapter(book, chapter, selectedProviderId, onGenerate, controller.signal);
          exact.add(chapter.index);
          setAnalyses((rows) => [...rows.filter((item) => item.chapter_index !== result.chapter_index), result].sort((a, b) => a.chapter_index - b.chapter_index));
          job = await writeJob(job, { processed_chapters: exact.size, current_chapter: null, failed_chapters: failed });
        } catch (error) {
          if (cancelRef.current || isAbort(error)) {
            job = await writeJob(job, { status: cancelRef.current ? "cancelled" : "interrupted", current_chapter: null, failed_chapters: failed });
            setNotice({ tone: "info", text: cancelRef.current ? "整书任务已取消，已有分析仍然保留" : "分析已中断，可以稍后继续" });
            return;
          }
          failed.push(chapter.index);
          job = await writeJob(job, {
            current_chapter: null,
            failed_chapters: [...failed],
            last_error: error instanceof Error ? error.message : "章节分析失败",
          });
        } finally {
          if (abortRef.current === controller) abortRef.current = null;
        }
      }
      job = await writeJob(job, {
        status: failed.length ? "failed" : "completed",
        processed_chapters: exact.size,
        current_chapter: null,
        failed_chapters: failed,
      });
      setNotice({
        tone: failed.length ? "error" : "info",
        text: failed.length ? `整书任务完成，${failed.length} 章需要重试` : `整书 ${chapters.length} 章分析完成`,
      });
    } finally {
      setJobBusy(false);
      setPausePending(false);
      abortRef.current = null;
    }
  };

  const pauseWholeBook = () => {
    pauseRef.current = true;
    setPausePending(true);
    setNotice({ tone: "info", text: "将在当前章节分析完成后暂停" });
  };

  const cancelWholeBook = () => {
    cancelRef.current = true;
    abortRef.current?.abort();
  };

  const addBookmark = async () => {
    if (!activeBook || !activeChapter) return;
    const progress = readerProgress();
    const next = {
      ...activeBook,
      bookmarks: [...activeBook.bookmarks, {
        id: makeId("bookmark"),
        chapter_index: activeChapter.index,
        progress,
        label: `${activeChapter.title} · ${progress}%`,
        created_at: new Date().toISOString(),
      }],
      current_chapter: activeChapter.index,
      current_progress: progress,
    };
    await saveBook(next);
    setBooks((rows) => rows.map((book) => book.id === next.id ? next : book));
    setNotice({ tone: "info", text: "书签已保存" });
  };

  const addNote = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeChapter || !noteDraft.trim()) return;
    const next = {
      ...activeChapter,
      notes: [...activeChapter.notes, {
        id: makeId("note"),
        text: noteDraft.trim().slice(0, 4_000),
        progress: readerProgress(),
        created_at: new Date().toISOString(),
      }],
    };
    await saveChapter(next);
    setChapters((rows) => rows.map((chapter) => chapter.id === next.id ? next : chapter));
    setNoteDraft("");
    setNotice({ tone: "info", text: "笔记已保存；下次分析本章时会纳入指纹" });
  };

  const shareChapter = async () => {
    if (!activeBook || !activeChapter) return;
    const progress = readerProgress();
    const center = Math.floor(activeChapter.content.length * progress / 100);
    const excerpt = activeChapter.content.slice(Math.max(0, center - 6_000), center + 6_000);
    const analysis = activeAnalysis?.analysis;
    setNotice({ tone: "info", text: `正在把当前段落送回与 ${personaName} 的聊天…` });
    try {
      await onSendToAssistant([
        `【本地共读：${activeBook.title}】`,
        `章节：${activeChapter.title}`,
        `阅读位置：约 ${progress}%`,
        analysis ? `本章已有分析：${analysis.core_idea}` : "",
        "",
        "当前附近原文：",
        excerpt,
      ].filter(Boolean).join("\n"));
      setNotice({ tone: "info", text: "已送回当前聊天" });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "发送到聊天失败" });
    }
  };

  const exportJson = async () => {
    if (!activeBook) return;
    await saveFile(`${safeFileName(activeBook.title)}-analysis.json`, buildBookAnalysisExport(activeBook, chapters, analyses));
    setNotice({ tone: "info", text: "分析 JSON 已交给系统保存" });
  };

  const exportSkill = async () => {
    if (!activeBook) return;
    try {
      const archive = await buildAgentSkillArchive(activeBook, chapters, analyses);
      await saveFile(archive.fileName, archive.blob);
      setNotice({ tone: "info", text: `Agent Skill 已导出，共 ${analyses.length} 章分析` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Agent Skill 导出失败" });
    }
  };

  const removeActiveBook = async () => {
    if (!activeBook || jobBusy) return;
    if (!window.confirm(`从本机删除《${activeBook.title}》、笔记和分析吗？`)) return;
    await deleteBook(activeBook.id);
    await refreshBooks();
    setNotice({ tone: "info", text: "书籍已从本地书库删除" });
  };

  if (loading) return <section className="book-forge book-forge-loading" aria-busy="true"><span className="book-forge-loader" /><p>正在打开本地书库…</p></section>;

  return (
    <section className="book-forge">
      <aside className="book-forge-library" aria-label="本地书库">
        <div className="book-forge-library-title">
          <span>LOCAL SHELF</span>
          <strong>{books.length} 本</strong>
        </div>
        <label className={`book-forge-import${importing ? " disabled" : ""}`}>
          <span>{importing ? "正在入库…" : "＋ 导入书籍"}</span>
          <small>PDF · EPUB · TXT · MD</small>
          <input
            type="file"
            multiple
            disabled={importing}
            accept=".pdf,.epub,.txt,.md,.markdown,application/pdf,application/epub+zip,text/plain,text/markdown"
            onChange={(event) => void importFiles(event)}
          />
        </label>
        <div className="book-forge-shelf">
          {books.map((book) => (
            <button
              type="button"
              className={book.id === activeBook?.id ? "active" : ""}
              onClick={() => setActiveBookId(book.id)}
              key={book.id}
            >
              <i aria-hidden="true" />
              <span><strong>{book.title}</strong><small>{formatName(book.format)} · {book.total_chapters} 章</small></span>
              <em>{Math.round(book.current_progress)}%</em>
            </button>
          ))}
          {!books.length && <p>把第一本书放进来。原文件不上传，正文留在这台设备。</p>}
        </div>
      </aside>

      <div className="book-forge-desk">
        {notice && <div className={`book-forge-notice ${notice.tone}`} role="status"><span>{notice.text}</span><button type="button" onClick={() => setNotice(null)} aria-label="关闭提示">×</button></div>}
        {!activeBook || !activeChapter ? (
          <div className="book-forge-empty">
            <span aria-hidden="true">书</span>
            <h3>书架还空着</h3>
            <p>支持有文字层的 PDF、EPUB、TXT 和 Markdown。导入后可以分章阅读、做笔记，再选择是否调用模型分析。</p>
          </div>
        ) : (
          <>
            <header className="book-forge-header">
              <div>
                <span>{formatName(activeBook.format)} · {activeBook.total_chapters} 章 · 已分析 {analyses.length} 章</span>
                <h2>{activeBook.title}</h2>
                <p>{activeBook.author || activeBook.source_name}</p>
              </div>
              <div className="book-forge-header-actions">
                <button type="button" onClick={() => void exportJson()}>导出 JSON</button>
                <button type="button" onClick={() => void exportSkill()}>导出 Agent Skill</button>
                <button type="button" className="danger" onClick={() => void removeActiveBook()}>删除</button>
              </div>
            </header>

            <div className="book-forge-workbench">
              <nav className="book-forge-chapters" aria-label="章节">
                <div><span>CHAPTERS</span><strong>{chapterIndex + 1} / {chapters.length}</strong></div>
                <div className="book-forge-chapter-list">
                  {chapters.map((chapter) => (
                    <button
                      type="button"
                      className={chapter.index === activeChapter.index ? "active" : ""}
                      onClick={() => openChapter(chapter.index)}
                      key={chapter.id}
                    >
                      <span>{String(chapter.index + 1).padStart(2, "0")}</span>
                      <strong>{chapter.title}</strong>
                      {analysisByChapter.has(chapter.index) && <i title="已有分析" aria-label="已有分析" />}
                    </button>
                  ))}
                </div>
              </nav>

              <main className="book-forge-reading">
                <div className="book-forge-reading-toolbar">
                  <button type="button" disabled={activeChapter.index <= chapters[0].index} onClick={() => openChapter(activeChapter.index - 1)}>← 上一章</button>
                  <strong>{activeChapter.title}</strong>
                  <button type="button" disabled={activeChapter.index >= chapters[chapters.length - 1].index} onClick={() => openChapter(activeChapter.index + 1)}>下一章 →</button>
                </div>
                <div
                  className="book-forge-reader"
                  ref={readerRef}
                  onScroll={() => persistReadingPosition(readerProgress())}
                  tabIndex={0}
                >
                  <article>
                    <span>第 {activeChapter.index + 1} 章</span>
                    <h3>{activeChapter.title}</h3>
                    <pre>{activeChapter.content}</pre>
                  </article>
                </div>
                <div className="book-forge-reader-actions">
                  <button type="button" onClick={() => void addBookmark()}>＋ 书签</button>
                  <button type="button" onClick={() => void shareChapter()}>和 {personaName} 读这一段</button>
                </div>
                <form className="book-forge-note-form" onSubmit={(event) => void addNote(event)}>
                  <label htmlFor="book-note">当前章节笔记</label>
                  <div><input id="book-note" value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="写下问题、想法或证据位置" /><button disabled={!noteDraft.trim()}>保存笔记</button></div>
                </form>
                {(activeChapter.notes.length > 0 || activeBook.bookmarks.length > 0) && (
                  <div className="book-forge-marginalia">
                    {activeBook.bookmarks.map((bookmark) => (
                      <button type="button" key={bookmark.id} onClick={() => openChapter(bookmark.chapter_index, bookmark.progress)}>
                        <span>书签</span>{bookmark.label}
                      </button>
                    ))}
                    {activeChapter.notes.map((note) => (
                      <button type="button" key={note.id} onClick={() => {
                        const node = readerRef.current;
                        if (node) node.scrollTop = (node.scrollHeight - node.clientHeight) * note.progress / 100;
                        persistReadingPosition(note.progress);
                      }}>
                        <span>{note.progress}%</span>{note.text}
                      </button>
                    ))}
                  </div>
                )}
              </main>

              <aside className="book-forge-analysis">
                <div className="book-forge-analysis-heading">
                  <span>ANALYSIS DESK</span>
                  <strong>由 {personaName} 使用当前人格分析</strong>
                </div>
                <label>分析模型
                  <select value={selectedProviderId} onChange={(event) => setSelectedProviderId(event.target.value)} disabled={jobBusy || chapterBusy}>
                    <option value="">选择模型服务</option>
                    {enabledProviders.map((provider) => <option value={provider.id} key={provider.id}>{provider.name} · {provider.model}</option>)}
                  </select>
                </label>
                <label>你的分析要求（可留空）
                  <textarea rows={4} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="例如：重点关注叙事结构；不要总结案例。这里的内容会单独、可见地传给模型。" />
                </label>
                <div className="book-forge-analysis-actions">
                  <button type="button" disabled={chapterBusy || jobBusy || !selectedProviderId} onClick={() => void runChapterAnalysis(Boolean(activeAnalysis))}>
                    {chapterBusy ? "分析中…" : activeAnalysis ? "重新分析本章" : "分析本章"}
                  </button>
                  {!jobBusy && <button type="button" className="primary" disabled={!selectedProviderId} onClick={() => void runWholeBook()}>整书炼制</button>}
                  {jobBusy && <>
                    <button type="button" disabled={pausePending} onClick={pauseWholeBook}>{pausePending ? "等待暂停…" : "暂停"}</button>
                    <button type="button" className="danger" onClick={cancelWholeBook}>取消</button>
                  </>}
                </div>

                {latestJob && (
                  <section className="book-forge-job">
                    <header><strong>{jobStatusLabel(latestJob.status)}</strong><span>{latestJob.processed_chapters} / {latestJob.total_chapters}</span></header>
                    <progress value={latestJob.processed_chapters} max={Math.max(1, latestJob.total_chapters)} />
                    {latestJob.current_chapter !== null && <p>当前：第 {latestJob.current_chapter + 1} 章</p>}
                    {latestJob.failed_chapters.length > 0 && <p>{latestJob.failed_chapters.length} 章等待重试</p>}
                    {!jobBusy && ["paused", "interrupted", "failed"].includes(latestJob.status) && (
                      <button type="button" onClick={() => void runWholeBook(latestJob)}>继续未完成任务</button>
                    )}
                  </section>
                )}

                {activeAnalysis ? (
                  <article className="book-forge-analysis-card">
                    <header><span>{activeAnalysis.cache_hit ? "CACHE" : "SAVED"}</span><time>{new Date(activeAnalysis.generated_at).toLocaleString()}</time></header>
                    <h3>核心思想</h3>
                    <p>{activeAnalysis.analysis.core_idea}</p>
                    {activeAnalysis.analysis.key_takeaways.length > 0 && <><h3>关键要点</h3><ul>{activeAnalysis.analysis.key_takeaways.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></>}
                    {activeAnalysis.analysis.frameworks.length > 0 && <><h3>框架</h3>{activeAnalysis.analysis.frameworks.map((item) => <details key={item.name}><summary>{item.name}</summary><p>{item.why}</p>{item.when_to_use && <small>适用：{item.when_to_use}</small>}</details>)}</>}
                    {activeAnalysis.analysis.topic_tags.length > 0 && <div className="book-forge-tags">{activeAnalysis.analysis.topic_tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
                    {activeAnalysis.analysis.quality_warnings.map((warning) => <p className="book-forge-warning" key={warning.code}><strong>{warning.code}</strong>{warning.message}</p>)}
                  </article>
                ) : (
                  <div className="book-forge-analysis-empty">
                    <span aria-hidden="true">析</span>
                    <p>本章还没有分析。正文与笔记只有在你点击分析时才会交给所选模型。</p>
                  </div>
                )}
              </aside>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
