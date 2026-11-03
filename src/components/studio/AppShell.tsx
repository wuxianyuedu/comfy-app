"use client";

import { useState, type ReactNode } from "react";
import { LayoutGrid, Plus } from "lucide-react";

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

import { sidebarNavItems, isProjectTab, PROJECTS_ENTRY, type WorkspaceView } from "./NavItems";
import { CommandPalette } from "./CommandPalette";
import { TopBar } from "./TopBar";
import { ViewTabStrip, type OpenableView } from "./ViewTabStrip";
import { useTitleBarTabsActive } from "./hooks/use-title-bar-tabs-active";
import type { ViewTab } from "./workspace-tabs";
import { ViewActionsProvider } from "./ViewActions";

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

export type AppShellProps = {
  /** 当前视图（决定侧栏高亮与顶部标题）。 */
  active: WorkspaceView;
  /** 存储里那一格活跃 id，不等于「用户此刻在这个项目里」：首页等全局视图也持有它，
   *  直接当高亮判据会让某项看着被选中、内容却一处没显（ISSUE #1691 第 2 条）；
   *  高亮改由 `insideProject` 按 `active` 视图位置判定。 */
  activeProjectId: string | null;
  activeViewKey?: string;
  /** 主内容。各视图只往这里塞东西，外壳细节（侧栏 / 顶栏 / 滚动容器）不归它们管。 */
  children: ReactNode /**
   * 视图页签（浏览器 / dev 形态下由外壳渲染在内容列最顶端的栏，位于 TopBar 之上）。
   * 不传时外壳行为与从前一致。
   */;
  /** 首帧侧栏展开态。由服务端读 `sidebar_state` cookie 传来（见 `ui/sidebar` 里那段说明）；不传按展开。 */
  defaultSidebarOpen?: boolean;
  onCloseViewTab?: (key: string) => void;
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
  viewTabs?: Array<ViewTab>;
};

/**
 * 应用外壳 —— 左侧栏（`ui/sidebar`）+ 顶部工具条（`TopBar`）+ 主内容。
 * 侧栏顶部是常驻全局项（设置不在其中，入口在顶栏应用菜单）；底部是「项目」折叠分组。
 * 项目类视图是视图页签（入口在 `ViewTabStrip` 的「+」），按分区归属定型、不随视图漂移。
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
  openableViews,
  onOpenView,
  children,
}: AppShellProps) {
  /* 全局命令面板（⌘/Ctrl+K）。状态留在这里：搜索按钮在 TopBar、键盘监听用
   * P20 唯一出口 useHotkey，面板本身由 CommandPalette 渲染。 */
  /* 桌面壳里这条栏由窗口标题行承载（与 `ShellTabs` 同一个判据）。 */
  const titleBarTabs = useTitleBarTabsActive();
  const [commandOpen, setCommandOpen] = useState(false);
  useHotkey({ key: "k", mod: true }, () => {
    setCommandOpen(true);
  });

  /* 侧栏列表 —— 与 `globalNavItems()` 的差别只有一处：设置不在侧栏列
     （它已经撤到顶栏右上角的菜单里，见 `sidebarNavItems` 的说明）。 */
  const navItems = sidebarNavItems();

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
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navItems.map((item) => {
                    const enabled = item.enabled !== false;
                    return (
                      <SidebarMenuItem key={item.id}>
                        {/* 未上线的视图留在列表里但禁用：移除会让「以后有这个」这件事消失，
                          禁用则给出「即将推出」（`tooltip` 里写明）。 */}
                        <SidebarMenuButton
                          disabled={!enabled}
                          isActive={active === item.id}
                          onClick={() => {
                            if (enabled) {
                              onSelect(item.id);
                            }
                          }}
                          tooltip={enabled ? item.label : `${item.label}（即将推出）`}
                        >
                          {item.icon}
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

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
                        {projects.map((project) => (
                          <SidebarMenuItem key={project.id}>
                            <SidebarMenuButton
                              isActive={insideProject && project.id === activeProjectId}
                              onClick={() => {
                                onOpenProject(project.id);
                              }}
                              size="sm"
                              tooltip={project.name}
                            >
                              {/* 缩略图标：展开态与缩略态都要有，否则收起后
                                按钮里只剩一个空格子（名称被 `truncate` 掉）。 */}
                              <ProjectGlyph />
                              <span>{project.name}</span>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        ))}
                        <SidebarMenuItem>
                          <SidebarMenuButton
                            onClick={onShowAllProjects}
                            size="sm"
                            tooltip="查看全部"
                          >
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
          </SidebarContent>

          {/* 原先这里有一个侧栏底「设置」—— 与列表里那一项是同一个动作的两处入口，
            而顶栏右上角的菜单本来就有一处的「设置」。三处收成一处后此处删除：
            一个动作只留一个入口，也顺带不再需要为底部状态栏 24px 让位的 `pb-6`。 */}

          {/* 边缘热区：点击/拖拽也能开合，官方自带。 */}
          <SidebarRail />
        </Sidebar>

        <SidebarInset className="bg-canvas text-ink min-w-0 overflow-hidden">
          {/* 浏览器 / dev 形态的视图页签栏：放到内容列最顶端（TopBar 上方），
            而不是 TopBar 下方。桌面壳里这条栏由窗口标题行承载，这里按同一个判据让位。
            保留在 `SidebarInset` 内部是为了让 fixed 侧栏自然让位，避免被侧栏压住关闭按钮。 */}
          {titleBarTabs ? null : (
            <ViewTabStrip
              activeKey={activeViewKey ?? ""}
              onClose={(key) => onCloseViewTab?.(key)}
              onOpenView={onOpenView}
              onSelect={(key) => onSelectViewTab?.(key)}
              openableViews={openableViews}
              projectNameOf={projectNameOf}
              tabs={viewTabs ?? []}
            />
          )}

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
