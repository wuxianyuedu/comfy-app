"use client";

/**
 * 日志分类开关分区（规范 07 §7.x）。
 *
 * 每一项对应「日志面板」里的一个来源分类（与来源筛选下拉同源）。开关**只控制面板
 * 里是否显示**该类日志——`log/` 下的真实文件照常写入，关掉只是「不想看」，不是
 * 「不记录」。改动经`useLogCategoryStore` 即时落 localStorage，面板侧已订阅该 store，
 * 因此**不重启、不重开面板**即生效（用户例子：「不关注应用服务，把它的开关关掉」）。
 *
 * 视图自持的仅交互态，其余读 category store；开关值从 store 派生，不在此处另存一份。
 */

import { Switch } from "~/components/ui/switch";
import {
  LOG_CATEGORY_FILTERS,
  type LogCategoryFilter,
} from "~/components/studio/logs/log-types";
import { useLogCategoryStore } from "~/components/studio/logs/log-category-store";
import { ORIGIN_TEXT } from "~/components/studio/logs/LogPanelOriginSelect";

import { SettingsCard } from "~/components/ui/settings-card";

/** 给每个分类一句简短说明，帮用户判断「这是不是我想关的那一类」。 */
const CATEGORY_HINT: Record<LogCategoryFilter, string> = {
  "app-runtime": "业务操作日志（appRuntimeLog 通道，写入 app-runtime.log）",
  app: "应用服务自身输出（Next dev server 的 stdout/stderr 转录）",
  dev: "启动过程日志（dev-launcher）",
  launcher: "启动器日志（dev-launcher-stderr）",
  console: "浏览器 console 拦截 / Tauri 事件 / 全局未捕获错误",
};

export function LogCategorySection() {
  const enabled = useLogCategoryStore((s) => s.enabled);
  const setEnabled = useLogCategoryStore((s) => s.setEnabled);

  return (
    <SettingsCard title="日志分类开关">
      <p className="text-muted-foreground mb-4 text-sm">
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
              key={category}
              className="border-border/60 flex items-start justify-between gap-4 rounded-lg border px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="text-ink/90 text-sm font-medium">
                  {ORIGIN_TEXT[category]}
                </div>
                <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                  {CATEGORY_HINT[category]}
                </p>
              </div>
              <Switch
                size="sm"
                checked={on}
                onCheckedChange={(checked) => setEnabled(category, checked)}
                aria-label={`${ORIGIN_TEXT[category]}日志显示开关`}
                className="mt-1 shrink-0"
              />
            </li>
          );
        })}
      </ul>
    </SettingsCard>
  );
}
