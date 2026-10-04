"use client";

// 控制台预设命令列表（视图第③层，纯展示）。
//
// 「点一下把命令**填进输入框**」而不是「点一下直接跑」是本组件唯一的交互决定：
// 预设里有 `pnpm db:push` 这种会真的改库的命令，而界面必须让用户在按下回车前
// 看清它到底要跑什么、也留出「加两个参数」的余地。这同时让「预设」与「自由行」
// 是**同一条链路**（都是用户在输入框里按下回车）——两条链路迟早就分叉
// （一条记历史、一条不记，或者一条能停止、一条不能）。

import { ChevronRight } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";
import { CONSOLE_PRESETS } from "~/lib/console/console-catalog";

export interface ConsolePresetListProps {
  onFill: (command: string) => void;
  /** 有命令在跑时禁用（避免用户以为点了就会插队执行）。 */
  disabled: boolean;
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
            <h3 className="text-ink text-[12px] font-semibold">
              {group.label}
            </h3>
            <p className="text-ink-fainter text-[10.5px] leading-snug">
              {group.hint}
            </p>
          </div>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => (
              <Hint key={item.id} label={item.command} side="right">
                <Button
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => onFill(item.command)}
                  data-testid={`console-preset-${item.id}`}
                  className="group text-ink-muted hover:bg-subtle hover:text-ink-strong h-auto w-full justify-start gap-1.5 rounded-md px-2 py-1.5 text-left text-[12px] font-normal"
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
