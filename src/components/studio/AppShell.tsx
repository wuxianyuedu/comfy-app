"use client";

import { useState, type ReactNode } from "react";
import { LayoutGrid, Pencil, Plus, Trash2, X } from "lucide-react";

import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { RenameProjectDialog } from "./RenameProjectDialog";
import { useHotkey } from "~/components/ui/use-hotkey";
import { Disclosure } from "~/components/ui/disclosure";
import { cn } from "~/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
} from "~/components/ui/sidebar";

import {
  sidebarPinnedViewIds,
  sidebarNavItems,
  isProjectTab,
  PROJECTS_ENTRY,
  type OpenableView,
  type WorkspaceView,
} from "./NavItems";
import { CommandPalette } from "./CommandPalette";
import { TopBar } from "./TopBar";
import { SidebarTempTabs } from "./SidebarTempTabs";
import { SidebarBrand } from "./SidebarBrand";
import { useToast } from "./ToastProvider";
import { useTitleBarTabsActive } from "./hooks/use-title-bar-tabs-active";
import { useTitleBarSlot } from "./TitleBarSlot";
import { isTabClosable, type ViewTab } from "./workspace-tabs";
import { ViewActionsProvider } from "./ViewActions";
import { MAIN_TAB_ID, useShellTabs } from "~/lib/shell/shell-tabs-store";

/** 侧栏底部「项目」分组里列出的一条项目（只需 id + 展示名）。 */
export type SidebarProject = {
  id: string;
  name: string;
};

/**
 * 一条项目的**缩略图标**：侧栏收起成图标轨时 `SidebarMenuButton` 只剩 `size-8` 方块、
 * 名称被 `truncate` 成零宽，没有图标就是空格子，用户认不出也点不下去（ISSUE #1691）。
 * 取「画布」一族而非文件夹：分组里每条都是画布项目（`canvas-store` 的 `proj_*`）。
 */
function ProjectGlyph() {
  return (
    <svg
      aria-hidden
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="16"
    >
      <rect height="18" rx="2" width="18" x="3" y="3" />
      <path d="M3 9h18M9 21V9" />
      <circle cx="15" cy="15" r="2" />
    </svg>
  );
}

/** 侧栏底部「项目」分组（从 `AppShell` 拆出 —— §12.13：#4808 的右键菜单把
 *  `AppShell` 函数顶过 400 行闸）：入口行的折叠面板 + 项目行（打开态 / 关页签 /
 *  右键菜单）+ 查看全部 / 新建项目。右键菜单与改名对话框的状态只在本组消费，
 *  随组件一起搬；菜单与对话框走 Portal，DOM 位置不影响呈现。 */
