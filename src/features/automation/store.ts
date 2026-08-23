export type WakeTaskMode = "once" | "interval";
export type WakeTaskStatus = "scheduled" | "running" | "paused" | "completed" | "error";
export type WakeTaskCreator = "user" | "ai";
export type WakeTaskApproval = "pending" | "approved";

export interface WakeTask {
  id: string;
  persona_key: string;
  name: string;
  prompt: string;
  provider_id: string;
  mode: WakeTaskMode;
  interval_minutes: number;
  max_runs: number;
  run_count: number;
  next_run_at: string;
  enabled: boolean;
  status: WakeTaskStatus;
  created_by: WakeTaskCreator;
  approval: WakeTaskApproval;
  created_at: string;
  updated_at: string;
  last_run_at?: string;
  last_result?: string;
  last_error?: string;
  attempts: number;
  lease_owner?: string;
  lease_until?: string;
  source_conversation_id?: string;
  source_user_message_id?: string;
  source_tool_call_id?: string;
}

export interface WakeTaskDraft {
  persona_key: string;
  name: string;
  prompt: string;
  provider_id: string;
  mode: WakeTaskMode;
  interval_minutes: number;
  max_runs: number;
  next_run_at: string;
  enabled: boolean;
}

interface AutomationStore {
  version: 1;
  wake_tasks: WakeTask[];
}

export const automationStoreKey = "atherloom-react:automation:v1";
const maxTasksPerPersona = 20;

function now() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, fallback: number) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function boundedText(value: unknown, limit: number) {
  return String(value || "").trim().slice(0, limit);
}

function validTimestamp(value: unknown, fallback: string) {
  const parsed = new Date(String(value || ""));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback;
}

function normalizeWakeTask(value: unknown, index: number): WakeTask | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const personaKey = boundedText(raw.persona_key, 160) || "__default__";
  const name = boundedText(raw.name, 80);
  const prompt = boundedText(raw.prompt, 4_000);
  if (!name || !prompt) return null;
  const mode: WakeTaskMode = raw.mode === "interval" ? "interval" : "once";
  const runCount = boundedInteger(raw.run_count, 0, 24, 0);
  const maxRuns = boundedInteger(raw.max_runs, Math.max(1, runCount), 24, Math.max(1, runCount));
  const createdBy: WakeTaskCreator = raw.created_by === "ai" ? "ai" : "user";
  const approval: WakeTaskApproval = createdBy === "ai" && raw.approval !== "approved" ? "pending" : "approved";
  const enabled = raw.enabled === true && approval === "approved" && runCount < maxRuns;
  let status: WakeTaskStatus = ["scheduled", "running", "paused", "completed", "error"].includes(String(raw.status))
    ? raw.status as WakeTaskStatus
    : enabled ? "scheduled" : "paused";
  const leaseUntil = validTimestamp(raw.lease_until, "");
  if (status === "running" && (!leaseUntil || Date.parse(leaseUntil) <= Date.now())) status = enabled ? "scheduled" : "paused";
  if (runCount >= maxRuns) status = "completed";
  return {
    id: boundedText(raw.id, 240) || `wake-${Date.now()}-${index}`,
    persona_key: personaKey,
    name,
    prompt,
    provider_id: boundedText(raw.provider_id, 240),
    mode,
    interval_minutes: mode === "once" ? 0 : boundedInteger(raw.interval_minutes, 5, 43_200, 60),
    max_runs: maxRuns,
    run_count: runCount,
    next_run_at: validTimestamp(raw.next_run_at, now()),
    enabled,
    status,
    created_by: createdBy,
    approval,
    created_at: validTimestamp(raw.created_at, now()),
    updated_at: validTimestamp(raw.updated_at, now()),
    last_run_at: raw.last_run_at ? validTimestamp(raw.last_run_at, "") || undefined : undefined,
    last_result: boundedText(raw.last_result, 2_000) || undefined,
    last_error: boundedText(raw.last_error, 500) || undefined,
    attempts: boundedInteger(raw.attempts, 0, 3, 0),
    lease_owner: boundedText(raw.lease_owner, 240) || undefined,
    lease_until: leaseUntil || undefined,
    source_conversation_id: boundedText(raw.source_conversation_id, 240) || undefined,
    source_user_message_id: boundedText(raw.source_user_message_id, 240) || undefined,
    source_tool_call_id: boundedText(raw.source_tool_call_id, 240) || undefined,
  };
}

export function readAutomationStore(): AutomationStore {
  try {
    const parsed = JSON.parse(localStorage.getItem(automationStoreKey) || "null") as Record<string, unknown> | null;
    const rows = parsed && Array.isArray(parsed.wake_tasks) ? parsed.wake_tasks : [];
    return { version: 1, wake_tasks: rows.map(normalizeWakeTask).filter((item): item is WakeTask => Boolean(item)).slice(0, 300) };
  } catch {
    return { version: 1, wake_tasks: [] };
  }
}

