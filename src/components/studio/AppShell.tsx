"use client";

import { useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Plus, Settings } from "lucide-react";

import { useHotkey } from "~/components/ui/use-hotkey";
import { Disclosure } from "~/components/ui/disclosure";
import { cn } from "~/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
} from "~/components/ui/sidebar";

import {
  globalNavItems,
  OVERLAY_NAV_ITEMS,
  PROJECTS_ENTRY,
  type OverlayEntryId,
  type WorkspaceView,
} from "./NavItems";
import { CommandPalette } from "./CommandPalette";
import { TopBar } from "./TopBar";

/* 两个全局浮层懒加载：它们各自拉起契约编辑器 / 适配器表格与 tRPC 查询，而外壳在
 * **每个**工作区视图里都挂着 —— 即时加载等于把这两块的代价摊到所有首屏上。
 * 与 `app/workspace/page.tsx` 里那批视图同一个口径（`ssr: false`：弹窗只在点开后存在）。 */
const ModeContractDialog = dynamic(
  () =>
    import("~/components/workshop/mode-contract/ModeContractDialog").then(
      (mod) => mod.ModeContractDialog,
    ),
  { ssr: false },
);
const WorkshopModelAdapterModal = dynamic(
  () =>
    import("~/components/workshop/WorkshopModelAdapterModal").then(
      (mod) => mod.WorkshopModelAdapterModal,
    ),
  { ssr: false },
);

/** 侧栏底部「项目」分组里列出的一条项目（只需 id + 展示名）。 */
export interface SidebarProject {
  id: string;
  name: string;
}

export interface AppShellProps {
  /** 当前视图（决定侧栏高亮与顶部标题）。 */
  active: WorkspaceView;
  /** 切换视图。 */
  onSelect: (view: WorkspaceView) => void;
  /** 打开设置 —— 走 overlay（不跳 `/settings` 路由），workspace 的组件树因此不卸载。 */
  onOpenSettings: () => void;
  /** 首帧侧栏展开态。由服务端读 `sidebar_state` cookie 传来（见 `ui/sidebar` 里那段说明）；不传按展开。 */
  defaultSidebarOpen?: boolean;
  /** 底部「项目」分组列出的项目（来自 canvas-store）。 */
  projects: SidebarProject[];
  /** 当前活跃项目 id（用于高亮分组里的对应项）。 */
  activeProjectId: string | null;
  /** 点开某个项目 → 进入项目界面（画布为其默认页签）。 */
  onOpenProject: (id: string) => void;
  /** 「查看全部」→ 项目网格落地页（works）。 */
  onShowAllProjects: () => void;
  /** 新建项目 → 建一条 proj_* 并进画布。 */
  onNewProject: () => void;
  /** 主内容。各视图只往这里塞东西，外壳细节（侧栏 / 顶栏 / 滚动容器）不归它们管。 */
  children: ReactNode;
}

