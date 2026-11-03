"use client";

/* ── stepLogCache.ts ──
 * 跨「卸载 / 重新挂载」缓存 CanvasNode 的步骤日志面板状态：节点切走时面板卸载，`stepLogs` / `validationErrors` 被拆掉，切回会重复订阅、回退到 QUEUED (0%)，20s 卡死告警也重置（Task.logs 能重放内容，在途计时器却丢）。
 * 修法：模块级 Map 按 taskId 存（MAX_ENTRIES 做 LRU）；只做标签页内持久化，跨刷新属服务端。
 */

import type { ValidationError } from "~/lib/comfyui/validation";
import { tailWindow } from "~/lib/page-window";

/* StepLogEntry 从本模块再导出，让 ImageGenerationPanel 能同时拿到类型与
 * 缓存助手，而不必造成循环导入（面板 ↔ 缓存）。
 * 形状与 runner.ts 的 LogEntry 一致（即 TaskEvent 联合里 "log" 那条的载荷），
 * 只多一个**纯界面**扩展：`client?: boolean` 标记「浏览器自己推的」条目
 *（订阅状态、卡死检测告警 …），好让它们以低饱和斜体渲染。 */
export type StepLogEntry = {
  client?: boolean;
  level: "info" | "progress" | "warn" | "error" | "success";
  msg: string;
  /** 调用方来源（"文件:行"），从服务端 LogEntry 镜像过来；
   *  只在调试开关打开时渲染。 */
  src?: string;
  t: number;
};

export type StepLogPanelState = {
  /** 该 taskId 的面板首次打开以来推入的全部日志条目。 */
  logs: Array<StepLogEntry>;
  /** 触发该任务的画布节点 id，用于日志面板按 #1/#2… 短序号筛选。 */
  nodeId?: string;
  status?: string;
  /** 最近一次看到的结构化失败（来自 pollTask 的 `d.validationErrors`，
   *  或 SSE 的 `state` 事件）。任务仍在跑、或从未标记失败时为 null。 */
  validationErrors: Array<ValidationError> | null;
  /* 任务级元数据，好让任务切换下拉框显示「工作流名 · 状态」，
   *  而不是一串被截断的 id。由 GlobalStepLogPanel 在每次 SSE `state` 事件时填充。 */
  workflowName?: string;
};

const MAX_ENTRIES = 256;

/* 单个任务的日志行数上限。面板本来就只显示尾部 300 行（LOG_MODAL_MAX_ROWS），
 * 再往前既看不到、也让每次 `[...prev.logs, entry]` 的拷贝一路变贵 ——
 * 长跑任务（几分钟、上千行）下这点尤其明显。 */
export const MAX_LOGS_PER_TASK = 2000;

/* 去重只比对尾部若干条：日志按时间追加，重复的那条一定紧跟在它自己之后，
 * 全量 `some` 让每条新日志都变成 O(n)，整个流就是 O(n²)。 */
const DEDUPE_WINDOW = 64;

const cache = new Map<string, StepLogPanelState>();

/* 触碰一次（移到插入顺序末尾）+ 限制总条数。LRU。 */
function touch(id: string, next: StepLogPanelState) {
  cache.set(id, next);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) {
      cache.delete(oldest);
    }
  }
}

/* 载入某个 taskId 的持久化状态；没有则为 null。 */
export function loadStepLogPanelState(taskId: string | null | undefined): StepLogPanelState | null {
  if (!taskId) {
    return null;
  }
  return cache.get(taskId) ?? null;
}

/* 覆盖某个 taskId 的持久化状态。测试要用；
 * 面板想主动重置时也用（例如用户选了新工作流 —— 目前没有这条路径，
 * 但把出口留着）。 */
export function saveStepLogPanelState(taskId: string, next: StepLogPanelState): void {
  if (!taskId) {
    return;
  }
  touch(taskId, next);
}

/* 丢掉某个 taskId 的条目。用于「任务真结束后，用户不希望下次点同一节点时
 * 又冒出旧界面状态」的场景 —— 目前还没这么做，但接口先备着。 */
export function clearStepLogPanelState(taskId: string | null | undefined): void {
  if (!taskId) {
    return;
  }
  cache.delete(taskId);
}

/* 往缓存状态里追加一条日志（必要时新建条目）。
 * 返回更新后的状态；若是空操作则返回同一个引用。 */
export function appendStepLog(
  taskId: string | null | undefined,
  entry: StepLogEntry,
): StepLogPanelState | null {
  if (!taskId) {
    return null;
  }
  const prev = cache.get(taskId) ?? {
    /* SAFETY: 类型断言已复核 */
    logs: [] as Array<StepLogEntry>,
    validationErrors: null,
  };
  // 按 (时间, 消息) 去重 —— 与 ImageGenerationPanel 里的 SSE 去重口径一致。
  let duplicated = false;
  for (
    let index = Math.max(0, prev.logs.length - DEDUPE_WINDOW);
    index < prev.logs.length;
    index += 1
  ) {
    const known = prev.logs[index];
    if (known?.t === entry.t && known?.msg === entry.msg) {
      duplicated = true;
      break;
    }
  }
  if (duplicated) {
    return prev;
  }

  const logs = [...prev.logs, entry];
  const next: StepLogPanelState = {
    /* 尾部窗口走 `~/lib/page-window`（规范 16 §16.2.4.67）—— 与面板显示时的
     * 取尾部 300 行是同一个出口，不在这里再写一个 `slice(-n)`。 */
    logs: tailWindow(logs, MAX_LOGS_PER_TASK),
    validationErrors: prev.validationErrors,
  };
  touch(taskId, next);
  return next;
}

/* 更新某个 taskId 缓存的 `validationErrors`（条目不存在则新建）。 */
export function setStepLogValidationErrors(
  taskId: string | null | undefined,
  errs: Array<ValidationError> | null,
): void {
  if (!taskId) {
    return;
  }
  const prev = cache.get(taskId) ?? {
    /* SAFETY: 类型断言已复核 */
    logs: [] as Array<StepLogEntry>,
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
  meta: { nodeId?: string; status?: string; workflowName?: string },
): void {
  if (!taskId) {
    return;
  }
  const prev = cache.get(taskId) ?? {
    /* SAFETY: 类型断言已复核 */
    logs: [] as Array<StepLogEntry>,
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
export function listCachedTaskIds(): Array<string> {
  return [...cache.keys()];
}

/* 测试 / 管理用助手：丢掉全部缓存状态。 */
export function clearAllStepLogPanels(): void {
  cache.clear();
}