function writeAutomationStore(store: AutomationStore) {
  localStorage.setItem(automationStoreKey, JSON.stringify(store));
  window.dispatchEvent(new CustomEvent("atherloom:automation-changed"));
}

export function listWakeTasks(personaKey?: string) {
  const rows = readAutomationStore().wake_tasks;
  return (personaKey ? rows.filter((task) => task.persona_key === personaKey) : rows)
    .sort((left, right) => left.next_run_at.localeCompare(right.next_run_at));
}

export function saveWakeTask(
  draft: WakeTaskDraft,
  taskId?: string,
  createdBy: WakeTaskCreator = "user",
  source: Pick<WakeTask, "source_conversation_id" | "source_user_message_id" | "source_tool_call_id"> = {},
) {
  const store = readAutomationStore();
  const existing = taskId ? store.wake_tasks.find((task) => task.id === taskId) : undefined;
  const personaKey = boundedText(draft.persona_key, 160) || "__default__";
  if (!existing && store.wake_tasks.filter((task) => task.persona_key === personaKey).length >= maxTasksPerPersona) {
    throw new Error(`每个人格最多保留 ${maxTasksPerPersona} 个自动唤醒任务`);
  }
  const name = boundedText(draft.name, 80);
  const prompt = boundedText(draft.prompt, 4_000);
  if (!name || !prompt) throw new Error("任务名称和唤醒内容不能为空");
  const mode: WakeTaskMode = draft.mode === "interval" ? "interval" : "once";
  const runCount = existing?.run_count || 0;
  const maxRuns = mode === "once" ? Math.max(1, runCount + (runCount ? 1 : 0)) : boundedInteger(draft.max_runs, Math.max(1, runCount + 1), 24, Math.max(1, runCount + 1));
  const stamp = now();
  const creator = existing?.created_by || createdBy;
  const approval: WakeTaskApproval = creator === "ai" && existing?.approval !== "approved" && !draft.enabled
    ? "pending"
    : "approved";
  const enabled = Boolean(draft.enabled) && approval === "approved" && runCount < maxRuns;
  const task: WakeTask = {
    id: existing?.id || makeId("wake"),
    persona_key: personaKey,
    name,
    prompt,
    provider_id: boundedText(draft.provider_id, 240),
    mode,
    interval_minutes: mode === "once" ? 0 : boundedInteger(draft.interval_minutes, 5, 43_200, 60),
    max_runs: maxRuns,
    run_count: runCount,
    next_run_at: validTimestamp(draft.next_run_at, stamp),
    enabled,
    status: enabled ? "scheduled" : runCount >= maxRuns ? "completed" : "paused",
    created_by: creator,
    approval,
    created_at: existing?.created_at || stamp,
    updated_at: stamp,
    last_run_at: existing?.last_run_at,
    last_result: existing?.last_result,
    attempts: 0,
    source_conversation_id: existing?.source_conversation_id || boundedText(source.source_conversation_id, 240) || undefined,
    source_user_message_id: existing?.source_user_message_id || boundedText(source.source_user_message_id, 240) || undefined,
    source_tool_call_id: existing?.source_tool_call_id || boundedText(source.source_tool_call_id, 240) || undefined,
  };
  store.wake_tasks = [task, ...store.wake_tasks.filter((item) => item.id !== task.id)];
  writeAutomationStore(store);
  return task;
}

export function createAiWakeTask(input: {
  persona_key: string;
  provider_id: string;
  name: string;
  prompt: string;
  first_delay_minutes: number;
  interval_minutes: number;
  max_runs: number;
  source_conversation_id?: string;
  source_user_message_id?: string;
  source_tool_call_id?: string;
}, approved: boolean) {
  const currentTasks = readAutomationStore().wake_tasks;
  const prior = input.source_user_message_id ? currentTasks.find((task) => task.persona_key === input.persona_key
    && task.created_by === "ai"
    && task.source_user_message_id === input.source_user_message_id
    && (task.source_tool_call_id === input.source_tool_call_id || (task.name === boundedText(input.name, 80) && task.prompt === boundedText(input.prompt, 4_000)))) : undefined;
  if (prior) return { ...prior, reused: true as const };
  const existingAiTasks = currentTasks.filter((task) => task.persona_key === input.persona_key
    && task.created_by === "ai" && !["completed", "error"].includes(task.status));
  if (existingAiTasks.length >= 5) throw new Error("当前人格最多保留 5 个未结束的 AI 唤醒任务，请先让用户整理任务台");
  const delay = boundedInteger(input.first_delay_minutes, 5, 10_080, 30);
  const interval = boundedInteger(input.interval_minutes, 0, 43_200, 0);
  const mode: WakeTaskMode = interval >= 5 ? "interval" : "once";
  const task = saveWakeTask({
    persona_key: input.persona_key,
    provider_id: input.provider_id,
    name: input.name,
    prompt: input.prompt,
    mode,
    interval_minutes: mode === "interval" ? interval : 0,
    max_runs: mode === "interval" ? boundedInteger(input.max_runs, 1, 24, 1) : 1,
    next_run_at: new Date(Date.now() + delay * 60_000).toISOString(),
    enabled: approved,
  }, undefined, "ai", {
    source_conversation_id: input.source_conversation_id,
    source_user_message_id: input.source_user_message_id,
    source_tool_call_id: input.source_tool_call_id,
  });
  return { ...task, reused: false as const };
}

