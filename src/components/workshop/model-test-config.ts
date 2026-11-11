// ── 「测试模型能力」页签的纯逻辑 / 常量（#3590）──────────────────────────
// 这页的定位：用工坊同款通道（/api/workshop-api/generate，远端模型按
// remoteModel 表 + 模式适配器直连）直接试已配置的模型。输入与输出都走
// 工坊那一条链 —— 本文件只放它的纯函数与常量，DOM / 网络分居视图与 hook。

import { type RemoteModeAdapter, type WorkshopInputType } from "~/lib/workshop/model-mode-contract";

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

/** 分辨率档：统一输入 megapixels 的取值（百万像素），界面按 K 档叫法。 */
export const MEGAPIXEL_PRESETS: ReadonlyArray<{ label: string; value: string }> = [
  { label: "1K", value: "1" },
  { label: "1.5K", value: "1.5" },
  { label: "2K", value: "2" },
];

/** 生成数量档（统一输入 multiple）。 */
/* SAFETY: 类型断言已复核 */
export const MULTIPLE_PRESETS = [1, 2, 3, 4] as const;

/** 表单值：按统一输入类型收值。数字类（multiple / duration / seed）也先存
 *  字符串 —— 输入中途不能被 Number("") 折成 0，组装时再转。 */
export type ModelTestValues = Partial<Record<WorkshopInputType, string>>;

/** 各用途在 API 通道里**真实承接**的统一输入集合（服务端
 *  `unifiedImageInputs` / `unifiedVideoInputs` 的镜像 —— 两边必须同步改，
 *  这里多给控件 = 用户填了却被通道静默丢掉，比不给更糟）。适配器映射行里
 *  落在集合外的类型渲染成「通道未承接」的禁用态。 */
export const RELAY_INPUT_TYPES: Record<ModelTestKind, ReadonlyArray<WorkshopInputType>> = {
  image: ["prompt", "negative", "aspect-ratio", "megapixels", "multiple", "image"],
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
  | "text";

export function controlForInputType(type: WorkshopInputType): ModelTestControl {
  switch (type) {
    case "prompt":
      return "prompt";
    case "negative":
      return "negative";
    case "aspect-ratio":
      return "ratio";
    case "megapixels":
      return "megapixels";
    case "multiple":
      return "multiple";
    case "duration":
      return "duration";
    case "image":
    case "first-frame":
    case "last-frame":
    case "mask":
    case "depth":
    case "pose":
    case "lineart":
    case "edge":
      return "image";
    case "seed":
      return "number";
    case "lora-model":
    case "lora-weight":
      return "text";
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
