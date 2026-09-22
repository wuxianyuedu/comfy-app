/**
 * 工作流 IO 的**分组与预设**（`workflow-io.ts` 的拆分件）。
 *
 * 从主模块抽出 DimensionGroup / VideoGroup 推断、尺寸与视频预设表、
 * `parseRatioFromLabel` / `dimsForRatio` / `pickClarityPreset` 等与「具体
 * 某条对外参数」无关的**表现层聚合规则**。主模块保留 IO 模型与逐条推断
 * （`splitWorkflowIO` / `defaultInputValues` / `reconcileInputValues` /
 * `toWorkflowInputsPayload` 等），并从本模块 re-export 上述符号；消费者
 * `from "~/components/studio/workflow-io"` 的路径不变（§12.18 复用优先——
 * 拆包只挪文件、不动契约）。
 *
 * 依赖方向：本文件 → `./workflow-io-controls`（ControlKind 叶子）、
 * `./workflow-io-keywords`（isDimX / isVideoX 判据）、外部 lib
 * （size-presets / workflow-io-types）。**不**回指主模块，§12.7 单向。
 * 拆分动机：主文件 1060 行超过 §12.6 文件长度棘轮的阈值。
 */
import {
  CLARITY_SUBGROUP_LABELS,
  DEFAULT_ALIGN_MULTIPLE,
  SIZE_CLARITY_PRESETS,
  SIZE_RATIO_PRESETS,
  clarityKindOfLabel,
  megapixelDims,
  megapixelTierOfLabel,
  normalizeAlignMultiple,
  parseMegapixelLabel,
  resolutionDims,
  resolutionTierOfLabel,
  type ClarityKind,
  type SizePresetTable,
  type SizeScene,
} from "~/lib/media/size-presets";
import type { WorkflowIOEntry } from "~/lib/workflow/workflow-io-types";
import type { ControlKind } from "./workflow-io-controls";
import {
  isDimAspect,
  isDimHeight,
  isDimMegapixels,
  isDimMultiple,
  isDimWidth,
  isVideoAspect,
  isVideoLength,
  isVideoQuality,
} from "./workflow-io-keywords";

/* ─────────────────────────────────────────────────────────────────────────
 * 参数**分组**的推断。
 *
 * 自定义工作流常常暴露一组强耦合的 widget，用户更愿意把它们当成一个「范式」
 * 来调，而不是 N 个独立的输入框：
 *   • 尺寸组 —— `width` + `height`（图像工作流）。两种填法：
 *     (A) 分开编辑 W/H；(B) 选比例 + 清晰度，由表单把 W/H 算回那两个 widget。
 *   • 视频组 —— `length`（帧数）+ `aspect`（比例）+ `quality`（画质）。
 *     两种填法：(A) 逐个编辑 widget；(B) 从友好的预设里选时长 + 画质 + 比例，
 *     由预设把真实 widget 值写进去。
 *
 * 推断**纯按名字 / 标签**（与 `numericBounds` 的关键字启发式同口径），
 * 因此不需要改 schema，任何暴露了约定 pin 的工作流都能用。
 * 分组由**唯一**的消费方 `DynamicWorkflowForm` 发现，
 * 命中的 widget 随后会**从**通用逐行渲染里**摘掉**（width/height 不会出现两次）。
 * ───────────────────────────────────────────────────────────────────────── */

/** 富化后的 widget 条目，由 `splitWorkflowIO().widgetInputs` 产出。 */
export type EnrichedWidget = WorkflowIOEntry & {
  ioKey: string;
  control: ControlKind;
  /** 控件种类是**推断**出来的（条目没有声明 ComfyUI 类型）。
   *  区别于「声明的类型」（富化链路给的 INT / FLOAT / STRING / COMBO …）。
   *  推断控件只保证能编辑，不保证与 ComfyUI 真类型一致——
   *  `defaultInputValues` 据此**不**给推断出的数值控件造默认值，避免离线时
   *  静默下发一个猜出来的数字（见该函数的注释）。 */
  controlInferred?: boolean;
};

export interface DimensionGroup {
  kind: "dimension";
  groupId: string;
  /** 常规的 W/H 成对项 —— 渲染「比例 + 清晰度」选择器。 */
  width?: EnrichedWidget;
  height?: EnrichedWidget;
  /** ResolutionSelector 风格的成对项 —— 渲染「比例 + 像素」快捷选择器，
   *  直接写进那两个暴露出来的 widget。 */
  aspect?: EnrichedWidget;
  megapixels?: EnrichedWidget;
  /** 倍数（upscale multiple）—— 存在时并入「比例 + 像素」popover 的
   *  第三段，而不是散落成独立数字框。 */
  multiple?: EnrichedWidget;
}

