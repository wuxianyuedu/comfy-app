"use client";

// ── 系统指标轮询（显存/内存）：供底部状态栏消费（规范 17 §17.2 第②层）──
// 轮询 `/api/comfy/stats`，把「ComfyUI 是否在线 + 显存/内存占用」收口成一个
// controller，BrowserStatusBar 视图只读这里的字段，不直接发请求。
//
// 轮询节奏：
//  - 前台 4s 一次（显存占用在跑图时每秒级变化，4s 足够反映趋势又不会刷屏）。
//  - 页面隐藏（切后台）时暂停，避免空转请求；切回前台立即补一次并恢复轮询。

import { useCallback, useState } from "react";

import { useInterval } from "~/components/ui/use-interval";
import {
  fetchComfyStats,
  type ComfyStatsPayload,
} from "~/lib/comfy/comfy-stats-client";

export const COMFY_STATS_POLL_MS = 4000;

export interface ComfyStatsController {
  /** 最近一次读到的指标；尚未返回时为 null */
  stats: ComfyStatsPayload | null;
  /** ComfyUI 是否在线（online 且最近一次成功） */
  online: boolean;
  /** 主动触发一次刷新（如页面回前台） */
  refresh: () => Promise<void>;
}

const OFFLINE: ComfyStatsPayload = {
  online: false,
  vramUsed: 0,
  vramFree: 0,
  vramTotal: 0,
  ramUsed: 0,
  ramTotal: 0,
};

export function useComfyStats(): ComfyStatsController {
  const [stats, setStats] = useState<ComfyStatsPayload | null>(null);

  const pollOnce = useCallback(async () => {
    const next = await fetchComfyStats();
    setStats(next.online ? next : OFFLINE);
  }, []);

  /* 「前台轮询、后台暂停、回前台立即补跑」同 `use-update-check` —— 此前这段
   * 逐字抄了两份，现在共用 `useInterval`（规范 16 §16.2.4.15）。 */
  useInterval(pollOnce, {
    ms: COMFY_STATS_POLL_MS,
    pauseWhenHidden: true,
  });

  const online = stats?.online === true;

  return { stats, online, refresh: pollOnce };
}
