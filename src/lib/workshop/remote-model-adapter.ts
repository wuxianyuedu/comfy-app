// ── 远端模型的「工坊模式适配器」：统一输入词表 + 存档形状（纯函数层）────
// 工坊对外只说「统一输入」（提示词 / 负向提示词 / 宽高比 / 百万像素 / 分辨率 /
// 倍数 / 图片 / 首帧 / 尾帧 / 掩码 / 深度图 / 姿态骨架 / 线稿 / 边缘图 / 种子），
// 每种远端模型按模式配置一份适配器（统一输入 → 该接口的请求体字段名 + 产物
// 字段路径），工坊发起生成时据此把统一输入翻译成该接口的请求。
//
// 「尺寸」这一类在契约层是一个口（`size`），在适配器层按接口请求体细分：比例
// （aspect-ratio）+ 总像素（megapixels）+ 分辨率档（resolution）+ 宽高对齐倍数
// （multiple）—— 与工坊尺寸选择器的两类表达（「比例 + 分辨率」/「比例 + 百万
// 像素 + 倍数」）对齐，选「分辨率」时档位名随 `resolution` 下发、换算值随
// `megapixels` 下发（`lib/size-presets` 是换算的唯一出处）。
//
// 端点是模型本身的配置（ISSUE #3622）：同一模型的几个模式用的端点路径相同，
// 所以它不按模式各配一份 —— 存档升成「模型级 envelope」（端点路径 + 各模式
// 适配器），端点留空时请求侧按产物类别推导。
//
// 本模块与 `model-mode-contract.ts` 同属一个子域：那边是「模式的统一契约」（工坊
// 对用户的口径），这边是「远端适配器」（按接口请求体细分）；桥接（契约口 →
// 适配器默认行）在 `model-mode-contract.ts` 的 `adapterInputsFromContract`。

import { isRecord } from "~/lib/is-record";
import { upperToken } from "~/lib/upper-token";
import { isVideoMode } from "~/lib/workflow/workflow-exposed-params";
import { getWorkflowType } from "~/lib/workflow/workflow-types";

/** 可作为输入的统一类型（供适配器配置选用）。
 *
 *  「尺寸」在契约层是一个口（`size`），到这里按接口请求体细分为四行：
 *  宽高比 / 百万像素 / 分辨率 / 倍数 —— 与尺寸选择器的两类表达同一口径
 *  （工坊选「分辨率」表达时 `resolution` 带档位名 "1k"/"2k"/"4k"，
 *  `megapixels` 仍带换算后的总像素；适配器映射了哪个就下发哪个）。 */
/* SAFETY: 类型断言已复核 */
export const WORKSHOP_INPUT_TYPES = [
  { type: "prompt", label: "提示词" },
  { type: "negative", label: "负向提示词" },
  { type: "aspect-ratio", label: "宽高比" },
  { type: "megapixels", label: "百万像素" },
  { type: "resolution", label: "分辨率" },
  { type: "multiple", label: "倍数（宽高对齐）" },
  { type: "image", label: "图片" },
  { type: "first-frame", label: "首帧图片" },
  { type: "last-frame", label: "尾帧图片" },
  /** 视频：时长。远端按 field 映射成该接口的字段名（duration / seconds…）。 */
  { type: "duration", label: "时长" },
  { type: "mask", label: "掩码图" },
  { type: "depth", label: "深度图" },
  { type: "pose", label: "姿态骨架图" },
  { type: "lineart", label: "线稿图" },
  { type: "edge", label: "边缘图" },
  { type: "seed", label: "种子" },
  { type: "lora-model", label: "角色 LoRA" },
  { type: "lora-weight", label: "LoRA 强度" },
] as const;

export type WorkshopInputType = (typeof WORKSHOP_INPUT_TYPES)[number]["type"];

const INPUT_TYPE_SET = new Set<string>(WORKSHOP_INPUT_TYPES.map((t) => t.type));

export function isWorkshopInputType(v: unknown): v is WorkshopInputType {
  return typeof v === "string" && INPUT_TYPE_SET.has(v);
}

export function workshopInputLabel(type: WorkshopInputType): string {
  return WORKSHOP_INPUT_TYPES.find((t) => t.type === type)?.label ?? type;
}

