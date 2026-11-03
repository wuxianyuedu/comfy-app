"use client";

// ── 底部状态栏「应用服务」那一格的 controller（规范 17 §17.2 第②层）──────
// 把探测原始事实（最近一次成功与否 / 是否曾探通 / 是否刚重启）折叠成视图
// 直接可渲染的文案与色调。判据本身在 ~/lib/dev-server-status（纯函数），
// 这里只做「取事实 → 调判据」的接线，便于 renderHook 断言。

import { deriveDevServerStatus, type DevServerStatus } from "~/lib/shell/dev-server-status";

import { useDevServerLiveness } from "./use-dev-server-liveness";

export type DevServerStatusViewModel = {
  /**
   * 当前是哪一次**启动**（launcher 的 runId）。
   * 消息中心用它把历史消息按「每一次启动」分组，并标出哪一组是当前这一次
   *（见 `~/lib/shell/message-run-groups`）。
   */
  currentRunId: string | null;
  /** 上一次结束记录的落盘时刻（毫秒）；无记录为 null。 */
  lastExitAt: number | null;
  /** 最近一次**真正**重启的时刻（页脚弱化展示用）。 */
  lastRestartAt: number | null;
  /**
   * 这一份进程对本次页面会话来说是新的（冷启动 / 真重启；整页刷新**不算**）。它是「进程换了
   * 一个」的唯一判据：探活失败可能只是显示器关闭 / 后台节流 / 瞬时断网，而刷新并没有换进程；
   * 消息中心「已启动 / 已恢复」那条建在它上面，也是 `useDevServerLiveness` 的唯一消费方。
   */
  processIsNew: boolean;
  /**
   * 最后一拍之前**没人在探测**的那一段（毫秒，0 = 紧接上一拍）。
   * 「应用服务已恢复」那条消息要它：那一段里服务是否可达没人问过，
   * 「断开持续了多久」必须带这个注脚（`~/lib/shell/app-service-message`）。
   */
  unprobedMs: number;
} & DevServerStatus;

export function useDevServerStatus(): DevServerStatusViewModel {
  const {
    restarting,
    processIsNew,
    lastRestartAt,
    lastExit,
    lastExitAt,
    reachable,
    routeTableStale,
    everOnline,
    currentRunId,
    unprobedMs,
  } = useDevServerLiveness();
  const derived = deriveDevServerStatus({
    everOnline,
    routeTableStale,
    /* 喂「抗抖动后」的可达性（`probeOk` 是单拍事实，冷编译超时那种抖动会在
     * 这里被滤掉），见 use-dev-server-liveness 的 OFFLINE_CONFIRM_FAILURES。 */
    reachable,
    restarted: restarting,
    lastRestartAt,
    lastExit,
  });
  return {
    ...derived,
    lastRestartAt,
    lastExitAt,
    processIsNew,
    currentRunId,
    unprobedMs,
  };
}
