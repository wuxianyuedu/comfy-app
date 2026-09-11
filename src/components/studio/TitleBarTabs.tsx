"use client";

/* ── TitleBarTabs · 把页签搬到窗口「标题行」的自定义标题栏 ────────────
 *
 * 背景（ISSUE #310 / #200）：此前的应用级页签虽然解决了「另弹独立窗口」，
 * 但页签栏渲染在原生标题栏**下方**，等于在应用内又占掉一条 40px 区域。
 * 用户要的是「像文件资源管理器那样」——页签直接显示在窗口标题行。
 *
 * 做法：主窗口关闭原生装饰（`decorations: false`），标题行由本组件接管，
 * 同一条横条里并列「页签 + 拖拽空白区 + 最小化/最大化/关闭」。浏览器 / dev
 * 环境没有原生标题栏可让位（窗口由系统浏览器提供），调用方（ShellTabs）
 * 会退回应用内页签栏——判据见 `shouldUseTitleBarTabs`。
 *
 * 分层（规范 17 §17.2）：
 *  - 本组件是第③层「视图」：只渲染 props + 转发动作，不含 IO；
 *  - 窗口控制（拖拽/最小化/关闭）与最大化状态订阅都走
 *    `src/lib/window-controls-client.ts`（第②层），视图不直接 invoke。
 *
 * 交互细节：
 *  - 拖拽区铺满标题栏，用 `data-no-drag` 标记排除页签与窗口按钮，
 *    否则点击会被拖拽吞掉（判据在 `isDragRegionTarget`）。
 *  - 双击标题栏空白处 = 最大化/还原，与系统标题栏一致。
 */

import { useCallback, useEffect, useState } from "react";
import { Copy, Square, X, Minus } from "lucide-react";
import type { ShellTab } from "~/lib/shell-tabs-store";
import {
  isDragRegionTarget,
  resolveMaximizeButtonKind,
  WINDOW_BUTTON_LABELS,
  type WindowButtonKind,
} from "~/lib/title-bar-derive";
import { TITLE_BAR_HEIGHT_CLASS } from "~/lib/full-screen-layer";
import {
  closeWindow,
  isWindowMaximized,
  minimizeWindow,
  onWindowResized,
  startWindowDrag,
  toggleMaximizeWindow,
} from "~/lib/window-controls-client";

interface TitleBarTabsProps {
  tabs: ShellTab[];
  activeTabId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}

/** 单个页签：标题 + 可选关闭按钮（点击不触发拖拽，见 data-no-drag）。 */
function TitleBarTab({
  tab,
  active,
  onActivate,
  onClose,
}: {
  tab: ShellTab;
  active: boolean;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}) {
  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={0}
      data-no-drag
      onClick={() => onActivate(tab.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate(tab.id);
        }
      }}
      className={`group flex h-full max-w-52 min-w-0 cursor-pointer items-center gap-2 border-r border-(--color-border-subtle) px-3 text-sm transition-colors ${
        active
          ? "bg-(--color-canvas) text-(--color-ink-bright)"
          : "text-(--color-ink-muted) hover:bg-(--color-subtle)/70 hover:text-(--color-ink-strong)"
      }`}
    >
      <span className="truncate">{tab.label}</span>
      {tab.closable && (
        <button
          type="button"
          aria-label={`关闭 ${tab.label}`}
          data-no-drag
          onClick={(e) => {
            e.stopPropagation();
            onClose(tab.id);
          }}
          className="rounded p-0.5 text-(--color-ink-fainter) hover:bg-(--color-subtle) hover:text-(--color-ink-strong)"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

/** 窗口控制按钮（最小化 / 最大化-还原 / 关闭）。 */
function WindowButton({
  kind,
  onClick,
  danger,
}: {
  kind: WindowButtonKind;
  onClick: () => void;
  danger?: boolean;
}) {
  const label = WINDOW_BUTTON_LABELS[kind];
  const icon =
    kind === "minimize" ? (
      <Minus size={14} />
    ) : kind === "maximize" ? (
      <Square size={12} />
    ) : kind === "restore" ? (
      <Copy size={12} />
    ) : (
      <X size={15} />
    );
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-no-drag
      onClick={onClick}
      className={`flex h-full w-11 items-center justify-center text-(--color-ink-soft) transition-colors ${
        danger
          ? "hover:bg-red-500 hover:text-white"
          : "hover:bg-(--color-subtle) hover:text-(--color-ink-bright)"
      }`}
    >
      {icon}
    </button>
  );
}

export function TitleBarTabs({
  tabs,
  activeTabId,
  onActivate,
  onClose,
}: TitleBarTabsProps) {
  const [maximized, setMaximized] = useState(false);

  // 初始与「窗口尺寸变化」时同步最大化状态（尺寸变化覆盖最大化/还原/拖拽边缘）。
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let alive = true;
    void (async () => {
      const current = await isWindowMaximized();
      if (alive) setMaximized(current);
      unlisten = await onWindowResized((next) => {
        if (alive) setMaximized(next);
      });
    })();
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // 只响应主键；点在页签/按钮上时不拖动。
    if (e.button !== 0) return;
    if (!isDragRegionTarget(e.target as unknown as { closest?: (s: string) => unknown })) return;
    void startWindowDrag();
  }, []);

  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragRegionTarget(e.target as unknown as { closest?: (s: string) => unknown })) return;
    void toggleMaximizeWindow().then((next) => {
      if (next !== null) setMaximized(next);
    });
  }, []);

  const maximizeKind = resolveMaximizeButtonKind(maximized);

  return (
    <div
      className={`flex ${TITLE_BAR_HEIGHT_CLASS} shrink-0 items-stretch border-b border-(--color-border-subtle) bg-(--color-panel) select-none`}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      {/* 页签区：与标题行同一横条 */}
      <div role="tablist" aria-label="应用页签" className="flex items-stretch overflow-x-auto">
        {tabs.map((tab) => (
          <TitleBarTab
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            onActivate={onActivate}
            onClose={onClose}
          />
        ))}
      </div>

      {/* 拖拽空白区：撑满剩余宽度 */}
      <div className="min-w-2 flex-1" aria-hidden />

      {/* 窗口按钮：接管原生标题栏的三个动作 */}
      <div className="flex shrink-0 items-stretch">
        <WindowButton kind="minimize" onClick={() => void minimizeWindow()} />
        <WindowButton
          kind={maximizeKind}
          onClick={() =>
            void toggleMaximizeWindow().then((next) => {
              if (next !== null) setMaximized(next);
            })
          }
        />
        <WindowButton kind="close" danger onClick={() => void closeWindow()} />
      </div>
    </div>
  );
}
