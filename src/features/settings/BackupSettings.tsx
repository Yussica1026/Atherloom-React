import { useRef, useState, type ChangeEvent } from "react";
import type { BackupBundle, BackupPart, BackupRestoreResult } from "../../domain/types";
import { saveFile } from "../../adapters/native/files";
import { automationStoreKey } from "../automation/store";

interface BackupSettingsProps {
  onExport: (parts: BackupPart[]) => Promise<BackupBundle>;
  onRestore: (bundle: BackupBundle, parts: BackupPart[]) => Promise<BackupRestoreResult>;
}

const choices: Array<{ value: BackupPart; label: string; detail: string }> = [
  { value: "conversations", label: "对话与分支", detail: "会话、消息、摘要与珍藏" },
  { value: "personas", label: "人格与世界书", detail: "人格指令、启动策略与世界书" },
  { value: "memory", label: "记忆与生活", detail: "记忆、欲望、日记、留言、梦与往来" },
  { value: "settings", label: "设置与 MCP", detail: "线路结构、设置和审计；所有凭据均留空" },
  { value: "games", label: "游戏与剧场", detail: "游戏、庭院和角色剧场存档" },
];

const clientPrefix = "atherloom-react:";
const apiBaseKey = `${clientPrefix}api-base`;
const snapshotKey = `${clientPrefix}pre-restore`;
const standaloneStateKey = `${clientPrefix}standalone-state:v1`;
const standaloneSnapshotPrefix = `${clientPrefix}standalone-snapshot:`;
const featureSpacesKey = `${clientPrefix}feature-spaces:v1`;
const settingsClientKeys = [
  `${clientPrefix}theme`,
  `${clientPrefix}font`,
  `${clientPrefix}font-scale`,
  `${clientPrefix}voice-config:v1`,
  automationStoreKey,
] as const;
const conversationClientPrefixes = [`${clientPrefix}draft:`, `${clientPrefix}worldbooks:`] as const;
const memoryFeatureFields = [
  "journals", "journalSchedules", "journalAudit", "board", "dreams", "life",
  "contacts", "mail", "parlorConfigs", "boardWakes",
] as const;
const gameFeatureFields = ["roleplays", "books", "mediaNotes"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isProtectedClientKey(key: string) {
  return key === apiBaseKey || key === standaloneStateKey || key.startsWith(standaloneSnapshotPrefix) || key.startsWith(`${clientPrefix}pre-restore`);
}

function featureFieldsFor(parts: BackupPart[]) {
  return [
    ...(parts.includes("memory") ? memoryFeatureFields : []),
    ...(parts.includes("games") ? gameFeatureFields : []),
  ];
}

function collectClientData(parts: BackupPart[]) {
  const result: Record<string, string> = {};
  if (parts.includes("settings")) {
    for (const key of settingsClientKeys) {
      const value = localStorage.getItem(key);
      if (value !== null) result[key] = value;
    }
  }
  if (parts.includes("conversations")) {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !conversationClientPrefixes.some((prefix) => key.startsWith(prefix) && key.length > prefix.length)) continue;
      const value = localStorage.getItem(key);
      if (value !== null) result[key] = value;
    }
  }
  const featureFields = featureFieldsFor(parts);
  if (featureFields.length) {
    let source: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(localStorage.getItem(featureSpacesKey) || "{}") as unknown;
      if (isRecord(parsed)) source = parsed;
    } catch {
      source = {};
    }
    result[featureSpacesKey] = JSON.stringify(Object.fromEntries(featureFields.map((field) => [field, Array.isArray(source[field]) ? source[field] : []])));
  }
  return result;
}

function restoreClientData(data: Record<string, string> | undefined, parts: BackupPart[]) {
  if (!data) return;
  sessionStorage.setItem(snapshotKey, JSON.stringify(collectClientData(parts)));

  if (parts.includes("settings")) {
    for (const key of settingsClientKeys) {
      if (isProtectedClientKey(key)) continue;
      localStorage.removeItem(key);
      const value = data[key];
      if (typeof value === "string") localStorage.setItem(key, value);
    }
  }

  if (parts.includes("conversations")) {
    const removable: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && conversationClientPrefixes.some((prefix) => key.startsWith(prefix) && key.length > prefix.length)) removable.push(key);
    }
    removable.forEach((key) => localStorage.removeItem(key));
    for (const [key, value] of Object.entries(data)) {
      if (isProtectedClientKey(key) || typeof value !== "string") continue;
      if (conversationClientPrefixes.some((prefix) => key.startsWith(prefix) && key.length > prefix.length)) localStorage.setItem(key, value);
    }
  }

  const featureFields = featureFieldsFor(parts);
  const featureRaw = data[featureSpacesKey];
  if (featureFields.length && typeof featureRaw === "string") {
    let restored: Record<string, unknown>;
    try {
      const parsed = JSON.parse(featureRaw) as unknown;
      if (!isRecord(parsed)) throw new Error("独立空间数据格式错误");
      restored = parsed;
    } catch (error) {
      throw error instanceof Error ? error : new Error("独立空间数据格式错误");
    }
    let current: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(localStorage.getItem(featureSpacesKey) || "{}") as unknown;
      if (isRecord(parsed)) current = parsed;
    } catch {
      current = {};
    }
    for (const field of featureFields) current[field] = Array.isArray(restored[field]) ? restored[field] : [];
    localStorage.setItem(featureSpacesKey, JSON.stringify(current));
    window.dispatchEvent(new CustomEvent("atherloom:feature-spaces-restored"));
  }
}

