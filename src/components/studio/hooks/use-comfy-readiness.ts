"use client";

// ── 底部状态栏 controller（规范 17 §17.2 第②层）───────────────────────
// 把「轮询到的原始指标」折叠成视图直接可渲染的字段：显隐谓词、百分比、
// 降级提示与「就绪」三态。视图（BrowserStatusBar）只读这里的结果，不自己
// 做判据推导——判据一变只有一处要改，也便于 renderHook 直接断言。

import {
  deriveComfyReadiness,
  type ComfyReadiness,
} from "~/lib/comfy-readiness";
import type { ComfyStatsPayload } from "~/lib/comfy-stats-client";

import { useComfyStats } from "./use-comfy-stats";

/** 状态栏要展示的一项占用条（显存/内存），null 表示该项应隐藏。 */
export interface StatBar {
  /** 已用（字节） */
  used: number;
  /** 总量（字节） */
  total: number;
  /** 用量百分比（四舍五入取整，clamp 到 100） */
  pct: number;
}

export interface ComfyStatusViewModel {
  stats: ComfyStatsPayload | null;
  online: boolean;
  /** 已连接但首个采样还没回来（轮询空窗），占用条暂不显示但不应报「未连接」 */
  connecting: boolean;
  /** 就绪三态 + 可读文案（见 src/lib/comfy-readiness.ts 的语义定义） */
  readiness: ComfyReadiness;
  /** ComfyUI CUDA 逻辑口径；非 NVIDIA 卡上仍是唯一可显示的口径 */
  cudaVram: StatBar | null;
  /** nvidia-smi 物理专用显存口径；非 NVIDIA 卡 / 查询失败时为 null（隐藏，不留空项） */
  smiVram: StatBar | null;
  /** 系统内存占用 */
  ram: StatBar | null;
  /** 降级提示（轮询失败/后端不可达时视图必须可见，不能静默消失） */
  degradedNote: string | null;
}

const DEGRADED_NOTE = "ComfyUI 未运行，显存/内存暂不可用";

/** 已用/总量 → 占用条；总量非法或未用为负则返回 null（该项隐藏）。 */
function toBar(
  used: number | undefined,
  total: number | undefined,
): StatBar | null {
  if (!total || total <= 0 || used == null || used < 0) return null;
  return {
    used,
    total,
    pct: Math.min(100, Math.round((used / total) * 100)),
  };
}

export function useComfyReadiness(): ComfyStatusViewModel {
  const { stats, online } = useComfyStats();
  const hasStats = online && stats !== null;

  return {
    stats,
    online,
    connecting: online && !hasStats,
    readiness: deriveComfyReadiness(online, hasStats),
    cudaVram: hasStats ? toBar(stats?.vramUsed, stats?.vramTotal) : null,
    smiVram: hasStats ? toBar(stats?.smiVramUsed, stats?.smiVramTotal) : null,
    ram: hasStats ? toBar(stats?.ramUsed, stats?.ramTotal) : null,
    degradedNote: online ? null : DEGRADED_NOTE,
  };
}
