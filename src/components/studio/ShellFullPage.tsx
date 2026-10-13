"use client";

import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

import { WindowTitleBar } from "./WindowTitleBar";
import { useTitleBarTabsActive } from "./hooks/use-title-bar-tabs-active";

/**
 * 整屏路由页的外壳 —— 错误页 / 404 / 全局错误 / 登录页 / 挂载加载态共用。
 *
 * 为什么必须有这一层：这些页面显示时替换掉的是 `app/layout` 的**整个
 * children**，`ShellTabs`（含 `TitleBarTabs` 与右上角的窗口按钮）跟着一起
 * 卸载。ISSUE #1794 的修法（`FULL_PAGE_CLEARANCE_CLASS` 的 `top-title-bar`）
 * 让出的是一条**已经不在 DOM 里**的标题行 —— 按钮不是被盖住，是整排消失，
 * 于是「处理过还是会被盖住」。正确形态是页面**自带**一条精简标题行
 * （`WindowTitleBar`，无页签、只有拖拽区与三个窗口按钮）。
 *
 * 结构：`flex-col` + 视口高（`h-dvh`，壳里 ≈ ShellTabs 的 `h-screen`；
 * 不用 `h-screen` 字面量 —— `check-title-bar-clearance.cjs` 第四条禁
 * `src/app/**` 写视口高度，整屏页面必须显式让位 / 自承高度）→ 标题行 →
 * 内容区（`flex-1 min-h-0 overflow-y-auto`：自己滚，多出来的内容不被裁）。
 *
 * `data-shell` 与 `ShellTabs` 同款：壳态下让全局 CSS 的侧栏让位规则与
 * 标题行高度相关的变量口径在这棵子树里同样成立（错误页没有侧栏，
 * 但精简标题行的高度量取自同一套 `--spacing-title-bar`）。
 *
 * 浏览器 / dev 形态：不渲染标题行（系统窗口自带），内容区照旧占满视口。
 */
export function ShellFullPage({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const useTitleBar = useTitleBarTabsActive();
  return (
    <div
      data-shell={useTitleBar ? "" : undefined}
      className={cn(
        "bg-canvas text-ink flex h-dvh flex-col overflow-hidden",
        className,
      )}
    >
      {useTitleBar ? <WindowTitleBar /> : null}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
