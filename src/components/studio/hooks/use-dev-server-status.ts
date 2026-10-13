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
  /** 上一次结束记录的落盘时刻（毫秒）；无记录为 null。 */
  lastExitAt: number | null;
  /**
   * 当前是哪一次**启动**（launcher 的 runId）。
   *
   * 消息中心用它把历史消息按「每一次启动」分组，并标出哪一组是当前这一次。
   * 见 `~/lib/shell/message-run-groups`。
   */
  currentRunId: string | null;
  /**
   * 这一份进程对本次页面会话来说是新的（冷启动 / 真重启；整页刷新**不算**）。
   *
   * 状态栏自己不画它，但**它是「进程换了一个」的唯一判据**——探活失败可能只是
   * 显示器关闭 / 后台节流 / 瞬时断网（那几条已明确不判定重启），而刷新并没有
   * 换进程。消息中心「应用服务已启动 / 已恢复」那条记录就建在它上面（见
   * `~/components/message-center/hooks/use-app-service-message-log`）。
   *
   * 顺带解决「谁去轮询」：这个 controller 是 `useDevServerLiveness` 的**唯一**
   * 消费方，消费方把这份事实直接递给消息中心的记录 hook，于是全应用仍然只有
   * 一条 2 秒一拍的探活循环。
   */
  processIsNew: boolean;
}

export function useDevServerStatus(): DevServerStatusViewModel {
  const {
    restarting,
    processIsNew,
    lastRestartAt,
    lastExit,
    lastExitAt,
    reachable,
    everOnline,
    currentRunId,
  } = useDevServerLiveness();
  const derived = deriveDevServerStatus({
    everOnline,
    /* 喂「抗抖动后」的可达性（`probeOk` 是单拍事实，冷编译超时那种抖动会在
     * 这里被滤掉），见 use-dev-server-liveness 的 OFFLINE_CONFIRM_FAILURES。 */
    reachable,
    restarted: restarting,
    lastRestartAt,
    lastExit,
  });
  return { ...derived, lastRestartAt, lastExitAt, processIsNew, currentRunId };
}
