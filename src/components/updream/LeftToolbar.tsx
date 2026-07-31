"use client";

import React from "react";

/* ── Updream-style Left Toolbar ──────────────────────────
  Vertical icon bar (48px wide):
  📁 Projects   🖼️ Assets   🕐 History   ✂️ Tools
*/

export interface ToolItem {
  id: string;
  icon: React.ReactNode;
  label: string;
  badge?: string | number;
}

const DEFAULT_TOOLS: ToolItem[] = [
  {
    id: "home",
    label: "首页",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    id: "create",
    label: "生成",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
  },
  {
    id: "projects",
    label: "作品",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
      </svg>
    ),
  },
  {
    id: "assets",
    label: "资源",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5L5 21" />
      </svg>
    ),
  },
  {
    id: "history",
    label: "历史",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    id: "tools",
    label: "工具",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
      </svg>
    ),
  },
];

export interface LeftToolbarProps {
  /** Active tool id */
  activeId?: string;
  /** Called when tool clicked */
  onSelect?: (id: string) => void;
  /** Custom tool list (defaults to built-in) */
  tools?: ToolItem[];
  /** Extra bottom items (below divider) */
  bottomItems?: React.ReactNode;
}

export function LeftToolbar({
  activeId,
  onSelect,
  tools = DEFAULT_TOOLS,
  bottomItems,
}: LeftToolbarProps) {
  return (
    <div className="flex h-full w-12 flex-col items-center gap-1 py-2">
      {/* Tool buttons */}
      {tools.map((tool) => {
        const isActive = tool.id === activeId;
        return (
          <button
            key={tool.id}
            type="button"
            onClick={() => onSelect?.(tool.id)}
            className={`group relative flex h-10 w-10 items-center justify-center rounded-xl transition-all ${
              isActive
                ? "bg-violet-500/15 text-violet-300 shadow-sm shadow-violet-500/10"
                : "text-gray-500 hover:bg-white/6 hover:text-gray-300"
            }`}
            title={tool.label}
          >
            {tool.icon}
            {/* Badge */}
            {tool.badge != null && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium leading-none text-white">
                {tool.badge}
              </span>
            )}
            {/* Tooltip */}
            <span className="pointer-events-none absolute left-full ml-2 hidden whitespace-nowrap rounded-md bg-gray-800 px-2 py-1 text-xs text-gray-200 opacity-0 shadow-lg transition-opacity group-hover:block group-hover:opacity-100">
              {tool.label}
            </span>
          </button>
        );
      })}

      {/* Spacer */}
      <div className="mt-auto flex flex-col items-center gap-1">
        {bottomItems}
      </div>
    </div>
  );
}
