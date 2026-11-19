"use client";

// ── 「当前是不是桌面壳、页签栏该放哪」的探测（规范 17 §17.2 第②层）
// 判据本体在 `~/lib/shell/title-bar-derive`，这里只解决「客户端探测怎么接进 React」。
// 两个消费点（`ShellTabs` / `AppShell`）必须共用这一处，各自写一遍就会出现
// 「壳里两条栏、浏览器里零条栏」这种两边单独看都自洽的错。

import { useSyncExternalStore } from "react";

import { isDesktopShell } from "~/lib/shell/desktop-shell-client";
import { shouldUseTitleBarTabs } from "~/lib/shell/title-bar-derive";

/**
 * 页签栏是否由窗口标题行承载（桌面壳 true / 浏览器、dev false）。
 * SSR 首帧恒 false（没有 window），客户端 hydration 后取真实值。
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
