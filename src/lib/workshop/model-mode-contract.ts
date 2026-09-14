// ── 远端模型「工坊模式适配器」：统一输入类型 + 模式契约（纯函数层）──────
// 工坊对外只说「统一输入」：提示词 / 负向提示词 / 宽高比 / 百万像素 / 图片 /
// 首帧 / 尾帧 / 掩码 / 深度图 / 姿态骨架 / 线稿 / 边缘图 / 种子 —— 模式对应
// 工作流库中定义的模式（T2I / I2I / D2I … T2V / I2V …）。每种远端模型按模式
// 配置一份适配器（统一输入 → 该接口的请求体字段名 + 产物字段路径），工坊
// 发起生成时据此把统一输入翻译成该接口的请求；未配置适配器时回落到
// OpenAI 兼容 images/generations 的默认映射。
//
// 输出类型由模式的类别决定（图像 → 图片，视频 → 视频，音频 → 音频）。

import {
  EXPOSED_PARAM_LABEL,
  exposedParamsForMode,
} from "~/lib/workflow-exposed-params";
import { getWorkflowType } from "~/lib/workflow-types";
import { isVideoMode } from "~/lib/workshop/workflow-encapsulation";

/** 可作为输入的统一类型（供适配器配置选用）。 */
export const WORKSHOP_INPUT_TYPES = [
  { type: "prompt", label: "提示词" },
  { type: "negative", label: "负向提示词" },
  { type: "aspect-ratio", label: "宽高比" },
  { type: "megapixels", label: "百万像素" },
  { type: "image", label: "图片（参考图 / 输入图）" },
  { type: "first-frame", label: "首帧图片" },
  { type: "last-frame", label: "尾帧图片" },
  { type: "mask", label: "掩码图" },
  { type: "depth", label: "深度图" },
  { type: "pose", label: "姿态骨架图" },
  { type: "lineart", label: "线稿图" },
  { type: "edge", label: "边缘图" },
  { type: "seed", label: "种子" },
] as const;

export type WorkshopInputType = (typeof WORKSHOP_INPUT_TYPES)[number]["type"];

const INPUT_TYPE_SET = new Set<string>(
  WORKSHOP_INPUT_TYPES.map((t) => t.type),
);

export function isWorkshopInputType(v: unknown): v is WorkshopInputType {
  return typeof v === "string" && INPUT_TYPE_SET.has(v);
}

export function workshopInputLabel(type: WorkshopInputType): string {
  return WORKSHOP_INPUT_TYPES.find((t) => t.type === type)?.label ?? type;
}

/** 一种远端模式在工坊下的适配器。 */
export interface RemoteModeAdapter {
  /** 工作流库定义的模式码（T2I / I2I / D2I … T2V / I2V …）。 */
  mode: string;
  /** 上游端点路径（拼在条目 baseUrl 后），如 /v1/images/generations。 */
  endpointPath: string;
  /** 统一输入 → 请求体字段名。同一类型只能出现一次。 */
  inputs: Array<{ type: WorkshopInputType; field: string }>;
  /** 产物字段路径（响应 JSON 内，支持 a.b.0.c）；空 = 走通用提取。 */
  outputField: string;
}

/** 该模式默认的输入清单（适配器新建时预填；field 暂用类型名本身）。 */
export function defaultInputsForMode(mode: string): Array<{
  type: WorkshopInputType;
  field: string;
}> {
  const code = mode.trim().toUpperCase();
  const size: Array<{ type: WorkshopInputType; field: string }> = [
    { type: "aspect-ratio", field: "aspect_ratio" },
    { type: "megapixels", field: "megapixels" },
  ];
  const base: Array<{ type: WorkshopInputType; field: string }> = [
    { type: "prompt", field: "prompt" },
  ];
  switch (code) {
    case "T2I":
      return [...base, ...size];
    case "TI2I":
    case "R2I":
      return [...base, { type: "image", field: "image" }, ...size];
    case "I2I":
      return [{ type: "image", field: "image" }, ...base, ...size];
    case "E2I":
      return [...base, { type: "edge", field: "edge_image" }, ...size];
    case "D2I":
      return [...base, { type: "depth", field: "depth_image" }, ...size];
    case "P2I":
      return [...base, { type: "pose", field: "pose_image" }, ...size];
    case "S2I":
      return [...base, { type: "lineart", field: "lineart_image" }, ...size];
    case "M2I":
      return [...base, { type: "mask", field: "mask_image" }, ...size];
    case "INPAINT":
      return [...base, { type: "image", field: "image" }, { type: "mask", field: "mask" }];
    case "OUTPAINT":
      return [...base, { type: "image", field: "image" }, ...size];
    default:
      break;
  }
  if (isVideoMode(code)) {
    if (/^I2V$/.test(code)) {
      return [{ type: "image", field: "image" }, ...base];
    }
    if (/^(FLF2V|FL2V|FMF2V)$/.test(code)) {
      return [
        { type: "first-frame", field: "first_frame" },
        { type: "last-frame", field: "last_frame" },
        ...base,
      ];
    }
    if (/^TI2V$/.test(code)) {
      return [...base, { type: "image", field: "image" }];
    }
    return [...base, ...size];
  }
  return base;
}

