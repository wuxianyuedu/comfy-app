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
import type { ShellTab } from "~/lib/shell/shell-tabs-store";
import { MAIN_TAB_ID } from "~/lib/shell/shell-tabs-store";
import { ViewTabStrip } from "./ViewTabStrip";
import { type ViewTab } from "./workspace-tabs";
import { type OpenableView } from "./ViewTabStrip";
import { type WorkspaceView } from "./NavItems";
import {
  isDragRegionTarget,
  resolveMaximizeButtonKind,
  WINDOW_BUTTON_LABELS,
  type WindowButtonKind,
} from "~/lib/shell/title-bar-derive";
import {
  TITLE_BAR_CHROME_CLASS,
  TITLE_BAR_HEIGHT_CLASS,
} from "~/lib/full-screen-layer";
import {
  closeWindow,
  isWindowMaximized,
  minimizeWindow,
  onWindowResized,
  startWindowDrag,
  toggleMaximizeWindow,
} from "~/lib/shell/window-controls-client";
import { useStartupForeground } from "./hooks/use-startup-foreground";
import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
import { simpleKeyHandler } from "~/components/ui/simple-key-handler";

interface TitleBarTabsProps {
  tabs: ShellTab[];
  activeTabId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  /**
   * 视图页签。传了就用它们**取代**「主应用」那一个伪页签：同一条标题行横条里并列
   * 「应用内视图」与「iframe 外部页面」，不再另起第二条（#1324 决策 ④(a)）。
   * 不传时行为与从前一致。
   */
  viewTabs?: ViewTab[];
  activeViewKey?: string;
  projectNameOf?: (projectId: string | null) => string | null | undefined;
  onSelectViewTab?: (key: string) => void;
  onCloseViewTab?: (key: string) => void;
  /** 「+」菜单里可打开的视图（由 ShellTabs 透传）。 */
  openableViews?: OpenableView[];
  onOpenView?: (view: WorkspaceView) => void;
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
      /* 与 `ShellTabs` 同款：键判据走 `~/components/ui/simple-key-handler`
       *（规范 16 §16.2.4.57）—— 两种渲染形态的页签对「哪个键激活」共用
       *  同一个判据，不再各写一遍。 */
      {...simpleKeyHandler(["Space", "Enter"], () => onActivate(tab.id))}
      className={`group border-border-subtle flex h-full max-w-52 min-w-0 cursor-pointer items-center gap-2 border-r px-3 text-sm transition-colors ${
        active
          ? "bg-canvas text-ink-bright"
          : "text-ink-muted hover:bg-subtle/70 hover:text-ink-strong"
      }`}
    >
      <span className="truncate">{tab.label}</span>
      {tab.closable && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`关闭 ${tab.label}`}
          data-no-drag
          onClick={(e) => {
            e.stopPropagation();
            onClose(tab.id);
          }}
          className="text-ink-fainter hover:bg-subtle hover:text-ink-strong rounded"
        >
          <X data-icon="inline-start" size={13} />
        </Button>
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
    <Hint label={label}>
      <Button
        variant="ghost"
        aria-label={label}
        data-no-drag
        onClick={onClick}
        className={`text-ink-soft h-full w-11 rounded-none ${
          danger
            ? "hover:bg-destructive hover:text-primary-foreground"
            : "hover:bg-subtle hover:text-ink-bright"
        }`}
      >
        {icon}
      </Button>
    </Hint>
  );
}

export function TitleBarTabs({
  tabs,
  activeTabId,
  onActivate,
  onClose,
  viewTabs,
  activeViewKey,
  projectNameOf,
  onSelectViewTab,
  onCloseViewTab,
  openableViews,
  onOpenView,
}: TitleBarTabsProps) {
  /* 有视图页签时，「主应用」那一个伪页签由它们代表 —— 同一条横条里出现
     「主应用」+「首页」+「模型」这种并列，用户分不清哪个才是当前页。 */
  const hasViewTabs = !!viewTabs && viewTabs.length > 0;
  const shellTabs = hasViewTabs
    ? tabs.filter((tab) => tab.id !== MAIN_TAB_ID)
    : tabs;
  const [maximized, setMaximized] = useState(false);

  // 启动完成后的前台归属：用户没让出前台就给前台，让出了才只在任务栏显示
  // （判据在壳里，见 §1.3）；本 hook 只管「用户再次唤起已运行的实例」那条通道。
  useStartupForeground();

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

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // 只响应主键；点在页签/按钮上时不拖动。
      if (e.button !== 0) return;
      if (
        !isDragRegionTarget(
          e.target as unknown as { closest?: (s: string) => unknown },
        )
      )
        return;
      void startWindowDrag();
    },
    [],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (
        !isDragRegionTarget(
          e.target as unknown as { closest?: (s: string) => unknown },
        )
      )
        return;
      void toggleMaximizeWindow().then((next) => {
        if (next !== null) setMaximized(next);
      });
    },
    [],
  );

  const maximizeKind = resolveMaximizeButtonKind(maximized);

  return (
    <div
      className={`flex ${TITLE_BAR_HEIGHT_CLASS} ${TITLE_BAR_CHROME_CLASS} border-border-subtle bg-panel shrink-0 items-stretch border-b select-none`}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      {/* 页签区：与标题行同一横条。视图页签在前（它们代表主应用那一格），
          iframe 页签在后；两组共用同一份 ViewTabStrip / TitleBarTab 形态。 */}
      <div className="flex min-w-0 items-stretch overflow-x-auto">
        {hasViewTabs ? (
          <ViewTabStrip
            inTitleBar
            tabs={viewTabs}
            activeKey={activeViewKey ?? ""}
            projectNameOf={projectNameOf}
            onSelect={(key) => onSelectViewTab?.(key)}
            onClose={(key) => onCloseViewTab?.(key)}
            openableViews={openableViews}
            onOpenView={onOpenView}
          />
        ) : null}
        {shellTabs.length > 0 ? (
          <div
            role="tablist"
            aria-label="应用页签"
            className="flex items-stretch"
          >
            {shellTabs.map((tab) => (
              <TitleBarTab
                key={tab.id}
                tab={tab}
                active={tab.id === activeTabId}
                onActivate={onActivate}
                onClose={onClose}
              />
            ))}
          </div>
        ) : null}
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
