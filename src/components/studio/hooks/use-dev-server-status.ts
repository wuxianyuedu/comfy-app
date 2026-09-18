"use client";

// ── 底部状态栏「应用服务」那一格的 controller（规范 17 §17.2 第②层）──────
// 把探测原始事实（最近一次成功与否 / 是否曾探通 / 是否刚重启）折叠成视图
// 直接可渲染的文案与色调。判据本身在 ~/lib/dev-server-status（纯函数），
// 这里只做「取事实 → 调判据」的接线，便于 renderHook 断言。

import {
  deriveDevServerStatus,
  type DevServerStatus,
} from "~/lib/shell/dev-server-status";

import { useDevServerLiveness } from "./use-dev-server-liveness";

export interface DevServerStatusViewModel extends DevServerStatus {
  /** 最近一次**真正**重启的时刻（页脚弱化展示用）。 */
  lastRestartAt: number | null;
}

export function useDevServerStatus(): DevServerStatusViewModel {
  const { restarting, lastRestartAt, probeOk, everOnline } =
    useDevServerLiveness();
  const derived = deriveDevServerStatus({
    everOnline,
    lastProbeOk: probeOk,
    restarted: restarting,
    lastRestartAt,
  });
  return { ...derived, lastRestartAt };
}
