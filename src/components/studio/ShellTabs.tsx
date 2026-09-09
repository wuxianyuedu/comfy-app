"use client";

/* ── ShellTabs · 应用级「页签」容器（窗口顶部一条页签栏 + 内容区）────
 *
 * 设计目标：把「主应用」（workspace）与「内嵌的 ComfyUI」都收进同一个
 * Tauri 主窗口内的页签里，顶部一条可切换、可关闭的页签栏，替代此前会
 * 弹出空白独立窗口的 open_comfyui_window 方案。
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

import { X } from "lucide-react";
import {
  useShellTabs,
  MAIN_TAB_ID,
  type ShellTab,
} from "~/lib/shell-tabs-store";

interface ShellTabsProps {
  /** 主应用页签的内容（即 workspace 整套界面）。 */
  children: React.ReactNode;
}

/** 单个页签按钮：标题 + 可选关闭按钮。 */
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

export function ShellTabs({ children }: ShellTabsProps) {
  const tabs = useShellTabs((s) => s.tabs);
  const activeTabId = useShellTabs((s) => s.activeTabId);
  const activateTab = useShellTabs((s) => s.activateTab);
  const closeTab = useShellTabs((s) => s.closeTab);

  const contentTabs = tabs.filter((t) => t.id !== MAIN_TAB_ID);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-(--color-canvas) text-(--color-ink) pb-6">
      {/* 顶部页签栏：固定高 40px */}
      <div
        role="tablist"
        aria-label="应用页签"
        className="flex h-10 shrink-0 items-stretch border-b border-(--color-border-subtle) bg-(--color-subtle)/40"
      >
        {tabs.map((tab) => (
          <TabButton
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            onSelect={activateTab}
            onClose={closeTab}
          />
        ))}
      </div>

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
