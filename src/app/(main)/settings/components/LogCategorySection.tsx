"use client";

/**
 * 日志分类开关分区（规范 07 §7.x）。
 * 开关**只控制日志面板是否显示**该来源分类——`log/` 文件照常写入；改动经
 * `useLogCategoryStore` 即时落 localStorage，面板侧已订阅，不重启即生效。
 */

import { Switch } from "~/components/ui/switch";
import { Button } from "~/components/ui/button";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { LOG_CATEGORY_FILTERS, type LogCategoryFilter } from "~/components/studio/logs/log-types";
import { useLogCategoryStore } from "~/components/studio/logs/log-category-store";
import { useLogDisplayStore } from "~/components/studio/logs/log-display-store";
import type { LogDensity } from "~/components/studio/logs/log-virtual";
import { ORIGIN_TEXT } from "~/components/studio/logs/LogPanelOriginSelect";

import { SettingsCard, SETTINGS_ROW_CLASS } from "~/components/ui/settings-card";

/** 给每个分类一句简短说明，帮用户判断「这是不是我想关的那一类」。 */
const CATEGORY_HINT: Record<LogCategoryFilter, string> = {
  "app-runtime": "业务操作日志（appRuntimeLog 通道，写入 app-runtime.log）",
  app: "应用服务自身输出（Next dev server 的 stdout/stderr 转录）",
  dev: "启动过程日志（dev-launcher）",
  launcher: "启动器日志（dev-launcher-stderr）",
  "shell-launch": "壳侧编排链路日志（shell-launch，双击启动最早的现场）",
  shell: "壳自持日志（shell.log，壳的诊断与编排器输出转发）",
  console: "浏览器 console 拦截 / Tauri 事件 / 全局未捕获错误",
};

/** 行距档的展示文案与排列顺序（与 `LOG_DENSITY_PRESETS` 的键一一对应）。 */
const DENSITY_LABEL: Record<LogDensity, string> = {
  compact: "紧凑",
  default: "标准",
  relaxed: "宽松",
};
const DENSITY_ORDER: Array<LogDensity> = ["compact", "default", "relaxed"];

export function LogCategorySection() {
  const enabled = useLogCategoryStore((s) => s.enabled);
  const setEnabled = useLogCategoryStore((s) => s.setEnabled);
  const density = useLogDisplayStore((s) => s.density);
  const setDensity = useLogDisplayStore((s) => s.setDensity);
  const showMeta = useLogDisplayStore((s) => s.showMeta);
  const setShowMeta = useLogDisplayStore((s) => s.setShowMeta);

  return (
    <SettingsCard>
      <p className="text-muted-foreground mb-4 text-xs leading-relaxed">
        关闭某一类，它的日志就
        <strong className="text-ink/80">不在日志面板里显示</strong>
        （文件照常记录，仅面板隐藏），按来源筛选时也会跳过被关掉的分类。改动即时生效、
        无需重启，并自动记住。
      </p>
      <ul className="flex flex-col gap-1">
        {LOG_CATEGORY_FILTERS.map((category) => {
          const on = enabled[category] !== false;
          return (
            <li
              className={`${SETTINGS_ROW_CLASS} flex items-start justify-between gap-4`}
              key={category}
            >
              <div className="min-w-0">
                <div className="text-ink/90 text-sm font-medium">{ORIGIN_TEXT[category]}</div>
                <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                  {CATEGORY_HINT[category]}
                </p>
              </div>
              <Switch
                aria-label={`${ORIGIN_TEXT[category]}日志显示开关`}
                checked={on}
                className="mt-1 shrink-0"
                onCheckedChange={(checked) => {
                  setEnabled(category, checked);
                }}
                size="sm"
              />
            </li>
          );
        })}
      </ul>

      {/* 行距与元信息列（ISSUE #4567）：同样是「即时生效 + 自动记住」的显示偏好。 */}
      <div className="border-border-subtle mt-4 border-t pt-4">
        <div className="text-ink/90 text-sm font-medium">日志行距</div>
        <p className="text-muted-foreground mt-0.5 mb-3 text-xs leading-relaxed">
          日志项之间的间隔大小；改动即时生效并自动记住。
        </p>
        {/* role/方向键契约由 `RadioGroup` 基元下发（同主题卡那套）；选中态用
            `data-checked:` 表达，指示圆点隐藏（理由见 AppearanceSection 同段）。 */}
        <RadioGroup
          aria-label="日志行距"
          className="flex max-w-md flex-wrap gap-2"
          onValueChange={(raw) => {
            const v: unknown = raw;
            if (v === "compact" || v === "default" || v === "relaxed") {
              setDensity(v);
            }
          }}
          value={density}
        >
          {DENSITY_ORDER.map((value) => (
            <RadioGroupItem
              key={value}
              nativeButton
              render={
                <Button
                  className="data-checked:border-primary data-checked:bg-primary-soft data-checked:text-ink data-checked:hover:border-primary data-checked:hover:bg-primary-soft data-checked:hover:text-ink data-unchecked:border-border data-unchecked:bg-surface-row data-unchecked:text-muted-foreground data-unchecked:hover:border-border-strong data-unchecked:hover:text-ink aspect-auto! size-auto! rounded-lg border px-4 py-2 text-sm transition-colors **:data-[slot=radio-group-indicator]:hidden"
                  variant="ghost"
                />
              }
              value={value}
            >
              {DENSITY_LABEL[value]}
            </RadioGroupItem>
          ))}
        </RadioGroup>
        <div className={`${SETTINGS_ROW_CLASS} mt-3 flex items-center justify-between gap-4 px-0`}>
          <div className="min-w-0">
            <div className="text-ink/90 text-sm font-medium">显示元信息列</div>
            <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
              行头的时刻、级别、位置与来源。想框选复制多条纯正文时可以关掉；
              面板右上角的眼睛按钮也能随时切。
            </p>
          </div>
          <Switch
            aria-label="日志元信息列显示开关"
            checked={showMeta}
            className="shrink-0"
            onCheckedChange={(checked) => {
              setShowMeta(checked);
            }}
            size="sm"
          />
        </div>
      </div>
    </SettingsCard>
  );
}
