// ── 「测试模型能力」页签的纯逻辑 / 常量（#3590）──────────────────────────
// 这页的定位：用工坊同款通道（/api/workshop-api/generate，远端模型按
// remoteModel 表 + 模式适配器直连）直接试已配置的模型。输入与输出都走
// 工坊那一条链 —— 本文件只放它的纯函数与常量，DOM / 网络分居视图与 hook。

import { ALL_WORKFLOW_TYPES } from "~/lib/workflow/workflow-types";
import {
  expandContractInputs,
  modeContractInputIdLabel,
  type ModeContractCustomInput,
} from "~/lib/workshop/model-mode-contract";
import type { WorkshopInputType } from "~/lib/workshop/remote-model-adapter";
import { workshopInputLabel } from "~/lib/workshop/remote-model-adapter";

import {
  RESOLUTION_TIERS,
  alignMultipleOf,
  megapixelLabel,
  megapixelsOf,
  normalizeSizeSpec,
  resolutionDims,
  sceneFromMode,
  sizeSpecToRelay,
  type SizeScene,
  type SizeSpec,
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
 *  落在集合外的类型渲染成「通道未承接」的禁用态。seed（ISSUE #3778）：
 *  生图通道新增承接 —— 抽卡种子的通行字段名就是 seed。 */
export const RELAY_INPUT_TYPES: Record<ModelTestKind, ReadonlyArray<WorkshopInputType>> = {
  image: [
    "prompt",
    "negative",
    "aspect-ratio",
    "megapixels",
    "resolution",
    "multiple",
    "image",
    "seed",
  ],
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

/** 统一输入里的「尺寸」复合口涉及的类型（比例 / 百万像素 / 分辨率 / 倍数）：
 *  不逐行渲染，由尺寸下拉（ShotSizePicker）一并承担。 */
export const SIZE_INPUT_TYPES: ReadonlyArray<WorkshopInputType> = [
  "aspect-ratio",
  "megapixels",
  "resolution",
  "multiple",
];

/** 统一输入的**一行**（ISSUE #3778：行清单来自模式契约，不再来自适配器映射）。
 *
 *  契约是「统一对外参数」的口径（与工坊生成同一份）；适配器只负责把它们翻译
 *  成接口字段。行上带必备标记（契约 required 的生效集）与承接状态（通道
 *  RELAY_INPUT_TYPES 之外 → 未承接禁用），适配器有没有映射某一行由视图另查
 *  （只影响提示，不影响渲染）。判别联合：复合尺寸口（`kind: "size"`）由
 *  ShotSizePicker 整体渲染，其余行逐行给控件。 */
export type ModelTestInputRow = {
  /** 渲染形态；"size" = 复合尺寸口，由尺寸下拉整体承担。 */
  control: ModelTestControl | "size";
  /** 通道未承接 → 禁用渲染（填了也不会进请求，行上明说）。 */
  disabled: boolean;
  /** 契约口 id（稳定 key；兜底行用 `relay-<type>` 形状）。 */
  id: string;
  /** 行标签（契约口的展示名 / 自定义口作者填的名字）。 */
  label: string;
  /** 必备口（契约 required 的生效集）。 */
  required: boolean;
  /** 表单值键；复合尺寸口为 null（值散在四个尺寸键上），未承接行也为 null
   *  （禁用行不参与必填校验）。 */
  valueKey: WorkshopInputType | null;
};

/** 契约 → 统一输入行清单（顺序 = 契约口的顺序，用户在「模式契约」里排的）。
 *
 *  预制口按 `expandContractInputs` 展开（seed 映射到 `seed`、参考图映射到
 *  `image`）；`size` 复合口整体一行；带序号参考图第 2 张起与自定义口通道没有
 *  对应类型 → 未承接禁用行。 */
export function contractTestRows(
  contract: {
    customInputs?: Array<ModeContractCustomInput>;
    inputs: ReadonlyArray<string>;
    required?: ReadonlyArray<string>;
  } | null,
  kind: ModelTestKind,
): Array<ModelTestInputRow> {
  const relay = new Set<string>(RELAY_INPUT_TYPES[kind]);
  if (contract === null) {
    return fallbackTestRows(kind);
  }
  return expandContractInputs(contract).map((entry) => {
    const label = modeContractInputIdLabel(entry.id, contract.customInputs);
    if (entry.id === "size") {
      return {
        control: "size",
        disabled: !entry.types.some((t) => relay.has(t)),
        id: entry.id,
        label,
        required: entry.required,
        valueKey: null,
      };
    }
    /* 单类型口（预制口除 size 外都恰好映射一行）；通道没有对应类型
     * （带序号参考图第 2 张起 / 自定义口）→ 未承接禁用。 */
    const type = entry.types[0];
    const carried = type !== undefined && relay.has(type);
    return {
      control: type === undefined ? "text" : controlForInputType(type),
      disabled: !carried,
      id: entry.id,
      label,
      required: entry.required,
      valueKey: carried && type !== undefined ? type : null,
    };
  });
}

/** 契约读数未到时的兜底行：该用途通道承接集合（OpenAI 兼容默认映射的形状）。
 *  尺寸族类型聚成一行，其余逐行；必备只认提示词（契约缺省的内置默认）。 */
export function fallbackTestRows(kind: ModelTestKind): Array<ModelTestInputRow> {
  const rows: Array<ModelTestInputRow> = [];
  let sizePending = false;
  for (const type of RELAY_INPUT_TYPES[kind]) {
    if (SIZE_INPUT_TYPES.includes(type)) {
      if (!sizePending) {
        sizePending = true;
        rows.push({
          control: "size",
          disabled: false,
          id: "size",
          label: "尺寸",
          required: false,
          valueKey: null,
        });
      }
      continue;
    }
    rows.push({
      control: controlForInputType(type),
      disabled: false,
      id: `relay-${type}`,
      label: workshopInputLabel(type),
      required: type === "prompt",
      valueKey: type,
    });
  }
  return rows;
}

/* ── 尺寸表单值 ⇄ 工坊尺寸表达（两套形状的桥，ISSUE #3778）──────────────
 *  测试页的表单值按统一输入类型收值（aspect-ratio / megapixels / resolution /
 *  multiple 四键）；尺寸下拉（ShotSizePicker）吃的是 `SizeSpec`（比例 + 清晰度
 *  档 + 倍数）。换算全部走 `size-presets` 的既有纯函数（normalizeSizeSpec /
 *  sizeSpecToRelay），这里只做键位搬运 —— 两处各拼一套换算就会漂移。 */

/** 表单值 → 尺寸表达。分辨率档优先（`resolution` 带档位名）；否则按百万像素
 *  读（"2.5" → "2.5M"）；全空回落默认档（normalizeSizeSpec 的兜底）。 */
export function sizeValuesToSpec(values: ModelTestValues): SizeSpec {
  const resolution = values.resolution?.trim() ?? "";
  const mp = values.megapixels?.trim() ?? "";
  return normalizeSizeSpec({
    /* 正向条件（no-negated-condition）：分辨率档优先，其次百万像素，全空交给
     * normalizeSizeSpec 的默认兜底。 */
    clarity: resolution === "" ? (mp === "" ? undefined : megapixelLabel(Number(mp))) : resolution,
    multiple: numericValue(values.multiple),
    /* 空串原样交给 normalizeRatioLabel（它把空 / 脏值回落默认），不用 || 折 undefined。 */
    ratio: values["aspect-ratio"]?.trim(),
  });
}

/** 尺寸表达 → 表单值：比例短标签、百万像素（分辨率档 = 该档实际总像素）、
 *  对齐倍数、分辨率档位名（百万像素档清空 —— 同一口只带一种表达）。 */
export function sizeSpecToValues(spec: SizeSpec, scene: SizeScene): ModelTestValues {
  const relay = sizeSpecToRelay(spec, scene);
  return {
    "aspect-ratio": relay.aspectRatio,
    megapixels: relay.megapixels,
    multiple: String(relay.multiple),
    resolution: relay.resolution ?? "",
  };
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

/** 种子统一输入的组装：空白 = 不带；非负整数才带（0 也是合法种子）。 */
function seedValue(raw: string | undefined): number | undefined {
  const trimmed = raw?.trim() ?? "";
  if (trimmed === "") {
    return undefined;
  }
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
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
  seed?: number;
} {
  const v = opts.values;
  const multiple = numericValue(v.multiple);
  const seed = seedValue(v.seed);
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
    ...(seed === undefined ? {} : { seed }),
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
