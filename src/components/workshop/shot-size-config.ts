/** 镜头生图尺寸的纯派生规则（规范 17 §17.2 第①层）。
 *
 *  尺寸对外表达为「比例 + 像素基准 + 对齐倍数」三段：
 *    · 比例   —— 宽高比预设（横/竖/方）
 *    · 像素   —— 像素基准（1k/2k/4k 长边像素 或 1M/2M/4M 总像素）
 *    · 对齐倍数 —— W/H 吸附网格（ComfyUI 常用 64）
 *  最终换算成真实 WxH 写进生成参数的 `size`（"宽x高"）。
 *  无 React、无副作用，可直接单测。 */

import {
  DIM_CLARITY_PRESETS,
  DIM_RATIO_PRESETS,
  dimsForRatio,
  normalizeAlignMultiple,
  pickClarityPreset,
} from "~/components/studio/shared/workflow-io";
import { shortRatioLabel } from "~/components/studio/shared/MultiSegmentPopover";

/** 默认尺寸：竖屏 1k（与内置 txt2img 的 832x1216 量级一致的 SD 竖屏比例）。 */
export const DEFAULT_SHOT_RATIO = "3:4";
export const DEFAULT_SHOT_CLARITY = "1k";
export const DEFAULT_SHOT_ALIGN = 64;

export interface ShotSizeState {
  /** 比例预设 label（DIM_RATIO_PRESETS[].label，如 "3:4"）。 */
  ratio: string;
  /** 清晰度预设 label（DIM_CLARITY_PRESETS[].label，如 "1k"、"2M"）。 */
  clarity: string;
  /** 对齐倍数（吸附网格，[8..128] 步长 8）。 */
  align: number;
}

export const DEFAULT_SHOT_SIZE: ShotSizeState = {
  ratio: DEFAULT_SHOT_RATIO,
  clarity: DEFAULT_SHOT_CLARITY,
  align: DEFAULT_SHOT_ALIGN,
};

/** 从任意 unknown（Shot.params.size / 草稿 JSON）恢复三段选择状态。
 *  旧数据是 "832x1216" 这类 WxH 字符串 —— 反解出最接近的 比例+清晰度；
 *  无法识别时回退默认值。 */
export function parseShotSize(raw: unknown): ShotSizeState {
  const align = DEFAULT_SHOT_ALIGN;
  if (typeof raw !== "string" || !raw.trim()) return { ...DEFAULT_SHOT_SIZE };
  const match = /^(\d+)\s*[xX×]\s*(\d+)$/.exec(raw.trim());
  if (!match) return { ...DEFAULT_SHOT_SIZE };
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { ...DEFAULT_SHOT_SIZE };
  }
  const currentRatio = width / height;
  const ratio = DIM_RATIO_PRESETS.reduce(
    (best, preset) =>
      Math.abs(preset.ratio - currentRatio) < Math.abs(best.ratio - currentRatio)
        ? preset
        : best,
    DIM_RATIO_PRESETS[0]!,
  );
  const clarity = pickClarityPreset(width, height, align);
  return { ratio: ratio.label, clarity: clarity.label, align };
}

/** 由比例 label 查比值；未知 label 回退 1:1。 */
export function ratioValueOf(label: string): number {
  return DIM_RATIO_PRESETS.find((preset) => preset.label === label)?.ratio ?? 1;
}

/** 由清晰度 label 查预设；未知 label 回退 1k。 */
export function clarityPresetOf(label: string) {
  return (
    DIM_CLARITY_PRESETS.find((preset) => preset.label === label) ??
    DIM_CLARITY_PRESETS[0]!
  );
}

/** 三段状态 → 最终 WxH（吸附到对齐倍数网格，钳制 [64, 4096]）。 */
export function shotSizeToDims(state: ShotSizeState): { width: number; height: number } {
  return dimsForRatio(ratioValueOf(state.ratio), clarityPresetOf(state.clarity), state.align);
}

/** 三段状态 → 生成参数 `size`（"宽x高" 字符串）。 */
export function shotSizeToParam(state: ShotSizeState): string {
  const { width, height } = shotSizeToDims(state);
  return `${width}x${height}`;
}

/** 生成触发按钮旁的紧凑摘要（如 "3:4 / 1k · 768x1024"）。 */
export function shotSizeSummary(state: ShotSizeState): string {
  const { width, height } = shotSizeToDims(state);
  return `${shortRatioLabel(state.ratio)} / ${state.clarity} · ${width}x${height}`;
}

/** 归一化（对齐倍数越界/非 8 倍数时吸附回合法值）。 */
export function normalizeShotSize(state: ShotSizeState): ShotSizeState {
  return { ...state, align: normalizeAlignMultiple(state.align) };
}