/** 模式默认的端点路径（按输出类别）。 */
export function defaultEndpointPathForMode(mode: string): string {
  return isVideoMode(mode) ? "/videos/generations" : "/images/generations";
}

/** 模式的产物类别。 */
export function outputKindForMode(mode: string): "image" | "video" | "audio" {
  const def = getWorkflowType(mode);
  if (def?.category === "video") return "video";
  if (def?.category === "audio") return "audio";
  if (isVideoMode(mode)) return "video";
  return "image";
}

/** 该模式是否为「图生」类（输入里带控制图 / 参考图）。 */
export function modeUsesControlImage(mode: string): boolean {
  return defaultInputsForMode(mode).some((i) =>
    ["image", "first-frame", "mask", "depth", "pose", "lineart", "edge"].includes(
      i.type,
    ),
  );
}

/** 归一化适配器数组（丢弃非法项：无模式 / 无字段映射）。 */
export function parseRemoteModeAdapters(raw: unknown): RemoteModeAdapter[] {
  if (!Array.isArray(raw)) return [];
  const out: RemoteModeAdapter[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const mode = typeof rec.mode === "string" ? rec.mode.trim().toUpperCase() : "";
    if (!mode || seen.has(mode)) continue;
    const inputs: Array<{ type: WorkshopInputType; field: string }> = [];
    if (Array.isArray(rec.inputs)) {
      for (const row of rec.inputs) {
        if (typeof row !== "object" || row === null) continue;
        const r = row as Record<string, unknown>;
        if (!isWorkshopInputType(r.type)) continue;
        const field = typeof r.field === "string" ? r.field.trim() : "";
        if (!field) continue;
        if (inputs.some((i) => i.type === r.type)) continue;
        inputs.push({ type: r.type, field });
      }
    }
    if (inputs.length === 0) continue;
    seen.add(mode);
    const endpointPath =
      typeof rec.endpointPath === "string" && rec.endpointPath.trim() !== ""
        ? rec.endpointPath.trim()
        : defaultEndpointPathForMode(mode);
    const outputField =
      typeof rec.outputField === "string" ? rec.outputField.trim() : "";
    out.push({
      mode,
      endpointPath,
      inputs,
      outputField,
    });
  }
  return out;
}

