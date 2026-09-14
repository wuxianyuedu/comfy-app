/** 镜头生图尺寸的纯派生规则（规范 17 §17.2 第①层）。
 *
 *  尺寸对外表达为两类等价形式，同一块选择器里都能选：
 *    · 比例 + 分辨率          —— 1k / 2k / 4k，宽高按场景查「尺寸表」；
 *    · 比例 + 百万像素 + 倍数  —— 1M / 2M / 4M × 宽高对齐倍数 8/16/32/64。
 *
 *  下发时按目标工作流要的形状二选一（用户口径）：
 *    · 工作流要 width + height → `shotSizeToParam` 的 "WxH"；
 *    · 工作流要 比例 + 百万像素 + 倍数 → `shotSizeToExposed`；选的是「分辨率」
 *      时由 `lib/size-presets` 的 `toMegapixelSpec` 唯一解地换算过去。
 *
 *  无 React、无副作用，可直接单测。 */

import {
  DEFAULT_ALIGN_MULTIPLE,
  alignMultipleOf,
  longEdgeOf,
  megapixelsOf,
  normalizeAlignMultiple,
  ratioOfLabel,
  resolutionDims,
  shortRatio,
  type AlignMultiple,
  type SizeScene,
} from "~/lib/size-presets";
import {
  DIM_CLARITY_PRESETS,
  DIM_RATIO_PRESETS,
  clarityKindOfLabel,
  dimsForRatio,
  pickClarityPreset,
  resolutionTierOfLabel,
  type DimClarityPreset,
} from "~/components/studio/shared/workflow-io";

/** 默认尺寸：竖屏 1k（3:4 长边 1024，图片场景表 → 768x1024）。 */
export const DEFAULT_SHOT_RATIO = "3:4";
export const DEFAULT_SHOT_CLARITY = "1k";

export interface ShotSizeState {
  /** 比例预设 label（DIM_RATIO_PRESETS[].label，如 "3:4"）。 */
  ratio: string;
  /** 清晰度预设 label（DIM_CLARITY_PRESETS[].label，如 "1k"、"2M"）。 */
  clarity: string;
  /** 百万像素档的宽高对齐倍数（8/16/32/64）。
   *  分辨率档不读它 —— 那一档的宽高由场景尺寸表给定。 */
  multiple: AlignMultiple;
}

export const DEFAULT_SHOT_SIZE: ShotSizeState = {
  ratio: DEFAULT_SHOT_RATIO,
  clarity: DEFAULT_SHOT_CLARITY,
  multiple: DEFAULT_ALIGN_MULTIPLE,
};

/** 从任意 unknown（Shot.params.size / 草稿 JSON）恢复尺寸选择状态。
 *  旧数据是 "832x1216" 这类 WxH 字符串 —— 反解出最接近的 比例 + 像素档，
 *  倍数取「能整除两侧的最大候选」；无法识别时回退默认值。 */
export function parseShotSize(
  raw: unknown,
  scene: SizeScene = "image",
): ShotSizeState {
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
  const clarity = pickClarityPreset(width, height, DEFAULT_ALIGN_MULTIPLE, scene);
  return {
    ratio: ratio.label,
    clarity: clarity.label,
    multiple: alignMultipleOf({ width, height }),
  };
}

/** 由比例 label 查比值；未知 label 回退 1:1。 */
export function ratioValueOf(label: string): number {
  return ratioOfLabel(label);
}

/** 由清晰度 label 查预设；未知 label 回退 1k。 */
export function clarityPresetOf(label: string): DimClarityPreset {
  return (
    DIM_CLARITY_PRESETS.find((preset) => preset.label === label) ??
    DIM_CLARITY_PRESETS[0]!
  );
}

/** 该清晰度档属于哪个子类（分辨率 / 百万像素）。 */
export function shotClarityKind(state: ShotSizeState): DimClarityPreset["kind"] {
  return clarityKindOfLabel(state.clarity);
}

/** 选择状态 → 最终 WxH。 */
export function shotSizeToDims(
  state: ShotSizeState,
  scene: SizeScene = "image",
): { width: number; height: number } {
  return dimsForRatio(
    ratioValueOf(state.ratio),
    clarityPresetOf(state.clarity),
    state.multiple,
    scene,
  );
}

