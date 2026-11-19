/** 工坊尺寸的**薄层**（规范 17 §17.2 第①层）。口径、档位、尺寸表与换算都在
 *  `lib/size-presets`（全项目唯一表达）。本模块只留：① 老数据回读（"832x1216"
 *  这类 WxH 字符串 → 尺寸表达）；② 只认老形状的出口（远端 API 通道要的字段名，
 *  另有 `shotSizeToParam` 给只读 "WxH" 的老接口）；③ 生成按钮旁的紧凑摘要。
 *  下发工作流库不经过这里（`ShotSizeState` 直接交封装层现算）。无 React、无副作用。 */

import {
  DEFAULT_SIZE_SPEC,
  clarityPresetOfLabel,
  sizeSpecAspect,
  sizeSpecDims,
  sizeSpecFromText,
  sizeSpecKind,
  sizeSpecSummary,
  sizeSpecToRelay,
  sizeSpecToWxH,
  type AlignMultiple,
  type SizeClarityPreset,
  type SizeDims,
  type SizeScene,
  type SizeSpec,
} from "~/lib/media/size-presets";

/** 工坊的尺寸选择 —— 与 `SizeSpec` 同一形状（比例 + 清晰度档 + 倍数）。 */
export type ShotSizeState = SizeSpec;

/** 默认尺寸：竖屏 1k（3:4，图片场景表 → 768×1024）。 */
export const DEFAULT_SHOT_SIZE: ShotSizeState = DEFAULT_SIZE_SPEC;

/** 旧数据（草稿里的 "832x1216" / 空值 / 脏值）→ 尺寸表达；识别不出回退默认。 */
export function parseShotSize(raw: unknown, scene: SizeScene = "image"): ShotSizeState {
  return sizeSpecFromText(raw, scene);
}

/** 尺寸表达 → 宽高（目标工作流要 width + height 时的派生值）。 */
export function shotSizeToDims(state: ShotSizeState, scene: SizeScene = "image"): SizeDims {
  return sizeSpecDims(state, scene);
}

/** 比例短标签（"16:9 横屏" → "16:9"）。 */
export function shotSizeAspect(state: ShotSizeState): string {
  return sizeSpecAspect(state);
}

/** 该清晰度档属于哪个子类（分辨率 / 百万像素）。 */
export function shotClarityKind(state: ShotSizeState): SizeClarityPreset["kind"] {
  return sizeSpecKind(state);
}

/** 由清晰度 label 查档位预设；未知 label 回退 1k。 */
export function clarityPresetOf(label: string): SizeClarityPreset {
  return clarityPresetOfLabel(label);
}

/** 内置工作流（txt2img / img2video…）接的就是 "WxH" 字符串 —— 只此一路还在用
 *  字符串表达，工作流库的工作流不走这里。 */
export function shotSizeToParam(state: ShotSizeState, scene: SizeScene = "image"): string {
  return sizeSpecToWxH(state, scene);
}

/** 远端 API 通道认的尺寸字段（比例 + 百万像素 + 倍数）。
 *
 *  与「模型适配」里契约的 `size` 口同一口径（适配器层就是这三行）：分辨率档
 *  换算成实际总像素与对齐倍数后再传 —— 直接透传 "1k" 这类档位名对远端没有意义。 */
export function shotSizeToRelay(
  state: ShotSizeState,
  scene: SizeScene = "image",
): { aspectRatio: string; megapixels: string; multiple: AlignMultiple } {
  return sizeSpecToRelay(state, scene);
}

/** 生成按钮旁的紧凑摘要（如 "3:4 / 1k"，百万像素档追加倍数 "16:9 / 2M / 64"）。
 *
 *  刻意不带折算出来的 WxH：工坊对尺寸的表达就是「比例 + 像素档（+ 倍数）」，
 *  具体像素由工作流侧按它自己的口径算。 */
export function shotSizeSummary(state: ShotSizeState): string {
  return sizeSpecSummary(state);
}
