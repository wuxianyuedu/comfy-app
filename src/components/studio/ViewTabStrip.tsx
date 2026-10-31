"use client";

import { Plus, X } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { simpleKeyHandler } from "~/components/ui/simple-key-handler";
import { displayValue } from "~/lib/display-value";

import { NAV_ITEMS, type WorkspaceView } from "./NavItems";
import { isTabClosable, type ViewTab } from "./workspace-tabs";

/**
 * 视图页签的标签文案 —— 与顶栏标题、侧栏导航同一个出处（`NAV_ITEMS`）。
 * 在这里另写一张 label 表，就会长出「侧栏叫队列、页签叫排队中」这类漂移。
 */
export function viewTabLabel(view: WorkspaceView, projectName?: string | null): string {
  const base = NAV_ITEMS.find((item) => item.id === view)?.label ?? view;
  const name = projectName?.trim();
  // 项目类视图带上项目名（原型里就是「工坊·雾中来信」）—— 同一视图开两页时，
  // 只有视图名的话用户分不清哪一页是哪个项目。
  return name ? `${base}·${name}` : base;
}

export interface ViewTabStripProps {
  activeKey: string;
  /** 标题行内嵌时去掉自己的边框/背景（那条横条的视觉由标题行统一持有）。 */
  inTitleBar?: boolean;
  onClose: (key: string) => void;
  /** 从「+」菜单里选了一个视图。 */
  onOpenView?: (view: WorkspaceView) => void;
  onSelect: (key: string) => void;
  /**
   * 「+」菜单里可打开的视图。由调用处给 —— 哪些视图能开是页面知识（有没有活跃项目
   * 决定项目内那六个能不能开），不是页签条的知识。不传就不渲染「+」。
   */
  openableViews?: Array<OpenableView>;
  /** 项目 id → 项目名；缺失时退化为只显示视图名（不显示 id，也不显示 undefined）。 */
  projectNameOf?: (projectId: string | null) => string | null | undefined;
  tabs: Array<ViewTab>;
}

/** 「+」菜单里的一项：视图 id + 展示名。 */
export interface OpenableView {
  label: string;
  view: WorkspaceView;
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
  openableViews,
  onOpenView,
  inTitleBar = false,
}: ViewTabStripProps) {
  return (
    <div
      aria-label="已打开的视图"
      className={
        inTitleBar
          ? "flex min-w-0 shrink items-center gap-1"
          : "border-border bg-sidebar/40 flex shrink-0 items-center gap-1 border-b px-2 py-1.5"
      }
      data-component="workspace-view-tabstrip"
      role="tablist"
    >
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        const label = viewTabLabel(tab.view, projectNameOf?.(tab.projectId));
        return (
          /* eslint-disable-next-line jsx-a11y/click-events-have-key-events -- 同上：键出口是 `simpleKeyHandler` 的展开。 */
          <div
            aria-selected={active}
            data-no-drag
            key={tab.key}
            onClick={() => onSelect(tab.key)}
            role="tab"
            tabIndex={active ? 0 : -1}
            {...simpleKeyHandler(["Space", "Enter"], () => onSelect(tab.key))}
            className={
              /* 选中态走 `.u-tab-active`（更亮的表面 + 顶部一条品牌色），两种形态
                 共用同一套语言 —— 原来标题行里给的是 `bg-canvas/70`，暗色下比
                 标题行的底还暗，肉眼读不出「哪张是当前页」。
                 基串带 `relative`：工具类的色条是伪元素，要有定位祖先。 */
              "relative flex max-w-56 min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors select-none " +
              (active
                ? "u-tab-active"
                : inTitleBar
                  ? "text-ink-muted hover:bg-canvas/40"
                  : "text-ink-muted hover:bg-surface-2")
            }
          >
            <span className="min-w-0 truncate">{label}</span>
            {isTabClosable(tab) ? (
              <Button
                aria-label={`关闭 ${displayValue(label)}`}
                className="text-ink-fainter hover:text-ink -mr-1 shrink-0"
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(tab.key);
                }}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <X data-icon="inline-start" size={12} />
              </Button>
            ) : null}
          </div>
        );
      })}

      {/* 「+」开一个新页签。这一颗是退役 ProjectTabBar 的**前提**：侧栏刻意不列
          项目内那六个视图（主页/画布/工坊/资源库/产出/成片），它们此前唯一的入口
          就是那条切换器 —— 没有这里，退役会让这些视图变成 unreachable。 */}
      {openableViews && openableViews.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label="新页签"
                className="text-ink-muted hover:text-ink shrink-0"
                data-no-drag
                size="icon-xs"
                variant="ghost"
              >
                <Plus data-icon="inline-start" size={14} />
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuGroup>
              <DropdownMenuLabel>打开视图</DropdownMenuLabel>
              {openableViews.map((item) => (
                <DropdownMenuItem key={item.view} onClick={() => onOpenView?.(item.view)}>
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