/** 从响应 JSON 里按点路径取产物字段（支持 a.b.0.c）；取不到返回 null。 */
export function readFieldPath(payload: unknown, path: string): unknown {
  if (!path) return null;
  let cur: unknown = payload;
  for (const seg of path.split(".")) {
    if (cur === null || cur === undefined) return null;
    if (Array.isArray(cur)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0) return null;
      cur = cur[idx];
      continue;
    }
    if (typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/* ── 模式契约注册表：每种模式的统一输入 / 输出（可配置，工坊全局生效）──
 *
 * 上一版把「某种模式对外暴露什么」写死在代码里（exposedParamsForMode），
 * 用户没有地方调整。现在契约本身成为可配置实体：
 *   · 本地工作流按契约配「落点」（画布节点拖圆点 / 工坊封装视图呈现）——
 *     契约口 id 与落点编辑器同一套（prompt / negative / size / …）；
 *   · 远端模型按契约建适配器（统一输入 → 请求体字段；尺寸口在适配器层
 *     细分为宽高比 + 百万像素两个字段）。
 * 注册表只存**用户改过的模式**；未改过的模式回落内置默认
 * （exposedParamsForMode + outputKindForMode），保证升级零破坏。
 */

/** 模式契约的输入口类型（与画布落点编辑器的契约口同一套 id）。 */
export const MODE_CONTRACT_INPUT_TYPES = [
  { type: "prompt", label: "提示词" },
  { type: "negative", label: "负向提示词" },
  { type: "size", label: "尺寸（宽高比 + 百万像素）" },
  { type: "reference-image", label: "参考图 / 输入图" },
  { type: "first-frame", label: "首帧图片" },
  { type: "last-frame", label: "尾帧图片" },
] as const;

export type ModeContractInputType = (typeof MODE_CONTRACT_INPUT_TYPES)[number]["type"];

const MODE_CONTRACT_INPUT_SET = new Set<string>(
  MODE_CONTRACT_INPUT_TYPES.map((t) => t.type),
);

export function isModeContractInputType(v: unknown): v is ModeContractInputType {
  return typeof v === "string" && MODE_CONTRACT_INPUT_SET.has(v);
}

export function modeContractInputLabel(type: ModeContractInputType): string {
  return MODE_CONTRACT_INPUT_TYPES.find((t) => t.type === type)?.label ?? type;
}

/** 契约口 id 的完整值域：6 个基础口 +「参考图」第 2 张起带序号
 *  （`reference-image-2`，见 workflow-exposed-params 的多参考图槽位）。
 *
 *  与适配器侧的 WorkshopInputType 是**两套 id**，别混用：适配器口按接口请求体
 *  分得更细（契约的「尺寸」在适配器层拆成 aspect-ratio + megapixels），契约口是
 *  工坊对用户的统一口径（尺寸 / 参考图）。 */
export type ModeContractInputId = ModeContractInputType | `reference-image-${number}`;

export function isModeContractInputId(v: unknown): v is ModeContractInputId {
  if (typeof v !== "string") return false;
  if (isModeContractInputType(v)) return true;
  return /^reference-image-\d+$/.test(v);
}

/** 带序号的参考图口的序号（`reference-image-2` → 2；非带序号口返回 0）。 */
export function referenceImageSlotIndex(id: string): number {
  const m = /^reference-image-(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
}

/** 任意契约口 id 的展示名（带序号的参考图口显示为「参考图 2」，其余同基础口）。 */
export function modeContractInputIdLabel(id: ModeContractInputId): string {
  const slot = referenceImageSlotIndex(id);
  if (slot) return `${EXPOSED_PARAM_LABEL["reference-image"]} ${slot}`;
  return modeContractInputLabel(id as ModeContractInputType);
}

export type ModeContractOutput = "image" | "video" | "audio";

/** 一种模式的统一输入 / 输出契约（工坊对外口径）。 */
export interface ModeContract {
  /** 工作流库定义的模式码（T2I / I2I / D2I … T2V / I2V …）。 */
  mode: string;
  /** 统一输入口（有序；取值为 ModeContractInputId）。 */
  inputs: ModeContractInputId[];
  /** 统一输出类别。 */
  output: ModeContractOutput;
}

/** 内置默认契约（未在注册表里改过的模式用它）。 */
export function builtInModeContract(mode: string): ModeContract {
  return {
    mode: mode.trim().toUpperCase(),
    inputs: exposedParamsForMode(mode).map((d) => d.id as ModeContractInputId),
    output: outputKindForMode(mode),
  };
}

/** 校验并归一化一份注册表（去重、剔非法口、模式大写）。
 *
 *  口的合法性用 isModeContractInputId —— 与 modeContractsSave 的入参校验同源。
 *  历史教训：这里用 isModeContractInputType（基础 6 口）时，内置默认契约里带序号的
 *  参考图口会被**静默丢掉**，用户存完再读回来就少一口。 */
export function parseModeContracts(raw: unknown): ModeContract[] {
  if (!Array.isArray(raw)) return [];
  const out: ModeContract[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const mode = typeof rec.mode === "string" ? rec.mode.trim().toUpperCase() : "";
    if (!mode || seen.has(mode)) continue;
    const rawInputs = Array.isArray(rec.inputs) ? rec.inputs : [];
    const inputs = rawInputs.filter((i): i is ModeContractInputId =>
      isModeContractInputId(i),
    );
    if (inputs.length === 0) continue;
    const rawOutput = typeof rec.output === "string" ? rec.output : "";
    const output: ModeContractOutput =
      rawOutput === "video" || rawOutput === "audio"
        ? rawOutput
        : outputKindForMode(mode);
    seen.add(mode);
    out.push({ mode, inputs, output });
  }
  return out;
}

/** 契约 → 封装状态派生用的口子清单（id / 展示名 / 工坊控件形态）。 */
export function contractToStatusEntries(contract: ModeContract): Array<{
  id: string;
  label: string;
  control: "text" | "size" | "image";
}> {
  return contract.inputs.map((type) => ({
    id: type,
    // 带序号的参考图口展示为「参考图 2」（与 exposedParamsForMode 的命名一致）
    label: modeContractInputIdLabel(type),
    control:
      type === "size"
        ? ("size" as const)
        : type === "prompt" || type === "negative"
          ? ("text" as const)
          : ("image" as const),
  }));
}

/** 契约 → 远端适配器的默认输入映射（size 拆成宽高比 + 百万像素两个字段）。
 *
 *  第 2 张起的参考图口（reference-image-2…）没有约定的默认请求体字段名，这里不猜：
 *  不生成默认行，留给用户在适配器页自行加一行并把字段名填成该接口实际用的名字。 */
export function adapterInputsFromContract(
  contract: ModeContract,
): Array<{ type: WorkshopInputType; field: string }> {
  const out: Array<{ type: WorkshopInputType; field: string }> = [];
  for (const id of contract.inputs) {
    switch (id) {
      case "prompt":
        out.push({ type: "prompt", field: "prompt" });
        break;
      case "negative":
        out.push({ type: "negative", field: "negative_prompt" });
        break;
      case "size":
        out.push(
          { type: "aspect-ratio", field: "aspect_ratio" },
          { type: "megapixels", field: "megapixels" },
        );
        break;
      case "reference-image":
        out.push({ type: "image", field: "image" });
        break;
      case "first-frame":
        out.push({ type: "first-frame", field: "first_frame" });
        break;
      case "last-frame":
        out.push({ type: "last-frame", field: "last_frame" });
        break;
    }
  }
  return out;
}
