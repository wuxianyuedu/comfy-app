"use client";

import Link from "next/link";
import { Layers, Settings } from "lucide-react";
import { NAV_ITEMS, type WorkspaceView } from "./NavItems";
import { Button } from "~/components/ui/button";

// 重新导出 `WorkspaceView`，好让既有写法如
// 例如 `import type { WorkspaceView } from "./WorkspaceNav"` 这种写法
// 继续可用。权威来源是 `./nav-items`。
export type { WorkspaceView } from "./NavItems";

interface WorkspaceNavProps {
  active: WorkspaceView;
  onSelect: (id: WorkspaceView) => void;
  /** 打开设置。传入后设置图标点击触发回调（overlay 模式），
   *  缺省时保留原行为——跳转到 /settings 独立路由。 */
  onOpenSettings?: () => void;
}

/**
 * 非首页视图使用的窄左侧栏。
 *
 * 项与图标取自 `./nav-items`，以与
 * <HomePage> 的内联侧栏（镜像同一列表）保持同步。
 */
export function WorkspaceNav({
  active,
  onSelect,
  onOpenSettings,
}: WorkspaceNavProps) {
  return (
    <nav className="border-border-subtle bg-canvas/85 flex h-full w-[64px] shrink-0 flex-col items-center gap-1 border-r py-4 backdrop-blur-sm">
      {/* Logo / 品牌标记 */}
      <Link
        href="/workspace"
        className="mb-5 flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/12 text-violet-700 ring-1 ring-violet-500/30 dark:text-violet-400"
        title="Comfy-APP"
      >
        <Layers size={20} />
      </Link>

      {NAV_ITEMS.map((item) => {
        const isActive = active === item.id;
        const isEnabled = item.enabled !== false;
        return (
          <Button
            key={item.id}
            variant="ghost"
            disabled={!isEnabled}
            onClick={() => isEnabled && onSelect(item.id)}
            className={`group flex h-[42px] w-[42px] flex-col items-center justify-center rounded-xl p-0 font-normal ${
              isActive
                ? "bg-primary/16 text-ink-bright hover:bg-primary/16 shadow-sm shadow-black/5 dark:shadow-black/5"
                : isEnabled
                  ? "text-ink-muted hover:bg-subtle hover:text-ink-strong"
                  : "text-ink-fainter cursor-not-allowed opacity-50"
            }`}
            title={isEnabled ? item.label : `${item.label}（即将推出）`}
            aria-current={isActive ? "page" : undefined}
          >
            {item.icon}
            <span
              className={`mt-0.5 text-[10px] leading-none ${
                isActive
                  ? "text-ink-bright"
                  : isEnabled
                    ? "text-ink-fainter group-hover:text-ink-strong"
                    : "text-ink-fainter"
              }`}
            >
              {item.label}
            </span>
          </Button>
        );
      })}

      <div className="mt-auto" />

      {/* Settings — workspace 内点击以 overlay 打开（组件树不卸载）；
          独立路由（非 workspace）时由调用方决定是否直接 Link 到 /settings。 */}
      {onOpenSettings ? (
        <Button
          variant="ghost"
          size="icon-lg"
          onClick={onOpenSettings}
          className="text-ink-muted hover:bg-subtle hover:text-ink-strong rounded-xl"
          title="设置"
        >
          <Settings size={17} strokeWidth={1.8} />
        </Button>
      ) : (
        <Link
          href="/settings"
          className="text-ink-muted hover:bg-subtle hover:text-ink-strong flex h-9 w-9 items-center justify-center rounded-xl transition-colors"
          title="设置"
        >
          <Settings size={17} strokeWidth={1.8} />
        </Link>
      )}
    </nav>
  );
}
