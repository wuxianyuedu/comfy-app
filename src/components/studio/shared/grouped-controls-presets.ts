/* 共享的预设常量 + 标签辅助函数 —— 从 GroupedControls.tsx 抽出。
 * 非组件模块（按项目规范用 kebab-case 命名）。 */
import { DIM_RATIO_PRESETS } from "./workflow-io";

/** Strip a "16:9 横屏" → "16:9" short label for compact triggers and chips. */
export function shortRatioLabel(label: string): string {
  return label.split(/\s+/)[0] ?? label;
}

/* ── 视频组预设 ──
 * length 在 ComfyUI 视频工作流里是帧数；标签按约 16fps
 * 近似出时长，好让用户按秒思考，而不是帧数。 */
export const VIDEO_DURATION_PRESETS: { label: string; value: number }[] = [
  { label: "3 秒", value: 48 },
  { label: "5 秒", value: 80 },
  { label: "8 秒", value: 128 },
  { label: "10 秒", value: 160 },
];
export const VIDEO_QUALITY_PRESETS: { label: string; value: number }[] = [
  { label: "流畅 480P", value: 480 },
  { label: "标清 720P", value: 720 },
  { label: "高清 1080P", value: 1080 },
  { label: "超清 2K", value: 2048 },
];

/** 把视频的时长 / 画质 / 比例取值映射成友好的浮层标签。 */
export function videoDurationLabel(value: number): string {
  return (
    VIDEO_DURATION_PRESETS.find((preset) => preset.value === value)?.label ??
    `${value} 帧`
  );
}
export function videoQualityLabel(value: number): string {
  return (
    VIDEO_QUALITY_PRESETS.find((preset) => preset.value === value)?.label ??
    `${value}P`
  );
}
export function videoAspectLabel(ratio: number): string {
  return shortRatioLabel(
    DIM_RATIO_PRESETS.find((preset) => Math.abs(preset.ratio - ratio) < 0.05)
      ?.label ?? "自定义",
  );
}

export type VideoRole = "length" | "aspect" | "quality";

export function roleLabel(role: VideoRole): string {
  return role === "length" ? "时长" : role === "aspect" ? "比例" : "画质";
}
