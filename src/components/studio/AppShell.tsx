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

import {
  sidebarNavItems,
  isProjectTab,
  PROJECTS_ENTRY,
  type WorkspaceView,
} from "./NavItems";
import { CommandPalette } from "./CommandPalette";
import { TopBar } from "./TopBar";
import { ViewTabStrip, type OpenableView } from "./ViewTabStrip";
import { useTitleBarTabsActive } from "./hooks/use-title-bar-tabs-active";
import { type ViewTab } from "./workspace-tabs";

/** 侧栏底部「项目」分组里列出的一条项目（只需 id + 展示名）。 */
export interface SidebarProject {
  id: string;
  name: string;
}

/**
 * 一条项目的**缩略图标**。
 *
 * 为什么每条都要有这一个：侧栏收起成图标轨（`collapsible="icon"`）时，
 * `SidebarMenuButton` 变成 `size-8` 的方块、名称那一格被 `truncate` 成零宽
 * —— 没有图标的行就只剩一个空格子，用户既认不出是哪条项目、也点不下去
 * （ISSUE #1691）。所以「项目列表缩略也要能显示名称」这一条拆成两半：
 * 缩略态有可辨认的**图形**（这里），名字则交给基元的 `tooltip`（悬停即出）。
 *
 * 图形取「画布」那一族而不是文件夹：项目分组里列出的每一条都是画布项目
 * （`canvas-store` 的 `proj_*`），与 `/workspace` 首页「新建画布」卡同一族。
 */
function ProjectGlyph() {
  return (
    <svg
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 21V9" />
      <circle cx="15" cy="15" r="2" />
    </svg>
  );
}

export interface AppShellProps {
  /** 当前视图（决定侧栏高亮与顶部标题）。 */
  active: WorkspaceView;
  /** 切换视图。 */
  onSelect: (view: WorkspaceView) => void;
  /** 打开设置 —— 切到 `settings` **视图页签**（与历史 / 队列 / 控制台同一套），
   *  不再是 workspace 上的一层浮层，也不跳 `/settings` 路由：组件树因此不卸载。 */
  onOpenSettings: () => void;
  /** 首帧侧栏展开态。由服务端读 `sidebar_state` cookie 传来（见 `ui/sidebar` 里那段说明）；不传按展开。 */
  defaultSidebarOpen?: boolean;
  /** 底部「项目」分组列出的项目（来自 canvas-store）。 */
  projects: SidebarProject[];
  /** 当前活跃项目 id。
   *
   *  ⚠️ 它是**存储里那一格活跃 id**，不等于「用户此刻在这个项目里」—— 两者
   *  由本组件按 `active` 视图位置区分（见下方 `insideProject`）：应用首页也
   *  持有活跃 id，但那一屏上没有任何项目内容，把 id 直接当高亮判据会让分组里
   *  某一项**看起来被选中、而它对应的内容一处都没显示**（ISSUE #1691 第 2 条）。 */
  activeProjectId: string | null;
  /** 点开某个项目 → 进入项目界面（画布为其默认页签）。 */
  onOpenProject: (id: string) => void;
  /** 「查看全部」→ 项目网格落地页（works）。 */
  onShowAllProjects: () => void;
  /** 新建项目 → 建一条 proj_* 并进画布。 */
  onNewProject: () => void;
  /** 主内容。各视图只往这里塞东西，外壳细节（侧栏 / 顶栏 / 滚动容器）不归它们管。 */
  children: ReactNode; /**
   * 视图页签（浏览器 / dev 形态下由外壳在内容列里渲染那条栏）。
   * 不传时外壳行为与从前一致。
   */
  viewTabs?: ViewTab[];
  activeViewKey?: string;
  projectNameOf?: (projectId: string | null) => string | null | undefined;
  onSelectViewTab?: (key: string) => void;
  onCloseViewTab?: (key: string) => void;
  openableViews?: OpenableView[];
  onOpenView?: (view: WorkspaceView) => void;
}

