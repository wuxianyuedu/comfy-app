"use client";

// 控制台预设命令列表（视图第③层，纯展示）。
//
// 「点一下把命令**填进输入框**」而不是「点一下直接跑」是本组件唯一的交互决定：
// 预设里有 `pnpm db:push` 这种会真的改库的命令，而界面必须让用户在按下回车前
// 看清它到底要跑什么、也留出「加两个参数」的余地。这同时让「预设」与「自由行」
// 是**同一条链路**（都是用户在输入框里按下回车）——两条链路迟早就分叉
// （一条记历史、一条不记，或者一条能停止、一条不能）。
//
// ## 悬停提示放什么：左边一列只有 240px，两行文字都必须能被读全
//
// 侧栏窄（`lg:w-60` = 240px），条目上的**展示名与说明小字都带 `truncate`** ——
// 这是必要的（不截断就会被长说明顶成三层行高、把整列撑成一条流水账），代价是
// 「`pnpm check:all` 到底是跑哪个脚本」这类信息在界面上根本读不到。
// 所以浮层要把**两行都补全**，而不是只回显命令：
//   · 说明小字（`desc`）是「这条命令做什么、什么时候用」—— 截断掉的正是它；
//   · 命令（`command`）是「点下去会填进什么」—— 界面上本来就没显示过它。
// 只回显命令等于把用户最想知道的那句（说明）留在截断里，悬停也看不到。
//
// 浮层内容按 `TooltipContent` 的既有形态给（`max-w-xs` + `wrap-break-word`）：
// 说明小字在这一档里会正常折行、读全；`max-w-xs` 是浮层自己的上限，不受侧栏
// 240px 影响（这正是它存在的意义）。

import { ChevronRight } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
import {
  CONSOLE_PRESETS,
  type ConsolePreset,
} from "~/lib/console/console-catalog";

export interface ConsolePresetListProps {
  onFill: (command: string) => void;
  /** 有命令在跑时禁用（避免用户以为点了就会插队执行）。 */
  disabled: boolean;
}

/**
 * 一条预设的悬停提示：展示名 + 说明小字 + 会填进输入框的命令。
 *
 * 三段都带，是因为它们在界面上各自缺一块：展示名可能截断、说明小字必然截断、
 * 命令则从来没露过面。三句都不长，浮层 `max-w-xs` 折行放得下。
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

export function ConsolePresetList({
  onFill,
  disabled,
}: ConsolePresetListProps) {
  return (
    <div className="custom-scrollbar flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-3">
      {CONSOLE_PRESETS.map((group) => (
        <div key={group.id} className="flex flex-col gap-1.5">
          <div className="flex flex-col">
            <h3 className="text-ink text-xs font-semibold">{group.label}</h3>
            {/* 分组说明是**两句以里的常驻文案**（`leading-snug` 折行显示），
                不截断、也不挂悬停 —— 它已经在屏上读全了。 */}
            <p className="text-ink-fainter text-2xs leading-snug">
              {group.hint}
            </p>
          </div>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => (
              <Hint key={item.id} label={presetHint(item)} side="right">
                <Button
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => onFill(item.command)}
                  data-testid={`console-preset-${item.id}`}
                  className="group text-ink-muted hover:bg-subtle hover:text-ink-strong h-auto w-full justify-start gap-1.5 rounded-md px-2 py-1.5 text-left text-xs font-normal"
                >
                  <ChevronRight
                    data-icon="inline-start"
                    size={12}
                    className="text-ink-fainter shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.label}</span>
                    <span className="text-ink-fainter text-3xs block truncate">
                      {item.desc}
                    </span>
                  </span>
                </Button>
              </Hint>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
