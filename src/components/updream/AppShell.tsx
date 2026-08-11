"use client";

import React from "react";

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
  className = "",
}: AppShellProps) {
  return (
    <div
      className={`updream-shell flex h-screen w-screen flex-col overflow-hidden bg-[#0a0a0f] text-gray-200 ${className}`}
      style={{ fontFamily: 'Inter, "Noto Sans SC", system-ui, -apple-system, sans-serif' }}
    >
      {/* ── Top Bar ── */}
      {topBar && (
        <header className="flex shrink-0 items-center border-b border-white/6 bg-[#14141a]/95 px-4 backdrop-blur-md">
          {topBar}
        </header>
      )}

      {/* ── Main Body: Left | Canvas+Bottom | Right ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Toolbar */}
        {leftToolbar && (
          <aside className="flex shrink-0 flex-col items-center border-r border-white/6 bg-[#14141a]/95 py-3 backdrop-blur-md">
            {leftToolbar}
          </aside>
        )}

        {/* Center: Canvas + Bottom */}
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="relative flex-1 overflow-hidden">{children}</div>
          {bottomBar && (
            <div className="shrink-0 border-t border-white/6 bg-[#14141a]/95 backdrop-blur-md">
              {bottomBar}
            </div>
          )}
        </main>

        {/* Right Panel */}
        {rightPanelOpen && rightPanel && (
          <aside
            className="shrink-0 overflow-y-auto border-l border-white/6 bg-[#14141a]/98 backdrop-blur-md"
            style={{ width: 360, maxWidth: "45vw" }}
          >
            {rightPanel}
          </aside>
        )}
      </div>
    </div>
  );
}
