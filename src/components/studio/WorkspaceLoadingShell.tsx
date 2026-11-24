"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

import { PROJECTS_ENTRY, sidebarNavItems } from "./NavItems";
import { ShellFullPage } from "./ShellFullPage";

/** 停留多久还没就绪就给提示（正常路由切换远用不到这么久）。 */
const STALLED_AFTER_MS = 30_000;

/** 停留超时的可行动提示（ISSUE #4968）：不再无声地按在骨架上。 */
const STALLED_HINT =
  "页面加载已超过 30 秒仍未就绪：可刷新页面重试；反复出现时重启应用，并查看 log/current/ 下的服务日志。";

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
  /* 停留超时提示（ISSUE #4968）：加载壳是路由级的「应许状态」，但真被卡住时
     （实测：某 webview 环境里页面流停住）它会把用户无声地按在骨架上 —— 给一条
     可行动的出口。30s 内的正常加载触达不到它。用全局 setTimeout（浏览器里与
     window.setTimeout 同一函数；单测的假时钟只 patch 全局这一份）。 */
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setStalled(true), STALLED_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
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
                  <div
                    className={cn(
                      "flex h-8 w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm [&_svg]:size-4 [&_svg]:shrink-0",
                      /* 未上线的占位项与真壳同形置灰：加载态切到真壳时侧栏不该跳一下
                         （真壳里 disabled 的 SidebarMenuButton 带 opacity-50）。 */
                      item.enabled === false && "opacity-50",
                    )}
                  >
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

        {/* 内容区：骨架形状由调用方按对应页面的布局给；停留超时先给可行动提示。 */}
        <div className="flex min-w-0 flex-1 flex-col">
          {stalled ? (
            <div
              className="border-border-strong bg-surface-2 text-ink m-3 rounded-lg border p-3 text-sm"
              role="alert"
            >
              {STALLED_HINT}
            </div>
          ) : null}
          {children}
        </div>
      </div>
    </ShellFullPage>
  );
}
