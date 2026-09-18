"use client";

/* ── stepLogCache.ts ──────────────────────────────
 * 跨「卸载 / 重新挂载」缓存 CanvasNode 的步骤日志面板状态。
 *
 * 为什么需要它
 * ────────────
 * 图片节点的正文用 `{selected && <ImageGenerationPanel/>}` 渲染日志面板
 *（CanvasNode.tsx:1234）。用户点走时 → React 卸载该面板 →
 * 连带拆掉 `stepLogs` 与 `validationErrors` 那两个 `useState` 槽位。
 * 点回来又挂载 → 空数组重新来过 → SSE 的 EventSource 从头重连 →
 * 用户会看到重复的「📡 已订阅…」、状态又变回「QUEUED (0%)」，
 * 20s 卡死告警的计数也重置了 —— 哪怕后端上同一个任务还在跑。
 *
 * 后端日志存在 `Task.logs`（Prisma）里、SSE 连上时会重放，
 * 所以**内容**大约一个往返就回来了 —— 但
 *（a）在途的告警计时器（20s 无活动）会丢，接下来 20s 的新静默没人管；
 *（b）界面给人一种「把这次运行的记忆丢了」的感觉；
 *（c）控制台噪音还让用户以为是重复订阅的 bug。
 *
 * 修法：把面板的临时状态放进模块级 Map，按 `taskId` 作键，
 *       于是同一次会话内的卸载 / 重挂载对用户不可见。
 *       用 `MAX_ENTRIES` 做上限（LRU），长时间开着的页签也不会漏内存。
 *
 * 范围
 * ────
 * 只做**标签页内**的持久化。跨整个浏览器刷新要 localStorage，
 * 那是 v1 有意排除的目标 —— 任务级状态属于 Prisma + SSE 重放，
 * 不属于每个标签页自己的草稿区。
 *
 * ───────────────────────────────────────────────────────────────────── */

import type { ValidationError } from "~/lib/comfyui/validation";

/* StepLogEntry 从本模块再导出，让 ImageGenerationPanel 能同时拿到类型与
 * 缓存助手，而不必造成循环导入（面板 ↔ 缓存）。
 * 形状与 runner.ts 的 LogEntry 一致（即 TaskEvent 联合里 "log" 那条的载荷），
 * 只多一个**纯界面**扩展：`client?: boolean` 标记「浏览器自己推的」条目
 *（订阅状态、卡死检测告警 …），好让它们以低饱和斜体渲染。 */
export interface StepLogEntry {
  t: number;
  level: "info" | "progress" | "warn" | "error" | "success";
  msg: string;
  client?: boolean;
  /** 调用方来源（"文件:行"），从服务端 LogEntry 镜像过来；
   *  只在调试开关打开时渲染。 */
  src?: string;
}

export interface StepLogPanelState {
  /** 该 taskId 的面板首次打开以来推入的全部日志条目。 */
  logs: StepLogEntry[];
  /** 最近一次看到的结构化失败（来自 pollTask 的 `d.validationErrors`，
   *  或 SSE 的 `state` 事件）。任务仍在跑、或从未标记失败时为 null。 */
  validationErrors: ValidationError[] | null;
  /* 任务级元数据，好让任务切换下拉框显示「工作流名 · 状态」，
   *  而不是一串被截断的 id。由 GlobalStepLogPanel 在每次 SSE `state` 事件时填充。 */
  workflowName?: string;
  status?: string;
  /** 触发该任务的画布节点 id，用于日志面板按 #1/#2… 短序号筛选。 */
  nodeId?: string;
}

const MAX_ENTRIES = 256;

const cache = new Map<string, StepLogPanelState>();

/* 触碰一次（移到插入顺序末尾）+ 限制总条数。LRU。 */
function touch(id: string, next: StepLogPanelState) {
  cache.set(id, next);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

/* 载入某个 taskId 的持久化状态；没有则为 null。 */
export function loadStepLogPanelState(
  taskId: string | null | undefined,
): StepLogPanelState | null {
  if (!taskId) return null;
  return cache.get(taskId) ?? null;
}

/* 覆盖某个 taskId 的持久化状态。测试要用；
 * 面板想主动重置时也用（例如用户选了新工作流 —— 目前没有这条路径，
 * 但把出口留着）。 */
export function saveStepLogPanelState(
  taskId: string,
  next: StepLogPanelState,
): void {
  if (!taskId) return;
  touch(taskId, next);
}

/* 丢掉某个 taskId 的条目。用于「任务真结束后，用户不希望下次点同一节点时
 * 又冒出旧界面状态」的场景 —— 目前还没这么做，但接口先备着。 */
export function clearStepLogPanelState(
  taskId: string | null | undefined,
): void {
  if (!taskId) return;
  cache.delete(taskId);
}

/* 往缓存状态里追加一条日志（必要时新建条目）。
 * 返回更新后的状态；若是空操作则返回同一个引用。 */
export function appendStepLog(
  taskId: string | null | undefined,
  entry: StepLogEntry,
): StepLogPanelState | null {
  if (!taskId) return null;
  const prev = cache.get(taskId) ?? {
    logs: [] as StepLogEntry[],
    validationErrors: null,
  };
  // 按 (时间, 消息) 去重 —— 与 ImageGenerationPanel 里的 SSE 去重口径一致。
  if (prev.logs.some((log) => log.t === entry.t && log.msg === entry.msg)) {
    return prev;
  }
  const next: StepLogPanelState = {
    logs: [...prev.logs, entry],
    validationErrors: prev.validationErrors,
  };
  touch(taskId, next);
  return next;
}

/* 更新某个 taskId 缓存的 `validationErrors`（条目不存在则新建）。 */
export function setStepLogValidationErrors(
  taskId: string | null | undefined,
  errs: ValidationError[] | null,
): void {
  if (!taskId) return;
  const prev = cache.get(taskId) ?? {
    logs: [] as StepLogEntry[],
    validationErrors: null,
  };
  touch(taskId, { logs: prev.logs, validationErrors: errs });
}

/* 把 workflowName 与 status 合并进缓存条目，
 * 好让任务切换下拉框能按工作流名给每个 id 打标签
 *（例如「image_Z-Anime-Workflow-v1 · FAILED」），
 * 而不是逼用户去认一串被截断的 14 字符 id。 */
export function patchStepLogMeta(
  taskId: string | null | undefined,
  meta: { workflowName?: string; status?: string; nodeId?: string },
): void {
  if (!taskId) return;
  const prev = cache.get(taskId) ?? {
    logs: [] as StepLogEntry[],
    validationErrors: null,
  };
  touch(taskId, {
    logs: prev.logs,
    validationErrors: prev.validationErrors,
    workflowName: meta.workflowName ?? prev.workflowName,
    status: meta.status ?? prev.status,
    nodeId: meta.nodeId ?? prev.nodeId,
  });
}

/* 测试 / 管理用助手：当前跟踪着多少个任务。 */
export function stepLogCacheSize(): number {
  return cache.size;
}

/* 返回缓存当前持有的 taskId，最近触碰的排在最前。
 * 全局日志面板的任务选择器用它，让用户能在历史运行之间来回切，而不必重跑。 */
export function listCachedTaskIds(): string[] {
  return Array.from(cache.keys());
}

/* 测试 / 管理用助手：丢掉全部缓存状态。 */
export function clearAllStepLogPanels(): void {
  cache.clear();
}