/** 选择状态 → 生成参数 `size`（"宽x高" 字符串）。
 *
 *  仅内置工作流（txt2img / img2video…）走这条 —— 它们接的就是 WxH 字符串。
 *  工作流库里的工作流不走字符串：尺寸按「比例 + 百万像素 + 倍数」逐端口派值，
 *  见 `shotSizeToExposed`。 */
export function shotSizeToParam(
  state: ShotSizeState,
  scene: SizeScene = "image",
): string {
  const { width, height } = shotSizeToDims(state, scene);
  return `${width}x${height}`;
}

/** 比例短标签（"16:9 横屏" → "16:9"）。 */
export function shotSizeAspect(state: ShotSizeState): string {
  return shortRatio(state.ratio);
}

/** 选择状态 → 工坊对外暴露的尺寸形状（比例 + 百万像素 + 倍数）。
 *
 *  工作流库里的工作流多用 `aspect_ratio`（COMBO，值形如 "16:9 (Widescreen)"）
 *  与 `megapixels`（FLOAT，1 ≈ 1M 总像素）表达尺寸。
 *
 *  用户口径：界面上选的若是「比例 + 百万像素 + 倍数」，直接传；选的若是
 *  「比例 + 分辨率」，按场景尺寸表换算成「百万像素 + 倍数」再传 ——
 *  百万像素取该档宽高的**实际总像素**（不是幂次近似），倍数取能同时整除
 *  两侧的最大候选。
 *
 *  `pixelLongEdge` 只在分辨率档给出（供工作流只暴露单个「分辨率」端口时使用）；
 *  两个端口同时存在时 `megapixels` 更精确，优先它。 */
export function shotSizeToExposed(
  state: ShotSizeState,
  scene: SizeScene = "image",
): {
  aspect: string;
  megapixels: number;
  multiple: AlignMultiple;
  pixelLongEdge?: number;
} {
  const aspect = shotSizeAspect(state);
  const tier = resolutionTierOfLabel(state.clarity);
  if (tier) {
    /* 分辨率档 → 查场景表拿宽高，再换算成「百万像素 + 倍数」。 */
    const size = resolutionDims(scene, ratioValueOf(state.ratio), tier);
    return {
      aspect,
      megapixels: megapixelsOf(size),
      multiple: alignMultipleOf(size),
      pixelLongEdge: longEdgeOf(size),
    };
  }
  const preset = clarityPresetOf(state.clarity);
  return {
    aspect,
    megapixels: (preset.totalPixels ?? 1_000_000) / 1_000_000,
    /* 老草稿里可能没有 multiple 字段 —— 规范化一次，避免把 undefined 下发。 */
    multiple: normalizeAlignMultiple(state.multiple),
  };
}

/** 选择状态 → 远端 API 通道认的尺寸字段（比例 + 百万像素 + 倍数）。
 *
 *  与「模型适配」里契约的 `size` 口同一口径（适配器层就是这三行）：分辨率档
 *  换算成实际总像素与对齐倍数后再传 —— 直接透传 "1k" 这类档位名对远端没有意义。 */
export function shotSizeToRelay(
  state: ShotSizeState,
  scene: SizeScene = "image",
): { aspectRatio: string; megapixels: string; multiple: AlignMultiple } {
  const exposed = shotSizeToExposed(state, scene);
  return {
    aspectRatio: exposed.aspect,
    megapixels: String(exposed.megapixels),
    multiple: exposed.multiple,
  };
}

/** 生成按钮旁的紧凑摘要（如 "3:4 / 1k"，百万像素档追加倍数 "16:9 / 2M / 64"）。
 *
 *  刻意不带折算出来的 WxH：工坊对尺寸的表达就是「比例 + 像素档（+ 倍数）」，
 *  具体像素由工作流侧按它自己的口径算 —— 把折算值写在这里等于又给了一串
 *  "768x1024"，与「不给 832x1216 这种值」相悖，且工作流只吃比例 / 像素时
 *  它还是个会误导的近似值。 */
export function shotSizeSummary(state: ShotSizeState): string {
  const base = `${shotSizeAspect(state)} / ${state.clarity}`;
  return shotClarityKind(state) === "megapixel"
    ? `${base} / ${normalizeAlignMultiple(state.multiple)}`
    : base;
}
