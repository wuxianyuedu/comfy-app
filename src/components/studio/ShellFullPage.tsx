"use client";

import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

import { WindowTitleBar } from "./WindowTitleBar";
import { useTitleBarTabsActive } from "./hooks/use-title-bar-tabs-active";

/**
 * 整屏路由页的外壳 —— 错误页 / 404 / 全局错误 / 登录页 / 挂载加载态共用。这些页面显示时替换掉 `app/layout` 的**整个 children**，`ShellTabs`（含 `TitleBarTabs` 与右上角窗口按钮）跟着卸载：ISSUE #1794 的修法（`FULL_PAGE_CLEARANCE_CLASS` 的 `top-title-bar`）让出的是**已不在 DOM 里**的标题行 —— 按钮不是被盖住，是整排消失；正确形态是页面**自带**一条精简标题行（`WindowTitleBar`）。
 * 结构：`flex-col` + `h-dvh`（不用 `h-screen` 字面量：`check-title-bar-clearance.cjs` 第四条禁 `src/app/**` 写视口高度）→ 标题行（仅壳态）→ `flex-1 min-h-0 overflow-y-auto` 内容区（自己滚，多出来的不被裁）。
 * `data-shell` 只在这类整屏页上打：它的 `WindowTitleBar` 确实是整窗第一行，全局 CSS 的侧栏让位规则与 `--spacing-title-bar` 口径在这棵子树成立。主窗口（`ShellTabs`）自 ISSUE #3807 起把标题行移进内容列、不再打这个标记，两处不要混为一谈；浏览器 / dev 形态不渲染标题行，内容区照旧占满视口。
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
      className={cn("bg-canvas text-ink flex h-dvh flex-col overflow-hidden", className)}
      data-shell={useTitleBar ? "" : undefined}
    >
      {useTitleBar ? <WindowTitleBar /> : null}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </div>
  );
}
