"use client";

/* ── workflow-run-store.ts · 工作流库「就地运行」的跨窗口运行态 ──────────
 *
 * 为什么需要它
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

import {
  readStorageItem,
  removeStorageItem,
  writeStorageJson,
} from "../browser-storage";
import type { TaskLogEntry } from "../workshop/generation-client";
import { tailWindow } from "~/lib/page-window";

/** 这次运行**从哪个入口发起**。
 *
 *  「画布节点」页签的「▶ 用此工作流生成」与「工坊封装」页签的「执行流程测试」
 *  是同一份封装口径、同一条 ComfyUI 链路的两次运行 —— 它们此前各写各的
 *  状态与日志，于是两处各自「占用」一个执行视角：一处在跑，另一处看着像
 *  「执行不了」（ISSUE #611）。现在两者都登记进本 store，只是带自己的来源标记，
 *  日志弹窗按来源如实标注。 */
export type WorkflowRunSource = "canvas-node" | "encapsulation-test";

/** 运行来源的展示名（日志弹窗头部按它标注这次运行是从哪儿发起的）。 */
export function runLogSourceLabel(source?: WorkflowRunSource): string {
  if (source === "encapsulation-test") return "工坊封装 · 流程测试";
  return "画布节点 · 就地运行";
}

export interface WorkflowRunMeta {
  taskId: string;
  workflowId: string;
  workflowName: string;
  taskType: string;
  startedAt: number;
  /** 发起入口（缺省按 `canvas-node` 处理，兼容早期落库的记录）。 */
  source?: WorkflowRunSource;
  /** 终态（done / failed）时由订阅者 patch；running/缺省 = 仍在跑。 */
  status?: "running" | "done" | "failed";
  /** 最近一次进度百分比（0–100）。
   *
   *  它必须落在这里而不是只留在组件的 `useState` 里：两个页签切走即卸载
   *  （`ui/tabs` 的 Panel），进度是「切回来时这次运行还在不在跑」最直接的
   *  证据 —— 只有它进了登记表，恢复出来的界面才不会从 0% 重新开始。 */
  progress?: number;
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
  /* 配额满 / 隐私模式：降级为仅会话内持久（写失败已静默）——
   * 「能不能用 storage」与「写失败怎么办」收在 `~/lib/browser-storage`
   *（§16.2.4.28）。 */
  const arr = Array.from(runs.values()).map((meta) => ({
    ...meta,
    logs: meta.logs ? tailWindow(meta.logs, MAX_LOGS) : undefined,
  }));
  writeStorageJson(STORAGE_KEY, arr);
}

function hydrate(): void {
  const raw = readStorageItem(STORAGE_KEY);
  if (raw === null) return;
  try {
    const parsed: unknown = JSON.parse(raw);
    /* 坏数据静默丢弃、**不回落默认值** —— 本 store 的「默认值」是空表，
     * 回不回落在结果上一样（§16.2.4.28 的口径：回落与丢弃等价时就别装两套）。 */
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

/** patch 已登记运行的状态 / 进度 / 结果 / 错误。 */
export function patchWorkflowRun(
  taskId: string,
  patch: Partial<
    Pick<WorkflowRunMeta, "status" | "resultUrl" | "errorMessage" | "progress">
  >,
): void {
  const prev = runs.get(taskId);
  if (!prev) return;
  touch({ ...prev, ...patch });
}

/** 收口一次「失败」运行：状态 + 错误原因（横幅）+ 一条 error 日志行。
 *
 *  Why 日志行和横幅要一起写：横幅只在弹窗顶部显示，用户按级别筛选
 *  （如只看「错误」）或在时间线里对照步骤时看不到它。把失败原因同时作为
 *  一条 error 日志落进 logs，它就跟其它步骤日志一样参与筛选 / 计数 / 回放，
 *  第二张图里「应用日志有原因、工作流日志没有」的割裂也就不再出现。
 *
 *  去重：同一 (原因, 级别) 已经作为最后一条日志存在时不再重复追加，
 *  避免「服务端已写过 ✗ 生成失败」+「客户端再补一条」出现两行一模一样的。 */
export function failWorkflowRun(taskId: string, message: string): void {
  const prev = runs.get(taskId);
  if (!prev) return;
  const reason = message || "生成失败";
  const logs = prev.logs ?? [];
  const last = logs[logs.length - 1];
  const duplicatedAsLogLine =
    last?.level === "error" &&
    typeof last.msg === "string" &&
    (last.msg === reason || last.msg.includes(reason));
  const nextLogs = duplicatedAsLogLine
    ? logs
    : tailWindow(
        [
          ...logs,
          {
            t: Date.now(),
            level: "error" as const,
            msg: `✗ 生成失败：${reason}`,
          },
        ],
        MAX_LOGS,
      );
  touch({ ...prev, status: "failed", errorMessage: reason, logs: nextLogs });
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
      if (!latestActive || meta.startedAt > latestActive.startedAt)
        latestActive = meta;
    }
  }
  return latestActive ?? latest;
}

/** 查找某个工作流最近的一次运行（重开窗口恢复视角用）。
 *  传入 source 时只看该来源的运行（画布节点 / 工坊封装各自独立恢复）。 */
export function latestRunForWorkflow(
  workflowId: string,
  source?: WorkflowRunSource,
): WorkflowRunMeta | null {
  let found: WorkflowRunMeta | null = null;
  for (const meta of runs.values()) {
    if (meta.workflowId !== workflowId) continue;
    if (source && meta.source !== source) continue;
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
  const next = tailWindow([...logs, entry], MAX_LOGS);
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
  removeStorageItem(STORAGE_KEY);
  version += 1;
  for (const l of listeners) l();
}
