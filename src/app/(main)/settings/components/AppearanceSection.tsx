"use client";

/**
 * 外观主题分区（规范 17 §17.2 第③层）：深色 / 浅色二选一，切换即保存。
 *
 * 纯展示：只消费 controller 的 `theme` 与 `setTheme`。
 */

import { Moon, Sun } from "lucide-react";

import { Button } from "~/components/ui/button";

import { SettingsCard } from "~/components/ui/settings-card";
import type { ReadySettingsPageController } from "../hooks/use-settings-page";

export function AppearanceSection({ c }: { c: ReadySettingsPageController }) {
  return (
    <SettingsCard title="外观主题">
      <p className="text-muted-foreground mb-4 text-sm">
        选择应用的主题外观：深色（Dark）或浅色（Light）。切换即时生效并自动保存，
        也可通过顶部导航栏的太阳/月亮按钮随时切换。
      </p>
      <div
        role="radiogroup"
        aria-label="主题外观"
        className="grid max-w-md grid-cols-2 gap-3"
      >
        {(
          [
            {
              value: "dark",
              label: "深色",
              Icon: Moon,
              hint: "适合低光环境",
            },
            {
              value: "light",
              label: "浅色",
              Icon: Sun,
              hint: "明亮、高对比",
            },
          ] as const
        ).map(({ value, label, Icon, hint }) => {
          const active = c.theme === value;
          return (
            /* 主题卡是「整卡可点」的选项，不是动作按钮：基元的高度/内边距/
               字号全部归还给调用处（`h-auto justify-start whitespace-normal`），
               只借用基元的可点目标语义与 focus-visible 焦点环。 */
            <Button
              key={value}
              variant="ghost"
              role="radio"
              aria-checked={active}
              onClick={() => c.setTheme(value)}
              className={`h-auto flex-col items-start justify-start gap-1.5 rounded-xl border p-4 text-left whitespace-normal transition-colors ${
                active
                  ? "bg-primary-soft text-ink border-primary"
                  : "bg-surface-1 text-muted-foreground hover:border-border-strong hover:text-ink border-border"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Icon size={18} className={active ? "text-primary" : ""} />
                {label}
              </span>
              <span className="text-xs opacity-80">{hint}</span>
            </Button>
          );
        })}
      </div>
    </SettingsCard>
  );
}
