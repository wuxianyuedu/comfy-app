"use client";

// ── 状态栏「队列与运行」格的**全页单点持有者**（与 comfy-stats-store 同款）──
//
// 为什么收成 store 而不是各组件各拉一份：状态栏（BrowserStatusBar）与队列面板
// （useQueueMonitor）原本各自挂一份 useComfyQueue，等于把同一个
// GET /api/comfy/queue 拉成两路独立轮询 —— 队列面板打开时该端点每 2s 被打两次。
// 现在观测收在这里一份，组件侧一律经 useComfyQueue() 用 useSyncExternalStore 订阅
// 同一份快照；轮询只在「至少有一个订阅者」时存在，最后一个订阅者退订即停表。
//
// 语义与原 hook 逐条对齐（不改判据）：
//   · 2s 一轮、挂载即先跑一次、后台暂停、回前台补跑 —— 全部走 `~/lib/poll-timer`；
//   · 连续失败迟滞走 `~/lib/offline-gate`（与 stats 通道各自一台计数机，互不污染）；
//   · 「忙不忙」仍喂给全页单点（comfy-busy-store），让系统指标把 /system_stats 的
//     探测降到出图档（GPU 满载时少打一次 torch.cuda.mem_get_info）；
//   · 本地 1s 秒表只算「已运行」，不发请求；
//   · 背压只认最新一次回包，迟到的旧回包丢弃。

import { startPollTimer } from "~/lib/poll-timer";
import { createOfflineGate } from "~/lib/offline-gate";
import { noteComfyBusy } from "~/lib/comfy/comfy-busy-store";
import { fireAndForget } from "~/lib/async-action";
import { isRecord } from "~/lib/is-record";
import type { ComfyQueueStatus, ComfyRunningTask } from "~/lib/comfyui/queue-status-types";

/** 事件通道掉线时的兜底轮询节奏；空闲时不频繁拉真值，实时变化交给 SSE。 */
export const COMFY_QUEUE_POLL_MS = 2000;
/** 本地秒表周期（只为让「已运行」连续，不发请求）。 */
const ELAPSED_TICK_MS = 1000;
/** 兜底轮询节奏：事件通道（SSE）为主，这条只在 SSE 掉了 / 还没连上时兜底
 * （事件为主、轮询兜底，与 liveness 同哲学）。比旧 2s 慢一个数量级——空闲时本就
 * 不该有事要拉，频繁的真值刷新交给 SSE 推送触发。 */
const COMFY_QUEUE_FALLBACK_MS = 15_000;

const EMPTY: ComfyQueueStatus = {
  online: false,
  comfy: { running: 0, pending: 0 },
  running: null,
  queued: 0,
};

const SERVER_SNAPSHOT: ComfyQueueView = { ...EMPTY, elapsedMs: null, syncedAt: null };

export type ComfyQueueView = {
  /** 当前任务已运行的毫秒数；没有在跑的任务时为 null。 */
  elapsedMs: number | null;
  /** 最近一次成功读取 ComfyUI 真值的时刻；失败时保留上一次成功读数。 */
  syncedAt: number | null;
} & ComfyQueueStatus;

let snapshot: ComfyQueueView = SERVER_SNAPSHOT;

type Subscription = {
  onChange: () => void;
};
const subscriptions = new Set<Subscription>();

let subscriberCount = 0;
let stopPolling: (() => void) | null = null;
let stopTicking: (() => void) | null = null;
let stopEvents: (() => void) | null = null;

/* 本通道独占一台离线迟滞计数机（与 stats 通道各自去抖，互不污染）：连续失败才翻离线，
 * 单次超时（跑图高峰 / 网络抖动）保留上一次好状态，不闪。 */
let observeOnline = createOfflineGate();
/* 背压：只认最新一次的观测。 */
let requestId = 0;
let refreshInFlight: Promise<void> | null = null;

/* 快照身份要稳定：字段没变就复用旧对象，避免 useSyncExternalStore 判等触发无限重渲染。 */
function publish(next: ComfyQueueView): void {
  if (
    snapshot.online === next.online &&
    snapshot.queued === next.queued &&
    snapshot.comfy.running === next.comfy.running &&
    snapshot.comfy.pending === next.comfy.pending &&
    sameRunning(snapshot.running, next.running) &&
    snapshot.elapsedMs === next.elapsedMs &&
    snapshot.syncedAt === next.syncedAt
  ) {
    return;
  }
  snapshot = next;
  for (const subscription of subscriptions) {
    subscription.onChange();
  }
}

