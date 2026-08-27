import { useEffect, useMemo, useState } from "react";
import { saveFile } from "../../adapters/native/files";
import { writeClipboardText } from "../../adapters/native/clipboard";
import {
  clearDiagnostics,
  diagnosticsEventName,
  listDiagnostics,
  type DiagnosticEntry,
  type DiagnosticLevel,
} from "./store";

const levelLabel: Record<DiagnosticLevel, string> = {
  info: "信息",
  warning: "提醒",
  error: "错误",
};

function displayTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : value;
}

function logText(entries: DiagnosticEntry[]) {
  return entries.map((entry) => [
    `[${entry.created_at}] [${entry.level.toUpperCase()}] [${entry.source}] ${entry.message}`,
    entry.detail,
  ].filter(Boolean).join("\n")).join("\n\n");
}

export function DiagnosticsSettings() {
  const [entries, setEntries] = useState<DiagnosticEntry[]>(listDiagnostics);
  const [level, setLevel] = useState<DiagnosticLevel | "all">("all");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const reload = () => setEntries(listDiagnostics());
    window.addEventListener(diagnosticsEventName(), reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener(diagnosticsEventName(), reload);
      window.removeEventListener("storage", reload);
    };
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return entries.filter((entry) => level === "all" || entry.level === level).filter((entry) => (
      !needle || `${entry.source}\n${entry.message}\n${entry.detail}`.toLocaleLowerCase().includes(needle)
    ));
  }, [entries, level, query]);

  const exportLogs = async () => {
    try {
      const body = JSON.stringify({ format: "atherloom-diagnostics", version: 1, exported_at: new Date().toISOString(), entries }, null, 2);
      const result = await saveFile(`atherloom-logs-${new Date().toISOString().slice(0, 10)}.json`, new Blob([body], { type: "application/json;charset=utf-8" }));
      setStatus(result);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "日志导出失败");
    }
  };

  const copyVisible = async () => {
    try {
      await writeClipboardText(logText(visible));
      setStatus(`已复制 ${visible.length} 条日志`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "日志复制失败");
    }
  };

  return (
    <section className="settings-section settings-feature diagnostics-settings">
      <div className="section-heading section-heading-with-action">
        <div><span className="settings-eyebrow">RUNNING LEDGER</span><h3>后台日志</h3><p>查看页面、接口、Android 桥接和后台任务产生的错误与运行记录。</p></div>
        <div className="form-actions"><button type="button" onClick={() => void copyVisible()}>复制当前结果</button><button type="button" onClick={() => void exportLogs()}>导出日志</button></div>
      </div>
      <div className="diagnostics-summary" aria-label="日志统计">
        <span><strong>{entries.length}</strong> 总数</span>
        <span><strong>{entries.filter((entry) => entry.level === "error").length}</strong> 错误</span>
        <span><strong>{entries.filter((entry) => entry.level === "warning").length}</strong> 提醒</span>
      </div>
      <div className="diagnostics-toolbar">
        <label>级别<select value={level} onChange={(event) => setLevel(event.target.value as DiagnosticLevel | "all")}><option value="all">全部</option><option value="error">错误</option><option value="warning">提醒</option><option value="info">信息</option></select></label>
        <label>搜索<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="来源、错误内容或任务名称" /></label>
        <button className="danger-action" type="button" onClick={() => { if (window.confirm("清空这台设备上的后台日志？")) { clearDiagnostics(); setEntries([]); setStatus("日志已清空"); } }}>清空</button>
      </div>
      <div className="diagnostics-ledger">
        {visible.map((entry) => <article data-level={entry.level} key={entry.id}>
          <header><span>{levelLabel[entry.level]}</span><strong>{entry.source}</strong><time>{displayTime(entry.created_at)}</time></header>
          <p>{entry.message}</p>
          {entry.detail ? <details><summary>详细信息</summary><pre>{entry.detail}</pre></details> : null}
        </article>)}
        {!visible.length ? <p className="settings-empty-copy">当前筛选下没有日志。</p> : null}
      </div>
      <p className="form-status" aria-live="polite">{status}</p>
    </section>
  );
}
