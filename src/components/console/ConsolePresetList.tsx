"use client";

// 控制台预设命令列表（视图第③层，纯展示）。
// 唯一的交互决定：点预设是「填进输入框」而不是直接跑——预设里有 `pnpm db:push`
// 这种真改库的命令，须按回车前看清，且与自由行保持同一条链路。侧栏窄
// （240px）说明小字必被 truncate，悬停浮层要补全说明与命令。分组可折叠、
// 默认全折起是有意的；折叠走 ui/disclosure + ui/expansion-set（唯一出口）。

import { ChevronRight } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Disclosure } from "~/components/ui/disclosure";
import { useExpansionSet } from "~/components/ui/expansion-set";
import { Hint } from "~/components/ui/hint";
import { TruncatedText } from "~/components/ui/truncated-text";
import { CONSOLE_PRESETS, type ConsolePreset } from "~/lib/console/console-catalog";

export type ConsolePresetListProps = {
  /** 有命令在跑时禁用（避免用户以为点了就会插队执行）。 */
  disabled: boolean;
  onFill: (command: string) => void;
};

/**
 * 一条预设的悬停提示：展示名 + 说明小字 + 会填进输入框的命令。
 * 三段都带：展示名可能截断、说明小字必然截断、命令从没露过面。
 */
function presetHint(preset: ConsolePreset) {
  return (
    <span className="flex flex-col gap-1 text-left">
      <span className="font-medium">{preset.label}</span>
      <span className="opacity-80">{preset.desc}</span>
      <span className="font-mono opacity-80">{preset.command}</span>
    </span>
  );
}

export function ConsolePresetList({ onFill, disabled }: ConsolePresetListProps) {
  /* 展开集合走唯一出口：键是分组 id，缺键 = 未表态 = 折起
   * （`useExpansionSet` 的既定语义，正是这里要的默认值）。 */
  const groups = useExpansionSet();

  return (
    <div
      className="custom-scrollbar flex h-full min-h-0 flex-col gap-1 overflow-y-auto p-3"
      data-testid="console-preset-list"
    >
      {CONSOLE_PRESETS.map((group) => {
        const open = groups.isExpanded(group.id);
        return (
          <Disclosure
            className="hover:text-ink w-auto flex-1 py-1"
            key={group.id}
            marker="chevron"
            onOpenChange={() => {
              groups.toggle(group.id);
            }}
            open={open}
            panelClassName="basis-full flex flex-col gap-0.5 pt-0.5"
            /* 排布在 Root 上（`rootClassName`）：触发开关与条数是 Root 的并列
             * 子元素，Root 不写 `flex` 就各自独占一行（§16.2.4.13 迁移口径）；
             * `className` 的 `w-auto flex-1` 与之配对（基元默认 `w-full` 会把
             * 条数挤到下一行）。`flex-wrap` 与 `basis-full` 是一对（ISSUE #1902）：
             * 行不换行时 `basis-full` 会横占整行、把 240px 侧栏吃掉。 */
            rootClassName="flex flex-wrap items-center gap-2"
            trailing={
              <span className="text-ink-fainter text-3xs shrink-0 tabular-nums">
                {group.items.length}
              </span>
            }
            trigger={
              <span className="min-w-0 flex-1" data-testid={`console-preset-group-${group.id}`}>
                <span className="text-ink block text-xs font-semibold">{group.label}</span>
                {/* 分组说明是**两句以里的常驻文案**（`leading-snug` 折行显示），
                    不截断、也不挂悬停 —— 它已经在屏上读全了。折起时它跟着组名
                    一起留在头上：说明是「这一组是干什么的」的唯一线索。 */}
                <span className="text-ink-fainter text-2xs block leading-snug">{group.hint}</span>
              </span>
            }
          >
            {group.items.map((item) => (
              <Hint key={item.id} label={presetHint(item)} side="right">
                <Button
                  className="group text-ink-muted hover:bg-subtle hover:text-ink-strong h-auto w-full justify-start gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-normal"
                  data-testid={`console-preset-${item.id}`}
                  disabled={disabled}
                  onClick={() => {
                    onFill(item.command);
                  }}
                  variant="ghost"
                >
                  <ChevronRight
                    className="text-ink-fainter shrink-0"
                    data-icon="inline-start"
                    size={12}
                  />
                  <span className="min-w-0 flex-1">
                    <TruncatedText className="block truncate">{item.label}</TruncatedText>
                    <TruncatedText className="text-ink-fainter text-3xs block truncate">
                      {item.desc}
                    </TruncatedText>
                  </span>
                </Button>
              </Hint>
            ))}
          </Disclosure>
        );
      })}
    </div>
  );
}
