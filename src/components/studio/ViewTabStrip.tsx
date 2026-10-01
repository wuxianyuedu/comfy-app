"use client";

import { X } from "lucide-react";

import { Button } from "~/components/ui/button";
import { simpleKeyHandler } from "~/components/ui/simple-key-handler";
import { displayValue } from "~/lib/display-value";

import { NAV_ITEMS, type WorkspaceView } from "./NavItems";
import { isTabClosable, type ViewTab } from "./workspace-tabs";

/**
 * 视图页签的标签文案 —— 与顶栏标题、侧栏导航同一个出处（`NAV_ITEMS`）。
 * 在这里另写一张 label 表，就会长出「侧栏叫队列、页签叫排队中」这类漂移。
 */
export function viewTabLabel(
  view: WorkspaceView,
  projectName?: string | null,
): string {
  const base = NAV_ITEMS.find((item) => item.id === view)?.label ?? view;
  const name = projectName?.trim();
  // 项目类视图带上项目名（原型里就是「工坊·雾中来信」）—— 同一视图开两页时，
  // 只有视图名的话用户分不清哪一页是哪个项目。
  return name ? `${base}·${name}` : base;
}

export interface ViewTabStripProps {
  tabs: ViewTab[];
  activeKey: string;
  /** 项目 id → 项目名；缺失时退化为只显示视图名（不显示 id，也不显示 undefined）。 */
  projectNameOf?: (projectId: string | null) => string | null | undefined;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  /** 标题行内嵌时去掉自己的边框/背景（那条横条的视觉由标题行统一持有）。 */
  inTitleBar?: boolean;
}

/**
 * 视图页签条 —— 桌面壳内嵌进窗口标题行，浏览器/dev 里单独一条。
 *
 * 为什么两种形态共用一个组件：这是同一件事的两种摆放位置，不是两件事。分成两份
 * 渲染，「当前项高亮 / 可关闭 / 键盘激活」迟早只在一边修（`ShellTabs` 与
 * `TitleBarTabs` 此前对 iframe 页签就是这么各写一遍键判据，后来才收进
 * `simpleKeyHandler`）。
 *
 * 语义用 `tablist`/`tab` + `aria-selected`：这里的选中态是真的存在（当前视图），
 * 与「镜头胶片带」那种只有跳转、没有选中态的控件刻意不同。
 */
export function ViewTabStrip({
  tabs,
  activeKey,
  projectNameOf,
  onSelect,
  onClose,
  inTitleBar = false,
}: ViewTabStripProps) {
  return (
    <div
      role="tablist"
      aria-label="已打开的视图"
      data-component="workspace-view-tabstrip"
      className={
        inTitleBar
          ? "flex min-w-0 shrink items-center gap-1"
          : "border-border bg-sidebar/40 flex shrink-0 items-center gap-1 border-b px-2 py-1.5"
      }
    >
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        const label = viewTabLabel(tab.view, projectNameOf?.(tab.projectId));
        return (
          <div
            key={tab.key}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            data-no-drag
            onClick={() => onSelect(tab.key)}
            {...simpleKeyHandler(["Space", "Enter"], () => onSelect(tab.key))}
            className={
              // 标题行内（壳）与应用内（浏览器）共用同一组态：只换背景层级，
              // 选中/悬停/焦点三态保持一致，避免"壳里好看、浏览器里像坏了"。
              "text-ink-strong flex max-w-[14rem] min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors select-none " +
              (active
                ? inTitleBar
                  ? "bg-canvas/70 text-ink"
                  : "bg-primary-soft text-primary"
                : inTitleBar
                  ? "text-ink-muted hover:bg-canvas/40"
                  : "text-ink-muted hover:bg-surface-2")
            }
          >
            <span className="min-w-0 truncate">{label}</span>
            {isTabClosable(tab) ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`关闭 ${displayValue(label)}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(tab.key);
                }}
                className="text-ink-fainter hover:text-ink -mr-1 shrink-0"
              >
                <X data-icon="inline-start" size={12} />
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
