"use client";

import { Bug, ChevronDown, Moon, Search, Settings, Sun } from "lucide-react";
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
import { HeaderHelp } from "~/components/ui/header-help";
import { Hint } from "~/components/ui/hint";
import { Kbd, KbdGroup } from "~/components/ui/kbd";
import { Separator } from "~/components/ui/separator";
import { SidebarTrigger } from "~/components/ui/sidebar";

import { NAV_ITEMS, type WorkspaceView } from "./NavItems";
import { useDevtoolsLauncher } from "./use-devtools-launcher";
import { viewHelp } from "./ViewHelp";
import { ViewActionsHost } from "./ViewActions";

export type TopBarProps = {
  /** 当前视图 —— 显示成标题，让用户知道自己在哪。 */
  active: WorkspaceView;
  /** 打开全局命令面板（⌘/Ctrl+K），由 `AppShell` 用 `useHotkey` 监听并透传。 */
  onOpenSearch: () => void;
  /** 打开设置（overlay，不跳 `/settings` 路由）。 */
  onOpenSettings: () => void;
};

/**
 * 顶部工具条（规范 §12.1 里与 `AppShell` 并列的那个空位）：侧栏开合（`SidebarTrigger`，即「宽栏 ↔ 图标档」，⌘/Ctrl+B 与 cookie 记忆封在 `ui/sidebar` 内部）、当前视图标题、全局搜索（⌘/Ctrl+K，`command` 基元，`AppShell` 用 `useHotkey` 打开；自绘 `Dialog` + 列表会撞 P11）、消息入口（复用状态栏 `MessageCenterButton`）、应用菜单（设置）、光暗一键切换（`next-themes` 的 `setTheme`）。
 * 首页顶栏那排装饰性占位（假搜索框、只弹 toast 的铃铛与头像）已撤，只留有真实后端的；光暗切换此前「只有承诺没有实现」（设置页外观分区写着顶栏有太阳/月亮按钮，而全仓没有）。
 * 标题放这里是因为侧栏头部「Comfy-APP」名称行没有承载信息（图标档只剩一个字母），而工具条图标与文字之间恰好空着一个槽位；全局只有这一行顶栏，顶部还因此省下约 3.5rem 纵向空间。
 */
export function TopBar({ active, onOpenSettings, onOpenSearch }: TopBarProps) {
  const label = NAV_ITEMS.find((item) => item.id === active)?.label ?? "工作区";
  /* 这一屏的说明文案（没有登记的视图没有说明，问号整个不渲染）。 */
  const help = viewHelp(active);
  const { resolvedTheme, setTheme } = useTheme();
  /* 开发者工具入口：只在壳带 `devtools` feature 时出现（发布壳里不渲染）。
     快捷键（⌘/Ctrl+Shift+I 与 F12）由 useDevtoolsLauncher 一并注册，
     判据与按钮同源，详见该文件。 */
  const devtools = useDevtoolsLauncher();

  /**
   * 一键翻深浅色。读 `resolvedTheme` 而非 `theme`：后者可能是 `"system"`，那样点一下会写成 system 而画面没变
   * （本仓库 `enableSystem={false}`，但这条不依赖那个前提）。
   */
  const toggleTheme = () => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  };

  return (
    <header className="border-border-subtle bg-canvas z-base flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <SidebarTrigger className="-ml-1" />
      {/* 竖档基元默认 `data-vertical:self-stretch`，而 flexbox 规则里 stretch 在
          交叉尺寸非 auto（这里给了 `h-4`）时退化为顶对齐 —— 这根短线会被钉在
          顶栏上沿成一截孤线（ISSUE #3587）。用**同形变体**声明居中：cn 合并时
          同组同变体会把基类的 self-stretch 挤掉，覆盖是确定性的；换成任意变体
          `data-[orientation=vertical]:` 的写法两类并存、要输给样式表顺序，别改。 */}
      <Separator
        className="data-vertical:self-center data-[orientation=vertical]:h-4"
        orientation="vertical"
      />
      <span className="text-ink-strong min-w-0 truncate text-sm font-medium" title={label}>
        {label}
      </span>
      {/* 视图说明问号：挂在标题右侧（读者在「这一屏叫什么」的地方顺路看见「还有
          一句解释」）。没有登记的视图不渲染 —— 「没有说明的不显示」。屏内页头不再
          放第二颗：那句话的单一出处是 `viewHelp()`。 */}
      {help === undefined ? null : <HeaderHelp text={help} />}

      <div className="ml-auto flex min-w-0 items-center gap-1">
        {/* 本屏动作的落点（`ViewActions`）。放在全局控件之前：本屏的动作与
            「这一屏叫什么」挨着读，全局搜索 / 主题 / 消息 / 菜单始终在最右端，
            位置不随视图变。空槽不占宽度（`min-w-0` + 无子节点）。 */}
        <ViewActionsHost />
        <Hint label="全局搜索（⌘K）">
          <Button
            aria-label="全局搜索"
            className="gap-1.5"
            onClick={onOpenSearch}
            size="sm"
            variant="ghost"
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
          <Button aria-label="切换深浅色" onClick={toggleTheme} size="icon-sm" variant="ghost">
            {/* 两枚都渲染、靠 `dark:` 决定可见性：`resolvedTheme` 在服务端与首帧是
                undefined，按它条件渲染会让按钮在 hydration 后跳一下。 */}
            <Sun className="dark:hidden" data-icon="inline-start" size={16} />
            <Moon className="hidden dark:block" data-icon="inline-start" size={16} />
          </Button>
        </Hint>
        <MessageCenterButton />

        <DropdownMenu>
          {/* `render` 必须直接收那颗 `<Button>`：`DropdownMenuTrigger` 会把 menu 的触发属性（pointerdown / click / `aria-haspopup`）以 props 形式灌进它收到的元素，而 `Hint` 只吃 `label` / `side` / `accessibleName` / `wrap` / `children`、不转发任意 props —— 套在中间（`render={<Hint>…</Hint>}`）等于把这串 props 全丢掉，表现是**按钮点不开菜单**（ISSUE #1384）。
              顺序只能是「`Hint` 在外、`DropdownMenuTrigger` 在内」：`TooltipTrigger` 与 `Menu.Trigger` 都是 `render` 接管同一个子元素，两层 props 会**合并**到那颗 `<Button>` 上，互不吞并。 */}
          <Hint label="应用菜单">
            <DropdownMenuTrigger
              render={
                <Button aria-label="应用菜单" size="icon-sm" variant="ghost">
                  <ChevronDown data-icon="inline-start" />
                </Button>
              }
            />
          </Hint>
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
              {/* 开发者工具：排查渲染 / 脚本性能用。判据是**编译期**有没有
                  devtools feature，所以发布壳里这一项整个不渲染，而不是渲染出来
                  点一下报「未启用」。快捷键 ⌘/Ctrl+Shift+I 与 F12 同判据。 */}
              {devtools.available ? (
                <DropdownMenuItem onClick={devtools.open}>
                  <Bug strokeWidth={1.8} />
                  开发者工具
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
