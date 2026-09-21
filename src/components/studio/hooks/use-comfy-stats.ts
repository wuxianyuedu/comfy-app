"use client";

// ── 系统指标轮询（显存/内存）：供底部状态栏消费（规范 17 §17.2 第②层）──
// 轮询 `/api/comfy/stats`，把「ComfyUI 是否在线 + 显存/内存占用」收口成一个
// controller，BrowserStatusBar 视图只读这里的字段，不直接发请求。
//
// 轮询节奏：
//  - 前台 4s 一次（显存占用在跑图时每秒级变化，4s 足够反映趋势又不会刷屏）。
//  - 页面隐藏（切后台）时暂停，避免空转请求；切回前台立即补一次并恢复轮询。

import { useCallback, useRef, useState } from "react";

import { useInterval } from "~/components/ui/use-interval";
import {
  fetchComfyStats,
  type ComfyStatsPayload,
} from "~/lib/comfy/comfy-stats-client";

export const COMFY_STATS_POLL_MS = 4000;

/** 连续失败多少次才判定离线（迟滞）。ComfyUI 跑图时 `/system_stats` 偶发超时
 * （服务端 2.5s 上限）或单次网络抖动都会返回 online:false，但 ComfyUI 其实一直
 * 在线——单次失败就翻「未运行」会让状态栏忽明忽暗。给 3 次容忍（≈12s 持续失败
 * 才报离线），任一次成功立即清零。 */
const OFFLINE_THRESHOLD = 3;

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
  /* 连续失败计数：用 ref 而非 state，避免每次轮询多一次无谓 re-render；
   * 它只影响「是否翻离线」的判据，不直接参与渲染。 */
  const failCountRef = useRef(0);

  const pollOnce = useCallback(async () => {
    const next = await fetchComfyStats();
    if (next.online) {
      failCountRef.current = 0;
      setStats(next);
      return;
    }
    /* 单次失败：若已有上一次的好数据，保留它（不闪「未运行」）；只有连续失败
     * 达阈值、或从未成功过（首帧就没有可保留的数据）才真正翻离线。 */
    failCountRef.current += 1;
    if (failCountRef.current >= OFFLINE_THRESHOLD) {
      setStats(OFFLINE);
    }
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