export interface VideoGroup {
  kind: "video";
  groupId: string;
  length?: EnrichedWidget;
  aspect?: EnrichedWidget;
  quality?: EnrichedWidget;
}

export type InferredGroup = DimensionGroup | VideoGroup;

/* ── Dimension presets (比例 + 分辨率 / 比例 + 百万像素 + 倍数 → 宽高) ──
 *
 * 尺寸对外只表达成这两类等价形式：
 *   · 比例 + 分辨率         —— 1k / 2k / 4k，具体宽高按**场景**查表
 *                              （图片 = AI 出图口径，视频 = 显示器 / 视频行业标准口径）；
 *   · 比例 + 百万像素 + 倍数 —— 1M / 2M / 4M × 宽高对齐倍数 8/16/32/64。
 * 两类之间可互算（见 `lib/size-presets` 的 `toMegapixelSpec`）：目标工作流要
 * 「比例 + 百万像素 + 倍数」而用户选的是「比例 + 分辨率」时，按表换算后下发。
 *
 * `DIM_CLARITY_PRESETS` 是**档位目录**（不含具体像素）：`kind` 区分子类，
 * 具体宽高由 `dimsForRatio` 按场景现查。图片与视频的 1k/2k/4k 不是同一组值，
 * 表允许用户在「尺寸表配置」里改（见 `lib/size-preset-store`）。
 */

/** 比例预设（与 `SIZE_RATIO_PRESETS` 同源；保留旧名以免全库改 import）。 */
export const DIM_RATIO_PRESETS: { label: string; ratio: number }[] =
  SIZE_RATIO_PRESETS;

/** 「像素」大类下的两个子类：分辨率（1k/2k/4k）与百万像素（1M/2M/4M）。
 *
 *  **档位目录只有一个出处**：`lib/size-presets` 的 `SIZE_CLARITY_PRESETS`。
 *  这里保留 studio 视图一直在用的形状（`kind` + `label` + `totalPixels`）做一层
 *  再导出，避免同一份档位表在视图层再抄一遍（抄一份就必然漂移）。 */
export interface DimClarityPreset {
  kind: ClarityKind;
  /** 弹层芯片上显示的标签（如 "1k"、"1M"）。 */
  label: string;
  /** 百万像素的种类：总像素数（宽 × 高）。 */
  totalPixels?: number;
}

export const DIM_CLARITY_PRESETS: DimClarityPreset[] = SIZE_CLARITY_PRESETS.map(
  (preset) => ({
    kind: preset.kind,
    label: preset.label,
    ...(preset.megapixels !== undefined
      ? { totalPixels: preset.megapixels * 1_000_000 }
      : {}),
  }),
);

/** 清晰度标签 → 预设（含**自由百万像素值**）。
 *
 *  档位目录里有就用它；`"2.5M"` 这类档位之外的值按同一形状现造一个 ——
 *  `dimsForRatio` 只读 `kind` 与 `totalPixels`，所以造出来的预设与档位走的是
 *  同一条换算路径（不需要为自由值再写一条分支）。识别不出才回退第一档。
 *
 *  为什么必须走这一处：`DIM_CLARITY_PRESETS.find(...)` 找不到就回退会让用户
 *  填的 2.5 悄悄变回 1k（界面上还显示着 2.5M）。 */
export function clarityPresetFor(label: string): DimClarityPreset {
  const known = DIM_CLARITY_PRESETS.find((preset) => preset.label === label);
  if (known) return known;
  const megapixels = parseMegapixelLabel(label);
  return megapixels === null
    ? DIM_CLARITY_PRESETS[0]!
    : { kind: "megapixel", label, totalPixels: megapixels * 1_000_000 };
}

/** 「像素」大类下两个子类的显示名（与 `size-presets` 同一份）。 */
export const CLARITY_SUBGROUP_OF_KIND: Record<
  DimClarityPreset["kind"],
  string
> = CLARITY_SUBGROUP_LABELS;

export { clarityKindOfLabel, megapixelTierOfLabel, resolutionTierOfLabel };

/* ── ResolutionSelector 的快捷预设 ──
 *  有些自定义节点（如 ResolutionSelector）并不暴露原始的 width/height，
 *  而是暴露 `aspect_ratio`（COMBO，值形如 "16:9 (Widescreen)" 的标签字符串）
 *  加 `megapixels`（FLOAT，1 ≈ 100 万总像素）。
 *  尺寸选择器需要针对这种范式的显式取值映射 —— 没东西能从这两个值推出 W/H。
 *
 *  下面的 `parseRatioFromLabel` 让选择器仍能从工作流特有的标签字符串里
 *  认出**真实**比例，这样即使某个工作流的节点……
 *  spells the option differently ("16:9 宽屏", "16:9") still highlights
 *  the right chip instead of silently falling back to "自定义". */
