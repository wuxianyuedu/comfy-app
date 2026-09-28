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
import { useOfflineGate } from "./use-offline-gate";

export const COMFY_STATS_POLL_MS = 4000;

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
  const [stale, setStale] = useState(false);
  /* 进程级判活：最近一次观测里 ComfyUI 进程还活着（路由经进程快照给出）。
   * HTTP 连续超时但进程在跑时它让 online 保持 true——顶栏不闪「未运行」，
   * 数据保留旧值并置 stale（与 `/api/comfy/queue` 的在线口径同源）。 */
  const [processAlive, setProcessAlive] = useState(false);
  /* 连续失败迟滞：单次探测失败（ComfyUI 跑图时 /system_stats 超时或网络抖动）
   * 不立刻翻离线，保留上一次好数据；连续达阈值才提交离线（判据见 use-offline-gate）。 */
  const tolerateOffline = useOfflineGate();
  /* 自增请求号：useInterval 不挡重叠（背压由调用方决定），慢/抖动下上一拍可能
   * 晚于下一拍返回。只接受最新一次的观测，丢弃乱序迟到的旧回包，避免污染连续
   * 失败计数（例如一个晚到的 online:false 把刚清零的计数又 +1）。 */
  const reqIdRef = useRef(0);

  const pollOnce = useCallback(async () => {
    const myReq = ++reqIdRef.current;
    const next = await fetchComfyStats();
    if (myReq !== reqIdRef.current) return; // 已有更新的请求在跑，丢弃本次迟到回包
    if (next.online) {
      tolerateOffline(true);
      setProcessAlive(true);
      setStats(next);
      setStale(false);
      return;
    }
    /* 进程活着、只是这一拍没应答（跑图满载）：这不是「掉线」观测——不计入
     * 连续失败（反而清零），数据保留旧值并置 stale，在线结论保持。 */
    if (next.processAlive) {
      tolerateOffline(true);
      setProcessAlive(true);
      setStale(true);
      return;
    }
    /* 离线观测：容忍期内保留上一次好数据、只打 stale 标记（不闪「未运行」）；
     * 连续失败达阈值才真正翻离线。 */
    if (tolerateOffline(false)) {
      setStale(true);
    } else {
      setStats(OFFLINE);
      setProcessAlive(false);
      setStale(false);
    }
  }, [tolerateOffline]);

  /* 「前台轮询、后台暂停、回前台立即补跑」同 `use-update-check` —— 此前这段
   * 逐字抄了两份，现在共用 `useInterval`（规范 16 §16.2.4.15）。 */
  useInterval(pollOnce, {
    ms: COMFY_STATS_POLL_MS,
    pauseWhenHidden: true,
  });

  /* 在线 = 读到过好数据，或最近一次观测确认进程还活着（数据可能暂时读不到）。 */
  const online = stats?.online === true || processAlive;

  return { stats, online, stale: online && stale, refresh: pollOnce };
}
