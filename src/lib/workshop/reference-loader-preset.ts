// ── 参考图装载预设：类型与判据（规范 §17.2 第①层，纯模块）────────────────
//
// #4376：多参考图工作流（如 MiniMax H3 的 image_0..image_4）的参考图装载链
// （LoadImage → ResizeImageMaskNode → …）此前写死在每张工作流的图里。本模块把
// 「一条装载链」抽成可保存的**预设**：LoadImage 之后串若干处理节点，执行期为
// 每张参考图按预设动态生成这条子图（见 `~/lib/comfyui/reference-loader-chain`）。
//
// 预设是**用户级**配置（这台机器上建、各工作流按 id 引用），存储分两层：
// 成品缺省（随包）+ 本机覆盖（`data/reference-loader-presets.json`，全量清单）。
// 读写执行者见 `reference-loader-preset.server.ts`。

import { z } from "zod";

/** 链上的一级处理：一个 ComfyUI 节点类 + 要固化的控件值（键 = object_info 里的
 *  widget 名；缺的键回落该类默认值）。串接口径：前一级的**第一个输出口** →
 *  后一级的**第一个连线入口**。 */
export const referenceLoaderStepSchema = z.object({
  /** ComfyUI 节点类名（object_info 键，如 `ResizeImageMaskNode`）。 */
  class: z.string().min(1),
  title: z.string().max(120).optional(),
  widgets: z.record(z.string(), z.unknown()).optional(),
});

export const referenceLoaderPresetSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  steps: z.array(referenceLoaderStepSchema).max(16),
});

export type ReferenceLoaderStep = z.infer<typeof referenceLoaderStepSchema>;
export type ReferenceLoaderPreset = z.infer<typeof referenceLoaderPresetSchema>;

/** 整份预设清单的判据（保存入参与读盘内容共用这一份）。 */
export const referenceLoaderPresetListSchema = z.array(referenceLoaderPresetSchema).max(64);

/** 解析一份来源不定的预设清单（读盘 / 入参同用）：不是数组 / 形状不符 → null。 */
export function parseReferenceLoaderPresets(value: unknown): Array<ReferenceLoaderPreset> | null {
  const parsed = referenceLoaderPresetListSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** 按 id 找预设（绑定侧只存 id，执行前用它回查定义）。 */
export function findReferenceLoaderPreset(
  presets: ReadonlyArray<ReferenceLoaderPreset>,
  id: string | undefined | null,
): ReferenceLoaderPreset | undefined {
  if (id === undefined || id === null || id === "") {
    return undefined;
  }
  return presets.find((preset) => preset.id === id);
}
