// ── 「测试模型能力」页签的纯逻辑 / 常量（#3590）──────────────────────────
// 这页的定位：用工坊同款通道（/api/workshop-api/generate，远端模型按
// remoteModel 表 + 模式适配器直连）直接试已配置的模型。输入与输出都走
// 工坊那一条链 —— 本文件只放它的纯函数与常量，DOM / 网络分居视图与 hook。

import { ALL_WORKFLOW_TYPES } from "~/lib/workflow/workflow-types";
import type { RemoteModeAdapter, WorkshopInputType } from "~/lib/workshop/remote-model-adapter";

import {
  MEGAPIXEL_TIERS,
  RESOLUTION_TIERS,
  alignMultipleOf,
  megapixelsOf,
  resolutionDims,
  sceneFromMode,
  type SizeScene,
} from "~/lib/media/size-presets";

/** 本页可测的用途。工坊 API 通道目前只有 image / video 两条（contract 的
 *  output 词表虽有 audio，通道未接入 —— 出现死页签不如不出现，接入后再加）。 */
/* SAFETY: 类型断言已复核 */
export const MODEL_TEST_KINDS = ["image", "video"] as const;
export type ModelTestKind = (typeof MODEL_TEST_KINDS)[number];

export const MODEL_TEST_KIND_LABELS: Record<ModelTestKind, string> = {
  image: "图片",
  video: "视频",
};

/** 宽高比档（参考主流生成面板的常用档）；值 = 统一输入 aspect-ratio 的取值。 */
/* SAFETY: 类型断言已复核 */
export const ASPECT_RATIO_PRESETS = [
  "1:1",
  "4:3",
  "3:4",
  "16:9",
  "9:16",
  "3:2",
  "2:3",
  "21:9",
] as const;

/** 「像素」段的候选（工作流库同款两类表达，ISSUE #3742）：分辨率档
 *  （1k/2k/4k，按场景尺寸表换算成「百万像素 + 对齐倍数」）与百万像素档
 *  （1M/2M/4M）。选分辨率档时档位名随 `resolution`、换算值随 `megapixels`
 *  一起下发（适配器映射了哪个就走哪个）。 */
export type ModelTestClarityOption = {
  /** 弹层芯片标签（"1K" / "2M"）。 */
  label: string;
  /** 写回 megapixels 的总像素（串形态，与本页表单值同型）。 */
  megapixels: string;
  /** 写回 multiple 的对齐倍数；百万像素档不改倍数（空串 = 不写）。 */
  multiple: string;
  /** 写回 resolution 的档位名；百万像素档清空它（空串 = 不带）。 */
  resolution: string;
  subgroup: "megapixel" | "resolution";
};

export function clarityOptionsFor(scene: SizeScene, ratio: number): Array<ModelTestClarityOption> {
  const rows: Array<ModelTestClarityOption> = [];
  for (const tier of RESOLUTION_TIERS) {
    const dims = resolutionDims(scene, ratio, tier);
    rows.push({
      label: tier.toUpperCase(),
      megapixels: String(megapixelsOf(dims)),
      multiple: String(alignMultipleOf(dims)),
      resolution: tier,
      subgroup: "resolution",
    });
  }
  for (const tier of MEGAPIXEL_TIERS) {
    rows.push({
      label: `${tier}M`,
      megapixels: String(tier),
      multiple: "",
      resolution: "",
      subgroup: "megapixel",
    });
  }
  return rows;
}

/** 提示词的常用随机样本（ISSUE #3742：随机按钮从这里取）。 */
export const PROMPT_PRESETS = [
  "一只柯基犬在草地上奔跑，阳光明媚，毛发细节丰富，照片级真实感",
  "赛博朋克城市夜景，霓虹灯与雨后街道倒影，电影感构图",
  "水彩风格的猫头鹰特写，白色背景，柔和笔触，插画",
  "云雾缭绕的中国山水画，水墨风格，留白意境",
  "未来感电动跑车，产品摄影，棚拍灯光，深色背景",
  "日式庭院里的樱花树，花瓣飘落，柔和晨光，动画电影质感",
] as const;

/** 随机取一条常用提示词（随机按钮的落点；随机源可注入便于测试）。 */
export function randomPromptFor(rand: () => number = Math.random): string {
  const picked = PROMPT_PRESETS[Math.floor(rand() * PROMPT_PRESETS.length)];
  return picked ?? PROMPT_PRESETS[0];
}

