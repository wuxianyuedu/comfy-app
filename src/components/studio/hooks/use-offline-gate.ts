"use client";

// ── 在线判定的连续失败迟滞（ComfyUI 是否在线的「去抖」原语）───────────
//
// ComfyUI 在跑图时，后端代理接口（`/system_stats`、`/queue`）会偶发变慢或单拍
// 网络抖动，于是回包里带 `online:false`——但 ComfyUI 其实一直在线。状态栏里
// 「显存/内存」与「排队/当前执行」两格都各自轮询一条通道判定在线，若「一次失败
// 就翻离线」，就会忽明忽暗（本次修复的原始症状）。
//
// 本原语把这条判据收口成一处，供 stats 与 queue 两路复用（规范 §12.18 复用优先：
// 与其在两个 hook 各抄一份计数器，不如写一次）：任一次在线立即清零；连续失败
// 达阈值才「提交离线」，阈值之内处于容忍期。
//
// 注意：这里只负责「该不该算在线」的状态机，不碰各自的 setState / 轮询节奏；
// 调用方拿到 `observe` 的返回后自行决定「保留上一次好数据」还是「翻离线」。

import { useCallback, useRef } from "react";

/** 默认连续失败阈值：3 次。stats 每 4s、queue 每 2s 轮询，3 次容忍分别约 12s / 6s
 *  才报离线——既滤掉瞬时抖动，又不会在真掉线时拖太久。 */
export const DEFAULT_OFFLINE_THRESHOLD = 3;

/**
 * @param threshold 连续失败多少次才提交离线
 * @returns `observe(online)` 喂入本次探测结果，返回「此刻是否仍应视为在线」——
 *   在线时为 true；离线但在容忍期内时也为 true（调用方据此保留上一次好数据）；
 *   连续失败达阈值时返回 false（调用方翻离线）。
 */
export function useOfflineGate(
  threshold: number = DEFAULT_OFFLINE_THRESHOLD,
): (online: boolean) => boolean {
  const failRef = useRef(0);
  return useCallback(
    (online: boolean) => {
      if (online) {
        failRef.current = 0;
        return true;
      }
      failRef.current += 1;
      return failRef.current < threshold;
    },
    [threshold],
  );
}