export const ASPECT_RATIO_LABEL_PRESETS: {
  label: string;
  value: string;
  ratio: number;
}[] = [
  { label: "1:1", value: "1:1 (Square)", ratio: 1 },
  { label: "4:3", value: "4:3 (Standard)", ratio: 4 / 3 },
  { label: "3:2", value: "3:2 (Photo)", ratio: 3 / 2 },
  { label: "16:9", value: "16:9 (Widescreen)", ratio: 16 / 9 },
  { label: "21:9", value: "21:9 (Ultrawide)", ratio: 21 / 9 },
  { label: "9:16", value: "9:16 (Portrait)", ratio: 9 / 16 },
  { label: "2:3", value: "2:3 (Portrait Photo)", ratio: 2 / 3 },
];

export const MEGAPIXEL_VALUE_PRESETS: { label: string; value: number }[] = [
  { label: "1M", value: 1 },
  { label: "2M", value: 2 },
  { label: "4M", value: 4 },
];

/** 从自由形式的比例标签（"16:9 (Wide)"）里取出数值化的宽高比。
 *  字符串里没有可识别的比例时返回 null。 */
export function parseRatioFromLabel(value: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*[:x×]\s*(\d+(?:\.\d+)?)/.exec(value);
  if (!match) return null;
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0)
    return null;
  return w / h;
}

/** 给定目标比例 + 清晰度预设 + 场景，返回具体的 {width, height}。
 *
 *  分辨率档（resolution kind）：查「场景 × 比例 × 档位」表 —— 表里的值就是该场景
 *    1k/2k/4k 的口径（图片与视频不同），不做网格吸附，也不做区间钳制
 *    （超宽 4k 档的 5120 宽是用户明确要的值）。
 *  百万像素档（megapixel kind）：`totalPixels = w*h` 与 `w/h = ratio` 联立
 *    （h = sqrt(totalPixels / ratio)，w = totalPixels / h），再落到用户选的
 *    倍数网格上 —— 视频 / SDXL 管线通常要求宽高是 64 的倍数。
 *
 *  传数字（旧签名）时按「显式长边」处理：长边取该数字、另一边按比例推。 */
export function dimsForRatio(
  ratio: number,
  presetOrBase: DimClarityPreset | number,
  alignMultiple: number = DEFAULT_ALIGN_MULTIPLE,
  scene: SizeScene = "image",
  table?: SizePresetTable,
): { width: number; height: number } {
  /* 防退化 / 缺失的比例：NaN / 0 / 负数一律回落到 1:1 正方形，
   * 表单拿到的永远是一个有限值。 */
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;

  if (typeof presetOrBase === "number") {
    const horizontal = safeRatio >= 1;
    return {
      width: Math.max(
        1,
        Math.round(horizontal ? presetOrBase : presetOrBase * safeRatio),
      ),
      height: Math.max(
        1,
        Math.round(horizontal ? presetOrBase / safeRatio : presetOrBase),
      ),
    };
  }

  if (clarityKindOfLabel(presetOrBase.label) === "resolution") {
    const tier = resolutionTierOfLabel(presetOrBase.label) ?? "1k";
    return resolutionDims(scene, safeRatio, tier, table);
  }

  return megapixelDims(
    safeRatio,
    (presetOrBase.totalPixels ?? 1_000_000) / 1_000_000,
    normalizeAlignMultiple(alignMultiple),
  );
}

/** 由宽高反解最接近的清晰度档（跨分辨率 / 百万像素两个子类）。
 *
 *  用曼哈顿距离比较「该档位经 `dimsForRatio` 还原出来的宽高」与输入的差，
 *  因此正反两个方向必须传同一套 `alignMultiple` / `scene` —— 否则会落在
 *  两个档位之间（用户表现为「选了 1k，回读却高亮 2M」）。平手时按
 *  `DIM_CLARITY_PRESETS` 的声明顺序取第一个（确定性）。 */
export function pickClarityPreset(
  width: number,
  height: number,
  alignMultiple: number = DEFAULT_ALIGN_MULTIPLE,
  scene: SizeScene = "image",
  table?: SizePresetTable,
): DimClarityPreset {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return DIM_CLARITY_PRESETS[0]!;
  }
  const alignM = normalizeAlignMultiple(alignMultiple);
  const ratio = width / height;
  let best: DimClarityPreset = DIM_CLARITY_PRESETS[0]!;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const preset of DIM_CLARITY_PRESETS) {
    const { width: dw, height: dh } = dimsForRatio(
      ratio,
      preset,
      alignM,
      scene,
      table,
    );
    const dist = Math.abs(width - dw) + Math.abs(height - dh);
    if (dist < bestDist) {
      best = preset;
      bestDist = dist;
    }
  }
  return best;
}

