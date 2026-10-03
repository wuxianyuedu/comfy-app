"use client";

// ── 「当前是不是桌面壳、页签栏该放哪」的探测（规范 17 §17.2 第②层）────────
// 判据本体在 `~/lib/shell/title-bar-derive`（`shouldUseTitleBarTabs`），这里只解决
// 「客户端探测怎么接进 React」。
//
// 这个答案有两个消费点 —— `ShellTabs` 决定要不要渲染标题行页签栏，
// `AppShell` 决定要不要在内容列里渲染视图页签栏。两处各写一遍
// `useSyncExternalStore` 探测，就会出现「壳里两条栏、浏览器里零条栏」这种
// 两边单独看都自洽的错。

import { useSyncExternalStore } from "react";

import { isDesktopShell } from "~/lib/shell/desktop-shell-client";
import { shouldUseTitleBarTabs } from "~/lib/shell/title-bar-derive";

/**
 * 页签栏是否由窗口标题行承载（桌面壳 true / 浏览器、dev false）。
 *
 * SSR 首帧恒 false（没有 window），客户端 hydration 后取真实值 —— 与 `ShellTabs`
 * 此前内联的写法同一判据，只是收在一处。
 */
export function useTitleBarTabsActive(): boolean {
  /* 第一个参数必须内联（react-hooks 的判据）；本值没有事件源，
     订阅函数返回一个空取消器即可。 */
  return useSyncExternalStore(
    () => () => undefined,
    () => shouldUseTitleBarTabs(isDesktopShell()),
    () => false,
  );
}
