"use client";

// ── 在线判定迟滞的组件侧外壳 ────────────────────────────────────────
//
// 判据本体（连续失败达阈值才提交离线、在线即清零）在 `~/lib/offline-gate` ——
// 那里同时服务非组件的消费者（系统指标的全页单点持有者），lib 也不能反向 import
// 视图层（硬规则 22），所以本体不能留在这边。本文件只保留「每个 hook 实例各持一台
// 计数机」这层 React 外壳。
//
// 谁在用：状态栏的显存/内存通道（stats）与「排队/当前执行」通道（queue）各自去抖，
// 互不污染 —— 两条通道的抖动节奏不同（4s / 2s），共用一台计数机会让一条通道的
// 成功把另一条的失败清零。

import { useMemo } from "react";

import {
  createOfflineGate,
  DEFAULT_OFFLINE_THRESHOLD,
} from "~/lib/offline-gate";

/**
 * 每个 hook 实例持有自己的一台迟滞计数机。
 *
 * @returns `observe(online)` —— 语义见 `createOfflineGate`：在线 true；
 *   离线但在容忍期内也 true（调用方据此保留上一次好数据）；达阈值才 false。
 */
export function useOfflineGate(
  threshold: number = DEFAULT_OFFLINE_THRESHOLD,
): (online: boolean) => boolean {
  /* 用 useMemo 而不是 useRef：本仓库 lint 判据 react-hooks/refs 不容「渲染期读 ref」
     （含惰性赋值那类），而这条计数机首帧就要能用，不能等 effect。
     阈值是调用处给的常量档；真改了阈值就重建一台 —— 语义上也说得通：
     换判据不该继承旧判据攒下的连续失败。 */
  return useMemo(() => createOfflineGate(threshold), [threshold]);
}
