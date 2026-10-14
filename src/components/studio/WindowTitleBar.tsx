"use client";

/* ── WindowTitleBar · 精简窗口标题行（没有应用内容的整屏路由页用）──────────
 *
 * 为什么需要它：`ShellTabs`（含 `TitleBarTabs`）渲染在 `app/layout` 的
 * children 里，而错误页 / 404 / 全局错误 / 登录页这些**整屏路由页**一旦显示，
 * 替换掉的正是那整个 children —— 页签与最小化 / 最大化 / **关闭**按钮跟着
 * 一起离开 DOM。ISSUE #1794 那次修复（`FULL_PAGE_CLEARANCE_CLASS` 的
 * `top-title-bar`）假设「标题行还在，让出它就行」；可真相是标题行本身被卸载
 * 了，让出来的是一条空带，窗口按钮根本不在页面上 —— 用户看到「页面出错了」
 * 的同时失去关闭窗口的能力，而这往往是他此刻唯一想做的事（反馈原话：
 * *这个处理过，为什么现在还是有问题，还是会盖住*）。
 *
 * 所以整屏路由页要**自带**一条标题行。它是精简版：只有拖拽区与三个窗口
 * 按钮，没有页签（页签属于 `ShellTabs` 的应用内状态，错误页没有可切的东西）。
 * 按钮与拖拽判据全部走 `./WindowControls` 的共享实现（与 `TitleBarTabs`
 * 同一份，不重写第二份）。
 *
 * 自带 `TooltipProvider`：`global-error` 替换整个根布局，拿不到根布局里的
 * Provider，而按钮的悬停提示走 `ui/hint`（P82 唯一出口）—— 少这一层，
 * 兜底页的 tooltip 会静默不弹。
 *
 * 层级必须给 `TITLE_BAR_CHROME_CLASS`（`relative z-chrome`）：几何让位管
 * 「不被盖住」，管不了「可点」（ISSUE #310 第三次回归的同一判据）。
 */

import { TooltipProvider } from "~/components/ui/tooltip";
import {
  TITLE_BAR_CHROME_CLASS,
  TITLE_BAR_HEIGHT_CLASS,
} from "~/lib/full-screen-layer";
import { cn } from "~/lib/utils";

import {
  useTitleBarDrag,
  useWindowMaximized,
  WindowControls,
} from "./WindowControls";
import { useTitleBarTabsActive } from "./hooks/use-title-bar-tabs-active";

/**
 * 精简窗口标题行：拖拽区 + 最小化 / 最大化-还原 / 关闭。
 *
 * 非桌面壳（浏览器 / dev）下渲染 `null` —— 那条标题行由系统窗口自己提供，
 * 再画一条既重复又占纵向空间（与 `ShellTabs` 同一个判据、同一个 hook）。
 */
export function WindowTitleBar() {
  const useTitleBar = useTitleBarTabsActive();
  const [maximized, setMaximized] = useWindowMaximized();
  const drag = useTitleBarDrag(setMaximized);

  if (!useTitleBar) return null;

  return (
    <TooltipProvider>
      {/* `data-slot="title-bar"` 与 `TitleBarTabs` 一致：e2e 按它断言
          「应用顶部这条 chrome 在不在」（overlay-boundary.spec.ts）。 */}
      <div
        data-slot="title-bar"
        data-no-drag
        className={cn(
          TITLE_BAR_HEIGHT_CLASS,
          TITLE_BAR_CHROME_CLASS,
          "border-border-subtle bg-panel flex shrink-0 items-stretch border-b select-none",
        )}
        onPointerDown={drag.onPointerDown}
        onDoubleClick={drag.onDoubleClick}
      >
        {/* 拖拽空白区：没有页签可放，它在按钮左侧占满余量（按钮自带
            data-no-drag，落在它上面的点击不会被拖拽吞掉）。
            这一格必须显式占位（`flex-1`）—— 它是把 `WindowControls` 推到**右端**
            的那只手。`TitleBarTabs` 里同样的位置有一份 `min-w-2 flex-1`，此前这一
            条漏了它，于是在 404 / 错误页这类整屏页上三个窗口按钮整排落在左上角，
            与别的页面（以及系统标题栏）相反；按钮本身还在、也点得动，所以门禁与
            用例都判不出来（ISSUE #1918）。 */}
        <div className="min-w-2 flex-1" aria-hidden />
        <WindowControls
          maximized={maximized}
          onMaximizedChange={setMaximized}
        />
      </div>
    </TooltipProvider>
  );
}