function SidebarProjectsGroup({
  activeProjectId,
  insideProject,
  onCloseViewTab,
  onDeleteProject,
  onNewProject,
  onOpenProject,
  onShowAllProjects,
  projects,
  viewTabs,
}: {
  activeProjectId: string | null;
  insideProject: boolean;
  onCloseViewTab?: (key: string) => void;
  /** 删除项目（上层负责：本地+服务端一并删、关该项目页签、刷新活跃项目），
   *  与项目页左列表的删除入口同一条链路。 */
  onDeleteProject?: (id: string) => void;
  onNewProject: () => void;
  onOpenProject: (id: string) => void;
  onShowAllProjects: () => void;
  projects: Array<SidebarProject>;
  viewTabs?: Array<ViewTab>;
}) {
  const toast = useToast();
  /* 「项目」行的右键菜单（ISSUE #4808）：开在右键那个点上（与画布菜单
     CanvasContextMenu 同一手法 —— 受控 DropdownMenu + 零尺寸 fixed 锚点），
     全局兜底 AppContextMenu 靠 `defaultPrevented` 让位。目前有「编辑名称」
     与「删除项目」两项；两个对话框各自单独一个状态（菜单关了才开，互不嵌套）。 */
  const [contextTarget, setContextTarget] = useState<{
    project: SidebarProject;
    x: number;
    y: number;
  } | null>(null);
  const [renameTarget, setRenameTarget] = useState<SidebarProject | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SidebarProject | null>(null);

  return (
    <>
      {/* 「项目」分组紧跟全局项之后（不再 `mt-auto` 顶到视口底部，避免中间大片空白）。
        **图标档不再整组隐藏**（ISSUE #1691）：此前挂 `collapsible=icon:hidden`，窗口一窄
        用户就看不见也切不了项目；现在缩略态每项都是带图标 + 名称 tooltip 的方块。 */}
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <Disclosure
                className={cn(
                  "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  "rounded-md p-2 text-sm font-medium [&_svg]:size-4 [&_svg]:shrink-0",
                  /* 缩略态：整行落成与全局项同形的 48px 方块 —— 折叠标记
                   与文字都让位，只留分组图标（否则这一行宽过图标轨、
                   `overflow-hidden` 把它裁掉一半）。 */
                  "group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center",
                  "group-data-[collapsible=icon]:**:data-[slot=disclosure-marker]:hidden",
                )}
                defaultOpen
                marker="chevron"
                panelClassName="mt-1"
                trigger={
                  <>
                    {PROJECTS_ENTRY.icon}
                    <span className="group-data-[collapsible=icon]:hidden">
                      {PROJECTS_ENTRY.label}
                    </span>
                  </>
                }
              >
                <SidebarMenu>
                  {projects.map((project) => {
                    /* 这个项目当前开着哪些页签（ISSUE #4770）：任一项目类页签
                       挂着它 = 界面打开。打开态与关闭按钮和上方导航项同一套。 */
                    const openProjectTabs =
                      viewTabs?.filter((tab) => tab.projectId === project.id) ?? [];
                    return (
                      /* 行级悬停用独立组名 `group/row`（ISSUE #4812）：本面板嵌在
                         外层「项目」行（也是一个带 `group/menu-item` 的
                         SidebarMenuItem）里，Tailwind 命名组变体是「任一祖先命中」
                         —— 悬停面板里任意一行都会让外层 li 处于 :hover，行内反馈
                         就会串到别的行上。行级变体（按钮背景 / 关闭按钮浮现）只认
                         本行的 li，外层不带 `group/row`，串色链条断在这里。 */
                      <SidebarMenuItem className="group/row" key={project.id}>
                        <SidebarMenuButton
                          className="group-hover/row:bg-sidebar-accent group-hover/row:text-sidebar-accent-foreground"
                          isActive={insideProject && project.id === activeProjectId}
                          onClick={() => {
                            onOpenProject(project.id);
                          }}
                          onContextMenu={(event) => {
                            /* 右键 = 项目菜单（编辑名称，ISSUE #4808）：
                               preventDefault 让全局兜底菜单（AppContextMenu）让位。 */
                            event.preventDefault();
                            setContextTarget({
                              project,
                              x: event.clientX,
                              y: event.clientY,
                            });
                          }}
                          size="sm"
                          tooltip={project.name}
                        >
                          {/* 缩略图标：展开态与缩略态都要有，否则收起后
                            按钮里只剩一个空格子（名称被 `truncate` 掉）。 */}
                          {openProjectTabs.length > 0 ? (
                            /* 打开态（与上方导航项同款）：图标落进品牌色浅底胶片，
                               读起来是「这个项目的界面开着」。 */
                            <span
                              className="bg-primary-soft text-primary-strong inline-flex size-7 shrink-0 items-center justify-center rounded-md"
                              data-open-state="true"
                            >
                              <ProjectGlyph />
                            </span>
                          ) : (
                            <ProjectGlyph />
                          )}
                          <span>{project.name}</span>
                        </SidebarMenuButton>
                        {openProjectTabs.length > 0 ? (
                          /* 关闭按钮（悬停浮现）：关掉这个项目开着的**全部**页签
                             —— 侧栏这一行表达的是「项目界面」这个整体，不是其中
                             某一页；逐页关走项目内页签自己的出口。 */
                          <Button
                            aria-label={`关闭 ${project.name} 页签`}
                            className={cn(
                              "absolute top-1/2 right-2 -translate-y-1/2",
                              "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                              /* 行级组（ISSUE #4812）：浮现条件只认本行的 li，
                                 不吃外层「项目」行的悬停。 */
                              "opacity-0 transition-opacity group-hover/row:opacity-100",
                              "group-focus-within/row:opacity-100 focus-visible:opacity-100",
                              "group-data-[collapsible=icon]:hidden",
                            )}
                            data-sidebar="menu-action"
                            onPointerDown={(event) => {
                              event.stopPropagation();
                              for (const tab of openProjectTabs) {
                                onCloseViewTab?.(tab.key);
                              }
                            }}
                            size="icon-xs"
                            type="button"
                            variant="ghost"
                          >
                            <X data-icon="inline-start" size={12} />
                          </Button>
                        ) : null}
                      </SidebarMenuItem>
                    );
                  })}
                  <SidebarMenuItem>
                    <SidebarMenuButton onClick={onShowAllProjects} size="sm" tooltip="查看全部">
                      <LayoutGrid />
                      <span>查看全部</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton onClick={onNewProject} size="sm" tooltip="新建项目">
                      <Plus />
                      <span>新建项目</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </Disclosure>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      {/* 「项目」行的右键菜单（ISSUE #4808）：锚点开在右键那个点上。 */}
      {contextTarget !== null && (
        <DropdownMenu
          onOpenChange={(open) => {
            if (!open) {
              setContextTarget(null);
            }
          }}
          open
        >
          {/* 零尺寸定位锚点（与 CanvasContextMenu 同一手法）：菜单开在右键那个点上。 */}
          <DropdownMenuTrigger
            aria-hidden
            className="pointer-events-none fixed size-0"
            style={{ left: contextTarget.x, top: contextTarget.y }}
            tabIndex={-1}
          />
          <DropdownMenuContent align="start" side="bottom">
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => {
                  setRenameTarget(contextTarget.project);
                  setContextTarget(null);
                }}
              >
                <Pencil data-icon="inline-start" size={14} />
                <span>编辑名称</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setDeleteTarget(contextTarget.project);
                  setContextTarget(null);
                }}
                variant="destructive"
              >
                <Trash2 data-icon="inline-start" size={14} />
                <span>删除项目</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* 改名对话框（与右键菜单分开挂：菜单先收，对话框再开）。 */}
      {renameTarget !== null && (
        <RenameProjectDialog
          onClose={() => {
            setRenameTarget(null);
          }}
          project={renameTarget}
        />
      )}

      {/* 删除确认对话框：文案与项目页 / 「所有项目」屏同族 —— 侧栏行可能是
          服务端-only 行，这里按「本地+服务端一并删」的口径写。 */}
      {deleteTarget !== null && (
        <ConfirmDialog
          cancelLabel="取消"
          confirmLabel="删除项目"
          danger
          description={
            `即将永久删除「${deleteTarget.name || "未命名项目"}」。\n` +
            `该操作不可撤销，画布内的节点与连线将一并丢失。\n` +
            `该项目的生成任务、成片与工坊内容（含磁盘产物）也将一并删除。`
          }
          onClose={() => {
            setDeleteTarget(null);
          }}
          onConfirm={() => {
            const target = deleteTarget;
            setDeleteTarget(null);
            onDeleteProject?.(target.id);
            toast.success(`已删除项目「${target.name}」`);
          }}
          open
          title="删除此画布项目？"
        />
      )}
    </>
  );
}

