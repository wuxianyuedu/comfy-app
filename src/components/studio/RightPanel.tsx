"use client";

import React from "react";

/* ── Updream-style Right Panel ───────────────────────────
  Slide-out panel (360px) with tabbed content:
  Skills | Characters | Properties | VideoQueue
*/

export type RightPanelTab =
  | "skills"
  | "characters"
  | "properties"
  | "video";

const TABS: { id: RightPanelTab; label: string }[] = [
  { id: "skills", label: "技能" },
  { id: "characters", label: "角色" },
  { id: "properties", label: "属性" },
  { id: "video", label: "视频" },
];

export interface RightPanelProps {
  /** Active tab */
  activeTab?: RightPanelTab;
  /** Tab change handler */
  onTabChange?: (tab: RightPanelTab) => void;
  /** Panel title (overrides tab label) */
  title?: string;
  /** Content for each tab */
  children: Record<RightPanelTab, React.ReactNode>;
  /** Header extra (right side of header) */
  headerExtra?: React.ReactNode;
  /** Whether panel is collapsed to icons-only */
  compact?: boolean;
}

export function RightPanel({
  activeTab = "skills",
  onTabChange,
  title,
  children,
  headerExtra,
  compact = false,
}: RightPanelProps) {
  const currentLabel = TABS.find((TABS) => TABS.id === activeTab)?.label ?? activeTab;

  if (compact) {
    return (
      <aside className="flex w-12 shrink-0 flex-col items-center gap-1 border-l border-white/6 bg-(--color-panel)/98 py-3 backdrop-blur-md">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange?.(tab.id)}
            className={`flex h-9 w-9 items-center justify-center rounded-lg text-xs transition-colors ${
              tab.id === activeTab
                ? "bg-violet-500/15 text-violet-300"
                : "text-gray-500 hover:bg-white/6 hover:text-gray-300"
            }`}
            title={tab.label}
          >
            {tab.label[0]}
          </button>
        ))}
      </aside>
    );
  }

  return (
    <aside className="flex w-[360px] max-w-[45vw] shrink-0 flex-col overflow-hidden border-l border-white/6 bg-(--color-panel)/98 backdrop-blur-md">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-white/6 px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="u-title">
            {title ?? currentLabel}
          </h2>
        </div>
        {headerExtra}
      </header>

      {/* Tab bar */}
      <nav className="flex shrink-0 gap-0.5 border-b border-white/6 px-3 pt-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange?.(tab.id)}
            className={`rounded-t-lg px-3 pb-2 text-xs font-medium transition-colors ${
              tab.id === activeTab
                ? "border-b-2 border-violet-400 text-violet-300"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {children[activeTab] ?? (
          <div className="flex h-full items-center justify-center text-sm text-gray-600">
            无内容
          </div>
        )}
      </div>
    </aside>
  );
}
