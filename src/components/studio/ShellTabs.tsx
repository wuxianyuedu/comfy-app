"use client";

/* ── ShellTabs · 应用级「页签」容器（窗口顶部一条页签栏 + 内容区）────
 *
 * 设计目标：把「主应用」（workspace）与「内嵌的 ComfyUI」都收进同一个
 * Tauri 主窗口内的页签里，一条可切换、可关闭的页签栏，替代此前会
 * 弹出空白独立窗口的 open_comfyui_window 方案。
 *
 * 两种渲染形态（判据见 `shouldUseTitleBarTabs`）：
 *  - **桌面壳内**：页签搬到窗口**标题行**——主窗口关闭原生装饰，由
 *    `TitleBarTabs` 接管整条标题栏（页签 + 拖拽区 + 最小化/最大化/关闭），
 *    不再额外占用应用内区域（ISSUE #310 / #200）。
 *  - **浏览器 / dev**：窗口由系统浏览器提供，没有原生标题栏可让位，
 *    退回「应用内页签栏」，保留原有行为与观感。
 *
 * 两种形态共用同一个高度量 `TITLE_BAR_HEIGHT_CLASS`（`h-title-bar` ←
 * `--spacing-title-bar`）：全屏视图层按 `top-title-bar` 让位，页签栏高度必须
 * 与它同源，否则让位量与实际高度对不上（多留空白或盖住一条）。
 *
 * 关键取舍：
 *  - 主应用内容（children）与已打开的 ComfyUI iframe 都**始终挂载**，
 *    用 CSS 显隐切换，而不是条件卸载——这样切页签不会丢 workspace 的
 *    viewMode / 画布编辑态，ComfyUI 页面也不会因卸载而重载。
 *  - 主应用页签（id="main"）不可关闭；ComfyUI 页签可按需关闭。
 *  - 页签状态由 shell-tabs-store 管理（纯状态层），本组件只做渲染与
 *    动作转发，符合规范 17 的四层归属。
 *
 * 样式说明：内容区高度为「窗口高 - 页签栏高」，主应用内部用 h-full 布局。
 */

import { useCallback, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import {
  useShellTabs,
  MAIN_TAB_ID,
  type ShellTab,
} from "~/lib/shell-tabs-store";
import { isDesktopShell } from "~/lib/desktop-shell-client";
import { shouldUseTitleBarTabs } from "~/lib/title-bar-derive";
import { TITLE_BAR_HEIGHT_CLASS } from "~/lib/full-screen-layer";
import { TitleBarTabs } from "./TitleBarTabs";

interface ShellTabsProps {
  /** 主应用页签的内容（即 workspace 整套界面）。 */
  children: React.ReactNode;
}

/** 单个页签按钮：标题 + 可选关闭按钮（浏览器形态用）。 */
function TabButton({
  tab,
  active,
  onSelect,
  onClose,
}: {
  tab: ShellTab;
  active: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}) {
  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={0}
      onClick={() => onSelect(tab.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(tab.id);
        }
      }}
      className={`group flex h-full cursor-pointer items-center gap-2 border-r border-(--color-border-subtle) px-4 text-sm transition-colors ${
        active
          ? "bg-(--color-canvas) text-(--color-ink-bright)"
          : "bg-(--color-subtle)/60 text-(--color-ink-muted) hover:bg-(--color-subtle) hover:text-(--color-ink-strong)"
      }`}
    >
      <span className="truncate">{tab.label}</span>
      {tab.closable && (
        <button
          type="button"
          aria-label={`关闭 ${tab.label}`}
          onClick={(e) => {
            e.stopPropagation();
            onClose(tab.id);
          }}
          className="rounded p-0.5 text-(--color-ink-fainter) hover:bg-(--color-subtle) hover:text-(--color-ink-strong)"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

/** 应用内页签栏（浏览器 / dev 形态）。 */
function InAppTabStrip({
  tabs,
  activeTabId,
  onActivate,
  onClose,
}: {
  tabs: ShellTab[];
  activeTabId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="应用页签"
      className={`flex ${TITLE_BAR_HEIGHT_CLASS} shrink-0 items-stretch border-b border-(--color-border-subtle) bg-(--color-subtle)/40`}
    >
      {tabs.map((tab) => (
        <TabButton
          key={tab.id}
          tab={tab}
          active={tab.id === activeTabId}
          onSelect={onActivate}
          onClose={onClose}
        />
      ))}
    </div>
  );
}

export function ShellTabs({ children }: ShellTabsProps) {
  const tabs = useShellTabs((s) => s.tabs);
  const activeTabId = useShellTabs((s) => s.activeTabId);
  const activateTab = useShellTabs((s) => s.activateTab);
  const closeTab = useShellTabs((s) => s.closeTab);

  // 壳探测只能在客户端进行（SSR 无 window）。用 useSyncExternalStore 取
  // 客户端快照（服务端恒 false）——首帧按「非壳」渲染，客户端再取真实值，
  // 既不触发 set-state-in-effect（规范 08 §8.6），也不会 hydration 报错。
  const inShell = useSyncExternalStore(
    useCallback(() => () => undefined, []),
    () => isDesktopShell(),
    () => false,
  );

  const contentTabs = tabs.filter((t) => t.id !== MAIN_TAB_ID);
  const useTitleBar = shouldUseTitleBarTabs(inShell);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-(--color-canvas) pb-6 text-(--color-ink)">
      {useTitleBar ? (
        <TitleBarTabs
          tabs={tabs}
          activeTabId={activeTabId}
          onActivate={activateTab}
          onClose={closeTab}
        />
      ) : (
        <InAppTabStrip
          tabs={tabs}
          activeTabId={activeTabId}
          onActivate={activateTab}
          onClose={closeTab}
        />
      )}

      {/* 内容区：主应用与 ComfyUI 均保持挂载，用 CSS 显隐切换，避免丢态 */}
      <div className="relative min-h-0 flex-1">
        {/* 主应用页签（恒挂载，用 CSS 显隐） */}
        <div
          className={activeTabId !== MAIN_TAB_ID ? "hidden h-full" : "h-full"}
        >
          {children}
        </div>

        {/* 已打开的非主应用页签（iframe），同样保持挂载 */}
        {contentTabs.map((tab) => (
          <div
            key={tab.id}
            className={activeTabId === tab.id ? "h-full" : "hidden h-full"}
            aria-hidden={activeTabId !== tab.id}
          >
            {tab.url ? (
              <iframe
                src={tab.url}
                title={tab.label}
                className="h-full w-full border-0"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-(--color-ink-muted)">
                页签内容为空
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