/** 表单值：按统一输入类型收值。数字类（multiple / duration / seed）也先存
 *  字符串 —— 输入中途不能被 Number("") 折成 0，组装时再转。 */
export type ModelTestValues = Partial<Record<WorkshopInputType, string>>;

/** 各用途在 API 通道里**真实承接**的统一输入集合（服务端
 *  `unifiedImageInputs` / `unifiedVideoInputs` 的镜像 —— 两边必须同步改，
 *  这里多给控件 = 用户填了却被通道静默丢掉，比不给更糟）。适配器映射行里
 *  落在集合外的类型渲染成「通道未承接」的禁用态。 */
export const RELAY_INPUT_TYPES: Record<ModelTestKind, ReadonlyArray<WorkshopInputType>> = {
  image: ["prompt", "negative", "aspect-ratio", "megapixels", "resolution", "multiple", "image"],
  video: ["prompt", "negative", "first-frame", "duration"],
};

/** 统一输入类型 → 本页的控件形态（与 mode-contract 的 contractControlFor 同族：
 *  那份吃契约口 id，这份吃适配器行的输入类型）。 */
export type ModelTestControl =
  | "duration"
  | "image"
  | "megapixels"
  | "multiple"
  | "negative"
  | "number"
  | "prompt"
  | "ratio"
  | "resolution"
  | "text";

export function controlForInputType(type: WorkshopInputType): ModelTestControl {
  switch (type) {
    case "prompt": {
      return "prompt";
    }
    case "negative": {
      return "negative";
    }
    case "aspect-ratio": {
      return "ratio";
    }
    case "megapixels": {
      return "megapixels";
    }
    case "resolution": {
      return "resolution";
    }
    case "multiple": {
      return "multiple";
    }
    case "duration": {
      return "duration";
    }
    case "image":
    case "first-frame":
    case "last-frame":
    case "mask":
    case "depth":
    case "pose":
    case "lineart":
    case "edge": {
      return "image";
    }
    case "seed": {
      return "number";
    }
    case "lora-model":
    case "lora-weight": {
      return "text";
    }
  }
}

/** configGet 下发的脱敏条目里本页关心的最小形状。 */
export type TestCandidate = {
  baseUrl: string | null;
  kind: string;
  name: string;
};

/** 候选过滤：kind 对得上的条目（chat 不参与生图 / 生视频）。
 *  baseUrl 为空的条目也不进 —— 按名解析对空址条目会回落到全局通道设置，
 *  那样「测的就不是一个具体模型」了；想测它先到设置页补供应商 Base URL。 */
export function testCandidatesForKind(
  kind: ModelTestKind,
  entries: ReadonlyArray<TestCandidate>,
): Array<TestCandidate> {
  return entries.filter((e) => e.name !== "" && e.kind === kind && (e.baseUrl ?? "").trim() !== "");
}