export type AppShellProps = {
  /** 当前视图（决定侧栏高亮与顶部标题）。 */
  active: WorkspaceView;
  /** 存储里那一格活跃 id，不等于「用户此刻在这个项目里」：首页等全局视图也持有它，
   *  直接当高亮判据会让某项看着被选中、内容却一处没显（ISSUE #1691 第 2 条）；
   *  高亮改由 `insideProject` 按 `active` 视图位置判定。 */
  activeProjectId: string | null;
  activeViewKey?: string;
  /** 主内容。各视图只往这里塞东西，外壳细节（侧栏 / 顶栏 / 滚动容器）不归它们管。 */
  children: ReactNode;
  /** 首帧侧栏展开态。由服务端读 `sidebar_state` cookie 传来（见 `ui/sidebar` 里那段说明）；不传按展开。 */
  defaultSidebarOpen?: boolean;
  onCloseViewTab?: (key: string) => void;
  /** 删除项目（侧栏「项目」行右键菜单）：上层负责删本地+服务端、关页签、刷新。 */
  onDeleteProject?: (id: string) => void;
  /** 新建项目 → 建一条 proj_* 并进画布。 */
  onNewProject: () => void;
  /** 点开某个项目 → 进入项目界面（画布为其默认页签）。 */
  onOpenProject: (id: string) => void;
  /** 打开设置 —— 切到 `settings` **视图页签**（与历史 / 队列 / 控制台同一套），
   *  不再是 workspace 上的一层浮层，也不跳 `/settings` 路由：组件树因此不卸载。 */
  onOpenSettings: () => void;
  onOpenView?: (view: WorkspaceView) => void;
  /** 切换视图。 */
  onSelect: (view: WorkspaceView) => void;
  onSelectViewTab?: (key: string) => void;
  /** 「查看全部」→ 项目网格落地页（works）。 */
  onShowAllProjects: () => void;
  openableViews?: Array<OpenableView>;
  projectNameOf?: (projectId: string | null) => string | null | undefined;
  /** 底部「项目」分组列出的项目（来自 canvas-store）。 */
  projects: Array<SidebarProject>;
  /** 视图页签（首页 / 模型 / 工坊·项目名 …）。侧栏据此渲染打开态与「临时页签」组。 */
  viewTabs?: Array<ViewTab>;
};

