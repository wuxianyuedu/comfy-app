/* Shared preset constants + label helpers — extracted from GroupedControls.tsx (T12).
 * Non-component module (kebab-case per project standards). */
import { DIM_RATIO_PRESETS } from "./workflow-io";

/** Strip a "16:9 横屏" → "16:9" short label for compact triggers and chips. */
export function shortRatioLabel(label: string): string {
  return label.split(/\s+/)[0] ?? label;
}

/* ── Video group presets ──
 * length is frames in ComfyUI video workflows; the labels approximate the
 * duration at ~16fps so the user thinks in seconds, not frame counts. */
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

/** Map a video length / quality / aspect value to a friendly popover label. */
export function videoDurationLabel(value: number): string {
  return VIDEO_DURATION_PRESETS.find((preset) => preset.value === value)?.label ?? `${value} 帧`;
}
export function videoQualityLabel(value: number): string {
  return VIDEO_QUALITY_PRESETS.find((preset) => preset.value === value)?.label ?? `${value}P`;
}
export function videoAspectLabel(ratio: number): string {
  return shortRatioLabel(
    DIM_RATIO_PRESETS.find((preset) => Math.abs(preset.ratio - ratio) < 0.05)?.label ?? "自定义"
  );
}

export type VideoRole = "length" | "aspect" | "quality";

export function roleLabel(role: VideoRole): string {
  return role === "length" ? "时长" : role === "aspect" ? "比例" : "画质";
}