/** 从 widget 清单里认出「尺寸型」的分组。
 *
 *  支持两种范式：
 *    • width + height            → renders the classic "比例 + 清晰度" picker
 *    • aspect_ratio + megapixels → renders a "比例 + 像素" quick picker that
 *      直接写进那两个暴露出来的 widget（如 ResolutionSelector）。
 */
export function inferDimensionGroup(
  widgets: EnrichedWidget[],
): DimensionGroup | null {
  const widthWidgets = widgets.filter(
    (entry) =>
      (entry.control === "int" || entry.control === "float") &&
      isDimWidth(entry),
  );
  const heightWidgets = widgets.filter(
    (entry) =>
      (entry.control === "int" || entry.control === "float") &&
      isDimHeight(entry),
  );
  if (widthWidgets.length > 0 && heightWidgets.length > 0) {
    const width = widthWidgets[0]!;
    const height = heightWidgets[0]!;
    if (width.ioKey === height.ioKey) return null;
    return {
      kind: "dimension",
      groupId: `dim:${width.ioKey}|${height.ioKey}`,
      width,
      height,
    };
  }

  /* ResolutionSelector-style: the user exposed "宽高比" + "百万像素" instead
   *      *  原始的 width/height。这里**不**要求特定的控件种类：这些 pin 通常是
   *      *  COMBO/FLOAT，但 IO 整理时 ComfyUI 离线的话，它们会以无类型的 "text" 到来。 */
  const aspectWidgets = widgets.filter(isDimAspect);
  const mpWidgets = widgets.filter(isDimMegapixels);
  if (aspectWidgets.length > 0 && mpWidgets.length > 0) {
    const aspect = aspectWidgets[0]!;
    const megapixels = mpWidgets[0]!;
    if (aspect.ioKey === megapixels.ioKey) return null;
    /* 倍数（可选伴随）：存在时并入组合 popover 的第三段。 */
    const multiple = widgets.find(
      (w) =>
        w.ioKey !== aspect.ioKey &&
        w.ioKey !== megapixels.ioKey &&
        isDimMultiple(w),
    );
    return {
      kind: "dimension",
      groupId: `aspect-mp:${aspect.ioKey}|${megapixels.ioKey}${multiple ? `|${multiple.ioKey}` : ""}`,
      aspect,
      megapixels,
      multiple,
    };
  }

  return null;
}

/** 从 widget 清单里认出「时长 + 比例 + 质量」的视频分组。 */
export function inferVideoGroup(widgets: EnrichedWidget[]): VideoGroup | null {
  const len = widgets.filter(isVideoLength);
  const asp = widgets.filter(isVideoAspect);
  const quality = widgets.filter(isVideoQuality);
  if (len.length === 0) return null;
  if (asp.length === 0 && quality.length === 0) return null;
  return {
    kind: "video",
    groupId: `video:${len[0]!.ioKey}|${asp[0]?.ioKey ?? ""}|${quality[0]?.ioKey ?? ""}`,
    length: len[0],
    aspect: asp[0],
    quality: quality[0],
  };
}

/** 跑两次推断，并在视频扫描里排除尺寸 pin ——
 *  同一个 widget 永远不会同属两组。返回命中的分组，
 *  以及它们消费掉的完整 ioKey 集合（调用方据此把那些 pin 的通用逐行渲染抑制掉）。 */
export function inferGroups(widgets: EnrichedWidget[]): {
  dimension: DimensionGroup | null;
  video: VideoGroup | null;
  groupedKeys: Set<string>;
} {
  const dimension = inferDimensionGroup(widgets);
  /* 尺寸组可能是 W/H 成对，也可能是别的形态，
   *  the 宽高比 + 百万像素 pair, so collect whichever pins it actually holds
   *  而不是假定一定存在 `width`/`height`。 */
  const dimKeys = new Set<string>();
  if (dimension) {
    if (dimension.width) dimKeys.add(dimension.width.ioKey);
    if (dimension.height) dimKeys.add(dimension.height.ioKey);
    if (dimension.aspect) dimKeys.add(dimension.aspect.ioKey);
    if (dimension.megapixels) dimKeys.add(dimension.megapixels.ioKey);
    if (dimension.multiple) dimKeys.add(dimension.multiple.ioKey);
  }
  const rest = widgets.filter((widget) => !dimKeys.has(widget.ioKey));
  const video = inferVideoGroup(rest);
  const groupedKeys = new Set<string>([...dimKeys]);
  if (video) {
    if (video.length) groupedKeys.add(video.length.ioKey);
    if (video.aspect) groupedKeys.add(video.aspect.ioKey);
    if (video.quality) groupedKeys.add(video.quality.ioKey);
  }
  return { dimension, video, groupedKeys };
}
