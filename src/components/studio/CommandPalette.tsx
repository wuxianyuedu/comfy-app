"use client";

import { useRouter } from "next/navigation";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import { Blocks } from "lucide-react";

import { globalNavItems, projectTabs, type WorkspaceView } from "./NavItems";

export type CommandPaletteProps = {
  /** 当前视图（保留入参：以后按视图给命令排序 / 高亮用，与侧栏同一份数据源）。 */
  active: WorkspaceView;
  onOpenChange: (open: boolean) => void;
  /** 选中某条命令时回调（这里用来切换视图）。 */
  onSelect: (view: WorkspaceView) => void;
  open: boolean;
};

/**
 * 全局命令面板（⌘/Ctrl+K）。走 `command` 基元而不自绘 `Dialog` + 列表，否则撞 P11（自绘浮层
 * 选项列表）。目前收纳「切换视图」（数据源 `NAV_ITEMS` 与侧栏同一份，避免两套事实来源）与
 * 「其他」命令（独立路由的开发者工具）；后续加命令往 `CommandGroup` 里加一组即可。
 */
export function CommandPalette({ open, onOpenChange, onSelect }: CommandPaletteProps) {
  const router = useRouter();
  return (
    <CommandDialog
      description="搜索视图或命令…"
      onOpenChange={onOpenChange}
      open={open}
      title="全局命令"
    >
      <CommandInput placeholder="搜索视图或命令…" />
      <CommandList>
        <CommandEmpty>没有匹配的结果</CommandEmpty>
        <CommandGroup heading="视图">
          {[...globalNavItems(), ...projectTabs()]
            .filter((item) => item.enabled !== false)
            .map((item) => (
              <CommandItem
                key={item.id}
                onSelect={() => {
                  onSelect(item.id);
                  onOpenChange(false);
                }}
                value={`${item.label} ${item.id}`}
              >
                {item.icon}
                <span>{item.label}</span>
              </CommandItem>
            ))}
        </CommandGroup>
        <CommandGroup heading="其他">
          {/* 不进 17 视图注册表的开发者工具走独立路由，命令只负责导航 ——
              视图切换（含页签状态）与路由跳转是两套机制，不混用。 */}
          <CommandItem
            onSelect={() => {
              router.push("/ui-kit");
              onOpenChange(false);
            }}
            value="UI 控件总览 ui-kit"
          >
            <Blocks aria-hidden />
            <span>UI 控件总览</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