/** 一种远端模式在工坊下的适配器。 */
export type RemoteModeAdapter = {
  /** 固定值字段（#3590）：每次请求都原样带上的请求体键值（如 Agnes 视频接口
   *  必填的 mode:"text" / size:"720P"）。它们不是用户输入，适配器层给不出
   *  「统一输入」的表达（各输入类型都是每次请求的值），所以单列一栏。
   *  合并顺序：先常量、后输入映射 —— 同名字段让输入映射赢（用户当次给值
   *  比写死的更具体）。缺省 / 空数组 = 没有常量。 */
  constants?: Array<{ field: string; value: string }>;
  /** 统一输入 → 请求体字段名。同一类型只能出现一次。 */
  inputs: Array<{ field: string; type: WorkshopInputType }>;
  /** 工作流库定义的模式码（T2I / I2I / D2I … T2V / I2V …）。 */
  mode: string;
  /** 产物字段路径（响应 JSON 内，支持 a.b.0.c）；空 = 走通用提取。 */
  outputField: string;
};

/** 一个远端模型的工坊适配器**存档**（模型级，ISSUE #3622）。
 *
 *  端点是模型本身的配置、与模式无关 —— 同一模型的几个模式用的是同一条端点
 *  路径，所以它从「每个模式各配一份」升成模型级一格；`adapters` 里的适配器
 *  只剩字段映射与产物提取。落库的 JSON 列有两种历史形状，读取时统一归一：
 *  旧版是裸适配器数组（端点按类别推导），新版是本 envelope。 */
export type RemoteModelAdaptersDoc = {
  /** 各模式的适配器（字段映射 + 产物提取）。 */
  adapters: Array<RemoteModeAdapter>;
  /** 模型级端点路径（拼在条目 baseUrl 后，如 /v1/images/generations）。
   *  空 = 未配置，请求侧按产物类别推导（图片 → images/generations 惯例、
   *  视频 → videos 惯例）。 */
  endpointPath: string;
};

/** 该模式默认的输入清单（适配器新建时预填；field 暂用类型名本身）。 */
export function defaultInputsForMode(mode: string): Array<{
  field: string;
  type: WorkshopInputType;
}> {
  const code = upperToken(mode);
  /* 「尺寸」的默认三行：比例 + 百万像素 + 倍数（与契约层的 size 口同一口径）。 */
  const size: Array<{ field: string; type: WorkshopInputType }> = [
    { type: "aspect-ratio", field: "aspect_ratio" },
    { type: "megapixels", field: "megapixels" },
    { type: "multiple", field: "multiple" },
  ];
  /** 视频口：时长（秒）。 */
  const durationRow: { field: string; type: WorkshopInputType } = {
    type: "duration",
    field: "duration",
  };
  const base: Array<{ field: string; type: WorkshopInputType }> = [
    { type: "prompt", field: "prompt" },
  ];
  switch (code) {
    case "T2I": {
      return [...base, ...size];
    }
    case "TI2I":
    case "R2I": {
      return [...base, { type: "image", field: "image" }, ...size];
    }
    case "I2I": {
      return [{ type: "image", field: "image" }, ...base, ...size];
    }
    case "E2I": {
      return [...base, { type: "edge", field: "edge_image" }, ...size];
    }
    case "D2I": {
      return [...base, { type: "depth", field: "depth_image" }, ...size];
    }
    case "P2I": {
      return [...base, { type: "pose", field: "pose_image" }, ...size];
    }
    case "S2I": {
      return [...base, { type: "lineart", field: "lineart_image" }, ...size];
    }
    case "M2I": {
      return [...base, { type: "mask", field: "mask_image" }, ...size];
    }
    case "INPAINT": {
      return [...base, { type: "image", field: "image" }, { type: "mask", field: "mask" }];
    }
    case "OUTPAINT": {
      return [...base, { type: "image", field: "image" }, ...size];
    }
    default: {
      break;
    }
  }
  if (isVideoMode(code)) {
    if (/^I2V$/.test(code)) {
      return [{ type: "image", field: "image" }, ...base, durationRow];
    }
    if (/^(?:FLF2V|FMF2V)$/.test(code)) {
      return [
        { type: "first-frame", field: "first_frame" },
        { type: "last-frame", field: "last_frame" },
        ...base,
        durationRow,
      ];
    }
    if (/^TI2V$/.test(code)) {
      return [...base, { type: "image", field: "image" }, durationRow];
    }
    return [...base, ...size, durationRow];
  }
  return base;
}

/** 模式默认的端点路径（按输出类别）。
 *
 *  请求侧在「模型级端点路径未配置」时的推导依据（ISSUE #3622 起 per-mode
 *  配置已移除，端点一律模型级）。 */
