// ── 远端模型「工坊模式适配器」：统一输入类型 + 模式契约（纯函数层）──────
// 工坊对外只说「统一输入」：提示词 / 负向提示词 / 宽高比 / 百万像素 / 图片 /
// 首帧 / 尾帧 / 掩码 / 深度图 / 姿态骨架 / 线稿 / 边缘图 / 种子 —— 模式对应
// 工作流库中定义的模式（T2I / I2I / D2I … T2V / I2V …）。每种远端模型按模式
// 配置一份适配器（统一输入 → 该接口的请求体字段名 + 产物字段路径），工坊
// 发起生成时据此把统一输入翻译成该接口的请求；未配置适配器时回落到
// OpenAI 兼容 images/generations 的默认映射。
//
// 输出类型由模式的类别决定（图像 → 图片，视频 → 视频，音频 → 音频）。

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