function isBackupBundle(value: unknown): value is BackupBundle {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<BackupBundle>;
  return item.format === "atherloom-backup" && item.version === 2 && Array.isArray(item.parts) && Boolean(item.tables && typeof item.tables === "object");
}

export function BackupSettings({ onExport, onRestore }: BackupSettingsProps) {
  const [selected, setSelected] = useState<BackupPart[]>(choices.map((item) => item.value));
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const toggle = (part: BackupPart) => {
    setSelected((current) => current.includes(part) ? current.filter((item) => item !== part) : [...current, part]);
  };

  const exportBackup = async () => {
    if (!selected.length) {
      setStatus("请至少选择一类数据");
      return;
    }
    setBusy(true);
    setStatus("正在整理并脱敏备份…");
    try {
      const bundle = await onExport(selected);
      bundle.client_data = collectClientData(selected);
      const fileName = `atherloom-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json;charset=utf-8" });
      const message = await saveFile(fileName, blob);
      setStatus(`${message}。API Key、搜索 Key、自定义鉴权头和 MCP Token 未包含。`);
    } catch (error) {
      setStatus(error instanceof Error ? `导出失败：${error.message}` : "导出失败");
    } finally {
      setBusy(false);
    }
  };

  const restoreBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setStatus("正在校验备份文件…");
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      if (!isBackupBundle(parsed)) throw new Error("不是有效的 Atherloom v2 备份文件；旧版 v1 备份不能直接覆盖当前数据");
      const restoreParts = selected.filter((part) => parsed.parts.includes(part));
      if (!restoreParts.length) throw new Error("当前勾选的数据不在这个备份文件中");
      const labels = choices.filter((item) => restoreParts.includes(item.value)).map((item) => item.label).join("、");
      if (!window.confirm(`将用备份替换当前的“${labels}”。恢复前会自动创建当前数据快照，确定继续吗？`)) {
        setStatus("已取消恢复，没有修改数据");
        return;
      }
      setStatus("正在创建恢复前快照并写入数据…");
      const result = await onRestore(parsed, restoreParts);
      restoreClientData(parsed.client_data, restoreParts);
      setStatus(`恢复完成；恢复前快照：${result.snapshot}。凭据未恢复，请重新填写线路 Key。正在重新载入…`);
      window.setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      setStatus(error instanceof Error ? `恢复失败：${error.message}` : "恢复失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section settings-feature">
      <div className="section-heading"><h3>备份与恢复</h3><p>服务器模式备份 FastAPI SQLite；本机模式备份当前设备数据。APK 使用 Android 系统文件保存与选择器。</p></div>
      <div className="backup-choices">
        {choices.map((item) => (
          <label className="backup-choice" key={item.value}>
            <input type="checkbox" checked={selected.includes(item.value)} disabled={busy} onChange={() => toggle(item.value)} />
            <span><strong>{item.label}</strong><small>{item.detail}</small></span>
          </label>
        ))}
      </div>
      <div className="settings-edit-card backup-action-card">
        <div><strong>导出脱敏备份</strong><p>不会导出 API Key、搜索 Key、自定义鉴权头、MCP Token 或环境变量。</p></div>
        <button className="primary-button" type="button" disabled={busy || !selected.length} onClick={() => void exportBackup()}>导出备份</button>
      </div>
      <div className="settings-edit-card backup-action-card">
        <div><strong>从备份选择性恢复</strong><p>只替换上方勾选且文件中存在的分类；恢复前会先保留当前数据快照。</p></div>
        <button className="secondary-button" type="button" disabled={busy || !selected.length} onClick={() => fileRef.current?.click()}>选择文件</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(event) => void restoreBackup(event)} />
      </div>
      <p className="form-status backup-status" aria-live="polite">{status}</p>
    </section>
  );
}
