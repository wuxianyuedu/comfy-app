"use client";

import React from "react";
import Link from "next/link";
import { NAV_ITEMS, type WorkspaceView } from "./nav-items";

// Re-export `WorkspaceView` so existing imports like
//   `import type { WorkspaceView } from "./WorkspaceNav"`
// keep working. The canonical source is `./nav-items`.
export type { WorkspaceView } from "./nav-items";

interface WorkspaceNavProps {
  active: WorkspaceView;
  onSelect: (id: WorkspaceView) => void;
}

/**
 * Narrow left sidebar used in non-home views.
 *
 * Items + icons are sourced from `./nav-items` to keep them in sync with the
 * `<HomePage>` inline sidebar (which mirrors this list).
 */
export function WorkspaceNav({ active, onSelect }: WorkspaceNavProps) {
  return (
    <nav className="flex h-full w-[64px] shrink-0 flex-col items-center gap-1 border-r border-white/[0.06] bg-[#0a0a0f]/85 py-4 backdrop-blur-sm">
      {/* Logo / Brand mark */}
      <Link
        href="/workspace"
        className="mb-5 flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/12 text-violet-400 ring-1 ring-violet-500/30"
        title="Comfy-APP"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
      </Link>

      {NAV_ITEMS.map((item) => {
        const isActive = active === item.id;
        const isEnabled = item.enabled !== false;
        return (
          <button
            key={item.id}
            type="button"
            disabled={!isEnabled}
            onClick={() => isEnabled && onSelect(item.id)}
            className={`group flex h-[42px] w-[42px] flex-col items-center justify-center rounded-xl transition-all ${
              isActive
                ? "bg-white/[0.08] text-white shadow-sm shadow-black/20"
                : isEnabled
                  ? "text-gray-500 hover:bg-white/[0.04] hover:text-gray-300"
                  : "cursor-not-allowed text-gray-700 opacity-50"
            }`}
            title={isEnabled ? item.label : `${item.label}（即将推出）`}
            aria-current={isActive ? "page" : undefined}
          >
            {item.icon}
            <span
              className={`mt-0.5 text-[10px] leading-none ${
                isActive ? "text-gray-200" : isEnabled ? "text-gray-600 group-hover:text-gray-400" : "text-gray-700"
              }`}
            >
              {item.label}
            </span>
          </button>
        );
      })}

      <div className="mt-auto" />

      {/* Settings */}
      <Link
        href="/settings"
        className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-600 transition-colors hover:bg-white/[0.04] hover:text-gray-400"
        title="设置"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
      </Link>
    </nav>
  );
}