export function deleteWakeTask(taskId: string) {
  const store = readAutomationStore();
  const next = store.wake_tasks.filter((task) => task.id !== taskId);
  if (next.length === store.wake_tasks.length) throw new Error("自动唤醒任务不存在");
  store.wake_tasks = next;
  writeAutomationStore(store);
}

export function setWakeTaskEnabled(taskId: string, enabled: boolean) {
  const store = readAutomationStore();
  const task = store.wake_tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("自动唤醒任务不存在");
  if (enabled && task.run_count >= task.max_runs) task.max_runs = Math.min(24, task.run_count + 1);
  if (enabled) task.approval = "approved";
  task.enabled = enabled;
  task.status = enabled ? "scheduled" : "paused";
  task.updated_at = now();
  delete task.lease_owner;
  delete task.lease_until;
  writeAutomationStore(store);
  return task;
}

export function runWakeTaskNow(taskId: string) {
  const store = readAutomationStore();
  const task = store.wake_tasks.find((item) => item.id === taskId);
  if (!task) throw new Error("自动唤醒任务不存在");
  if (task.run_count >= task.max_runs) task.max_runs = Math.min(24, task.run_count + 1);
  task.approval = "approved";
  task.enabled = true;
  task.status = "scheduled";
  task.next_run_at = now();
  task.updated_at = now();
  task.attempts = 0;
  delete task.last_error;
  delete task.lease_owner;
  delete task.lease_until;
  writeAutomationStore(store);
  return task;
}

export function dueWakeTaskIds(currentTime = Date.now()) {
  return readAutomationStore().wake_tasks
    .filter((task) => task.approval === "approved" && task.enabled && task.status === "scheduled" && task.run_count < task.max_runs && Date.parse(task.next_run_at) <= currentTime)
    .sort((left, right) => left.next_run_at.localeCompare(right.next_run_at))
    .slice(0, 3)
    .map((task) => task.id);
}

export function claimWakeTask(taskId: string) {
  const store = readAutomationStore();
  const task = store.wake_tasks.find((item) => item.id === taskId);
  if (!task || task.approval !== "approved" || !task.enabled || task.status !== "scheduled" || task.run_count >= task.max_runs || Date.parse(task.next_run_at) > Date.now()) return null;
  const leaseOwner = makeId("wake-lease");
  task.status = "running";
  task.lease_owner = leaseOwner;
  task.lease_until = new Date(Date.now() + 180_000).toISOString();
  task.updated_at = now();
  writeAutomationStore(store);
  return { ...task, lease_owner: leaseOwner };
}

export function finishWakeTask(taskId: string, leaseOwner: string, result: string) {
  const store = readAutomationStore();
  const task = store.wake_tasks.find((item) => item.id === taskId && item.lease_owner === leaseOwner && item.status === "running");
  if (!task) return null;
  const completedAt = now();
  task.run_count += 1;
  task.last_run_at = completedAt;
  task.last_result = boundedText(result, 2_000);
  task.last_error = undefined;
  task.attempts = 0;
  task.updated_at = completedAt;
  delete task.lease_owner;
  delete task.lease_until;
  if (task.mode === "once" || task.run_count >= task.max_runs) {
    task.enabled = false;
    task.status = "completed";
  } else {
    task.status = "scheduled";
    task.next_run_at = new Date(Date.now() + task.interval_minutes * 60_000).toISOString();
  }
  writeAutomationStore(store);
  return task;
}

export function failWakeTask(taskId: string, leaseOwner: string, error: unknown) {
  const store = readAutomationStore();
  const task = store.wake_tasks.find((item) => item.id === taskId && item.lease_owner === leaseOwner && item.status === "running");
  if (!task) return null;
  task.attempts = Math.min(3, task.attempts + 1);
  task.last_error = boundedText(error instanceof Error ? error.message : error, 500) || "自动唤醒失败";
  task.updated_at = now();
  delete task.lease_owner;
  delete task.lease_until;
  if (task.attempts >= 3) {
    task.enabled = false;
    task.status = "error";
  } else {
    task.status = "scheduled";
    task.next_run_at = new Date(Date.now() + Math.max(2, task.attempts * 2) * 60_000).toISOString();
  }
  writeAutomationStore(store);
  return task;
}