export function defaultEndpointPathForKind(kind: "image" | "video" | "audio"): string {
  return kind === "video" ? "/videos/generations" : "/images/generations";
}

/** 模式的产物类别。 */
export function outputKindForMode(mode: string): "image" | "video" | "audio" {
  const def = getWorkflowType(mode);
  if (def?.category === "video") {
    return "video";
  }
  if (def?.category === "audio") {
    return "audio";
  }
  if (isVideoMode(mode)) {
    return "video";
  }
  return "image";
}

/** 归一化适配器数组（丢弃非法项：无模式 / 无字段映射）。 */
export function parseRemoteModeAdapters(raw: unknown): Array<RemoteModeAdapter> {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: Array<RemoteModeAdapter> = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item)) {
      continue;
    }
    const rec = item;
    const mode = upperToken(rec.mode);
    if (!mode || seen.has(mode)) {
      continue;
    }
    const inputs: Array<{ field: string; type: WorkshopInputType }> = [];
    if (Array.isArray(rec.inputs)) {
      for (const row of rec.inputs) {
        if (!isRecord(row)) {
          continue;
        }
        const r = row;
        if (!isWorkshopInputType(r.type)) {
          continue;
        }
        const field = typeof r.field === "string" ? r.field.trim() : "";
        if (!field) {
          continue;
        }
        if (inputs.some((i) => i.type === r.type)) {
          continue;
        }
        inputs.push({ type: r.type, field });
      }
    }
    if (inputs.length === 0) {
      continue;
    }
    seen.add(mode);
    const outputField = typeof rec.outputField === "string" ? rec.outputField.trim() : "";
    /* 固定值字段：field 非空才算一行；同名字段保留**先到的那条**（与 inputs
     * 的「同一类型只留一行」同精神）；value 原样保留（空串也合法 —— 有些
     * 接口就是要显式的空值）。坏行丢弃不报错（库里一行写坏不该让整条消失）。 */
    const constants: Array<{ field: string; value: string }> = [];
    if (Array.isArray(rec.constants)) {
      for (const row of rec.constants) {
        if (!isRecord(row)) {
          continue;
        }
        const r = row;
        const field = typeof r.field === "string" ? r.field.trim() : "";
        if (!field || constants.some((c) => c.field === field)) {
          continue;
        }
        const raw = r.value;
        /* value 只收字符串 / 数字 / 布尔（JSON 里的标量）；对象 / 数组不是
         * 「固定值」该有的形状，整行丢弃而不是 String() 出 [object Object]。 */
        if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") {
          continue;
        }
        constants.push({ field, value: String(raw) });
      }
    }
    out.push({
      mode,
      inputs,
      outputField,
      ...(constants.length > 0 ? { constants } : {}),
    });
  }
  return out;
}

/** 归一化一个模型的适配器**存档**（envelope；兼容旧版裸数组，ISSUE #3622）。
 *
 *  旧版 JSON 列直接存适配器数组（端点按模式各配一份，读取时丢弃那份
 *  per-mode 值，端点回落请求侧按类别推导）；新版存 `RemoteModelAdaptersDoc`。
 *  坏数据（非数组也非对象）按「没配置」处理。 */
export function parseRemoteModelAdaptersDoc(raw: unknown): RemoteModelAdaptersDoc {
  if (Array.isArray(raw)) {
    return { endpointPath: "", adapters: parseRemoteModeAdapters(raw) };
  }
  if (!isRecord(raw)) {
    return { endpointPath: "", adapters: [] };
  }
  /* 路径强制根相对（与 sanitizeChannel 的 path 同一纪律）：拼接
   * `${baseUrl}${path}` 才能保持格式正确；空串 = 未配置（请求侧推导）。 */
  const rawPath = typeof raw.endpointPath === "string" ? raw.endpointPath.trim() : "";
  const endpointPath = rawPath === "" || rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  return {
    endpointPath,
    adapters: parseRemoteModeAdapters(raw.adapters),
  };
}

/** 从响应 JSON 里按点路径取产物字段（支持 a.b.0.c）；取不到返回 null。 */
export function readFieldPath(payload: unknown, path: string): unknown {
  if (!path) {
    return null;
  }
  let cur: unknown = payload;
  for (const seg of path.split(".")) {
    if (cur === null || cur === undefined) {
      return null;
    }
    if (Array.isArray(cur)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0) {
        return null;
      }
      cur = cur[idx];
      continue;
    }
    if (!isRecord(cur)) {
      return null;
    }
    cur = cur[seg];
  }
  return cur;
}
