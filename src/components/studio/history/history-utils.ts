import { useState } from "react";

import { useInterval } from "~/components/ui/use-interval";
import { adviseWithFallback } from "~/lib/comfyui/error-advice";
import { timeAgo as timeAgoImpl } from "~/lib/time-format";
import { formatDate } from "~/lib/time-format";

import type { TaskItem } from "./history-types";

/** 全量历史页的相对时间。定义收在 `~/lib/time-format`（此前两域各写一份）。 */
export function timeAgo(iso: string): string {
  return timeAgoImpl(iso) ?? "刚刚";
}

export interface StatusStyle {
  label: string;
  pillCls: string;
  // 左缘 3px accent（Tailwind border-l-4 系列）
  accentCls: string;
  // 整卡边框（失败/进行中/排队中加深）
  cardBorderCls: string;
  isActive: boolean;
  showProgress: boolean;
  // 失败错误转修复建议
  failureSuggestion?: (err?: string | null) => string;
}

export const STATUS_STYLE: Record<string, StatusStyle> = {
  QUEUED: {
    label: "排队中",
    pillCls:
      "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30 border-dashed",
    accentCls: "border-l-cyan-500",
    cardBorderCls: "border-cyan-500/30 border-dashed",
    isActive: true,
    showProgress: false,
  },
  RUNNING: {
    label: "生成中",
    pillCls: "bg-violet-500/20 text-violet-700 dark:text-violet-300",
    accentCls: "border-l-violet-500",
    cardBorderCls: "border-violet-500/30",
    isActive: true,
    showProgress: true,
  },
  SUCCEEDED: {
    label: "已完成",
    pillCls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    accentCls: "border-l-emerald-500",
    cardBorderCls: "border-border-subtle",
    isActive: false,
    showProgress: false,
  },
  FAILED: {
    label: "失败",
    pillCls: "bg-red-500/15 text-red-700 dark:text-red-400",
    accentCls: "border-l-red-500",
    cardBorderCls: "border-red-500/30",
    isActive: false,
    showProgress: false,
    failureSuggestion: (err) => suggestFix(err),
  },
  CANCELLED: {
    label: "已取消",
    pillCls: "bg-surface-2 text-ink-faint",
    accentCls: "border-l-gray-500",
    cardBorderCls: "border-border-subtle",
    isActive: false,
    showProgress: false,
  },
};

/** 失败原因 → 一行可行动建议。
 *
 * 规则表本体收在 `~/lib/comfyui/error-advice`（规范 16 §16.2.4.37）——
 * 收口前这里与画布节点错误面板**各写一份词表**，同一句 ComfyUI 报错在两处
 * 会给出不同建议（`out of memory` 一处提「拆批次」、另一处提「降分辨率」），
 * 且两边的告警词表互相漏项（「队列满了」在画布节点上根本没有建议）。
 *
 * 这里用 `adviseWithFallback` 而不是 `adviseOnError`：本卡片的建议是失败原因
 * 下方**位置固定**的一行，给不出建议就会跳一次布局。 */
export function suggestFix(err?: string | null): string {
  return `建议：${adviseWithFallback(err)}`;
}

/** 把 ISO 时间归到日期桶：今天 / 昨天 / yyyy-mm-dd */
export function dateBucket(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const startOfDay = (inputDate: Date) => {
    const result = new Date(inputDate);
    result.setHours(0, 0, 0, 0);
    return result;
  };
  const today = startOfDay(now).getTime();
  const task = startOfDay(date).getTime();
  if (task === today) return "今天";
  if (task === today - 86400000) return "昨天";
  return formatDate(date);
}

/** 简单的「看起来在跑」动效：递增到 95% 后封顶；任务结束时归 0。 */
export function useSimulatedProgress(tasks: TaskItem[]) {
  const [map, setMap] = useState<Record<string, number>>({});
  /* `useInterval` 的 `ms` 固定、回调放 ref —— 此前把 `tasks` 写进依赖数组，
   * 每次任务数组变化（轮询每次都会给新数组）都要重建定时器、把计时重置；
   * 现在定时器稳定，回调里读到的是最新的 `tasks`（规范 16 §16.2.4.15）。 */
  useInterval(
    () => {
      setMap((prev) => {
        const next = { ...prev };
        let dirty = false;
        for (const task of tasks) {
          if (task.status === "RUNNING") {
            const cur = prev[task.id] ?? 12 + Math.random() * 25;
            next[task.id] = Math.min(95, cur + Math.random() * 5);
            dirty = true;
          } else {
            if (prev[task.id] != null) {
              delete next[task.id];
              dirty = true;
            }
          }
        }
        return dirty ? next : prev;
      });
    },
    { ms: 1500, immediate: false, pauseWhenHidden: false },
  );
  return map;
}

export const PAGE_SIZE = 8;
