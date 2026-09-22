## Changed

- **`src/components/studio/workflow-io.ts` 拆包**：1060 行超过 §12.6 文件长度
  棘轮的阈值（当前 --strict 违规、比基线 1025 多 35）。按 §18 拆包模式切成 4 个
  文件、**依赖方向完全单向**：
  · **`workflow-io-controls.ts`**（21 行，叶子）—— `ControlKind` 判别联合；
  · **`workflow-io-keywords.ts`**（66 行，叶子）—— 8 个关键字匹配器
  （`isDimWidth` / `isDimHeight` / `isDimAspect` / `isDimMegapixels` /
  `isDimMultiple` / `isVideoLength` / `isVideoAspect` / `isVideoQuality`），
  主模块的 `inferControlFromName` 与拆件的 `inferDimensionGroup` /
  `inferVideoGroup` **共用同一批**判据（不同源会长出「画布上认它是宽高比、
  下拉里认它是 text」这类分叉）；
  · **`workflow-io-groups.ts`**（402 行）—— DimensionGroup / VideoGroup
  推断 + `EnrichedWidget` / `DimClarityPreset` 类型 + 尺寸预设表
  （`DIM_RATIO_PRESETS` / `DIM_CLARITY_PRESETS` / `CLARITY_SUBGROUP_OF_KIND`
  / `ASPECT_RATIO_LABEL_PRESETS` / `MEGAPIXEL_VALUE_PRESETS`） +
  `parseRatioFromLabel` / `dimsForRatio` / `pickClarityPreset` /
  `clarityPresetFor` + `inferDimensionGroup` / `inferVideoGroup` /
  `inferGroups`；
  · **`workflow-io.ts`**（651 行）—— 保留 IO 模型与逐条推断
  （`splitWorkflowIO` / `defaultInputValues` / `reconcileInputValues` /
  `mergeRefreshedDefaults` / `toWorkflowInputsPayload` / `getMissingRequiredInputs`
  / `ioLabel` / `numericBounds` / `paramOutputPorts` / `wiredTargetsForEntry`
  / `runtimeNodeId` 等），从 controls / keywords / groups 三处 import 内部所需、
  末尾 `export { ... } from "./workflow-io-groups"` 与 `export type { ControlKind }`
  re-export；消费者 `from "~/components/studio/workflow-io"` 的路径**完全不变**
  （§12.18 复用优先）。

  `resolutionTierOfLabel` / `clarityKindOfLabel` / `megapixelTierOfLabel` 三个
  `~/lib/media/size-presets` 出口原本经 tail 段 re-export、被 3 个外部消费者按
  workflow-io 路径 import 使用；拆包后**保留在主文件的 re-export 列表**（否则
  `AspectMegapixelControl.tsx` / `DimensionControl.tsx` / `ShotSizePicker.tsx`
  三处会挂）。`scripts/.file-size-baseline.json` 里 workflow-io.ts 从 1025 降到
  651。

  `pnpm exec tsc --noEmit` 绿；`src/components/studio/workflow-io.test.ts` +
  `workflow-form/*` + `workflow-library/*` 共 **32 测试文件、424 用例**全过。
  类型安全审查 · 技术债盘点 #5 拆分线的一个（此前 --strict 唯一「违规且基线还
  对得上」的那个）。
