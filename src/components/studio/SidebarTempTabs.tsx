"use client";

/* ── SidebarTempTabs · 侧栏「临时页签」分组（ISSUE #4770）──────────────
 * 顶部页签栏退役后的新家：此前渲染在内容列顶端的已打开页签（设置这类瞬时页、
 * 项目类页签、桌面壳里的 ComfyUI iframe 页签）改在**左侧栏**列出，与其它侧栏项
 * 同一套状态语言 —— 当前页高亮（`data-active`）、悬停浮现关闭按钮。
 * 「临时」指这些行随页签开合增减，不像常驻导航项恒在；首页等侧栏常驻项的页签
 * 不在这里重复出现（它们在上方导航组里已有打开态与关闭按钮，ISSUE #3740）。
 * 「+」菜单保留：项目内六视图（主页 / 画布 / 工坊 / 资源库 / 产出 / 成片）不进
 * 侧栏导航，这里是它们唯一的入口（`openableViews` 由装配层按「有没有活跃项目」给）。
 * 第③层视图（规范 17 §17.2）：只渲染 props + 转发动作，不自己碰页签状态。
 */

import { Globe, Plus, X } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/ui/sidebar";
import { cn } from "~/lib/utils";
import type { ShellTab } from "~/lib/shell/shell-tabs-store";

import { NAV_ITEMS, viewTabLabel, type OpenableView, type WorkspaceView } from "./NavItems";
import { isTabClosable, type ViewTab } from "./workspace-tabs";

export type SidebarTempTabsProps = {
  /** 当前激活的桌面壳 iframe 页签 id；不在 iframe 页签上时与视图页签 id 不同源。 */
  activeIframeTabId?: string;
  /** 当前激活的视图页签 key。 */
  activeViewKey?: string;
  /** 桌面壳 iframe 页签（ComfyUI 等；主应用页签不在此列）。 */
  iframeTabs: Array<ShellTab>;
  onActivateIframeTab: (id: string) => void;
  onCloseIframeTab: (id: string) => void;
  /** 关闭一个视图页签。 */
  onCloseViewTab?: (key: string) => void;
  /** 从「+」菜单里选了一个视图。 */
  onOpenView?: (view: WorkspaceView) => void;
  /** 选中某个视图页签。 */
  onSelectViewTab?: (key: string) => void;
  /** 「+」菜单里可打开的视图（页面知识，见 workspace 页的装配）。 */
  openableViews?: Array<OpenableView>;
  /** 项目 id → 项目名（页签标题用「工坊·项目名」区分同视图多页）。 */
  projectNameOf?: (projectId: string | null) => string | null | undefined;
  /** 已过滤掉侧栏常驻项的视图页签（瞬时页 + 项目类页）。 */
  viewTabs: Array<ViewTab>;
};

/** 关闭按钮：只在悬停 / 聚焦时浮现（与上方导航项的关闭按钮同一套形态）。 */
function TempTabClose({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <Button
      aria-label={`关闭 ${label}`}
      className={cn(
        "absolute top-1/2 right-2 -translate-y-1/2",
        "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        "opacity-0 transition-opacity group-hover/menu-item:opacity-100",
        "group-focus-within/menu-item:opacity-100 focus-visible:opacity-100",
        "group-data-[collapsible=icon]:hidden",
      )}
      data-sidebar="menu-action"
      /* 关闭走 pointerdown 而不是 click（ISSUE #3789）：行级 tooltip 在 pointerdown
         时收起会引发一次重渲染，真实点击的 click 事件会落到行 <li> 上、关不掉页签。 */
      onPointerDown={(event) => {
        event.stopPropagation();
        onClose();
      }}
      size="icon-xs"
      type="button"
      variant="ghost"
    >
      <X data-icon="inline-start" size={12} />
    </Button>
  );
}

/** 侧栏「临时页签」分组 —— 上层按「有没有要列的页签」决定挂不挂。 */
export function SidebarTempTabs({
  viewTabs,
  activeViewKey,
  iframeTabs,
  activeIframeTabId,
  projectNameOf,
  onSelectViewTab,
  onCloseViewTab,
  onActivateIframeTab,
  onCloseIframeTab,
  openableViews,
  onOpenView,
}: SidebarTempTabsProps) {
  /* iframe 页签激活时，视图页签一律不算当前页（主应用整体被 iframe 盖住）。 */
  const iframeActive = iframeTabs.some((tab) => tab.id === activeIframeTabId);

  return (
    <SidebarGroup>
      <SidebarGroupLabel>临时页签</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {viewTabs.map((tab) => {
            const active = !iframeActive && tab.key === activeViewKey;
            const label = viewTabLabel(tab.view, projectNameOf?.(tab.projectId));
            const icon = NAV_ITEMS.find((item) => item.id === tab.view)?.icon;
            return (
              <SidebarMenuItem key={tab.key}>
                <SidebarMenuButton
                  className="group-hover/menu-item:bg-sidebar-accent group-hover/menu-item:text-sidebar-accent-foreground"
                  isActive={active}
                  onClick={() => {
                    onSelectViewTab?.(tab.key);
                  }}
                  tooltip={label}
                >
                  {icon ?? <Globe />}
                  <span>{label}</span>
                </SidebarMenuButton>
                {isTabClosable(tab) ? (
                  <TempTabClose
                    label={label}
                    onClose={() => {
                      onCloseViewTab?.(tab.key);
                    }}
                  />
                ) : null}
              </SidebarMenuItem>
            );
          })}

          {iframeTabs.map((tab) => (
            <SidebarMenuItem key={tab.id}>
              <SidebarMenuButton
                className="group-hover/menu-item:bg-sidebar-accent group-hover/menu-item:text-sidebar-accent-foreground"
                isActive={tab.id === activeIframeTabId}
                onClick={() => {
                  onActivateIframeTab(tab.id);
                }}
                tooltip={tab.label}
              >
                <Globe />
                <span>{tab.label}</span>
              </SidebarMenuButton>
              {tab.closable ? (
                <TempTabClose
                  label={tab.label}
                  onClose={() => {
                    onCloseIframeTab(tab.id);
                  }}
                />
              ) : null}
            </SidebarMenuItem>
          ))}

          {/* 「+」开一个新页签：项目内六视图的唯一入口（侧栏导航刻意不列它们）。 */}
          {openableViews && openableViews.length > 0 ? (
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <SidebarMenuButton tooltip="打开视图">
                      <Plus />
                      <span>打开视图</span>
                    </SidebarMenuButton>
                  }
                />
                <DropdownMenuContent align="start" className="w-44">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>打开视图</DropdownMenuLabel>
                    {openableViews.map((item) => (
                      <DropdownMenuItem
                        key={item.view}
                        onClick={() => {
                          onOpenView?.(item.view);
                        }}
                      >
                        {item.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          ) : null}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
