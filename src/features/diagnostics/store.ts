export type DiagnosticLevel = "info" | "warning" | "error";

export interface DiagnosticEntry {
  id: string;
  level: DiagnosticLevel;
  source: string;
  message: string;
  detail: string;
  created_at: string;
}

const diagnosticsKey = "atherloom-react:diagnostics:v1";
const diagnosticsLimit = 300;
const changeEvent = "atherloom:diagnostics-changed";
let installed = false;

function bounded(value: unknown, limit: number) {
  return String(value ?? "").trim().slice(0, limit);
}

function safeDetail(value: unknown) {
  if (value instanceof Error) return bounded(value.stack || `${value.name}: ${value.message}`, 8_000);
  if (typeof value === "string") return bounded(value, 8_000);
  try {
    return bounded(JSON.stringify(value, null, 2), 8_000);
  } catch {
    return bounded(value, 8_000);
  }
}

function normalizeEntry(value: unknown): DiagnosticEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const message = bounded(raw.message, 1_000);
  if (!message) return null;
  return {
    id: bounded(raw.id, 180) || `log-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    level: raw.level === "error" || raw.level === "warning" ? raw.level : "info",
    source: bounded(raw.source, 120) || "app",
    message,
    detail: bounded(raw.detail, 8_000),
    created_at: Number.isFinite(Date.parse(String(raw.created_at || "")))
      ? new Date(String(raw.created_at)).toISOString()
      : new Date().toISOString(),
  };
}

export function listDiagnostics() {
  try {
    const parsed = JSON.parse(localStorage.getItem(diagnosticsKey) || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeEntry).filter((entry): entry is DiagnosticEntry => Boolean(entry)).slice(0, diagnosticsLimit);
  } catch {
    return [];
  }
}

export function recordDiagnostic(
  level: DiagnosticLevel,
  source: string,
  message: string,
  detail: unknown = "",
) {
  const entry: DiagnosticEntry = {
    id: `log-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
    level,
    source: bounded(source, 120) || "app",
    message: bounded(message, 1_000) || "未命名日志",
    detail: safeDetail(detail),
    created_at: new Date().toISOString(),
  };
  try {
    localStorage.setItem(diagnosticsKey, JSON.stringify([entry, ...listDiagnostics()].slice(0, diagnosticsLimit)));
    window.dispatchEvent(new CustomEvent(changeEvent, { detail: entry }));
  } catch {
    // Logging must never replace the original application error.
  }
  return entry;
}

export function clearDiagnostics() {
  localStorage.removeItem(diagnosticsKey);
  window.dispatchEvent(new CustomEvent(changeEvent));
}

export function diagnosticsEventName() {
  return changeEvent;
}

function consoleMessage(values: unknown[]) {
  return values.map((value) => value instanceof Error ? `${value.name}: ${value.message}` : typeof value === "string" ? value : safeDetail(value)).join(" ").slice(0, 8_000);
}

export function installDiagnostics() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);
  console.warn = (...values: unknown[]) => {
    recordDiagnostic("warning", "console", consoleMessage(values));
    originalWarn(...values);
  };
  console.error = (...values: unknown[]) => {
    recordDiagnostic("error", "console", consoleMessage(values));
    originalError(...values);
  };

  window.addEventListener("error", (event) => {
    recordDiagnostic("error", "window", event.message || "页面脚本错误", {
      file: event.filename,
      line: event.lineno,
      column: event.colno,
      stack: event.error instanceof Error ? event.error.stack : "",
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    recordDiagnostic("error", "promise", "未处理的异步错误", event.reason);
  });
  recordDiagnostic("info", "runtime", "应用日志已启动", {
    mode: window.AtherloomNative ? "android" : "browser",
    version: "0.2.7",
  });
}
