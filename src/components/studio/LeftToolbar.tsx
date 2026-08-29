"use client";

import React from "react";
import { Clock, Folder, Home, Image as ImageIcon, Wrench, Zap } from "lucide-react";

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
      <Home size={20} strokeWidth={1.8} />
    ),
  },
  {
    id: "create",
    label: "生成",
    icon: (
      <Zap size={20} strokeWidth={1.8} />
    ),
  },
  {
    id: "projects",
    label: "作品",
    icon: (
      <Folder size={20} strokeWidth={1.8} />
    ),
  },
  {
    id: "assets",
    label: "资源",
    icon: (
      <ImageIcon size={20} strokeWidth={1.8} />
    ),
  },
  {
    id: "history",
    label: "历史",
    icon: (
      <Clock size={20} strokeWidth={1.8} />
    ),
  },
  {
    id: "tools",
    label: "工具",
    icon: (
      <Wrench size={20} strokeWidth={1.8} />
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
