"use client";

/* ── workflow-run-store.ts · 工作流库「就地运行」的跨窗口运行态 ──────────
 *
 * Why this exists
 * ────────────────
 * 就地运行的进度/日志此前存在组件 useState 里，窗口关闭（或切页签导致组件
 * 卸载）即丢失；重新打开后用户看不到「正在生成」这个事实，日志也清零。
 *
 * 服务端任务本身持久在 SQLite（Task.logs / status / progress），SSE 重连
 * 会全量回放 —— 所以客户端只需两层：
 *   1. 模块级 Map：会话内的运行登记（切页签 / 关弹窗不丢）；
 *   2. localStorage 写穿：整个应用窗口关掉再打开后仍能恢复「生成中」视角，
 *      缺失的历史日志由 SSE 回放（服务端 Task.logs）补齐，(t, msg) 去重。
 *
 * 参照 project-canvas/stepLogCache.ts 的同款取舍，真值永远以服务端为准。
 */

import type { TaskLogEntry } from "./workshop/generation-client";

export interface WorkflowRunMeta {
  taskId: string;
  workflowId: string;
  workflowName: string;
  taskType: string;
  startedAt: number;
  /** 终态（done / failed）时由订阅者 patch；running/缺省 = 仍在跑。 */
  status?: "running" | "done" | "failed";
  resultUrl?: string;
  errorMessage?: string;
  /** 累积的执行步骤日志（重开窗口后由 SSE 回放继续补齐）。 */
  logs?: TaskLogEntry[];
}

const MAX_ENTRIES = 32;
const MAX_LOGS = 300;
const STORAGE_KEY = "wflib:runs:v1";

const runs = new Map<string, WorkflowRunMeta>();
const listeners = new Set<() => void>();
let version = 0;

/* ── localStorage 写穿（SSR 安全：仅浏览器端执行）──────────────────────── */

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    const arr = Array.from(runs.values()).map((meta) => ({
      ...meta,
      logs: meta.logs?.slice(-MAX_LOGS),
    }));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  } catch {
    /* 配额满 / 隐私模式：降级为仅会话内持久 */
  }
}

function hydrate(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    for (const item of parsed) {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as WorkflowRunMeta).taskId === "string" &&
        typeof (item as WorkflowRunMeta).workflowId === "string"
      ) {
        const meta = item as WorkflowRunMeta;
        runs.set(meta.taskId, meta);
      }
    }
  } catch {
    /* 损坏的存储内容：忽略 */
  }
}
hydrate();

function notify() {
  version += 1;
  persist();
  for (const l of listeners) l();
}

function touch(meta: WorkflowRunMeta) {
  runs.set(meta.taskId, meta);
  if (runs.size > MAX_ENTRIES) {
    /* 淘汰最旧的一条（先落盘再删，防丢终态）。 */
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [key, meta] of runs) {
      if (meta.startedAt < oldestAt) {
        oldestAt = meta.startedAt;
        oldestKey = key;
      }
    }
    if (oldestKey !== null && oldestKey !== meta.taskId) runs.delete(oldestKey);
  }
  notify();
}

/** 登记一次新的就地运行（run() 成功拿到 taskId 时调用）。 */
export function registerWorkflowRun(meta: WorkflowRunMeta): void {
  touch(meta);
}

/** patch 已登记运行的状态 / 结果 / 错误。 */
export function patchWorkflowRun(
  taskId: string,
  patch: Partial<Pick<WorkflowRunMeta, "status" | "resultUrl" | "errorMessage">>,
): void {
  const prev = runs.get(taskId);
  if (!prev) return;
  touch({ ...prev, ...patch });
}

/** 按 taskId 查运行元信息。 */
export function getWorkflowRun(taskId: string): WorkflowRunMeta | null {
  return runs.get(taskId) ?? null;
}

/** 最近一次仍在运行的运行（重开窗口恢复「生成中」视角用），无则取最近一条。 */
export function latestActiveWorkflowRun(): WorkflowRunMeta | null {
  let latest: WorkflowRunMeta | null = null;
  let latestActive: WorkflowRunMeta | null = null;
  for (const meta of runs.values()) {
    if (!latest || meta.startedAt > latest.startedAt) latest = meta;
    if (meta.status === "running" || !meta.status) {
      if (!latestActive || meta.startedAt > latestActive.startedAt) latestActive = meta;
    }
  }
  return latestActive ?? latest;
}

/** 查找某个工作流最近的一次运行（重开窗口恢复视角用）。 */
export function latestRunForWorkflow(workflowId: string): WorkflowRunMeta | null {
  let found: WorkflowRunMeta | null = null;
  for (const meta of runs.values()) {
    if (meta.workflowId !== workflowId) continue;
    if (!found || meta.startedAt > found.startedAt) found = meta;
  }
  return found;
}

/** 全部已登记运行（新→旧）。 */
export function listWorkflowRuns(): WorkflowRunMeta[] {
  return Array.from(runs.values()).sort((a, b) => b.startedAt - a.startedAt);
}

/* ── 日志累积（store 托管，组件卸载不丢）──────────────────────────────── */

/** 记录一条运行日志并返回累积后的数组（无该 taskId 登记时返回 null）。 */
export function appendWorkflowRunLog(
  taskId: string,
  entry: TaskLogEntry,
): TaskLogEntry[] | null {
  const prev = runs.get(taskId);
  if (!prev) return null;
  const logs = prev.logs ?? [];
  // 与 GlobalStepLogPanel 的 SSE 去重同款：(t, msg) 重复帧丢弃。
  if (logs.some((log) => log.t === entry.t && log.msg === entry.msg)) {
    return logs;
  }
  const next = [...logs, entry].slice(-MAX_LOGS);
  touch({ ...prev, logs: next });
  return next;
}

/* ── useSyncExternalStore 接线 ─────────────────────────────────────────── */

export interface WorkflowRunStoreSnapshot {
  version: number;
  runs: WorkflowRunMeta[];
  /** 最近一次仍在运行（或最近一次）的 taskId，null 表示从未运行。 */
  activeTaskId: string | null;
}

let cachedSnapshot: WorkflowRunStoreSnapshot | null = null;

function getSnapshot(): WorkflowRunStoreSnapshot {
  const active = latestActiveWorkflowRun();
  return {
    version,
    runs: listWorkflowRuns(),
    activeTaskId: active?.taskId ?? null,
  };
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** useSyncExternalStore 快照：version 变化才换新对象，保证引用稳定。 */
export function getWorkflowRunStoreSnapshot(): WorkflowRunStoreSnapshot {
  if (cachedSnapshot?.version !== version) {
    cachedSnapshot = getSnapshot();
  }
  return cachedSnapshot;
}

export { subscribe as subscribeWorkflowRunStore };

/** 测试辅助：清空全部登记（含 localStorage）。 */
export function clearAllWorkflowRuns(): void {
  runs.clear();
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  version += 1;
  for (const l of listeners) l();
}
