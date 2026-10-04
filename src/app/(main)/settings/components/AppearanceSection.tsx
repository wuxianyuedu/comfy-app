"use client";

/**
 * 外观主题分区（规范 17 §17.2 第③层）：深色 / 浅色二选一，切换即保存。
 *
 * 纯展示：只消费 controller 的 `theme` 与 `setTheme`。
 */

import { useEffect, useState } from "react";

import { Moon, Sun } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  DEFAULT_APPEARANCE,
  FONT_SCALE_STEPS,
  RADIUS_STEPS,
  readAppearance,
  saveAppearance,
  type AppearancePrefs,
  type AppearanceStep,
} from "~/lib/appearance";

import { SettingsCard } from "~/components/ui/settings-card";
import type { ReadySettingsPageController } from "../hooks/use-settings-page";

export function AppearanceSection({ c }: { c: ReadySettingsPageController }) {
  /* 已保存的外观偏好。读取放在挂载之后：localStorage 在 SSR 阶段不存在，直接当
     useState 初值会让服务端与首帧不一致（选中态跳变）。 */
  const [prefs, setPrefs] = useState<AppearancePrefs>(DEFAULT_APPEARANCE);
  const [notPersisted, setNotPersisted] = useState(false);
  useEffect(() => {
    /* 延到提交之后（与 `TopBar` / `workspace/page.tsx` 同一做法）：effect 体内同步
       setState 会触发级联渲染。 */
    const t = setTimeout(() => setPrefs(readAppearance()), 0);
    return () => clearTimeout(t);
  }, []);

  const update = (patch: Partial<AppearancePrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    /* 写不进存储（隐私模式等）时变量仍然生效，只是下次打开回到默认 ——
       这件事必须让用户看见，不能静默。 */
    setNotPersisted(!saveAppearance(next));
  };

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

      {/* 圆角与标题字阶各只改一个全局 CSS 变量（--radius / --font-scale）；
          具体数值留在 globals.css 一处，这里不重复定义基准。 */}
      <StepRow
        label="圆角"
        hint="影响卡片、按钮、输入框等所有圆角。"
        steps={RADIUS_STEPS}
        value={prefs.radius}
        onChange={(id) => update({ radius: id })}
      />
      <StepRow
        label="标题字阶"
        hint="只影响各级标题；正文与小号文字保持原尺寸，不随这一档变化。"
        steps={FONT_SCALE_STEPS}
        value={prefs.fontScale}
        onChange={(id) => update({ fontScale: id })}
      />
      {notPersisted && (
        <p className="text-warning mt-3 text-xs">
          浏览器拒绝了本地存储：本次设置立即生效，但下次打开会回到默认值。
        </p>
      )}
    </SettingsCard>
  );
}

/** 一横向的可选档位（沿用主题那排的 radiogroup 语义，只是尺寸收紧）。 */
function StepRow({
  label,
  hint,
  steps,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  steps: AppearanceStep[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="mt-5">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <span className="text-ink text-sm font-semibold">{label}</span>
        <span className="text-muted-foreground text-xs">{hint}</span>
      </div>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex flex-wrap gap-2"
      >
        {steps.map((step) => {
          const active = step.id === value;
          return (
            <Button
              key={step.id}
              variant="ghost"
              size="sm"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(step.id)}
              className={`h-auto rounded-lg border px-3 py-1.5 text-xs ${
                active
                  ? "bg-primary-soft text-primary border-primary"
                  : "text-muted-foreground border-border hover:border-border-strong hover:text-ink"
              }`}
            >
              {step.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
