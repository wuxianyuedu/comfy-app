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
  /** 打开设置。传入后设置图标点击触发回调（overlay 模式），
   *  缺省时保留原行为——跳转到 /settings 独立路由。 */
  onOpenSettings?: () => void;
}

/**
 * Narrow left sidebar used in non-home views.
 *
 * Items + icons are sourced from `./nav-items` to keep them in sync with the
 * `<HomePage>` inline sidebar (which mirrors this list).
 */
export function WorkspaceNav({
  active,
  onSelect,
  onOpenSettings,
}: WorkspaceNavProps) {
  return (
    <nav className="flex h-full w-[64px] shrink-0 flex-col items-center gap-1 border-r border-(--color-border-subtle) bg-(--color-canvas)/85 py-4 backdrop-blur-sm">
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
                ? "bg-(--color-primary)/16 text-(--color-ink-bright) shadow-sm shadow-black/5"
                : isEnabled
                  ? "text-(--color-ink-muted) hover:bg-(--color-subtle) hover:text-(--color-ink-strong)"
                  : "cursor-not-allowed text-(--color-ink-fainter) opacity-50"
            }`}
            title={isEnabled ? item.label : `${item.label}（即将推出）`}
            aria-current={isActive ? "page" : undefined}
          >
            {item.icon}
            <span
              className={`mt-0.5 text-[10px] leading-none ${
                isActive ? "text-(--color-ink-bright)" : isEnabled ? "text-(--color-ink-fainter) group-hover:text-(--color-ink-strong)" : "text-(--color-ink-fainter)"
              }`}
            >
              {item.label}
            </span>
          </button>
        );
      })}

      <div className="mt-auto" />

      {/* Settings — workspace 内点击以 overlay 打开（组件树不卸载）；
          独立路由（非 workspace）时由调用方决定是否直接 Link 到 /settings。 */}
      {onOpenSettings ? (
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-(--color-ink-muted) transition-colors hover:bg-(--color-subtle) hover:text-(--color-ink-strong)"
          title="设置"
        >
          <Settings size={17} strokeWidth={1.8} />
        </button>
      ) : (
        <Link
          href="/settings"
          className="flex h-9 w-9 items-center justify-center rounded-xl text-(--color-ink-muted) transition-colors hover:bg-(--color-subtle) hover:text-(--color-ink-strong)"
          title="设置"
        >
          <Settings size={17} strokeWidth={1.8} />
        </Link>
      )}
    </nav>
  );
}
