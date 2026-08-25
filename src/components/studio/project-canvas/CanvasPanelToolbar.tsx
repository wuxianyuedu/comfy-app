"use client";

import React from "react";

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
export function CanvasPanelToolbar({ active, onSelect, floating = true }: CanvasPanelToolbarProps) {
  const items: { id: CanvasPanelType; label: string; icon: React.ReactNode }[] = [
    {
      id: "materials",
      label: "素材库",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
        </svg>
      ),
    },
    {
      id: "history",
      label: "历史记录",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      ),
    },
  ];

  return (
    <div
      className={`flex flex-col items-center gap-1 rounded-2xl border border-white/[0.07] bg-[#0d0b16]/95 p-1.5 shadow-xl shadow-black/50 backdrop-blur-md ${
        floating ? "absolute top-1/2 z-20 -translate-y-1/2 left-3" : "self-center shrink-0"
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
                ? "bg-violet-500/20 text-violet-300 shadow-sm shadow-violet-500/10 ring-1 ring-violet-500/25"
                : "text-gray-500 hover:bg-white/[0.05] hover:text-gray-300"
            }`}
          >
            {item.icon}
            {/* Tooltip — show right of button on hover or when active */}
            <span
              className={`pointer-events-none absolute left-full ml-2.5 whitespace-nowrap rounded-lg bg-[#16121f]/95 border border-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-gray-300 shadow-xl shadow-black/40 backdrop-blur-sm transition-opacity ${
                isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              }`}
            >
              {item.label}
            </span>
          </button>
        );
      })}
      {/* 分隔线 */}
      <div className="mx-1 my-0.5 h-px w-6 bg-white/[0.06]" />
    </div>
  );
}