function sameRunning(a: ComfyRunningTask | null, b: ComfyRunningTask | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return (
    a.taskId === b.taskId &&
    a.startedAt === b.startedAt &&
    a.progress === b.progress &&
    a.workflowName === b.workflowName &&
    a.model === b.model &&
    a.nodeType === b.nodeType &&
    a.progressValue === b.progressValue &&
    a.progressMax === b.progressMax
  );
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** 可空数值字段（progressValue / progressMax）：缺了就是「拿不到」，不冒充 0。 */
function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseRunning(value: unknown): ComfyRunningTask | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.taskId !== "string" || typeof value.startedAt !== "number") {
    return null;
  }
  return {
    taskId: value.taskId,
    workflowName: typeof value.workflowName === "string" ? value.workflowName : null,
    model: typeof value.model === "string" ? value.model : null,
    startedAt: value.startedAt,
    progress: numberOr(value.progress, 0),
    nodeType: typeof value.nodeType === "string" ? value.nodeType : null,
    progressValue: numberOrNull(value.progressValue),
    progressMax: numberOrNull(value.progressMax),
  };
}

function parseStatus(data: unknown): ComfyQueueStatus {
  if (!isRecord(data)) {
    return EMPTY;
  }
  const comfy = isRecord(data.comfy) ? data.comfy : {};
  return {
    online: data.online === true,
    comfy: {
      running: numberOr(comfy.running, 0),
      pending: numberOr(comfy.pending, 0),
    },
    running: parseRunning(data.running),
    queued: numberOr(data.queued, 0),
  };
}

function elapsedFor(running: ComfyRunningTask | null): number | null {
  if (running === null) {
    return null;
  }
  return Math.max(0, Date.now() - running.startedAt);
}

/* 轮询动作抛错时的通道：本文件在 src/lib，不许直接 console.*（单日志通道判据）。
 * pollOnce 自身已用 try/catch 吞掉网络/解析错误、不动状态，所以这里实际上不会被触发。 */
const ignorePollError = (): void => undefined;

