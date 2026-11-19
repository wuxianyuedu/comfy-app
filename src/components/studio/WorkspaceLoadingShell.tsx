"use client";

import type { ReactNode } from "react";

import { PROJECTS_ENTRY, sidebarNavItems } from "./NavItems";
import { ShellFullPage } from "./ShellFullPage";

/**
 * 工作区路由级加载壳（ISSUE #4511）。
 *
 * 左侧导航侧栏直接渲染**真实的固定项**（`sidebarNavItems()` 注册表）—— 导航项
 * 是静态注册表数据，不依赖任何请求，加载期间它就该是「已经在了」的样子；
 * 骨架只落在右侧内容区，形状由调用方按对应页面的布局给。
 *
 * 视觉口径与 `AppShell` 的侧栏一致（宽度 `w-40` = 10rem、分组 `p-2`、行高
 * `h-8`、`text-sm`、图标 `[&_svg]:size-4`），加载结束切到真壳时侧栏不跳变。
 * 非交互（行是 div 不是按钮）：加载态里页面尚未就绪，导航本就点不动。
 *
 * 仍套 `ShellFullPage` —— 路由 boundary 显示时 `ShellTabs` 及其标题行已卸载，
 * 必须自带精简标题行（ISSUE #1794）。
 */
export function WorkspaceLoadingShell({ children }: { children: ReactNode }) {
  const navItems = sidebarNavItems();
  return (
    <ShellFullPage>
      <div aria-label="工作区加载中" className="flex min-h-0 flex-1 overflow-hidden" role="status">
        {/* 左侧导航侧栏：固定项真实渲染，不参与加载（ISSUE #4511 第 2 条）。 */}
        <nav
          aria-label="主导航"
          className="border-border-strong bg-sidebar text-sidebar-foreground hidden w-40 shrink-0 flex-col overflow-y-auto border-r p-2 md:flex"
        >
          <div className="p-2">
            <ul className="flex w-full min-w-0 flex-col gap-0">
              {navItems.map((item) => (
                <li key={item.id}>
                  <div className="flex h-8 w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm [&_svg]:size-4 [&_svg]:shrink-0">
                    {item.icon}
                    <span className="truncate">{item.label}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          {/* 侧栏的「项目」分组入口：与真壳同一注册表（`PROJECTS_ENTRY`）。
              分组里列的项目是动态数据（canvas-store），加载态不列。 */}
          <div className="p-2">
            <div className="flex h-8 w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm [&_svg]:size-4 [&_svg]:shrink-0">
              {PROJECTS_ENTRY.icon}
              <span className="truncate">{PROJECTS_ENTRY.label}</span>
            </div>
          </div>
        </nav>

        {/* 内容区：骨架形状由调用方按对应页面的布局给。 */}
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </ShellFullPage>
  );
}
