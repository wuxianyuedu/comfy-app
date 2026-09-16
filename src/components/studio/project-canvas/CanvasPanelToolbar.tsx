"use client";

import React from "react";
import { Clock, Folder } from "lucide-react";

export type CanvasPanelType = "materials" | "history" | null;

interface CanvasPanelToolbarProps {
  /** Currently open panel (null = none) */
  active: CanvasPanelType;
  /** Called when user toggles a panel */
  onSelect: (panel: CanvasPanelType) => void;
  /**
   * When true: renders as a floating absolute-positioned element in the canvas
   * (used when no panel is open).
   * When false: renders as an inline flex child (used inside the panel container,
   *  vertically centered alongside the panel).
   */
  floating?: boolean;
}

/**
 * Vertical toolbar for toggling material-library / history panels.
 *
 * Two modes:
 * - **Floating** (`floating=true`, default): absolutely positioned in canvas at left-3.
 * - **Inline** (`floating=false`): normal flex child, sits to the left of the open panel.
 */
export function CanvasPanelToolbar({
  active,
  onSelect,
  floating = true,
}: CanvasPanelToolbarProps) {
  const items: { id: CanvasPanelType; label: string; icon: React.ReactNode }[] =
    [
      {
        id: "materials",
        label: "素材库",
        icon: <Folder size={20} strokeWidth={1.8} />,
      },
      {
        id: "history",
        label: "历史记录",
        icon: <Clock size={20} strokeWidth={1.8} />,
      },
    ];

  return (
    <div
      className={`border-border-strong bg-panel/95 dark:shadow-black/50p-blur-md flex flex-col items-center gap-1 rounded-2xl border p-1.5 shadow-xl shadow-black/20 backdrop-blur ${
        floating
          ? "absolute top-1/2 left-3 z-20 -translate-y-1/2"
          : "shrink-0 self-center"
      }`}
    >
      {items.map((item) => {
        const isActive = active === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(isActive ? null : item.id)}
            title={item.label}
            className={`group relative flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-150 ${
              isActive
                ? "bg-violet-500/20 text-violet-700 shadow-sm ring-1 shadow-violet-500/10 ring-violet-500/25 dark:text-violet-300"
                : "text-ink-muted hover:bg-subtle hover:text-ink-soft"
            }`}
          >
            {item.icon}
            {/* Tooltip — show right of button on hover or when active */}
            <span
              className={`border-border-strong bg-panel/95 text-ink-soft pointer-events-none absolute left-full ml-2.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium whitespace-nowrap shadow-xl shadow-black/40 backdrop-blur-sm transition-opacity ${
                isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              }`}
            >
              {item.label}
            </span>
          </button>
        );
      })}
      {/* 分隔线 */}
      <div className="bg-border-strong mx-1 my-0.5 h-px w-6" />
    </div>
  );
}
