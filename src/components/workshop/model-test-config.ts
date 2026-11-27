// ── 「测试模型能力」页签的纯逻辑 / 常量（#3590）──────────────────────────
// 这页的定位：用工坊同款通道（/api/workshop-api/generate，远端模型按
// remoteModel 表 + 模式适配器直连）直接试已配置的模型。输入与输出都走
// 工坊那一条链 —— 本文件只放它的纯函数与常量，DOM / 网络分居视图与 hook。

import { ALL_WORKFLOW_TYPES } from "~/lib/workflow/workflow-types";
import { debugBodyOf, type ApiCallDebugRow } from "~/lib/workshop/api-channel-shared";
import {
  expandContractInputs,
  modeContractInputIdLabel,
  type ModeContractCustomInput,
} from "~/lib/workshop/model-mode-contract";
import type { WorkshopInputType } from "~/lib/workshop/remote-model-adapter";
import { isWorkshopInputType, workshopInputLabel } from "~/lib/workshop/remote-model-adapter";
import type { WorkshopWorkflowOption } from "~/lib/workshop/generation-client";

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

/** 本页可测的用途。工坊 API 通道目前有 image / video 两条；chat（#4080）走
 *  LLM 补全（本地 Ollama 与远端 chat 模型都可测）。 */
/* SAFETY: 类型断言已复核 */
export const MODEL_TEST_KINDS = ["image", "video", "chat"] as const;
export type ModelTestKind = (typeof MODEL_TEST_KINDS)[number];

export const MODEL_TEST_KIND_LABELS: Record<ModelTestKind, string> = {
  image: "图片",
  video: "视频",
  chat: "对话",
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

/** 统一输入值的白名单过滤（#4841 起两处共用同一条判据）：只收测试页承接的
 *  输入类型、且值是非空字符串。JSON 粘贴侧（use-model-test-json）与历史页
 *  「重试」的预填侧（use-model-test 的 applyReprintPrefill）都从这里过 ——
 *  两侧各写一份过滤，键集合迟早漂移。 */
export function pickWorkshopInputValues(raw: Record<string, unknown>): Partial<ModelTestValues> {
  const patch: Partial<ModelTestValues> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isWorkshopInputType(key) || typeof value !== "string" || value.trim() === "") {
      continue;
    }
    patch[key] = value;
  }
  return patch;
}

/** 统一输入的当前值 → JSON 输入模式的展示文本（ISSUE #4922）：形状与历史
 *  「复制去重投」的载荷一致（`{ mode, inputs }`），解析侧是 useApplyJsonValues
 *  —— 两端同步同走 `pickWorkshopInputValues` 这一条白名单过滤，测试页不承接的
 *  键与空值不进 JSON；默认档（尺寸族等）已在 values 里，会一并带出。 */
export function serializeModelTestJson(mode: string, values: ModelTestValues): string {
  return `${JSON.stringify({ mode, inputs: pickWorkshopInputValues({ ...values }) }, null, 2)}\n`;
}

/** 各用途在 API 通道里**真实承接**的统一输入集合（服务端
 *  `unifiedImageInputs` / `unifiedVideoInputs` 的镜像 —— 两边必须同步改，
 *  这里多给控件 = 用户填了却被通道静默丢掉，比不给更糟）。适配器映射行里
 *  落在集合外的类型渲染成「通道未承接」的禁用态。seed（ISSUE #3778）：
 *  生图通道新增承接 —— 抽卡种子的通行字段名就是 seed；视频通道同口径
 *  承接（ISSUE #3783），测试页视频模式的种子口随之可用。 */
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
  video: ["prompt", "negative", "first-frame", "duration", "seed"],
  /* 对话测试（#4080）：只有一条提示词，走 LLM 补全而不是图片/视频中继。 */
  chat: ["prompt"],
};

/** 本地（ComfyUI）通道承接的统一输入集合（#4080 评论 4：工作流提供的图片 /
 *  视频模型也进测试页）。与 RELAY_INPUT_TYPES 的分工：远端候选按 relay 集判
 *  「通道未承接」，工作流候选按这份集判 —— 集合是工坊封装层真实承接的对外口
 *  （prompt / negative / 尺寸族 / 参考图 / 首尾帧 / 时长 / 种子，见
 *  workflow-encapsulation 的 toContractValues）。 */
