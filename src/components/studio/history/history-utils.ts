import { useState } from "react";

import { useInterval } from "~/components/ui/use-interval";
import { adviseWithFallback } from "~/lib/comfyui/error-advice";
import { formatDate } from "~/lib/time-format";

import type { TaskItem } from "./history-types";

export type StatusStyle = {
  // 失败错误转修复建议
  failureSuggestion?: (err?: string | null) => string;
  isActive: boolean;
  label: string;
  showProgress: boolean;
  // 状态语义色（bg 档）：左缘短条与头像状态角标共用同一出处（状态 → 配色单点）
  toneCls: string;
};

/** 任务状态 → 角标 / 左缘短条样式（**状态语义**，全部走语义 token）。
 *  §4.11.1 + P71：`--color-destructive` / `--color-success` / `--color-primary`
 *  / `--color-info` 等 token 内部已含浅/深两态，不再写 `dark:` 手写档；这也让
 *  状态色与其他域（log 徽标 / status-badge / alert）同源，改主题一处生效全站。 */
/* 排队态单独具名：它是「状态键对不上时」的兜底样式，调用点因此可以写
 * `STATUS_STYLE[x] ?? QUEUED_STATUS_STYLE` 而不必再补 `!`（表是索引签名，
 * 连 `STATUS_STYLE.QUEUED` 本身也是 `StatusStyle | undefined`）。 */
export const QUEUED_STATUS_STYLE: StatusStyle = {
  label: "排队中",
  toneCls: "bg-info",
  isActive: true,
  showProgress: false,
};

export const STATUS_STYLE: Record<string, StatusStyle> = {
  QUEUED: QUEUED_STATUS_STYLE,
  RUNNING: {
    label: "生成中",
    toneCls: "bg-primary",
    isActive: true,
    showProgress: true,
  },
  SUCCEEDED: {
    label: "已完成",
    toneCls: "bg-success",
    isActive: false,
    showProgress: false,
  },
  FAILED: {
    label: "失败",
    toneCls: "bg-destructive",
    isActive: false,
    showProgress: false,
    failureSuggestion: (err) => suggestFix(err),
  },
  CANCELLED: {
    label: "已取消",
    toneCls: "bg-gray-500",
    isActive: false,
    showProgress: false,
  },
};

/** 失败原因 → 一行可行动建议。规则表收在 ~/lib/comfyui/error-advice ——
 * 收口前这里与画布节点错误面板各写词表，同一报错两处建议不同（out of memory 一处「拆批次」一处「降分辨率」），
 * 且两边词表互相漏项。
 * 用 adviseWithFallback 而非 adviseOnError：建议是失败原因下方位置固定的一行，给不出就会跳布局。 */
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
  if (task === today) {
    return "今天";
  }
  if (task === today - 86_400_000) {
    return "昨天";
  }
  return formatDate(date);
}

/** 简单的「看起来在跑」动效：递增到 95% 后封顶；任务结束时归 0。
 *  引用纪律（ISSUE #4559）：只有**真的有值变化**才换 `map` 的引用 ——
 *  RUNNING 卡封顶在 95% 之后每拍算出的还是 95，再每拍造新对象就会让
 *  整页卡片（哪怕已 memo）拿到一个「值没变、引用变了」的 props 源。 */
export function useSimulatedProgress(tasks: Array<TaskItem>) {
  const [map, setMap] = useState<Record<string, number>>({});
  /* `useInterval` 的 `ms` 固定、回调放 ref —— 此前把 `tasks` 写进依赖数组，
   * 每次任务数组变化（轮询每次都会给新数组）都要重建定时器、把计时重置；
   * 现在定时器稳定，回调里读到的是最新的 `tasks`（规范 16 §16.2.4.15）。
   * `pauseWhenHidden` 用默认的 true：模拟进度是给人看的，页面不可见时照跑
   * 只会空转（与仓内其它轮询的可见性口径对齐，ISSUE #4559）。 */
  useInterval(
    () => {
      setMap((prev) => {
        const next = { ...prev };
        let dirty = false;
        for (const task of tasks) {
          if (task.status === "RUNNING") {
            const cur = prev[task.id] ?? 12 + Math.random() * 25;
            const nextValue = Math.min(95, cur + Math.random() * 5);
            if (nextValue !== cur) {
              next[task.id] = nextValue;
              dirty = true;
            }
          } else {
            if (prev[task.id] !== null && prev[task.id] !== undefined) {
              delete next[task.id];
              dirty = true;
            }
          }
        }
        return dirty ? next : prev;
      });
    },
    { ms: 1500, immediate: false },
  );
  return map;
}

export const PAGE_SIZE = 8;
