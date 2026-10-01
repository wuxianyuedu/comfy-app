"use client";

import { ChevronDown, Moon, Search, Settings, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { MessageCenterButton } from "~/components/message-center/MessageCenterButton";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Hint } from "~/components/ui/hint";
import { Kbd, KbdGroup } from "~/components/ui/kbd";
import { Separator } from "~/components/ui/separator";
import { SidebarTrigger } from "~/components/ui/sidebar";

import { NAV_ITEMS, type WorkspaceView } from "./NavItems";

export interface TopBarProps {
  /** 当前视图 —— 显示成标题，让用户知道自己在哪。 */
  active: WorkspaceView;
  /** 打开设置（overlay，不跳 `/settings` 路由）。 */
  onOpenSettings: () => void;
  /** 打开全局命令面板（⌘/Ctrl+K），由 `AppShell` 用 `useHotkey` 监听并透传。 */
  onOpenSearch: () => void;
}

/**
 * 顶部工具条（规范 §12.1 里与 `AppShell` 并列的那个空位）。
 *
 * 三件事：
 *
 *   - **侧栏开合**：`SidebarTrigger`。它同时就是「布局切换」—— 官方 `sidebar` 在
 *     `collapsible="icon"` 下，这个按钮切换的正是「宽栏 ↔ 图标档」两种形态；
 *     ⌘/Ctrl+B 与 cookie 记忆都封在 `ui/sidebar` 内部（走 `useHotkey`）。
 *   - **当前视图标题**：取代首页顶栏那排装饰性控件。那几个此前都是占位
 *     （搜索框是一个 `<div>` 假实现、铃铛与头像只弹一句 toast），本轮只留
 *     有真实后端的：消息入口复用状态栏那个 `MessageCenterButton`
 *     （`useMessageCenterStore` 的唯一出口，不再自绘一个铃铛）。
 *   - **全局搜索（⌘/Ctrl+K 命令面板）**：接 `command` 基元（`AppShell` 里用
 *     `useHotkey` 监听 ⌘/Ctrl+K 打开）。此前压住是因为 `command` 还没合并
 *     （在 #886），用 `Dialog` + 自绘列表会撞 P11（自绘浮层选项列表）。
 *   - **应用菜单**：设置。
 *   - **光暗一键切换**：`next-themes` 的 `setTheme`，与设置页外观分区同一个出口。
 *     这一颗此前**只有承诺没有实现** —— 设置页外观分区一直写着「也可通过顶部导航栏的
 *     太阳/月亮按钮随时切换」，而全仓没有那个按钮（改深浅色只能进设置页）。与其删掉那句
 *     承诺，不如把它补上：主题是最常用的单一开关，藏在一层导航之后不合理。
 *
 * 视图标题放在这里，是因为侧栏头部那条「Comfy-APP」名称行**没有承载任何信息**：
 * 图标档下它只剩一个字母，展开档下用户早就知道自己开的是什么应用；而工具条里
 * 图标与文字之间恰好空着一个槽位（右侧的搜索 / 消息 / 菜单靠 `ml-auto` 顶到
 * 最右），标题正好补上——**应用全局只有这一行顶栏**（首页与其余视图共用 `AppShell`，
 * 项目页签的主页 / 画布 / 工坊 / 资源库 / 产出 / 成片走 `ProjectTabBar` 高亮，见 `ProjectTabBar`）。
 * 只是那个名称行也不白占：顶部省下约 3.5rem 的纵向空间。
 */
export function TopBar({ active, onOpenSettings, onOpenSearch }: TopBarProps) {
  const label = NAV_ITEMS.find((item) => item.id === active)?.label ?? "工作区";
  const { resolvedTheme, setTheme } = useTheme();

  /**
   * 一键翻深浅色。
   *
   * 读的是 `resolvedTheme` 而不是 `theme`：`theme` 可能是 `"system"`，那样点一下
   * 会写成 system 而画面没变（本仓库 `enableSystem={false}`，但这条不依赖那个前提）。
   */
  const toggleTheme = () => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  };

  return (
    <header className="border-border-subtle bg-canvas/85 z-base flex h-12 shrink-0 items-center gap-2 border-b px-3 backdrop-blur-sm">
      <SidebarTrigger className="-ml-1" />
      <Separator
        orientation="vertical"
        className="data-[orientation=vertical]:h-4"
      />
      <span
        className="text-ink-strong min-w-0 truncate text-sm font-medium"
        title={label}
      >
        {label}
      </span>

      <div className="ml-auto flex items-center gap-1">
        <Hint label="全局搜索（⌘K）">
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenSearch}
            className="gap-1.5"
            aria-label="全局搜索"
          >
            <Search data-icon="inline-start" size={16} />
            <span className="hidden md:inline">搜索</span>
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </KbdGroup>
          </Button>
        </Hint>
        <Hint label="切换深浅色">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggleTheme}
            aria-label="切换深浅色"
          >
            {/* 两枚都渲染、靠 `dark:` 决定可见性：`resolvedTheme` 在服务端与首帧是
                undefined，按它条件渲染会让按钮在 hydration 后跳一下。 */}
            <Sun data-icon="inline-start" size={16} className="dark:hidden" />
            <Moon
              data-icon="inline-start"
              size={16}
              className="hidden dark:block"
            />
          </Button>
        </Hint>
        <MessageCenterButton />

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Hint label="应用菜单">
                <Button variant="ghost" size="icon-sm" aria-label="应用菜单">
                  <ChevronDown data-icon="inline-start" />
                </Button>
              </Hint>
            }
          />
          <DropdownMenuContent align="end" className="w-44">
            {/* base-ui 的 DropdownMenuLabel 实为 Menu.GroupLabel，必须包在
                DropdownMenuGroup（或 DropdownMenuRadioGroup）里；否则打开菜单会抛
                "MenuGroupContext is missing"（与 CanvasContextMenu 同款约定）。 */}
            <DropdownMenuGroup>
              <DropdownMenuLabel>应用</DropdownMenuLabel>
              <DropdownMenuItem onClick={onOpenSettings}>
                <Settings strokeWidth={1.8} />
                设置
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
