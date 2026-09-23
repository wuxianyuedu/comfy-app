"use client";

import { useState, type ReactNode } from "react";
import { Settings } from "lucide-react";

import { useHotkey } from "~/components/ui/use-hotkey";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
} from "~/components/ui/sidebar";

import { visibleNavItems, type WorkspaceView } from "./NavItems";
import { CommandPalette } from "./CommandPalette";
import { TopBar } from "./TopBar";

export interface AppShellProps {
  /** 当前视图（决定侧栏高亮与顶部标题）。 */
  active: WorkspaceView;
  /** 切换视图。 */
  onSelect: (view: WorkspaceView) => void;
  /** 打开设置 —— 走 overlay（不跳 `/settings` 路由），workspace 的组件树因此不卸载。 */
  onOpenSettings: () => void;
  /** 首帧侧栏展开态。由服务端读 `sidebar_state` cookie 传来（见 `ui/sidebar` 里那段说明）；不传按展开。 */
  defaultSidebarOpen?: boolean;
  /** 主内容。各视图只往这里塞东西，外壳细节（侧栏 / 顶栏 / 滚动容器）不归它们管。 */
  children: ReactNode;
}

/**
 * 应用外壳 —— 左侧栏（官方 `ui/sidebar`）+ 顶部工具条（`TopBar`）+ 主内容。
 *
 * ## 为什么现在才有它
 *
 * 规范 §12.1 的目录树与 §12.2 的 barrel 示例里一直写着 `AppShell` / `TopBar`
 * 两个名字，但文件从未落地。主界面此前是 `workspace/page.tsx` 里手工拼的
 * 「64px 自绘竖排导航条 + 各视图自己的内容」，首页 `HomePage` 另有一份内联
 * 顶部条（搜索是个 `<div>` 假实现、铃铛与头像只弹一句 toast 占位）——
 * 同一件事两处实现，且两处都没有官方基元已有的能力（折叠成图标档 / ⌘B / 记忆）。
 *
 * 引入官方 `sidebar` 后，这里把三件事一次收拢：
 *
 *   - **侧栏**：`NAV_ITEMS` 的**唯一**渲染者（`WorkspaceNav` 随之退役）；
 *   - **顶部工具条**：`TopBar`（§12.1 的另一个空位）；
 *   - **主内容**：`SidebarInset`（渲染成 `<main>`，符合规范 06 的语义标签要求）。
 *
 * 侧栏开合态由 `ui/sidebar` 自己写 cookie（`sidebar_state`）、并由**服务端**
 * 读出来经 `defaultSidebarOpen` 回传，首屏即用户上次选的那一档；⌘/Ctrl+B
 * 与「在输入框里不抢键」都由 `ui/sidebar` 内部走 `useHotkey` 保证。
 */
export function AppShell({
  active,
  onSelect,
  onOpenSettings,
  defaultSidebarOpen,
  children,
}: AppShellProps) {
  /* 全局命令面板（⌘/Ctrl+K）。状态留在这里：搜索按钮在 TopBar、键盘监听用
   * P20 唯一出口 useHotkey，面板本身由 CommandPalette 渲染。 */
  const [commandOpen, setCommandOpen] = useState(false);
  useHotkey({ key: "k", mod: true }, () => setCommandOpen(true));

  /* 首页不显示项目作用域工具（画布 / 工坊）——它们是对「当前项目」的操作投影，
   * 只有进入某个项目后才出现在侧栏。规则收在 `visibleNavItems`，与命令面板共用。 */
  const navItems = visibleNavItems(active);

  return (
    <SidebarProvider
      defaultOpen={defaultSidebarOpen}
      className="h-full min-h-0"
    >
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                tooltip="Comfy-APP"
                onClick={() => onSelect("home")}
              >
                <span className="text-ink-strong grid flex-1 text-left text-sm leading-tight font-semibold">
                  Comfy-APP
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

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
        </SidebarContent>

        <SidebarFooter>
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

      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        active={active}
        onSelect={onSelect}
      />
    </SidebarProvider>
  );
}
