"use client";

// ── ComfyUI 排队 / 当前执行（底部状态栏那一格的数据源）──
// 轮询本体在 `~/lib/comfy/comfy-queue-store`（全页单点持有者，状态栏与队列面板共用一条
// GET /api/comfy/queue，避免重复轮询）。本文件只剩订阅快照 + 纯展示函数：逻辑（notice
// 文案 / 耗时格式化）走纯函数，视图不再自己发请求（硬规则 10）。

import { useSyncExternalStore } from "react";

import {
  COMFY_QUEUE_POLL_MS,
  subscribeComfyQueue,
  getComfyQueueSnapshot,
  getComfyQueueServerSnapshot,
  type ComfyQueueView,
} from "~/lib/comfy/comfy-queue-store";

export { COMFY_QUEUE_POLL_MS };
export type { ComfyQueueView };

/** 已运行时长 → `mm:ss`（超过一小时带上小时）。 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const ss = String(total % 60).padStart(2, "0");
  const mm = String(Math.floor(total / 60) % 60).padStart(2, "0");
  const h = Math.floor(total / 3600);
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 状态栏那一格该说什么（纯函数，组件只管渲染）。返回 null = 不占位。 */
export type ComfyQueueNotice = {
  text: string;
  title: string;
};

export function comfyQueueNotice(view: ComfyQueueView): ComfyQueueNotice | null {
  /* ComfyUI 离线时不占位：状态栏已有「ComfyUI 未运行，显存/内存暂不可用」那条
   * 降级提示，同一件事报两遍只会让那一行更吵。 */
  if (!view.online) {
    return null;
  }

  const waiting = view.queued + view.comfy.pending;

  if (view.running === null) {
    /* 没在跑但有排队：只报队列（应用刚提交、ComfyUI 还在预热的那一小段）。 */
    if (waiting === 0) {
      return null;
    }
    return {
      text: `排队 ${waiting}`,
      title: `ComfyUI 队列里有 ${waiting} 个任务待执行`,
    };
  }

  const elapsed = formatElapsed(view.elapsedMs ?? 0);
  const head = [elapsed, view.running.workflowName, view.running.model].filter(
    (part): part is string => typeof part === "string" && part !== "",
  );
  const text = waiting > 0 ? `▶ ${head.join(" · ")}（排队 ${waiting}）` : `▶ ${head.join(" · ")}`;

  const title = [
    `正在执行：${view.running.workflowName ?? "（未知工作流）"}`,
    view.running.model === null ? "模型：未能从本次工作流里识别" : `模型：${view.running.model}`,
    `已运行：${elapsed}　进度：${view.running.progress}%`,
    view.running.nodeType === null ? null : `当前节点：${view.running.nodeType}`,
    `ComfyUI 队列：运行 ${view.comfy.running} · 排队 ${view.comfy.pending}　本应用排队：${view.queued}`,
  ].filter((line): line is string => line !== null);

  return { text, title: title.join("\n") };
}

/** 订阅同一份队列与运行快照（全页单点持有，见 `comfy-queue-store`）。 */
export function useComfyQueue(): ComfyQueueView {
  return useSyncExternalStore(
    subscribeComfyQueue,
    getComfyQueueSnapshot,
    getComfyQueueServerSnapshot,
  );
}
