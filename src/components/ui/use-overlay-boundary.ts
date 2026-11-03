"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  anchoredOverlayBoundary,
  titleBarHeightPx,
  type ViewportRect,
} from "~/lib/full-screen-layer";
import { isDesktopShell } from "~/lib/shell/desktop-shell-client";
import { useViewportSize } from "~/components/ui/use-viewport-size";

/**
 * useOverlayBoundary —— 锚定浮层（气泡 / 下拉 / 气泡卡）可用的碰撞边界。
 * 桌面壳顶部多一条应用级标题行（`TitleBarTabs`，`z-chrome` 2000），挂在 TopBar 上的气泡默认 `side="top"`，Base UI 的 `flip` 只对视口判溢出 → 整块气泡被标题行盖掉一半（实测四个入口全中招）。抬层级不是出路（会吃掉页签与窗口按钮的可点区域，§16.2.5 判据 4），这里把可用区域交给定位引擎翻转。
 * 「有没有标题行」复用 `shouldUseTitleBarTabs(isDesktopShell())`，「多高」用 `--spacing-title-bar`（`TITLE_BAR_HEIGHT_REM`），一致性由 `full-screen-layer.test.ts` 反向核对；首帧返回 `null`（同 `useViewportSize`），调用处当作「不传这一档」。
 */
export function useOverlayBoundary(): ViewportRect | null {
  const viewport = useViewportSize();
  /* 壳探测只能在客户端进行（SSR 无 window）。用 `useSyncExternalStore` 取快照 ——
   * 与 `ShellTabs` 同一口径（规范 08 §8.6：不在 effect 里 set-state）。快照是
   * **布尔**，身份天然稳定，不会触发重渲染循环。 */
  const inShell = useSyncExternalStore(
    useCallback(() => () => undefined, []),
    () => isDesktopShell(),
    () => false,
  );
  return anchoredOverlayBoundary(viewport, inShell ? titleBarHeightPx() : 0);
}
