"use client";

import React from "react";
import { cn } from "@/lib/utils";

/* ── Updream-style App Shell ───────────────────────────────
  Five-zone full-screen dark layout:
  ┌─────────────────────────────────────────────────────┐
  │                    TopBar (48px)                     │
  ├────┬────────────────────────────────────┬───────────┤
  │    │                                    │           │
  │ L  │          CanvasArea                │  Right    │
  │ e  │     (ReactFlow / content)          │  Panel    │
  │ f  │                                    │ (360px)   │
  │ t  │                                    │           │
  │(48│                                    │           │
  │px)│                                    │           │
  │    ├────────────────────────────────────┤           │
  │    │        BottomBar (64px)            │           │
  └────┴────────────────────────────────────┴───────────┘

  NOTE: 组件本身是纯布局壳，但 React Flow / Tauri 页面都是 Client Component，
  且它们直接 import 本壳。若移除 "use client"，Client Component 无法直接 import
  Server Component。因此这里保留 "use client"，并在使用处由客户端页面消费。
  如果未来某个页面是纯 Server Component，应把 AppShell 作为 children 传入，
  而不是直接 import。
*/

export interface AppShellProps {
  /** Top bar content */
  topBar?: React.ReactNode;
  /** Left toolbar (vertical icon bar) */
  leftToolbar?: React.ReactNode;
  /** Main canvas / content area */
  children: React.ReactNode;
  /** Right slide-out panel */
  rightPanel?: React.ReactNode;
  /** Bottom bar (chat input + timeline) */
  bottomBar?: React.ReactNode;
  /** Whether right panel is visible */
  rightPanelOpen?: boolean;
  /** Class for the shell root */
  className?: string;
}

export function AppShell({
  topBar,
  leftToolbar,
  children,
  rightPanel,
  bottomBar,
  rightPanelOpen = false,
  className,
}: AppShellProps) {
  return (
    <div
      className={cn(
        "studio-shell flex h-screen w-screen flex-col overflow-hidden bg-surface-0 text-ink",
        className
      )}
    >
      {/* ── Top Bar ── */}
      {topBar && (
        <header
          aria-label="顶部工具栏"
          className="flex shrink-0 items-center border-b border-border-subtle bg-surface-1/95 px-4 backdrop-blur-md"
        >
          {topBar}
        </header>
      )}

      {/* ── Main Body: Left | Canvas+Bottom | Right ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Toolbar */}
        {leftToolbar && (
          <aside
            aria-label="左侧工具栏"
            className="flex shrink-0 flex-col items-center border-r border-border-subtle bg-surface-1/95 py-3 backdrop-blur-md"
          >
            {leftToolbar}
          </aside>
        )}

        {/* Center: Canvas + Bottom */}
        <main
          aria-label="主画布"
          className="relative flex min-w-0 flex-1 flex-col overflow-hidden"
        >
          <div className="relative flex-1 overflow-hidden">{children}</div>
          {bottomBar && (
            <div
              aria-label="底部栏"
              className="shrink-0 border-t border-border-subtle bg-surface-1/95 backdrop-blur-md"
            >
              {bottomBar}
            </div>
          )}
        </main>

        {/* Right Panel — 始终渲染 DOM，用 CSS transition 控制显隐 */}
        <aside
          aria-label="属性面板"
          role="complementary"
          aria-hidden={!rightPanelOpen}
          className={cn(
            "shrink-0 overflow-y-auto border-l border-border-subtle bg-surface-1/98 backdrop-blur-md transition-all duration-300 ease-out",
            rightPanelOpen
              ? "w-[var(--panel-right-width)] opacity-100"
              : "w-0 opacity-0 pointer-events-none"
          )}
        >
          {rightPanel}
        </aside>
      </div>
    </div>
  );
}
