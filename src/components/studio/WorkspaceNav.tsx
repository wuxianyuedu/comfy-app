"use client";

import Link from "next/link";
import { Layers, Settings } from "lucide-react";
import { NAV_ITEMS, type WorkspaceView } from "./NavItems";

// Re-export `WorkspaceView` so existing imports like
//   `import type { WorkspaceView } from "./WorkspaceNav"`
// keep working. The canonical source is `./nav-items`.
export type { WorkspaceView } from "./NavItems";

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
    <nav className="flex h-full w-[64px] shrink-0 flex-col items-center gap-1 border-r border-white/6 bg-(--color-canvas)/85 py-4 backdrop-blur-sm">
      {/* Logo / Brand mark */}
      <Link
        href="/workspace"
        className="mb-5 flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/12 text-violet-400 ring-1 ring-violet-500/30"
        title="Comfy-APP"
      >
        <Layers size={20} />
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
                ? "bg-white/8 text-white shadow-sm shadow-black/20"
                : isEnabled
                  ? "text-gray-500 hover:bg-white/4 hover:text-gray-300"
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
        className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-600 transition-colors hover:bg-white/4 hover:text-gray-400"
        title="设置"
      >
        <Settings size={17} strokeWidth={1.8} />
      </Link>
    </nav>
  );
}
