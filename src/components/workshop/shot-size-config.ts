/** 镜头生图尺寸的纯派生规则（规范 17 §17.2 第①层）。
 *
 *  尺寸对外表达为「比例 + 像素基准」两段：
 *    · 比例   —— 宽高比预设（横/竖/方）
 *    · 像素   —— 像素基准（1k/2k/4k 长边像素 或 1M/2M/4M 总像素）
 *
 *  不再对外表达「对齐倍数」：它是把 W/H 吸附到 ComfyUI 网格的实现细节，
 *  用户面没有可决策的内容 —— 内部固定用 `DEFAULT_ALIGN_MULTIPLE`。
 *
 *  无 React、无副作用，可直接单测。 */

import {
  DEFAULT_ALIGN_MULTIPLE,
  DIM_CLARITY_PRESETS,
  DIM_RATIO_PRESETS,
  dimsForRatio,
  pickClarityPreset,
  type DimClarityPreset,
} from "~/components/studio/shared/workflow-io";
import { shortRatioLabel } from "~/components/studio/shared/MultiSegmentPopover";

/** 默认尺寸：竖屏 1k（与内置 txt2img 的 832x1216 量级一致的 SD 竖屏比例）。 */
export const DEFAULT_SHOT_RATIO = "3:4";
export const DEFAULT_SHOT_CLARITY = "1k";

export interface ShotSizeState {
  /** 比例预设 label（DIM_RATIO_PRESETS[].label，如 "3:4"）。 */
  ratio: string;
  /** 清晰度预设 label（DIM_CLARITY_PRESETS[].label，如 "1k"、"2M"）。 */
  clarity: string;
}

export const DEFAULT_SHOT_SIZE: ShotSizeState = {
  ratio: DEFAULT_SHOT_RATIO,
  clarity: DEFAULT_SHOT_CLARITY,
};

/** 从任意 unknown（Shot.params.size / 草稿 JSON）恢复两段选择状态。
 *  旧数据是 "832x1216" 这类 WxH 字符串 —— 反解出最接近的 比例+清晰度；
 *  无法识别时回退默认值。 */
export function parseShotSize(raw: unknown): ShotSizeState {
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
  const clarity = pickClarityPreset(width, height, DEFAULT_ALIGN_MULTIPLE);
  return { ratio: ratio.label, clarity: clarity.label };
}

/** 由比例 label 查比值；未知 label 回退 1:1。 */
export function ratioValueOf(label: string): number {
  return DIM_RATIO_PRESETS.find((preset) => preset.label === label)?.ratio ?? 1;
}

/** 由清晰度 label 查预设；未知 label 回退 1k。 */
export function clarityPresetOf(label: string): DimClarityPreset {
  return (
    DIM_CLARITY_PRESETS.find((preset) => preset.label === label) ??
    DIM_CLARITY_PRESETS[0]!
  );
}

/** 两段状态 → 最终 WxH（固定对齐网格，钳制 [64, 4096]）。 */
export function shotSizeToDims(state: ShotSizeState): { width: number; height: number } {
  return dimsForRatio(
    ratioValueOf(state.ratio),
    clarityPresetOf(state.clarity),
    DEFAULT_ALIGN_MULTIPLE,
  );
}

/** 两段状态 → 生成参数 `size`（"宽x高" 字符串）。
 *
 *  仅内置工作流（txt2img / img2video…）走这条 —— 它们接的就是 WxH 字符串。
 *  工作流库里的工作流不走字符串：尺寸按「比例 + 像素」逐端口派值，
 *  见 `shotSizeToExposed`。 */
export function shotSizeToParam(state: ShotSizeState): string {
  const { width, height } = shotSizeToDims(state);
  return `${width}x${height}`;
}

/** 两段状态 → 工坊对外暴露的尺寸形状（不看像素、只看「比例 + 像素基准」）。
 *
 *  工作流库里的工作流可能用 `aspect_ratio`（COMBO，值形如 "16:9 (Widescreen)"）
 *  与 `megapixels`（FLOAT，1 ≈ 1M 总像素）表达尺寸，而不是 WxH 两个整数。
 *  把「比例 + 像素基准」原样交给它们，比先在工坊侧折成 WxH 再反解回来更准确
 *  —— 后者会因四舍五入落在两个预设之间（用户表现为「给了 1k 却算出个怪尺寸」）。
 *
 *  `pixelLongEdge` 是像素基准档（1k/2k/4k）的长边像素，供工作流只暴露
 *  单个「分辨率」端口时使用；百万像素档为 undefined（改用 `megapixels`）。 */
export function shotSizeToExposed(state: ShotSizeState): {
  aspect: string;
  megapixels?: number;
  pixelLongEdge?: number;
} {
  const preset = clarityPresetOf(state.clarity);
  const aspect = shortRatioLabel(state.ratio);
  if (preset.kind === "pixel") {
    return { aspect, pixelLongEdge: preset.longEdge ?? 1024 };
  }
  return { aspect, megapixels: (preset.totalPixels ?? 1_000_000) / 1_000_000 };
}

/** 生成按钮旁的紧凑摘要（如 "3:4 / 1k"）。
 *
 *  刻意不带折算出来的 WxH：工坊对尺寸的表达就是「比例 + 像素基准」，具体像素
 *  由工作流侧按它自己的口径算 —— 把折算值写在这里等于又给了一串 "768x1024"，
 *  与「不给 832x1216 这种值」相悖，且工作流只吃比例 / 像素时它还是个会误导的
 *  近似值。 */
export function shotSizeSummary(state: ShotSizeState): string {
  return `${shortRatioLabel(state.ratio)} / ${state.clarity}`;
}
