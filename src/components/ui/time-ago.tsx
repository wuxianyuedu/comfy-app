"use client";

/**
 * `time-ago.tsx` — 相对时间的**水合安全**出口（ISSUE #4852）。
 * @module ui/time-ago — 挂载前渲染稳定占位、挂载后显示真实相对时间
 *
 * `timeAgo()` 在渲染期取 `Date.now()`：服务端渲染与客户端水合之间跨过分钟
 * 边界，同一份时间会算出两个文案 —— React 19 判定水合失配后把整棵树在
 * 客户端重新生成（工作区页签的 pending 载荷与临时 state 被一起清掉，
 * 用户感知是「点了一下跳回首页」）。
 *
 * 口径（§16 / §8 同批记录）：**挂载前渲染稳定占位**（与「刚刚」同形），
 * 挂载后再显示真实相对时间 —— 文案在挂载后才变化，不属于水合失配。
 */

import { useSyncExternalStore } from "react";

import { timeAgo } from "~/lib/time-format";

const emptySubscribe = () => () => undefined;

/** 是否已挂载（客户端）：SSR 与水合首帧都是 `false`，挂载后翻 `true`。
 *  用 `useSyncExternalStore` 而不是「useEffect 里 setState」——前者不需要
 *  豁免 react/set-state-in-effect（清零规则集在管它）。 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

export type TimeAgoProps = {
  /** timeAgo 返回 null（超过 maxDays）时的兜底文案。 */
  fallback?: string;
  maxDays?: number;
  /** 水合前的稳定占位；缺省与「刚刚」同形（带后缀）。 */
  placeholder?: string;
  suffix?: string;
  value: string | number;
};

export function TimeAgo({ value, suffix, maxDays, fallback, placeholder }: TimeAgoProps) {
  const mounted = useMounted();
  const stable = placeholder ?? `刚刚${suffix ?? ""}`;
  if (!mounted) {
    return <>{stable}</>;
  }
  return <>{timeAgo(value, { suffix, maxDays }) ?? fallback ?? stable}</>;
}