/**
 * 应用外壳 —— 左侧栏（官方 `ui/sidebar`）+ 顶部工具条（`TopBar`）+ 主内容。
 *
 * 侧栏分两段：
 *   · 顶部 = 全局项（首页 / 模型 / 历史 / 队列 / 炼丹 / 流程 + 两个全局浮层入口
 *     模型适配 / 模式契约），常驻、不随当前视图增减；
 *   · 底部 = 「项目」折叠分组（`Disclosure`，P10 唯一实现），展开列出已有项目 + 查看全部 / 新建。
 *
 * 画布 / 工坊 / 产出 / 成片不再出现在这里 —— 它们是「项目界面」内部的顶部标签页
 * （见 `ProjectTabBar`）。此前用 `active === "home"` 决定这四项显隐，导致点「项目」等
 * 非首页视图时它们莫名复现；改成按分区归属一次性定型，显隐不再随视图漂移。
 *
 * 两个浮层入口（模型适配 / 模式契约）**是应用级的、与项目无关**，所以留在这里而不是
 * 工坊顶栏：它们读写的是全局注册表（模式契约 = 每种模式有哪些统一输入 / 输出；
 * 模型适配 = 每个远端模型 × 每个模式的字段映射），换项目不该重配一遍。弹窗挂在
 * 外壳这一层（而不是某个视图内部），切视图时也不会被连带卸载。
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
  children,
}: AppShellProps) {
  /* 全局命令面板（⌘/Ctrl+K）。状态留在这里：搜索按钮在 TopBar、键盘监听用
   * P20 唯一出口 useHotkey，面板本身由 CommandPalette 渲染。 */
  const [commandOpen, setCommandOpen] = useState(false);
  useHotkey({ key: "k", mod: true }, () => setCommandOpen(true));

  const navItems = globalNavItems();
  /* 浮层入口同一时刻只开一个：两项都是「配置全局注册表」，同时铺两层弹窗只会互遮。
     状态与命令面板同源归外壳 —— 它们不属于任何视图。 */
  const [overlay, setOverlay] = useState<OverlayEntryId | null>(null);

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

                {/* 全局浮层入口：紧跟「流程」之后。它们不切换视图（`isActive` 恒 false），
                    故不参与高亮；点击只开弹窗。 */}
                {OVERLAY_NAV_ITEMS.map((item) => (
                  <SidebarMenuItem key={item.overlay}>
                    <SidebarMenuButton
                      isActive={false}
                      tooltip={item.label}
                      onClick={() => setOverlay(item.overlay)}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {/* 「项目」分组：紧跟全局项之后（不再 `mt-auto` 顶到视口最下，避免中间一大片空白）。
              图标档折叠时整组隐藏 —— 展开式列表在 3rem 图标栏里没有落点，展开侧栏才能选项目。 */}
          <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <Disclosure
                    defaultOpen
                    marker="chevron"
                    trigger={
                      <>
                        {PROJECTS_ENTRY.icon}
                        <span>{PROJECTS_ENTRY.label}</span>
                      </>
                    }
                    className={cn(
                      "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      "rounded-md p-2 text-sm font-medium [&_svg]:size-4 [&_svg]:shrink-0",
                    )}
                    panelClassName="mt-1"
                  >
                    <SidebarMenuSub>
                      {projects.map((project) => (
                        <SidebarMenuSubItem key={project.id}>
                          <SidebarMenuButton
                            size="sm"
                            isActive={project.id === activeProjectId}
                            tooltip={project.name}
                            onClick={() => onOpenProject(project.id)}
                          >
                            <span>{project.name}</span>
                          </SidebarMenuButton>
                        </SidebarMenuSubItem>
                      ))}
                      <SidebarMenuSubItem>
                        <SidebarMenuButton
                          size="sm"
                          onClick={onShowAllProjects}
                        >
                          <span>查看全部</span>
                        </SidebarMenuButton>
                      </SidebarMenuSubItem>
                      <SidebarMenuSubItem>
                        <SidebarMenuButton size="sm" onClick={onNewProject}>
                          <Plus />
                          <span>新建项目</span>
                        </SidebarMenuButton>
                      </SidebarMenuSubItem>
                    </SidebarMenuSub>
                  </Disclosure>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        {/* 底部避让全局固定状态栏（BrowserStatusBar 是 fixed bottom-0 h-6 = 24px、
            横跨整窗）：侧栏由 SidebarProvider 的 min-h-svh 撑满整屏，底部「设置」
            会被这 24px 盖住。留 pb-6 与主内容 / ScriptMarkdownEditor 同一口径。 */}
        <SidebarFooter className="pb-6">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="设置" onClick={onOpenSettings}>
                <Settings strokeWidth={1.8} />
                <span>设置</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>

        {/* 边缘热区：点击/拖拽也能开合，官方自带。 */}
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="bg-canvas text-ink min-w-0 overflow-hidden">
        <TopBar
          active={active}
          onOpenSettings={onOpenSettings}
          onOpenSearch={() => setCommandOpen(true)}
        />
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {children}
        </div>
      </SidebarInset>

      {/* 两个全局浮层：与「模型适配 / 模式契约」两个侧栏入口一一对应。
          与工坊里那份**同一个组件**，改完注册表两处读到的是同一份口径。 */}
      {overlay === "model-adapters" && (
        <WorkshopModelAdapterModal onClose={() => setOverlay(null)} />
      )}
      {overlay === "mode-contract" && (
        <ModeContractDialog onClose={() => setOverlay(null)} />
      )}

      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        active={active}
        onSelect={onSelect}
      />
    </SidebarProvider>
  );
}
