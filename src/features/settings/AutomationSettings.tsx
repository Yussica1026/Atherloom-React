import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { isStandaloneAndroid } from "../../adapters/standalone/store";
import type { Persona, Provider } from "../../domain/types";
import {
  automationStoreKey,
  deleteWakeTask,
  listWakeTasks,
  runWakeTaskNow,
  saveWakeTask,
  setWakeTaskEnabled,
  type WakeTask,
  type WakeTaskMode,
} from "../automation/store";

interface AutomationSettingsProps {
  personaKey: string;
  personas: Persona[];
  providers: Provider[];
  connected: boolean;
}

interface WakeTaskFormState {
  name: string;
  prompt: string;
  provider_id: string;
  mode: WakeTaskMode;
  interval_minutes: number;
  max_runs: number;
  next_run_at: string;
  enabled: boolean;
}

const statusLabels: Record<WakeTask["status"], string> = {
  scheduled: "等待唤醒",
  running: "正在执行",
  paused: "已暂停",
  completed: "已完成",
  error: "执行失败",
};

function toLocalDateTime(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function emptyForm(providerId = ""): WakeTaskFormState {
  return {
    name: "",
    prompt: "",
    provider_id: providerId,
    mode: "once",
    interval_minutes: 60,
    max_runs: 1,
    next_run_at: toLocalDateTime(new Date(Date.now() + 30 * 60_000)),
    enabled: true,
  };
}

function taskForm(task: WakeTask): WakeTaskFormState {
  return {
    name: task.name,
    prompt: task.prompt,
    provider_id: task.provider_id,
    mode: task.mode,
    interval_minutes: task.mode === "interval" ? task.interval_minutes : 60,
    max_runs: task.max_runs,
    next_run_at: toLocalDateTime(task.next_run_at),
    enabled: task.approval === "approved" && task.enabled,
  };
}

function formatTime(value?: string) {
  if (!value) return "尚未执行";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("zh-CN", { hour12: false })
    : value;
}

export function AutomationSettings({ personaKey, personas, providers, connected }: AutomationSettingsProps) {
  const standalone = isStandaloneAndroid();
  const persona = personas.find((item) => item.id === personaKey);
  const defaultProviderId = String(persona?.provider_id || persona?.config?.provider_id || providers.find((provider) => provider.enabled !== false)?.id || "");
  const [tasks, setTasks] = useState<WakeTask[]>(() => listWakeTasks(personaKey));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<WakeTaskFormState>(() => emptyForm(defaultProviderId));
  const [status, setStatus] = useState("");

  const reload = useCallback(() => setTasks(listWakeTasks(personaKey)), [personaKey]);

  useEffect(() => {
    setEditingId(null);
    setForm(emptyForm(defaultProviderId));
    setStatus("");
    reload();
  }, [defaultProviderId, personaKey, reload]);

  useEffect(() => {
    const handleChange = () => reload();
    const handleStorage = (event: StorageEvent) => {
      if (!event.key || event.key === automationStoreKey) reload();
    };
    window.addEventListener("atherloom:automation-changed", handleChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("atherloom:automation-changed", handleChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, [reload]);

  const editingTask = useMemo(() => tasks.find((task) => task.id === editingId), [editingId, tasks]);
  const personaName = persona?.name || (personaKey === "__default__" ? "默认人格" : "当前人格");

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm(defaultProviderId));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(editingId ? "正在保存任务修改…" : "正在添加唤醒任务…");
    try {
      const scheduledAt = new Date(form.next_run_at);
      if (!Number.isFinite(scheduledAt.getTime())) throw new Error("请选择有效的首次唤醒时间");
      saveWakeTask({
        persona_key: personaKey,
        name: form.name,
        prompt: form.prompt,
        provider_id: form.provider_id,
        mode: form.mode,
        interval_minutes: form.mode === "interval" ? form.interval_minutes : 0,
        max_runs: form.mode === "interval" ? form.max_runs : 1,
        next_run_at: scheduledAt.toISOString(),
        enabled: editingTask?.approval === "pending" ? false : form.enabled,
      }, editingId || undefined);
      resetForm();
      reload();
      setStatus(standalone
        ? "任务已保存；应用在前台打开时会按计划唤醒"
        : "任务已保存到本机；当前运行方式不会执行它");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "唤醒任务保存失败");
    }
  };

  const openTask = (task: WakeTask) => {
    setEditingId(task.id);
    setForm(taskForm(task));
    setStatus(task.approval === "pending" ? "正在查看 AI 提案；保存修改不会自动批准" : "正在修改任务");
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>(".automation-task-editor")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const toggleTask = (task: WakeTask, enabled: boolean) => {
    try {
      setWakeTaskEnabled(task.id, enabled);
      reload();
      setStatus(enabled
        ? standalone ? "任务已启用" : "任务已启用并保存在本机；当前运行方式不会执行它"
        : "任务已暂停");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "任务状态修改失败");
    }
  };

  const approveTask = (task: WakeTask) => {
    try {
      setWakeTaskEnabled(task.id, true);
      reload();
      setStatus(standalone
        ? `已批准 AI 提案“${task.name}”，没有扩大它的提示词或次数`
        : `已批准并保存“${task.name}”；当前运行方式不会执行它`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "AI 提案批准失败");
    }
  };

  const runNow = (task: WakeTask) => {
    if (!standalone || task.approval !== "approved") return;
    try {
      runWakeTaskNow(task.id);
      reload();
    setStatus(`“${task.name}”已交给本机调度，会在应用前台打开时尽快执行`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "立即运行失败");
    }
  };

  const removeTask = (task: WakeTask) => {
    if (!window.confirm(`删除唤醒任务“${task.name}”？此操作不会删除已经写入的留言。`)) return;
    try {
      deleteWakeTask(task.id);
      if (editingId === task.id) resetForm();
      reload();
      setStatus("唤醒任务已删除");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "唤醒任务删除失败");
    }
  };

  return (
    <section className="settings-section settings-feature automation-settings">
      <div className="section-heading">
        <span className="settings-eyebrow">WAKE LEDGER</span>
        <h3>自动唤醒</h3>
        <p>任务只属于“{personaName}”。用户可以修改任务；AI 只能新增待批准提案，不能替你改动或删除已有任务。</p>
      </div>

      <div className={`settings-edit-card automation-runtime-note ${standalone ? "local" : connected ? "connected" : "preview"}`} role="note">
        <strong>{standalone ? "Android 本机调度" : connected ? "FastAPI 连接模式" : "浏览器预览模式"}</strong>
        <p>{standalone
          ? "仅在应用前台打开时运行。退到后台或完全关闭后不会常驻；错过的任务会在下次打开应用时补做。"
          : connected
            ? "任务仍只保存到这台设备，旧 FastAPI 不会执行；“立即运行”已禁用。切回 Android 本机模式后，已启用任务才会进入调度。"
            : "这里可以整理本机任务，但浏览器预览没有 Android 本机调度，“立即运行”已禁用。"}</p>
      </div>

      <form className="settings-form settings-edit-card automation-task-editor" onSubmit={submit}>
        {editingTask ? <div className="edit-state span-all">正在修改：{editingTask.name}{editingTask.approval === "pending" ? " · AI 待批准提案" : ""}</div> : null}
        <label>任务名称<input required maxLength={80} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如：晚间问候" /></label>
        <label>模型线路<select value={form.provider_id} onChange={(event) => setForm((current) => ({ ...current, provider_id: event.target.value }))}><option value="">使用当前人格默认线路</option>{providers.map((provider) => <option value={provider.id} key={provider.id}>{provider.name}{provider.enabled === false ? " · 已停用" : ""}</option>)}</select></label>
        <label className="span-all">唤醒时交给 AI 的提示词<textarea required rows={4} maxLength={4000} value={form.prompt} onChange={(event) => setForm((current) => ({ ...current, prompt: event.target.value }))} placeholder="写清楚这次唤醒时要说什么或做什么；不会自动获得额外工具权限。" /></label>
        <label>首次时间<input required type="datetime-local" value={form.next_run_at} onChange={(event) => setForm((current) => ({ ...current, next_run_at: event.target.value }))} /></label>
        <label>执行方式<select value={form.mode} onChange={(event) => { const mode = event.target.value as WakeTaskMode; setForm((current) => ({ ...current, mode, max_runs: mode === "once" ? 1 : Math.max(2, current.max_runs) })); }}><option value="once">只执行一次</option><option value="interval">按间隔重复</option></select></label>
        <label>间隔分钟<input type="number" min="5" max="43200" step="1" required={form.mode === "interval"} disabled={form.mode !== "interval"} value={form.interval_minutes} onChange={(event) => setForm((current) => ({ ...current, interval_minutes: Number(event.target.value) }))} /></label>
        <label>总执行次数<input type="number" min={Math.max(1, (editingTask?.run_count || 0) + (editingTask?.run_count ? 1 : 0))} max="24" step="1" disabled={form.mode !== "interval"} value={form.mode === "once" ? 1 : form.max_runs} onChange={(event) => setForm((current) => ({ ...current, max_runs: Number(event.target.value) }))} /></label>
        <label className="check-row span-all"><input type="checkbox" checked={form.enabled} disabled={editingTask?.approval === "pending"} onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))} /><span>保存后启用任务<small>{editingTask?.approval === "pending" ? "AI 提案必须从下方任务卡片精确批准。" : standalone ? "到点后由本机调度执行。" : "当前只保存配置，切换到 Android 本机模式后才执行。"}</small></span></label>
        <div className="form-actions span-all">{editingId ? <button className="secondary-button" type="button" onClick={resetForm}>取消修改</button> : null}<button className="primary-button">{editingId ? "保存修改" : "添加任务"}</button></div>
      </form>

      <div className="automation-task-ledger settings-card-list" aria-label={`${personaName}的唤醒任务`}>
        {tasks.map((task) => (
          <article className={`settings-list-card automation-task-card state-${task.status}${task.approval === "pending" ? " pending-approval" : ""}`} key={task.id}>
            <div className="settings-list-copy">
              <strong>{task.name}</strong>
              <small>{task.created_by === "ai" ? task.approval === "pending" ? "AI 提案 · 待你批准" : "AI 创建 · 已批准" : "用户创建"} · {statusLabels[task.status]} · {task.mode === "interval" ? `每 ${task.interval_minutes} 分钟` : "单次"}</small>
              <p className="automation-task-prompt">{task.prompt}</p>
              <p className="automation-task-meta">下次：{formatTime(task.next_run_at)} · 已执行 {task.run_count}/{task.max_runs} · 上次：{formatTime(task.last_run_at)}</p>
              {task.last_result ? <p className="automation-task-result">上次结果：{task.last_result}</p> : null}
              {task.last_error ? <p className="automation-task-error">错误：{task.last_error}</p> : null}
            </div>
            <div className="card-actions">
              {task.approval === "pending" ? <button className="primary-button" type="button" onClick={() => approveTask(task)}>批准并启用</button> : task.enabled ? <button type="button" onClick={() => toggleTask(task, false)}>暂停</button> : <button type="button" onClick={() => toggleTask(task, true)}>启用</button>}
              <button type="button" disabled={!standalone || task.approval !== "approved" || task.status === "running"} title={!standalone ? "只有 Android 本机模式可以立即运行" : task.approval !== "approved" ? "请先批准这条 AI 提案" : undefined} onClick={() => runNow(task)}>立即运行</button>
              <button type="button" onClick={() => openTask(task)}>编辑</button>
              <button className="danger-action" type="button" onClick={() => removeTask(task)}>删除</button>
            </div>
          </article>
        ))}
        {!tasks.length ? <p className="settings-empty-copy">“{personaName}”还没有自动唤醒任务。可以先添加一个单次任务，确认运行方式符合预期。</p> : null}
      </div>
      <p className="form-status" aria-live="polite">{status}</p>
    </section>
  );
}