/**
 * 应用外壳 —— 左侧栏（官方 `ui/sidebar`）+ 顶部工具条（`TopBar`）+ 主内容。
 *
 * 侧栏分两段：
 *   · 顶部 = 全局项（首页 / 模型 / 历史 / 队列 / 流程 / 模型适配 / 模式契约 /
 *     控制台），常驻、不随当前视图增减 —— **设置不在其中**（`sidebarNavItems`）：
 *     它的入口是顶栏右上角的应用菜单，侧栏不再重复列一遍；
 *   · 底部 = 「项目」折叠分组（`Disclosure`，P10 唯一实现），展开列出已有项目 + 查看全部 / 新建。
 *
 * 主页 / 画布 / 工坊 / 资源库 / 产出 / 成片不再出现在这里 —— 它们是**视图页签**，入口是页签条
 * 上的「+」（见 `ViewTabStrip`；原先那条 `ProjectTabBar` 已退役）。此前用
 * `active === "home"` 决定这些页签显隐，导致点「项目」等非首页视图时它们莫名复现；
 * 改成按分区归属一次性定型，显隐不再随视图漂移。
 *
 * 模型适配 / 模式契约**是应用级的、与项目无关**，所以入口留在侧栏全局项而不是工坊顶栏：
 * 它们读写的是全局注册表（模式契约 = 每种模式有哪些统一输入 / 输出；模型适配 = 每个远端
 * 模型 × 每个模式的字段映射）。它们此前是「点开弹窗、不改视图」的浮层入口，挂在外壳这一层
 * 才能做到切视图也不被连带卸载 —— 现在不需要那个理由了：它们与别的视图同一条渲染路径
 * （`app/workspace/page.tsx` 的 `renderCenter`），开着时就是当前页签，关掉即卸载。
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
  useHotkey({ key: "k", mod: true }, () => setCommandOpen(true));

  /* 侧栏列表 —— 与 `globalNavItems()` 的差别只有一处：设置不在侧栏列
     （它已经撤到顶栏右上角的菜单里，见 `sidebarNavItems` 的说明）。 */
  const navItems = sidebarNavItems();

  /* 「用户此刻在这个项目里」—— 侧栏项目行要不要打高亮，判据是**视图位置**，
   * 不是存储里有没有活跃 id。
   *
   * 为什么不能直接用 `project.id === activeProjectId`（ISSUE #1691 第 2 条）：
   * 活跃 id 是**跨视图常驻**的（新建项目、从最近项目点进来都写它），而首页 /
   * 模型 / 历史这些全局视图上没有任何项目内容 —— 于是「项目」分组里总有一项
   * 亮着，读起来就是「你已经在这个项目里，只是内容没显示出来」。用户的原话
   * 正是这个：*项目未显示，默认有个选中*。
   *
   * 判据取 `isProjectTab`（项目页签 = 主页 / 画布 / 工坊 / 资源库 / 产出 / 成片）：
   * 那六个视图的每一屏都**只讲当前项目**，只有在它们上面，「亮着的那一项」与
   * 「屏幕上这块内容」才是同一件事。 */
  const insideProject = isProjectTab(active);

  return (
    <SidebarProvider
      defaultOpen={defaultSidebarOpen}
      className="h-full min-h-0"
    >
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
                        isActive={active === item.id}
                        disabled={!enabled}
                        tooltip={
                          enabled ? item.label : `${item.label}（即将推出）`
                        }
                        onClick={() => {
                          if (enabled) onSelect(item.id);
                        }}
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

          {/* 「项目」分组：紧跟全局项之后（不再 `mt-auto` 顶到视口最下，避免中间一大片空白）。
              **图标档（缩略态）不再整组隐藏**（ISSUE #1691）：此前这里挂着
              `group-data-[collapsible=icon]:hidden`，窗口一窄到自动收起，用户就
              既看不见项目名、也切不了项目 —— 而「项目」恰恰是这一屏最需要按名字
              找到的东西。现在缩略态下每一项都落成**带缩略图标 + 名称 tooltip**
              的方块（与全局项同一套 `SidebarMenuButton` 机制）：名字仍够得着，
              展开侧栏则照旧是完整列表。 */}
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <Disclosure
                    defaultOpen
                    marker="chevron"
                    trigger={
                      <>
                        {PROJECTS_ENTRY.icon}
                        <span className="group-data-[collapsible=icon]:hidden">
                          {PROJECTS_ENTRY.label}
                        </span>
                      </>
                    }
                    className={cn(
                      "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      "rounded-md p-2 text-sm font-medium [&_svg]:size-4 [&_svg]:shrink-0",
                      /* 缩略态：整行落成与全局项同形的 48px 方块 —— 折叠标记
                         与文字都让位，只留分组图标（否则这一行宽过图标轨、
                         `overflow-hidden` 把它裁掉一半）。 */
                      "group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center",
                      "group-data-[collapsible=icon]:[&_[data-slot=disclosure-marker]]:hidden",
                    )}
                    panelClassName="mt-1"
                  >
                    <SidebarMenu>
                      {projects.map((project) => (
                        <SidebarMenuItem key={project.id}>
                          <SidebarMenuButton
                            size="sm"
                            isActive={
                              insideProject && project.id === activeProjectId
                            }
                            tooltip={project.name}
                            onClick={() => onOpenProject(project.id)}
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
                          size="sm"
                          tooltip="查看全部"
                          onClick={onShowAllProjects}
                        >
                          <LayoutGrid />
                          <span>查看全部</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          size="sm"
                          tooltip="新建项目"
                          onClick={onNewProject}
                        >
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
        <TopBar
          active={active}
          onOpenSettings={onOpenSettings}
          onOpenSearch={() => setCommandOpen(true)}
        />

        {/* 浏览器 / dev 形态的视图页签栏。放在内容列（`SidebarInset`）之内而不是
            `ShellTabs` 那一层：侧栏是 fixed 定位，整窗宽度那一层会被它压住（实测
            关闭按钮报「subtree intercepts pointer events」）。桌面壳里这条栏由窗口
            标题行承载，所以这里按同一个判据让位。 */}
        {titleBarTabs ? null : (
          <ViewTabStrip
            tabs={viewTabs ?? []}
            activeKey={activeViewKey ?? ""}
            projectNameOf={projectNameOf}
            onSelect={(key) => onSelectViewTab?.(key)}
            onClose={(key) => onCloseViewTab?.(key)}
            openableViews={openableViews}
            onOpenView={onOpenView}
          />
        )}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {children}
        </div>
      </SidebarInset>

      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        active={active}
        onSelect={onSelect}
      />
    </SidebarProvider>
  );
}
