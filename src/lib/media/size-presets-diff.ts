/* ── 尺寸配置表的差集（ISSUE #3973）──
 * 本机覆盖只记「这台机器上真的改过的那几格」，与侧栏页签行为
 * （`diffSidebarTabConfig`）/ 模式契约（`localOverrideDiff`）同一口径：
 * 基准（项目默认）演进能穿透覆盖文件，改回默认 = 从覆盖里消失。
 *
 * 为什么不住在 `size-presets.ts`：那份文件已到 900 行的文件长度硬闸，
 * 按职责把「差集」这一小块拆出来 —— 只依赖本域的常量与类型，单向不回环。
 * 纯函数、无 React、无 IO，可直接单测。 */
import {
  RESOLUTION_TIERS,
  SIZE_RATIO_PRESETS,
  type ResolutionTier,
  type SizeDims,
  type SizePresetTable,
  type SizeScene,
} from "./size-presets";

/** 差集覆盖的稀疏形状：场景、比例行、分辨率档三层都可缺 —— 缺 = 回落基准。 */
export type SizePresetTableDiff = Partial<
  Record<SizeScene, Partial<Record<string, Partial<Record<ResolutionTier, SizeDims>>>>>
>;

/** 差集：只留 `desired` 与 `base` 不同的那些格子（逐场景 × 逐行 × 逐档）。
 *
 *  与基准相同的格子**不进差集** —— 覆盖文件里只留「这台机器上真的改过的那几格」，
 *  于是「改回默认」免费成立（把表改回基准再保存 = 该格从覆盖里消失），项目默认
 *  后续改动也能穿透到存过覆盖的机器。 */
export function diffSizePresetTable(
  desired: SizePresetTable,
  base: SizePresetTable,
): SizePresetTableDiff {
  const out: SizePresetTableDiff = {};
  for (const scene of ["image", "video"] as const) {
    const desiredScene = desired[scene];
    const baseScene = base[scene];
    const sceneDiff: NonNullable<SizePresetTableDiff[SizeScene]> = {};
    for (const preset of SIZE_RATIO_PRESETS) {
      const desiredRow = desiredScene[preset.label];
      const baseRow = baseScene[preset.label];
      const rowDiff: Partial<Record<ResolutionTier, SizeDims>> = {};
      for (const tier of RESOLUTION_TIERS) {
        const a = desiredRow?.[tier];
        const b = baseRow?.[tier];
        /* 任一侧缺格按「不同」处理（有值的一侧进差集）—— 与 `sceneIsModified`
         * 的缺格判据同一口径。 */
        if (a && (!b || a.width !== b.width || a.height !== b.height)) {
          rowDiff[tier] = { width: a.width, height: a.height };
        }
      }
      if (Object.keys(rowDiff).length > 0) {
        sceneDiff[preset.label] = rowDiff;
      }
    }
    if (Object.keys(sceneDiff).length > 0) {
      out[scene] = sceneDiff;
    }
  }
  return out;
}
