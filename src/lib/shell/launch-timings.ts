import { z } from "zod";

/**
 * 启动耗时分解的应用内读数（#4327）：把 `run/launch-status.json` 的 `timings`
 * （编排器 timeline 写入，形状见 scripts/launcher-core/timeline.mjs 的
 * `LaunchTimingSpan`）解析成日志面板能直接渲染的逐阶段行。
 *
 * 为什么在应用内也要这一份：启动页的耗时条随窗口交换一起消失，「启动的时候
 * 看着图表、结果就关闭了」——同一份读数搬进应用内日志面板，启动结束后仍可查。
 */

/** `run/launch-status.json` 的固定名（与 app-service-exit 的记录文件同布局）。 */
export const LAUNCH_STATUS_FILE = "launch-status.json";

/** 单阶段耗时：与编排器 timeline 的 span 同形（endMs 为 null = 仍在进行）。 */
const launchTimingSpanSchema = z.object({
  key: z.string(),
  label: z.string(),
  startMs: z.number().finite(),
  endMs: z.number().finite().nullable(),
  durationMs: z.number().finite(),
});

const launchStatusTimingsSchema = z.object({
  timings: z.array(launchTimingSpanSchema).nullish(),
});

/** `/api/dev/launch-timings` 的应答形状（客户端侧同样 zod 校验，规范 §5.5）。 */
export const launchTimingsResponseSchema = z.object({
  phases: z.array(launchTimingSpanSchema.extend({ percent: z.number().finite() })).nullable(),
  totalMs: z.number().finite().nullable(),
});

/** 渲染用的一行：span 原样 + 占合计的百分比（一位小数）。 */
export type LaunchTimingPhase = {
  durationMs: number;
  endMs: number | null;
  key: string;
  label: string;
  percent: number;
  startMs: number;
};

export type LaunchTimings = {
  phases: LaunchTimingPhase[];
  /** 合计取**墙钟**（最后一刻 − 最早一刻），不把并行段求和——与
   * scripts/launcher-core/timeline.mjs 的口径一致，否则并行段会重复计时。 */
  totalMs: number;
};

/**
 * 从已解析的 launch-status JSON 里取耗时分解。
 *
 * 容错口径与 `/api/dev/last-exit` 一致：编排器还没写到 timings（壳的兜底快照）、
 * 字段缺项 / 类型不对，都归「没有读数」回 null——调用方据此整卡隐藏，而不是
 * 把半份坏数据画成图表。合计为 0（极端：所有段都 0ms）时百分比一律 0，不除零。
 */
export function parseLaunchTimings(raw: unknown): LaunchTimings | null {
  const parsed = launchStatusTimingsSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  const spans = parsed.data.timings ?? [];
  if (spans.length === 0) {
    return null;
  }
  const phases = [...spans].sort((a, b) => a.startMs - b.startMs);
  const firstStart = Math.min(...phases.map((s) => s.startMs));
  const lastEnd = Math.max(...phases.map((s) => s.endMs ?? s.startMs + s.durationMs));
  const totalMs = Math.max(0, lastEnd - firstStart);
  return {
    phases: phases.map((s) => ({
      ...s,
      percent: totalMs > 0 ? Math.round((s.durationMs / totalMs) * 1000) / 10 : 0,
    })),
    totalMs,
  };
}

/** 从文件原文解析；坏 JSON 归「没有读数」（与 last-exit 的容错同取向）。 */
export function parseLaunchStatusText(text: string): LaunchTimings | null {
  try {
    return parseLaunchTimings(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}