/** 数字统一输入的组装：空白 = 不带；非数字文本 = 不带（由必填项校验兜底）。 */
function numericValue(raw: string | undefined): number | undefined {
  const trimmed = raw?.trim() ?? "";
  if (trimmed === "") {
    return undefined;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** 组装生图请求（generation-client `apiGenerateImage` 的入参形状）。
 *  只收通道承接集合里的键；没填的键不带（服务端按「没带」回落）。 */
export function assembleImageRequest(opts: {
  mode: string;
  model: string;
  values: ModelTestValues;
}): {
  aspectRatio?: string;
  image?: string;
  megapixels?: string;
  mode: string;
  model: string;
  multiple?: number;
  negative?: string;
  prompt: string;
  resolution?: string;
} {
  const v = opts.values;
  const multiple = numericValue(v.multiple);
  return {
    model: opts.model,
    mode: opts.mode,
    prompt: v.prompt?.trim() ?? "",
    ...(v.negative?.trim() ? { negative: v.negative.trim() } : {}),
    ...(v["aspect-ratio"]?.trim() ? { aspectRatio: v["aspect-ratio"].trim() } : {}),
    ...(v.megapixels?.trim() ? { megapixels: v.megapixels.trim() } : {}),
    ...(v.resolution?.trim() ? { resolution: v.resolution.trim() } : {}),
    ...(multiple === undefined ? {} : { multiple }),
    ...(v.image?.trim() ? { image: v.image.trim() } : {}),
  };
}

/** 组装视频提交请求（`apiSubmitVideo` 的入参形状）。首帧走统一输入的
 *  first-frame；duration 组装成秒数。 */
export function assembleVideoRequest(opts: {
  mode: string;
  model: string;
  values: ModelTestValues;
}): {
  duration?: number;
  image?: string;
  mode: string;
  model: string;
  negative?: string;
  prompt: string;
} {
  const v = opts.values;
  const duration = numericValue(v.duration);
  return {
    model: opts.model,
    mode: opts.mode,
    prompt: v.prompt?.trim() ?? "",
    ...(v.negative?.trim() ? { negative: v.negative.trim() } : {}),
    ...(v["first-frame"]?.trim() ? { image: v["first-frame"].trim() } : {}),
    ...(duration === undefined ? {} : { duration }),
  };
}

/** 该适配器下「通道承接得住」的输入行数：0 = 全是未承接类型
 *  （提示用户这条映射超出 API 通道，不是报错 —— 适配器本身是合法的）。 */
export function relayInputCount(adapter: RemoteModeAdapter, kind: ModelTestKind): number {
  const relay = new Set<string>(RELAY_INPUT_TYPES[kind]);
  return adapter.inputs.filter((row) => relay.has(row.type)).length;
}

/* ── 左栏「所有模式」页签（#3635）─────────────────────────────────────
 * 页签清单 = 当前用途分类下的**全部生成类**工作流类型（与「模型适配」页的
 * availableModes 同一份出处）；页签上的模型数 = 候选里**配了该模式适配器**
 * 的条目数（没配适配器的模型走通道默认映射，不计入任何模式 —— 计入会让
 * 每个页签的数字都一样，页签间就分不出差异了）。 */

export type ModeTab = {
  /** 中文名（文生图 / 图生图 …），来自工作流类型注册表。 */
  label: string;
  /** 模式码（T2I / I2V / T2V …），即生成请求里带的 mode。 */
  mode: string;
  /** 配了该模式适配器的候选模型数。 */
  modelCount: number;
};

/** 候选模型的适配器索引：模型名 → 它已配置的模式适配器清单。 */
export type AdaptersByModel = Record<string, ReadonlyArray<{ mode: string }>>;

export function modeTabsForKind(
  kind: ModelTestKind,
  adaptersByModel: AdaptersByModel,
): Array<ModeTab> {
  return ALL_WORKFLOW_TYPES.filter((t) => t.isGenerative && t.category === kind).map((t) => ({
    mode: t.code,
    label: t.label,
    modelCount: Object.values(adaptersByModel).filter((adapters) =>
      adapters.some((a) => a.mode === t.code),
    ).length,
  }));
}

/** 用途的默认模式：该分类下第一个生成类类型码（image → T2I、video → T2V）。
 *  左栏页签常显，模式必须有初值才能让「选模型 → 填输入」的表单一次成立。 */
export function defaultModeForKind(kind: ModelTestKind): string {
  return ALL_WORKFLOW_TYPES.find((t) => t.isGenerative && t.category === kind)?.code ?? "";
}

/** 尺寸默认档：比例首档（1:1 正方）+ 分辨率首档（1k）。 */
export const MODEL_TEST_DEFAULT_RATIO = "1:1";
export const MODEL_TEST_DEFAULT_RESOLUTION = RESOLUTION_TIERS[0];

/** 尺寸的默认取值（ISSUE #3742「给一个最常用的默认选项」）：1:1 + 1K
 *  （与工作流库的首档默认同源；分辨率档位名随 `resolution`、按场景尺寸表
 *  换算出的总像素随 `megapixels`、对齐倍数随 `multiple` 一并预置）。视频
 *  模式的 API 通道不承接尺寸，不给默认。 */
export function defaultSizeValues(mode: string): ModelTestValues {
  if (sceneFromMode(mode) !== "image") {
    return {};
  }
  const dims = resolutionDims("image", 1, MODEL_TEST_DEFAULT_RESOLUTION);
  return {
    "aspect-ratio": MODEL_TEST_DEFAULT_RATIO,
    megapixels: String(megapixelsOf(dims)),
    multiple: String(alignMultipleOf(dims)),
    resolution: MODEL_TEST_DEFAULT_RESOLUTION,
  };
}