async function pollOnce(): Promise<"failed" | "published" | "stale"> {
  const myRequest = ++requestId;
  try {
    const res = await fetch("/api/comfy/queue", {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (myRequest !== requestId) {
      return "stale";
    } // 已有更新的请求在跑，丢弃本次迟到回包
    if (!res.ok) {
      return "failed";
    }
    const data: unknown = await res.json();
    if (myRequest !== requestId) {
      return "stale";
    }
    const parsed = parseStatus(data);
    const syncedAt = Date.now();
    if (parsed.online) {
      observeOnline(true);
      /* 把「忙不忙」喂给全页单点（ISSUE #1351）：系统指标的持有者据此把
       * /system_stats 的探测降到出图档 —— 那条探针内部会调
       * torch.cuda.mem_get_info，GPU 满载时打它等于往排队的 aiohttp 里再插请求。 */
      noteComfyBusy(
        parsed.running !== null ||
          parsed.comfy.pending > 0 ||
          parsed.comfy.running > 0 ||
          parsed.queued > 0,
      );
      publish({ ...parsed, elapsedMs: elapsedFor(parsed.running), syncedAt });
      return "published";
    }
    // 离线观测：容忍期内保留上一次好状态（不闪），连续失败达阈值才提交离线。
    noteComfyBusy(false);
    if (!observeOnline(false)) {
      publish({ ...parsed, elapsedMs: elapsedFor(parsed.running), syncedAt });
    }
    return "published";
  } catch {
    /* 探测失败不动状态：瞬时断网不该让状态栏那一格忽明忽暗（与 dev server
     * 存活探测同口径）。 */
    return "failed";
  }
}

/** 主动刷新共享快照；并发点击复用同一次请求，不重复打端点。 */
export function refreshComfyQueue(): Promise<void> {
  if (refreshInFlight !== null) {
    return refreshInFlight;
  }
  const pending = pollOnce().then((outcome) => {
    if (outcome !== "published") {
      throw new Error("ComfyUI 队列刷新失败");
    }
  });
  refreshInFlight = pending;
  /* settled 后清掉去重标记：成功与失败都清，且只清「还是自己」的那一次。
   * 清理链本身的结果无人消费 —— 走 fireAndForget 显式收口，不用 void 悬空
   * （void someFn() 会撞 src/lib 的 H-6 棘轮）。pending 原样返回给主动刷新方，
   * 失败仍由调用方看到，这里不吞。 */
  fireAndForget(
    pending.finally(() => {
      if (refreshInFlight === pending) {
        refreshInFlight = null;
      }
    }),
    ignorePollError,
  );
  return pending;
}

/* 本地秒表：只让「已运行」连续（不发请求），每秒刷一次 elapsedMs。 */
function tickElapsed(): void {
  if (snapshot.running === null) {
    return;
  }
  const elapsed = elapsedFor(snapshot.running);
  if (elapsed !== snapshot.elapsedMs) {
    publish({ ...snapshot, elapsedMs: elapsed });
  }
}

/* 事件主通道：订阅 `/api/comfy/queue/events` 这条 SSE，收到「变了」就补一次真值
 * 拉取（refreshComfyQueue）。EventSource 自带断线重连；只在主动退订时关。非浏览器
 * 环境（jsdom 单测）没有 EventSource，跳过——此时只剩兜底轮询。 */
function subscribeComfyQueueEvents(onChange: () => void): () => void {
  if (typeof EventSource === "undefined") {
    return () => undefined;
  }
  const es = new EventSource("/api/comfy/queue/events");
  es.onmessage = () => {
    onChange();
  };
  return () => {
    es.close();
  };
}

function ensurePolling(): void {
  if (stopPolling !== null) {
    return;
  }
  // 慢速兜底轮询：事件通道掉线 / 还没连上时的安全网（事件为主、轮询兜底）。
  stopPolling = startPollTimer(pollOnce, {
    ms: COMFY_QUEUE_FALLBACK_MS,
    immediate: true,
    onError: ignorePollError,
  });
  stopTicking ??= startPollTimer(tickElapsed, {
    ms: ELAPSED_TICK_MS,
    immediate: false,
    onError: ignorePollError,
  });
  if (stopEvents === null && typeof EventSource !== "undefined") {
    // 事件主通道：首个订阅者拉起一条共享 SSE（多组件共用，不各开一条）。
    stopEvents = subscribeComfyQueueEvents(() => {
      // 收到 SSE 就补拉一次真值；网络 / 非 2xx 失败会从 refreshComfyQueue 抛出，
      // 由 fireAndForget 的 onError 接收，不污染后台快照。
      fireAndForget(refreshComfyQueue(), ignorePollError);
    });
  }
}

function stopAll(): void {
  stopPolling?.();
  stopPolling = null;
  stopTicking?.();
  stopTicking = null;
  stopEvents?.();
  stopEvents = null;
}

/**
 * 订阅队列与运行快照；返回退订函数。**这是本文件唯一的启动入口** —— 没有订阅者时
 * 不存在轮询（不会有「没人看还在打服务端」的白拉）。
 */
export function subscribeComfyQueue(onChange: () => void): () => void {
  const subscription: Subscription = { onChange };
  subscriptions.add(subscription);
  subscriberCount += 1;
  ensurePolling();
  return () => {
    subscriptions.delete(subscription);
    subscriberCount -= 1;
    if (subscriberCount === 0) {
      stopAll();
    }
  };
}

/** 当前快照（身份稳定，可直接给 `useSyncExternalStore`）。 */
export function getComfyQueueSnapshot(): ComfyQueueView {
  return snapshot;
}

/** 服务端快照：与首帧「还没量过」一致，按「无数据」渲染，不制造第三种状态。 */
export function getComfyQueueServerSnapshot(): ComfyQueueView {
  return SERVER_SNAPSHOT;
}

/** 只给用例：把模块级状态复位（含那台有状态的离线计数机），避免用例之间互相污染。 */
export function resetComfyQueueStoreForTest(): void {
  subscriptions.clear();
  subscriberCount = 0;
  stopAll();
  requestId += 1;
  refreshInFlight = null;
  observeOnline = createOfflineGate();
  snapshot = SERVER_SNAPSHOT;
}