export const LOCAL_INPUT_TYPES: ReadonlyArray<WorkshopInputType> = [
  "prompt",
  "negative",
  "aspect-ratio",
  "megapixels",
  "resolution",
  "multiple",
  "image",
  "first-frame",
  "last-frame",
  "duration",
  "seed",
];

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
    case "images":
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

/** 当前候选走的那条通道真实承接的统一输入集合：远端候选按 API 中继的集合，
 *  工作流候选（#4080 评论 4）按本地 ComfyUI 通道的集合。 */
export function carriedInputTypes(
  kind: ModelTestKind,
  channel: "api" | "local",
): ReadonlyArray<WorkshopInputType> {
  return channel === "local" ? LOCAL_INPUT_TYPES : RELAY_INPUT_TYPES[kind];
}

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
  /** 候选走的通道（#4080 评论 4）：决定「未承接」按哪个集合判。 */
  channel: "api" | "local" = "api",
): Array<ModelTestInputRow> {
  const relay = new Set<string>(carriedInputTypes(kind, channel));
  if (contract === null) {
    return fallbackTestRows(kind, channel);
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
export function fallbackTestRows(
  kind: ModelTestKind,
  channel: "api" | "local" = "api",
): Array<ModelTestInputRow> {
  const rows: Array<ModelTestInputRow> = [];
  let sizePending = false;
  for (const type of carriedInputTypes(kind, channel)) {
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

/** configGet 下发的脱敏条目里本页关心的最小形状。
 *  `local` = 本地模型（#4080）：两种来源 —— extraModels 里的**字符串**条目
 *  （Ollama 文本候选，只能做对话测试）与**工作流提供的图片/视频模型**（#4080
 *  评论 4：工作流库条目，带 `workflow`，走工坊本地 ComfyUI 通道测试）；远端条目
 *  按 kind 过滤。 */
export type TestCandidate = {
  baseUrl: string | null;
  kind: string;
  local: boolean;
  name: string;
  /** 工作流提供的本地候选：工作流库条目（id / 模式 / 封装就绪都在上面）。 */
  workflow?: WorkshopWorkflowOption;
};

/** 工作流候选在下拉里的取值前缀：与远端模型名共用一个取值空间，前缀避免撞名
 *（模型名和工作流名都可能叫「z-Image」）。 */
export const WORKFLOW_CANDIDATE_PREFIX = "wf::";

/** 从候选取值里解出本地工作流 id：`wf::<id>` → `<id>`；其余（模型名 / 空串）
 *  一律回空串 —— 调用侧据此分流本地工作流通道与远端 API 通道（#4834）。 */
export function workflowIdFromCandidateValue(value: string): string {
  return value.startsWith(WORKFLOW_CANDIDATE_PREFIX)
    ? value.slice(WORKFLOW_CANDIDATE_PREFIX.length)
    : "";
}

/** 候选在下拉里的选项值：工作流候选用 `wf::<id>`，其余用模型名。 */
export function candidateValue(candidate: TestCandidate): string {
  return candidate.workflow
    ? `${WORKFLOW_CANDIDATE_PREFIX}${candidate.workflow.id}`
    : candidate.name;
}

/** 工作流候选的模型显示名（#4080 评论 17）：用户认知里的「模型名」是工作流库
 *  「管理模型」挂的模型标签（如 z-image），不是工作流文件名 —— 优先取第一个
 *  非空标签；没挂标签的工作流退回工作流名。 */
export function candidateModelName(candidate: TestCandidate): string {
  if (candidate.workflow === undefined) {
    return candidate.name;
  }
  const tag = candidate.workflow.modelTags.find((t) => t.trim() !== "");
  return tag === undefined ? candidate.workflow.name : tag.trim();
}

/** 候选的显示文案：工作流候选显示**模型名**（#4080 评论 17）；未完成工坊封装
 *  的明说（封装页签补线后才能被统一输入驱动）。 */
export function candidateLabel(candidate: TestCandidate): string {
  const base = candidateModelName(candidate);
  if (candidate.workflow === undefined) {
    return base;
  }
  return candidate.workflow.encapsulationReady ? base : `${base}（未封装）`;
}

/** 下拉选项的显示名索引：同名模型用工作流名消歧。 */
export function buildCandidateLabels(
  candidates: ReadonlyArray<TestCandidate>,
): Record<string, string> {
  const labels: Record<string, string> = {};
  const seen = new Map<string, number>();
  for (const candidate of candidates) {
    const base = candidateLabel(candidate);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    labels[candidateValue(candidate)] =
      count === 0 ? base : `${base} · ${candidate.workflow?.name ?? candidate.name}`;
  }
  return labels;
}

/** 工作流是否支持某个生成模式：模式码是工坊与库之间唯一的生成模式判据
 *  （workflow-library-flow §7 红线）—— 只认 modes / taskType 声明，不从内容
 *  类别反推。modes 缺失的老条目退 taskType。 */
export function workflowSupportsMode(
  workflow: Pick<WorkshopWorkflowOption, "modes" | "taskType">,
  mode: string,
): boolean {
  if (workflow.modes.includes(mode)) {
    return true;
  }
  return workflow.taskType !== undefined && workflow.taskType === mode;
}

/** 候选过滤：本地候选两种来源（#4080 评论 4）—— 工作流候选按 kind 对上
 *  （image / video），Ollama 字符串候选只能做对话测试；远端条目按 kind 对上
 *  （chat 不参与生图 / 生视频）。远端条目还要求 baseUrl 非空 —— 按名解析对
 *  空址条目会回落到全局通道设置，那样「测的就不是一个具体模型」了。 */
export function testCandidatesForKind(
  kind: ModelTestKind,
  entries: ReadonlyArray<TestCandidate>,
): Array<TestCandidate> {
  return entries.filter((e) => {
    if (e.name === "" && e.workflow === undefined) {
      return false;
    }
    if (e.local) {
      return e.workflow === undefined ? kind === "chat" : e.kind === kind;
    }
    return e.kind === kind && (e.baseUrl ?? "").trim() !== "";
  });
}

/** 数字统一输入的组装：空白 = 不带；非数字文本 = 不带（由必填项校验兜底）。
 *  本地（工作流）通道的时长组装同用这一份（workflow-model-test）。 */
export function numericValue(raw: string | undefined): number | undefined {
  const trimmed = raw?.trim() ?? "";
  if (trimmed === "") {
    return undefined;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** 种子统一输入的组装：空白 = 不带；非负整数才带（0 也是合法种子）。
 *  本地（工作流）通道的组装同用这一份（workflow-model-test）。 */
export function seedValue(raw: string | undefined): number | undefined {
  const trimmed = raw?.trim() ?? "";
  if (trimmed === "") {
    return undefined;
  }
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/** 组装生图请求（generation-client `apiGenerateImage` 的入参形状）。
 *  只收通道承接集合里的键；没填的键不带（服务端按「没带」回落）。
 *  `referenceImages`（#3949 需求 6/7）：参考图契约口的多张取值——首张照旧走
 *  `image`（既有单图适配器不受影响），整组以 `images` 数组随请求下发。 */
export function assembleImageRequest(opts: {
  mode: string;
  model: string;
  referenceImages?: Array<string>;
  values: ModelTestValues;
}): {
  aspectRatio?: string;
  image?: string;
  images?: Array<string>;
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
  const refs = (opts.referenceImages ?? []).map((s) => s.trim()).filter((s) => s !== "");
  const firstRef = refs[0];
  return {
    model: opts.model,
    mode: opts.mode,
    prompt: v.prompt?.trim() ?? "",
    ...(v.negative?.trim() ? { negative: v.negative.trim() } : {}),
    ...(v["aspect-ratio"]?.trim() ? { aspectRatio: v["aspect-ratio"].trim() } : {}),
    ...(v.megapixels?.trim() ? { megapixels: v.megapixels.trim() } : {}),
    ...(v.resolution?.trim() ? { resolution: v.resolution.trim() } : {}),
    ...(multiple === undefined ? {} : { multiple }),
    /* 参考图组（#3949 需求 6/7）：首张照旧走 `image`（既有单图适配器不受
     * 影响），整组以 `images` 数组随请求下发。 */
    ...(firstRef === undefined
      ? v.image?.trim()
        ? { image: v.image.trim() }
        : {}
      : { image: firstRef }),
    ...(refs.length > 0 ? { images: refs } : {}),
    ...(seed === undefined ? {} : { seed }),
  };
}

/** 组装视频提交请求（`apiSubmitVideo` 的入参形状）。首帧走统一输入的
 *  first-frame；duration 组装成秒数；种子非负整数才带（0 合法，#3783）。 */
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
  seed?: number;
} {
  const v = opts.values;
  const duration = numericValue(v.duration);
  const seed = seedValue(v.seed);
  return {
    model: opts.model,
    mode: opts.mode,
    prompt: v.prompt?.trim() ?? "",
    ...(v.negative?.trim() ? { negative: v.negative.trim() } : {}),
    ...(v["first-frame"]?.trim() ? { image: v["first-frame"].trim() } : {}),
    ...(duration === undefined ? {} : { duration }),
    ...(seed === undefined ? {} : { seed }),
  };
}

/* ── 左栏「所有模式」页签（#3635）─────────────────────────────────────
 * 页签清单 = 当前用途分类下的**全部生成类**工作流类型（与「模型适配」页的
 * availableModes 同一份出处）；页签上的模型数 = 候选里**配了该模式适配器**
 * 的条目数（没配适配器的模型走通道默认映射，不计入任何模式 —— 计入会让
 * 每个页签的数字都一样，页签间就分不出差异了）。 */

export type ModeTab = {
  /** 中文名（文生图 / 图像编辑 …），来自工作流类型注册表。 */
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
  /** 工作流候选（#4080 评论 4）：按 modes 声明计入页签徽标 —— 本地模型也
   *  要在「N 模型」里可见，否则只有工作流候选的页签会显示 0 模型。 */
  workflowCandidates: ReadonlyArray<WorkshopWorkflowOption> = [],
): Array<ModeTab> {
  const modelsByMode = new Map<string, number>();
  for (const adapters of Object.values(adaptersByModel)) {
    for (const mode of new Set(adapters.map((a) => a.mode))) {
      modelsByMode.set(mode, (modelsByMode.get(mode) ?? 0) + 1);
    }
  }
  const candidatesByMode = new Map<string, number>();
  for (const workflow of workflowCandidates) {
    for (const type of ALL_WORKFLOW_TYPES) {
      if (type.isGenerative && workflowSupportsMode(workflow, type.code)) {
        candidatesByMode.set(type.code, (candidatesByMode.get(type.code) ?? 0) + 1);
      }
    }
  }
  return ALL_WORKFLOW_TYPES.filter((t) => t.isGenerative && t.category === kind).map((t) => ({
    mode: t.code,
    label: t.label,
    modelCount: (modelsByMode.get(t.code) ?? 0) + (candidatesByMode.get(t.code) ?? 0),
  }));
}

/** 用途的默认模式：该分类下第一个生成类类型码（image → T2I、video → T2V）。
 *  左栏页签常显，模式必须有初值才能让「选模型 → 填输入」的表单一次成立。 */
export function defaultModeForKind(kind: ModelTestKind): string {
  return ALL_WORKFLOW_TYPES.find((t) => t.isGenerative && t.category === kind)?.code ?? "";
}

/* ── 左栏「生成中」标记（ISSUE #4838）─────────────────────────────────
 * 运行态按「用途 + 模式 + 模型」一格一份、不同模型可同时测试 —— 把**全部格**
 * 的生成中状态聚合成一份只读索引，左栏三处（用途页签 / 模式列表 / 模型下拉）
 * 的「生成中」徽标与计数都读它，不在三处各写一遍过滤。 */

/** 生成中的模型索引（全部格聚合）。 */
export type GeneratingIndex = {
  /** 键 = 用途，值 = 该用途下生成中的模型数（按模型取值去重：同一模型在
   *  多个模式各开一格时，用途页签不重复计数）。 */
  byKind: Record<ModelTestKind, number>;
  /** 键 = `${kind}::${mode}`，值 = 该模式下生成中的模型数（一格即一个
   *  模型取值，天然不重）。 */
  byMode: Record<string, number>;
  /** 正在生成的模型取值集合（模型名或 `wf::<id>`）。 */
  models: ReadonlySet<string>;
};

/** 聚合各格的生成中状态。只认能解析出用途与模型取值的格键，坏键跳过。
 *  格键 = `${kind}::${mode}::${modelValue}`，而模型取值本身可含 `::`
 *  （工作流候选 `wf::<id>`）—— 不能无脑 `split("::")`，按前两个分隔符切。 */
export function summarizeGeneratingSessions(
  sessions: Record<string, { generating: boolean }>,
): GeneratingIndex {
  const byKind: Record<ModelTestKind, number> = { image: 0, video: 0, chat: 0 };
  const byMode: Record<string, number> = {};
  const seenByKind: Record<ModelTestKind, Set<string>> = {
    image: new Set<string>(),
    video: new Set<string>(),
    chat: new Set<string>(),
  };
  const models = new Set<string>();
  for (const [key, session] of Object.entries(sessions)) {
    if (!session.generating) {
      continue;
    }
    const first = key.indexOf("::");
    const second = first === -1 ? -1 : key.indexOf("::", first + 2);
    if (first === -1 || second === -1) {
      continue;
    }
    const kind = key.slice(0, first);
    const mode = key.slice(first + 2, second);
    const model = key.slice(second + 2);
    if ((kind !== "image" && kind !== "video" && kind !== "chat") || model === "") {
      continue;
    }
    models.add(model);
    if (!seenByKind[kind].has(model)) {
      seenByKind[kind].add(model);
      byKind[kind] += 1;
    }
    const modeKey = `${kind}::${mode}`;
    byMode[modeKey] = (byMode[modeKey] ?? 0) + 1;
  }
  return { byKind, byMode, models };
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

/** 工作流候选的「本地提交」预览体（#4080 评论 8）：统一输入表单里**非空**的
 *  键原样列出（提示词 / 负向 / 尺寸四键 / 种子 / 时长 / 首帧…）—— 生成前就
 *  能看到尺寸这类值进了提交参数；data URL 长值由 debugBodyOf 截断。 */
export function workflowPreviewBody(values: ModelTestValues): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    const text = value?.trim() ?? "";
    if (text !== "") {
      out[key] = text;
    }
  }
  return out;
}

/* ── 请求读数行的组装（测试页三处共用：ISSUE #3799 / #3949 需求 8 / #3995）─ */

/** 请求体组装的唯一入口（#3949 需求 8）：本地提交行、生成前预览、真实调用
 *  三处共用同一份组装结果 —— 三处各拼一套必然漂移。从 use-model-test 拆来
 *  （§12.13：宿主文件越过行数硬闸）。 */
export function buildRequestBodies(input: {
  kind: ModelTestKind;
  mode: string;
  model: string;
  referenceImages: Array<string>;
  values: ModelTestValues;
}): {
  imageBody: ReturnType<typeof assembleImageRequest> | null;
  videoBody: ReturnType<typeof assembleVideoRequest> | null;
} {
  return {
    imageBody:
      input.kind === "image"
        ? assembleImageRequest({
            mode: input.mode,
            model: input.model,
            referenceImages: input.referenceImages,
            values: input.values,
          })
        : null,
    videoBody:
      input.kind === "video"
        ? assembleVideoRequest({ mode: input.mode, model: input.model, values: input.values })
        : null,
  };
}

/** 本地提交 / 生成前预览共用的那一行请求读数（端点固定为 relay）。
 *  形状同 `ApiCallDebugRow`（ISSUE #3791 / #3949 需求 8）。 */
export function relayDebugRow(kind: ModelTestKind, body: Record<string, unknown>): ApiCallDebugRow {
  return {
    body: debugBodyOf({ kind, debug: true, ...body }),
    durationMs: null,
    endpoint: "/api/workshop-api/generate",
    excerpt: null,
    ok: true,
    phase: "relay",
    status: null,
  };
}
