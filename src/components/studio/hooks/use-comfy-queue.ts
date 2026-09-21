"use client";

// ── ComfyUI 排队 / 当前执行（底部状态栏那一格的数据源）──
//
// 数据来自 `GET /api/comfy/queue` —— 服务端三路聚合（执行器内存态 + DB +
// ComfyUI `/queue`，见 `queue-status.server.ts`）。为什么值得占一格：任务全在
// 串行排队（MAX_CONCURRENCY=1），用户盯着画布转圈时最想知道的正是「前面还堵着
// 几个、当前这个跑了多久、跑的是哪个工作流与模型」——这些此前只散在日志面板里，
// 而**耗时根本没暴露过**。
//
// 两个周期：状态轮询 2s（与 dev server 存活探测同频）；「已运行 mm:ss」由本地
// 1s tick 算 —— 只靠轮询的话秒数会一跳两秒，看起来像卡住，而这一格恰恰是用户
// 用来判断「它还在动吗」的。

import { useCallback, useEffect, useRef, useState } from "react";

import { useInterval } from "~/components/ui/use-interval";
import { isRecord } from "~/lib/is-record";
import { useOfflineGate } from "./use-offline-gate";
import type {
  ComfyQueueStatus,
  ComfyRunningTask,
} from "~/lib/comfyui/queue-status-types";

export const COMFY_QUEUE_POLL_MS = 2000;

/** 本地秒表周期（只为让「已运行」连续，不发请求）。 */
const ELAPSED_TICK_MS = 1000;

const EMPTY: ComfyQueueStatus = {
  online: false,
  comfy: { running: 0, pending: 0 },
  running: null,
  queued: 0,
};

export interface ComfyQueueView extends ComfyQueueStatus {
  /** 当前任务已运行的毫秒数；没有在跑的任务时为 null。 */
  elapsedMs: number | null;
}

/** 已运行时长 → `mm:ss`（超过一小时带上小时）。 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const ss = String(total % 60).padStart(2, "0");
  const mm = String(Math.floor(total / 60) % 60).padStart(2, "0");
  const h = Math.floor(total / 3600);
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 状态栏那一格该说什么（纯函数，组件只管渲染）。返回 null = 不占位。 */
export interface ComfyQueueNotice {
  text: string;
  title: string;
}

export function comfyQueueNotice(
  view: ComfyQueueView,
): ComfyQueueNotice | null {
  /* ComfyUI 离线时不占位：状态栏已有「ComfyUI 未运行，显存/内存暂不可用」那条
   * 降级提示，同一件事报两遍只会让那一行更吵。 */
  if (!view.online) return null;

  const waiting = view.queued + view.comfy.pending;

  if (view.running === null) {
    /* 没在跑但有排队：只报队列（应用刚提交、ComfyUI 还在预热的那一小段）。 */
    if (waiting === 0) return null;
    return {
      text: `排队 ${waiting}`,
      title: `ComfyUI 队列里有 ${waiting} 个任务待执行`,
    };
  }

  const elapsed = formatElapsed(view.elapsedMs ?? 0);
  const head = [elapsed, view.running.workflowName, view.running.model].filter(
    (part): part is string => typeof part === "string" && part !== "",
  );
  const text =
    waiting > 0
      ? `▶ ${head.join(" · ")}（排队 ${waiting}）`
      : `▶ ${head.join(" · ")}`;

  const title = [
    `正在执行：${view.running.workflowName ?? "（未知工作流）"}`,
    view.running.model === null
      ? "模型：未能从本次工作流里识别"
      : `模型：${view.running.model}`,
    `已运行：${elapsed}　进度：${view.running.progress}%`,
    view.running.nodeType === null
      ? null
      : `当前节点：${view.running.nodeType}`,
    `ComfyUI 队列：运行 ${view.comfy.running} · 排队 ${view.comfy.pending}　本应用排队：${view.queued}`,
  ].filter((line): line is string => line !== null);

  return { text, title: title.join("\n") };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseRunning(value: unknown): ComfyRunningTask | null {
  if (!isRecord(value)) return null;
  if (typeof value.taskId !== "string" || typeof value.startedAt !== "number") {
    return null;
  }
  return {
    taskId: value.taskId,
    workflowName:
      typeof value.workflowName === "string" ? value.workflowName : null,
    model: typeof value.model === "string" ? value.model : null,
    startedAt: value.startedAt,
    progress: numberOr(value.progress, 0),
    nodeType: typeof value.nodeType === "string" ? value.nodeType : null,
  };
}

/** 网络载荷 → 状态（`unknown` 收窄，不做类型断言）。 */
function parseStatus(data: unknown): ComfyQueueStatus {
  if (!isRecord(data)) return EMPTY;
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

export function useComfyQueue(): ComfyQueueView {
  const [status, setStatus] = useState<ComfyQueueStatus>(EMPTY);
  /* 本地秒表。初值刻意为 0（不是 `Date.now()`）——它参与首帧渲染，用真实时钟
   * 会让 SSR 与客户端首帧不一致；没有在跑的任务时它根本不被读。 */
  const [now, setNow] = useState(0);
  const stoppedRef = useRef(false);
  /* 在线判定走与资源格同一条迟滞（use-offline-gate）：ComfyUI 跑图时 /queue
   * 偶发超时被服务端判 online:false，单次不该让这一格闪没，连续达阈值才提交离线。
   * 两路共用同一原语，保证「ComfyUI 是否在线」的口径一致。 */
  const tolerateOffline = useOfflineGate();
  /* 自增请求号：只接受最新一次的观测，丢弃乱序迟到的旧回包，避免污染连续失败计数。 */
  const reqIdRef = useRef(0);

  const probe = useCallback(async () => {
    const myReq = ++reqIdRef.current;
    try {
      const res = await fetch("/api/comfy/queue", {
        cache: "no-store",
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) return;
      const data: unknown = await res.json();
      if (stoppedRef.current || myReq !== reqIdRef.current) return;
      const parsed = parseStatus(data);
      if (parsed.online) {
        tolerateOffline(true);
        setStatus(parsed);
        return;
      }
      // 离线观测：容忍期内保留上一次好状态（不闪），连续失败达阈值才提交离线。
      if (!tolerateOffline(false)) {
        setStatus(parsed);
      }
    } catch {
      /* 探测失败不动状态：瞬时断网不该让状态栏那一格忽明忽暗（与 dev server
       * 存活探测同口径，见 use-dev-server-liveness.ts 文件头）。 */
    }
  }, [tolerateOffline]);

  useInterval(
    useCallback(() => {
      setNow(Date.now());
    }, []),
    { ms: ELAPSED_TICK_MS },
  );
  useInterval(probe, { ms: COMFY_QUEUE_POLL_MS });

  useEffect(() => {
    stoppedRef.current = false;
    return () => {
      stoppedRef.current = true;
    };
  }, []);

  return {
    ...status,
    elapsedMs:
      status.running === null
        ? null
        : Math.max(0, now - status.running.startedAt),
  };
}
