"use client";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";

import { visibleNavItems, type WorkspaceView } from "./NavItems";

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 当前视图：首页时命令面板也不列项目作用域工具（画布 / 工坊），与侧栏同一规则。 */
  active: WorkspaceView;
  /** 选中某条命令时回调（这里用来切换视图）。 */
  onSelect: (view: WorkspaceView) => void;
}

/**
 * 全局命令面板（⌘/Ctrl+K）。
 *
 * 这一项此前被压住没做，是因为它要 `command` 基元，而那批基元当时还没合并
 * （在 #886）。现在 `command` 已在 master，这里落地 —— 走基元而不是
 * `Dialog` + 自绘列表，否则会撞 P11（自绘浮层选项列表）。
 *
 * 目前只收纳「切换视图」这一类命令，数据源就是 `NAV_ITEMS`，与侧栏同一份
 * （避免两套事实来源）。后面要加「打开设置 / 搜项目」等，往 `CommandGroup`
 * 里加一组即可，不必动侧栏。
 */
export function CommandPalette({
  open,
  onOpenChange,
  active,
  onSelect,
}: CommandPaletteProps) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="全局命令"
      description="搜索视图或命令…"
    >
      <CommandInput placeholder="搜索视图或命令…" />
      <CommandList>
        <CommandEmpty>没有匹配的结果</CommandEmpty>
        <CommandGroup heading="视图">
          {visibleNavItems(active)
            .filter((item) => item.enabled !== false)
            .map((item) => (
              <CommandItem
                key={item.id}
                value={`${item.label} ${item.id}`}
                onSelect={() => {
                  onSelect(item.id);
                  onOpenChange(false);
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </CommandItem>
            ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
