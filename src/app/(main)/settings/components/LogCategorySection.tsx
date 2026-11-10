"use client";

/**
 * 日志分类开关分区（规范 07 §7.x）。
 * 开关**只控制日志面板是否显示**该来源分类——`log/` 文件照常写入；改动经
 * `useLogCategoryStore` 即时落 localStorage，面板侧已订阅，不重启即生效。
 */

import { Switch } from "~/components/ui/switch";
import { LOG_CATEGORY_FILTERS, type LogCategoryFilter } from "~/components/studio/logs/log-types";
import { useLogCategoryStore } from "~/components/studio/logs/log-category-store";
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

export function LogCategorySection() {
  const enabled = useLogCategoryStore((s) => s.enabled);
  const setEnabled = useLogCategoryStore((s) => s.setEnabled);

  return (
    <SettingsCard title="日志分类开关">
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
    </SettingsCard>
  );
}
