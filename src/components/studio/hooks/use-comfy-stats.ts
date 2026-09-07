"use client";

// ── 系统指标轮询（显存/内存）：供底部状态栏消费（规范 17 §17.2 第②层）──
// 轮询 `/api/comfy/stats`，把「ComfyUI 是否在线 + 显存/内存占用」收口成一个
// controller，BrowserStatusBar 视图只读这里的字段，不直接发请求。
//
// 轮询节奏：
//  - 前台 4s 一次（显存占用在跑图时每秒级变化，4s 足够反映趋势又不会刷屏）。
//  - 页面隐藏（切后台）时暂停，避免空转请求；切回前台立即补一次并恢复轮询。

import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchComfyStats,
  type ComfyStatsPayload,
} from "~/lib/comfy-stats-client";

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
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollOnce = useCallback(async () => {
    const next = await fetchComfyStats();
    setStats(next.online ? next : OFFLINE);
  }, []);

  // 清理计时器
  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  // 前台时启动轮询；后台时暂停。visibilitychange 恢复前台先立即刷一次。
  useEffect(() => {
    const start = () => {
      if (timer.current) clearInterval(timer.current);
      void pollOnce();
      timer.current = setInterval(() => void pollOnce(), COMFY_STATS_POLL_MS);
    };
    const stop = () => {
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    start();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pollOnce]);

  const online = stats?.online === true;

  return { stats, online, refresh: pollOnce };
}
