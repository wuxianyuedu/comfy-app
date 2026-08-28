import { useEffect, useState } from "react";

import type { TaskItem } from "./history-types";

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
    pillCls: "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 border-dashed",
    accentCls: "border-l-cyan-500",
    cardBorderCls: "border-cyan-500/30 border-dashed",
    isActive: true,
    showProgress: false,
  },
  RUNNING: {
    label: "生成中",
    pillCls: "bg-violet-500/20 text-violet-300",
    accentCls: "border-l-violet-500",
    cardBorderCls: "border-violet-500/30",
    isActive: true,
    showProgress: true,
  },
  SUCCEEDED: {
    label: "已完成",
    pillCls: "bg-emerald-500/15 text-emerald-400",
    accentCls: "border-l-emerald-500",
    cardBorderCls: "border-white/[0.06]",
    isActive: false,
    showProgress: false,
  },
  FAILED: {
    label: "失败",
    pillCls: "bg-red-500/15 text-red-400",
    accentCls: "border-l-red-500",
    cardBorderCls: "border-red-500/30",
    isActive: false,
    showProgress: false,
    failureSuggestion: (err) => suggestFix(err),
  },
  CANCELLED: {
    label: "已取消",
    pillCls: "bg-white/10 text-gray-400",
    accentCls: "border-l-gray-500",
    cardBorderCls: "border-white/[0.06]",
    isActive: false,
    showProgress: false,
  },
};

export function suggestFix(err?: string | null): string {
  if (!err) return "建议：检查 ComfyUI 服务状态后重试。";
  if (/ckpt|checkpoint/i.test(err))
    return "建议：检查 ckpt_name 是否存在于 ComfyUI 模型目录，或换一个可用模型。";
  if (/seed/i.test(err))
    return "建议：seed 值超出 INT 范围或被损坏，换一个随机 seed 重试。";
  if (/network|timeout|connect|ECONNREFUSED|fetch failed/i.test(err))
    return "建议：检查 ComfyUI(:8188) 是否在线、端口是否被防火墙阻挡。";
  if (/prompt|empty|null|undefined/i.test(err))
    return "建议：检查提示词是否为空或包含非法字符。";
  if (/out of memory|OOM|cuda/i.test(err))
    return "建议：降低 batch size / 分辨率，或切换到更小的模型。";
  if (/queue/i.test(err))
    return "建议：清空 ComfyUI 队列或重启服务后重试。";
  return `建议：复制错误码到 ComfyUI 控制台查日志：${err.slice(0, 40)}${err.length > 40 ? "…" : ""}`;
}

export function timeAgo(iso: string) {
  const time = new Date(iso).getTime();
  const diff = Date.now() - time;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const day = Math.floor(hours / 24);
  return `${day} 天前`;
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
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** 简单的「看起来在跑」动效：递增到 95% 后封顶；任务结束时归 0。 */
export function useSimulatedProgress(tasks: TaskItem[]) {
  const [map, setMap] = useState<Record<string, number>>({});
  useEffect(() => {
    const id = setInterval(() => {
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
    }, 1500);
    return () => clearInterval(id);
  }, [tasks]);
  return map;
}

export const PAGE_SIZE = 8;
