"use client";

// ── 系统指标（显存 / 内存）读数的组件侧外壳（规范 17 §17.2 第②层）─────
//
// 观测本体与轮询节奏在 `~/lib/comfy/comfy-stats-store`：状态栏那格与首页算力总览读
// 的是**同一条轮询** —— 各挂一份 hook 会把同一个 `/api/comfy/stats` 拉成两路，
// 两份「前台/后台暂停」也各走各的（见 store 文件头）。
//
// 本文件只做三件事：订阅快照、给一个主动刷新出口、把「在线 + 迟滞容忍期」折叠成
// 视图好用的形状。BrowserStatusBar 等视图仍只读字段，不直接发请求（硬规则 10）。

import { useCallback, useSyncExternalStore } from "react";

import type { ComfyStatsPayload } from "~/lib/comfy/comfy-stats-client";
import {
  COMFY_STATS_POLL_MS,
  getComfyStatsServerSnapshot,
  getComfyStatsSnapshot,
  refreshComfyStats,
  subscribeComfyStats,
} from "~/lib/comfy/comfy-stats-store";

export { COMFY_STATS_POLL_MS };
export type { ComfyStatsPayload };

export interface ComfyStatsController {
  /** 最近一次读到的指标；尚未返回时为 null */
  stats: ComfyStatsPayload | null;
  /** ComfyUI 是否在线（online 且最近一次成功） */
  online: boolean;
  /** 数据陈旧：处于迟滞容忍期、显示的是上一次好数据（不闪离线，但需弱化提示） */
  stale: boolean;
  /** 主动触发一次刷新（如页面回前台） */
  refresh: () => Promise<void>;
}

/**
 * 读同一份系统指标快照。
 *
 * 快照身份由 store 保证稳定（三个字段没变就复用旧对象），所以不会因
 * `useSyncExternalStore` 判等而反复重渲染；订阅者归零时 store 会停表。
 */
export function useComfyStats(): ComfyStatsController {
  const snapshot = useSyncExternalStore(
    subscribeComfyStats,
    getComfyStatsSnapshot,
    getComfyStatsServerSnapshot,
  );
  const refresh = useCallback(() => refreshComfyStats(), []);
  return {
    stats: snapshot.stats,
    online: snapshot.online,
    stale: snapshot.online && snapshot.stale,
    refresh,
  };
}