/**
 * 应用外壳 —— 左侧栏（`ui/sidebar`）+ 顶部工具条（`TopBar`）+ 主内容。
 * 侧栏顶部是常驻全局项（设置不在其中，入口在顶栏应用菜单）；其下是「临时页签」组
 * （已打开的页签，ISSUE #4770 起）；底部是「项目」折叠分组。项目类视图是视图页签
 * （入口在「临时页签」组的「+」菜单），按分区归属定型、不随视图漂移。
 */
export function AppShell({
  active,
  onSelect,
  onOpenSettings,
  defaultSidebarOpen,
  projects,
  activeProjectId,
  onOpenProject,
  onShowAllProjects,
  onNewProject,
  viewTabs,
  activeViewKey,
  projectNameOf,
  onSelectViewTab,
  onCloseViewTab,
  onDeleteProject,
  openableViews,
  onOpenView,
  children,
}: AppShellProps) {
  /* 全局命令面板（⌘/Ctrl+K）。状态留在这里：搜索按钮在 TopBar、键盘监听用
   * P20 唯一出口 useHotkey，面板本身由 CommandPalette 渲染。 */
  /* 桌面壳里标题行（拖拽区 + 窗口按钮）由 `ShellTabs` 组装后经插槽交下来，
   * 落在本壳的内容列顶部（ISSUE #3807）；页签已退役到侧栏「临时页签」组（#4770）。 */
  const titleBarTabs = useTitleBarTabsActive();
  const titleBarSlot = useTitleBarSlot();
  /* 桌面壳的 iframe 页签（ComfyUI 等）：随「临时页签」组在侧栏列出（ISSUE #4770）。
     主应用页签不列 —— 它就是侧栏与内容这一整块。 */
  const shellTabs = useShellTabs((s) => s.tabs);
  const shellActiveTabId = useShellTabs((s) => s.activeTabId);
  const activateShellTab = useShellTabs((s) => s.activateTab);
  const closeShellTab = useShellTabs((s) => s.closeTab);
  const iframeTabs = shellTabs.filter((tab) => tab.id !== MAIN_TAB_ID);
  const [commandOpen, setCommandOpen] = useState(false);
  useHotkey({ key: "k", mod: true }, () => {
    setCommandOpen(true);
  });

  /* 侧栏列表 —— 与 `globalNavItems()` 的差别只有一处：设置不在侧栏列
     （它已经撤到顶栏右上角的菜单里，见 `sidebarNavItems` 的说明）。 */
  const navItems = sidebarNavItems();

  /* 「临时页签」组列的视图页签：侧栏常驻项不重复列（ISSUE #3740）；项目类页签
     也不列（ISSUE #4798：项目在「项目」分组里已有打开态，再列一条是重复）——
     这里只剩瞬时页签（设置等）与桌面壳 iframe 页签。首页属于常驻项，一并不进。 */
  const pinnedViewIds = sidebarPinnedViewIds();
  const stripTabs =
    viewTabs?.filter((tab) => !pinnedViewIds.has(tab.view) && !isProjectTab(tab.view)) ?? [];

  /* 「用户此刻在这个项目里」判据是**视图位置**而非存储里的活跃 id：活跃 id 跨视图常驻
     （新建项目、从最近项目进来都会写），首页 / 模型 / 历史等全局视图上没有任何项目内容，
     直接比 id 会让分组里总有一项亮着（ISSUE #1691 第 2 条）。`isProjectTab` 的六个项目
     页签每屏只讲当前项目，只有那里「亮着的项」与屏幕内容才同一件事。 */
  const insideProject = isProjectTab(active);

  return (
    /* 视图动作槽的宿主在 `TopBar`、使用者是各视图（它的后代）—— 提供者因此
       必须裹住两者。见 `ViewActions` 里那段「为什么是槽不是注册表」。 */
    <ViewActionsProvider>
      <SidebarProvider className="h-full min-h-0" defaultOpen={defaultSidebarOpen}>
        <Sidebar collapsible="icon">
          {/* 底部避让全局固定状态栏（fixed bottom-0 h-6 = 24px、横跨整窗）：侧栏由
              SidebarProvider 的 min-h-svh 撑满整屏，内容贴底（或滚到底）时「临时页签」
              组的最后一行会落进这 24px 被盖住、点不到。留 pb-6 与主内容 /
              ScriptMarkdownEditor 同一口径（侧栏底部「设置」此前的避让同形，#987）。 */}
          <SidebarContent className="pb-6">
            <SidebarBrand onHome={onSelect} />
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navItems.map((item) => {
                    const enabled = item.enabled !== false;
                    /* 这一项的视图当前开着哪一页（ISSUE #3740）：侧栏顶部列的是全局项，
                       无项目维度，取第一张命中的页签即可。首页是固定页签（恒在、不可关），
                       `isTabClosable` 判它为不可关 ⇒ 不会拿到打开态。 */
                    const openTab = viewTabs?.find(
                      (tab) => tab.view === item.id && isTabClosable(tab),
                    );
                    return (
                      <SidebarMenuItem key={item.id}>
                        {/* 未上线的视图留在列表里但禁用：移除会让「以后有这个」这件事消失，
                          禁用则给出「即将推出」（`tooltip` 里写明）。 */}
                        <SidebarMenuButton
                          className={cn(
                            /* 关闭按钮悬停时行背景也带上悬停色（ISSUE #3740 追加反馈）：
                               按钮是兄弟控件、盖在行右缘，光标落在它上面时行自身的 :hover
                               不触发；用组悬停变量把整行接成悬停态。 */
                            "group-hover/menu-item:bg-sidebar-accent group-hover/menu-item:text-sidebar-accent-foreground",
                            /* 未上线的占位项要看着是禁用的：带 tooltip 的菜单按钮会被 Base UI
                               包一层 TooltipTrigger，`disabled` 不会落成原生属性，变体里的
                               `disabled:opacity-50` 因此不生效。这里显式置灰但不动
                               pointer-events —— 悬停仍要能弹出「即将推出」提示。 */
                            !enabled && "opacity-50",
                          )}
                          disabled={!enabled}
                          /* 首页不参与选中变色（Issue #4813）：它是常驻落点，
                             不像其它页签那样用高亮表达「当前在这页」。 */
                          isActive={active === item.id && item.id !== "home"}
                          onClick={() => {
                            if (enabled) {
                              onSelect(item.id);
                            }
                          }}
                          tooltip={enabled ? item.label : `${item.label}（即将推出）`}
                        >
                          {openTab ? (
                            /* 打开态（ISSUE #3740 追加反馈）：图标落进一枚品牌色浅底胶片
                               （`primary-soft`，明暗两态自有值），读起来是「这一页在用」，
                               不再像「有通知」的角点。与「当前在这页」的选中指示条
                               （侧栏 `data-active`）是两个维度，互不替代。 */
                            <span
                              className="bg-primary-soft text-primary-strong inline-flex size-7 shrink-0 items-center justify-center rounded-md"
                              data-open-state="true"
                            >
                              {item.icon}
                            </span>
                          ) : (
                            item.icon
                          )}
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                        {openTab ? (
                          /* 关闭按钮（ISSUE #3740）：只在悬停 / 聚焦时浮现 —— 打开态
                             已由图标胶片常驻表达，按钮不必一直占位。做成菜单按钮的
                             **兄弟**而不是子元素（button 里不许再套 button）；挂
                             `data-sidebar="menu-action"` 让按钮的
                             `group-has-data-[sidebar=menu-action]:pr-8` 自动给文字让位。
                             缩略成图标轨时不显示（那里没有放它的位置，关页签走展开态） */
                          <Button
                            aria-label={`关闭 ${item.label} 页签`}
                            className={cn(
                              "absolute top-1/2 right-2 -translate-y-1/2",
                              "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                              "opacity-0 transition-opacity group-hover/menu-item:opacity-100",
                              "group-focus-within/menu-item:opacity-100 focus-visible:opacity-100",
                              "group-data-[collapsible=icon]:hidden",
                            )}
                            data-sidebar="menu-action"
                            /* 关闭走 pointerdown 而不是 click（ISSUE #3789）：行级 tooltip
                               在 pointerdown 时收起会引发一次重渲染，真实点击的 click
                               事件会落到行 <li> 上、关不掉页签；pointerdown 阶段目标
                               稳定是这枚按钮本身。 */
                            onPointerDown={(event) => {
                              event.stopPropagation();
                              onCloseViewTab?.(openTab.key);
                            }}
                            size="icon-xs"
                            type="button"
                            variant="ghost"
                          >
                            <X data-icon="inline-start" size={12} />
                          </Button>
                        ) : null}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {/* 「项目」分组（拆成子组件 —— §12.13：右键菜单把本函数顶过 400 行闸；
                内容与右键菜单的说明见 `SidebarProjectsGroup`）。 */}
            <SidebarProjectsGroup
              activeProjectId={activeProjectId}
              insideProject={insideProject}
              onCloseViewTab={onCloseViewTab}
              onDeleteProject={onDeleteProject}
              onNewProject={onNewProject}
              onOpenProject={onOpenProject}
              onShowAllProjects={onShowAllProjects}
              projects={projects}
              viewTabs={viewTabs}
            />

            {/* 「临时页签」组（ISSUE #4770）：顶部页签栏退役后，已打开的页签改在左侧列出
              —— 瞬时页（设置等）、项目类页（工坊·某项目）与桌面壳 iframe 页（ComfyUI），
              状态与其它侧栏项同一套（当前页高亮、悬停浮现关闭按钮）。没有要列的页签时
              整组不渲染，不给侧栏添一条空分组。#4792：排在「项目」分组之后。 */}
            {stripTabs.length + iframeTabs.length > 0 ? (
              <SidebarTempTabs
                activeIframeTabId={shellActiveTabId}
                activeViewKey={activeViewKey}
                iframeTabs={iframeTabs}
                onActivateIframeTab={activateShellTab}
                onCloseIframeTab={closeShellTab}
                onCloseViewTab={onCloseViewTab}
                onOpenView={onOpenView}
                onSelectViewTab={onSelectViewTab}
                openableViews={openableViews}
                projectNameOf={projectNameOf}
                viewTabs={stripTabs}
              />
            ) : null}
          </SidebarContent>

          {/* 原先这里有一个侧栏底「设置」—— 与列表里那一项是同一个动作的两处入口，
            而顶栏右上角的菜单本来就有一处的「设置」。三处收成一处后此处删除：
            一个动作只留一个入口，也顺带不再需要为底部状态栏 24px 让位的 `pb-6`。 */}

          {/* 边缘热区：点击/拖拽也能开合，官方自带。 */}
          <SidebarRail />
        </Sidebar>

        <SidebarInset className="bg-canvas text-ink min-w-0 overflow-hidden">
          {/* 顶部那一条（ISSUE #3807 摆位、#4770 退役页签）：桌面壳渲染 `ShellTabs` 经
              `TitleBarSlotProvider` 交下来的 `TitleBar`（拖拽区 + 窗口按钮）；浏览器 / dev
              没有这条 chrome，内容列直接从 TopBar 起。已打开的页签不再住这里 ——
              它们改在左侧栏「临时页签」组里列出。 */}
          {titleBarTabs && titleBarSlot ? titleBarSlot : null}

          <TopBar
            active={active}
            onOpenSearch={() => {
              setCommandOpen(true);
            }}
            onOpenSettings={onOpenSettings}
          />

          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
        </SidebarInset>

        <CommandPalette
          active={active}
          onOpenChange={setCommandOpen}
          onSelect={onSelect}
          open={commandOpen}
        />
      </SidebarProvider>
    </ViewActionsProvider>
  );
}
