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
 * useOverlayBoundary —— 锚定浮层（气泡 / 下拉 / 气泡卡）可用的**碰撞边界**。
 *
 * 桌面壳里窗口顶部多一条应用级标题行（`TitleBarTabs`：页签 + 拖拽区 + 窗口按钮），
 * 它按 `z-chrome`(2000) 立在最上。而挂在 TopBar 那排按钮上的气泡默认往上摆
 * （`side="top"`），Base UI 的 `flip` 只对**视口**判溢出 —— 气泡顶部落在视口内、
 * 它就不翻转，于是整块气泡被标题行**盖掉一半**（实测 TopBar 上四个入口全中招）。
 *
 * 抬气泡的层级不是出路：标题行是应用级 chrome，气泡压过它就会吃掉页签与窗口
 * 按钮的可点区域（规范 16 §16.2.5 判据 4）。所以这里把「可用区域」交给定位引擎
 * ——它据此翻转，气泡改从下方展开。
 *
 * **「有没有标题行」不在这里另判**：判据就是 `ShellTabs` 渲染标题行用的那句
 * （`shouldUseTitleBarTabs(isDesktopShell())`）——两处各判一次就会漂成
 * 「一边画了、另一边不认」。**「多高」也不在这里现量**：它就是
 * `--spacing-title-bar` 那 2.25rem（`TITLE_BAR_HEIGHT_REM`），与 `globals.css`
 * 的一致性由 `full-screen-layer.test.ts` 反向核对。量一次
 * `getBoundingClientRect` 看着更「真」，代价是给每个挂着的浮层加一个 effect +
 * DOM 查询 + 一段「元素还没挂上」的空窗期，换来的是一个已被漂移测试钉住的常量。
 *
 * **首帧返回 `null`**（与 `useViewportSize` 同口径）：还不知道视口多大时不摆位，
 * 而不是拿一个假矩形去算。调用处把 `null` 当作「不传这一档」处理。
 *
 * 归属第②层（逻辑层，规范 17 §17.2）：视图只消费返回值，不自己读 window。
 * 算式在 `~/lib/full-screen-layer` 的「锚定浮层」一节。
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
