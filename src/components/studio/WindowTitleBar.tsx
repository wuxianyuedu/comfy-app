"use client";

/* ── WindowTitleBar · 精简窗口标题行（没有应用内容的整屏路由页用）──────────
 * `ShellTabs`（含 `TitleBarTabs`）渲染在 `app/layout` 的 children 里，而错误页 / 404 / 全局错误 / 登录页一旦显示就替换掉整个 children —— 页签与三个窗口按钮跟着离开 DOM；`FULL_PAGE_CLEARANCE_CLASS` 的 `top-title-bar`（ISSUE #1794）假设「标题行还在」，真相是它被卸载了，让出来的是一条空带，用户看到「页面出错了」却失去关闭窗口的能力。
 * 所以整屏路由页自带这条精简标题行：只有拖拽区与三个按钮、没有页签；按钮与拖拽判据走 `./WindowControls`（与 `TitleBarTabs` 同一份）。自带 `TooltipProvider`（`global-error` 替换整个根布局拿不到它，否则兜底页 tooltip 静默不弹）；层级必须给 `TITLE_BAR_CHROME_CLASS`（`relative z-chrome`），几何让位管不了「可点」（ISSUE #310 第三次回归）。
 */

import { TooltipProvider } from "~/components/ui/tooltip";
import { TITLE_BAR_CHROME_CLASS, TITLE_BAR_HEIGHT_CLASS } from "~/lib/full-screen-layer";
import { cn } from "~/lib/utils";

import { useTitleBarDrag, useWindowMaximized, WindowControls } from "./WindowControls";
import { useTitleBarTabsActive } from "./hooks/use-title-bar-tabs-active";

/**
 * 精简窗口标题行：拖拽区 + 最小化 / 最大化-还原 / 关闭。非桌面壳（浏览器 / dev）下渲染 `null` —— 由系统窗口自己提供，再画一条既重复又占纵向空间（与 `ShellTabs` 同一个判据、同一个 hook）。
 */
export function WindowTitleBar() {
  const useTitleBar = useTitleBarTabsActive();
  const [maximized, setMaximized] = useWindowMaximized();
  const drag = useTitleBarDrag(setMaximized);

  if (!useTitleBar) {
    return null;
  }

  return (
    <TooltipProvider>
      {/* `data-slot="title-bar"` 与 `TitleBarTabs` 一致：e2e 按它断言
          「应用顶部这条 chrome 在不在」（overlay-boundary.spec.ts）。 */}
      <div
        className={cn(
          TITLE_BAR_HEIGHT_CLASS,
          TITLE_BAR_CHROME_CLASS,
          "border-border-subtle bg-panel flex shrink-0 items-stretch border-b select-none",
        )}
        data-no-drag
        data-slot="title-bar"
        onDoubleClick={drag.onDoubleClick}
        onPointerDown={drag.onPointerDown}
      >
        {/* 拖拽空白区：没有页签可放，它在按钮左侧占满余量（按钮自带 data-no-drag，落在它上面的点击不会被拖拽吞掉）。
            这一格必须显式占位（`flex-1`）—— 它把 `WindowControls` 推到**右端**。`TitleBarTabs` 同样的位置有一份 `min-w-2 flex-1`，此前这一条漏了它，404 / 错误页上三个按钮整排落在左上角（按钮还在、也点得动，门禁与用例都判不出，ISSUE #1918）。 */}
        <div aria-hidden className="min-w-2 flex-1" />
        <WindowControls maximized={maximized} onMaximizedChange={setMaximized} />
      </div>
    </TooltipProvider>
  );
}
