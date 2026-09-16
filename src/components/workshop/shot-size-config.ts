/** 工坊尺寸的**薄层**（规范 17 §17.2 第①层）。
 *
 *  尺寸的口径、档位目录、场景尺寸表与所有换算都在 `lib/size-presets` —— 全项目
 *  只有那两种表达：
 *    · 比例 + 分辨率          —— 比例（16:9 …）× 分辨率档（1k / 2k / 4k）
 *    · 比例 + 百万像素 + 倍数  —— 比例 × 总像素档（1M / 2M / 4M）× 对齐倍数（8/16/32/64）
 *
 *  本模块只留工坊用得到的三件事：
 *    ① 老数据回读（草稿里存的 "832x1216" 这类 WxH 字符串 → 尺寸表达）；
 *    ② 两条**只认老形状**的出口：内置工作流（txt2img / img2video）要的 `"WxH"`
 *       字符串、远端 API 通道要的「比例 + 百万像素 + 倍数」字段名；
 *    ③ 生成按钮旁的紧凑摘要。
 *
 *  下发到**工作流库的工作流**时不经过这里：把 `ShotSizeState` 直接交给封装层
 *  （`WorkshopExposedValues.size`），宽 / 高、比例标签、百万像素、倍数由封装层
 *  按当前模式的场景表现算 —— 不再拼字符串再反解。
 *
 *  无 React、无副作用，可直接单测。 */

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
} from "~/lib/size-presets";

/** 工坊的尺寸选择 —— 与 `SizeSpec` 同一形状（比例 + 清晰度档 + 倍数）。 */
export type ShotSizeState = SizeSpec;

/** 默认尺寸：竖屏 1k（3:4，图片场景表 → 768×1024）。 */
export const DEFAULT_SHOT_SIZE: ShotSizeState = DEFAULT_SIZE_SPEC;

/** 旧数据（草稿里的 "832x1216" / 空值 / 脏值）→ 尺寸表达；识别不出回退默认。 */
export function parseShotSize(
  raw: unknown,
  scene: SizeScene = "image",
): ShotSizeState {
  return sizeSpecFromText(raw, scene);
}

/** 尺寸表达 → 宽高（目标工作流要 width + height 时的派生值）。 */
export function shotSizeToDims(
  state: ShotSizeState,
  scene: SizeScene = "image",
): SizeDims {
  return sizeSpecDims(state, scene);
}

/** 比例短标签（"16:9 横屏" → "16:9"）。 */
export function shotSizeAspect(state: ShotSizeState): string {
  return sizeSpecAspect(state);
}

/** 该清晰度档属于哪个子类（分辨率 / 百万像素）。 */
export function shotClarityKind(
  state: ShotSizeState,
): SizeClarityPreset["kind"] {
  return sizeSpecKind(state);
}

/** 由清晰度 label 查档位预设；未知 label 回退 1k。 */
export function clarityPresetOf(label: string): SizeClarityPreset {
  return clarityPresetOfLabel(label);
}

/** 内置工作流（txt2img / img2video…）接的就是 "WxH" 字符串 —— 只此一路还在用
 *  字符串表达，工作流库的工作流不走这里。 */
export function shotSizeToParam(
  state: ShotSizeState,
  scene: SizeScene = "image",
): string {
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
