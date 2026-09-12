/* ── 统一对外参数契约（按模式，与具体工作流无关）──
 *
 * 「对外参数」是产品对用户承诺的那几个口子（提示词、尺寸、首帧…），不是某个
 * 工作流碰巧暴露了哪些 widget。此前对外参数是按工作流富化出来的 pin 聚类生成的
 * ——同一个「提示词」在不同工作流里叫 `text` / `positive_prompt` / `value_1`，
 * 卡片列表于是变成工作流内部参数名的大杂烩（`value` / `value_2` /
 * `resolution_preset`…），用户读到的是一份「与这个工作流绑定」的清单，而不是
 * 「这一类模式统一能给什么」。
 *
 * 本模块给出**唯一的契约表**：给定模式码，返回该模式对外暴露的参数集合（顺序即
 * 展示顺序）。工作流只决定「每个统一参数落到哪一行端口」（见
 * `workflow-param-mapping` 的映射模型），不决定「对外有哪些参数」。
 *
 * 无 React、无 IO（规范 §17.2 第①层），可直接单测。
 */

import {
  isVideoMode,
  modeUsesFirstFrame,
  modeUsesLastFrame,
} from "~/lib/workshop/workflow-encapsulation";

/** 统一对外参数的种类（`ParamClass` 的对外子集）。
 *
 *  `size-*` 四类聚合为一个「尺寸」参数：宽度 / 高度 / 宽高比 / 像素量是同一个
 *  语义（画面尺寸）的四种落点形态，工作流用哪种由它自己决定，对外只报「尺寸」。 */
export type ExposedParamClass =
  | "prompt"
  | "negative"
  | "size"
  | "reference-image"
  | "first-frame"
  | "last-frame";

export interface ExposedParamDef {
  cls: ExposedParamClass;
  /** 契约内的稳定 id，直接作为映射表的键（`source.mode:<模式>` 的值域）。
   *  多张参考图时第二张起带序号（`reference-image-2`），仍是同一类。 */
  id: string;
  /** 对外展示名（与具体工作流无关）。 */
  label: string;
  /** 可选参数：只有工作流确实有对应端口时才出现，避免给每个工作流都摆一张死卡片。 */
  optional?: boolean;
}

/** 统一对外参数的展示名。 */
export const EXPOSED_PARAM_LABEL: Record<ExposedParamClass, string> = {
  prompt: "提示词",
  negative: "负面提示词",
  size: "尺寸",
  "reference-image": "参考图",
  "first-frame": "首帧",
  "last-frame": "尾帧",
};

/** 「参考图」按出现顺序在契约里的位置（多张参考图槽位）。 */
const REFERENCE_IMAGE_MAX = 2;

/** 一个模式是否属于「图生图类」——需要一张参考图输入。
 *
 *  这些模式的输入本身就是一张图，对外就必须暴露「参考图」；纯文生图（T2I）
 *  没有这个口子。 */
function isImageEditMode(code: string | null | undefined): boolean {
  if (typeof code !== "string") return false;
  return /^(i2i|inpaint|outpaint|upscale|e2i|d2i|p2i|r2i|c2i)$/i.test(
    code.trim(),
  );
}

/** 一个模式是否支持多张参考图（图生图类通常多图）。 */
function allowsReferenceImages(code: string | null | undefined): boolean {
  return isImageEditMode(code) || modeUsesFirstFrame(code);
}

/** 给定模式码，返回该模式统一对外暴露的参数（顺序即展示顺序）。
 *
 *  模式为空（工作流没声明模式）时退到最保守的一套（提示词 + 尺寸），
 *  与工作流无关 —— 「对外参数只跟模式有关」，没有模式就只说最通用的两样。 */
export function exposedParamsForMode(
  code: string | null | undefined,
): ExposedParamDef[] {
  const out: ExposedParamDef[] = [
    { cls: "prompt", id: "prompt", label: EXPOSED_PARAM_LABEL.prompt },
    {
      cls: "negative",
      id: "negative",
      label: EXPOSED_PARAM_LABEL.negative,
      optional: true,
    },
  ];

  if (isVideoMode(code)) {
    if (modeUsesFirstFrame(code)) {
      out.push({
        cls: "first-frame",
        id: "first-frame",
        label: EXPOSED_PARAM_LABEL["first-frame"],
      });
    }
    if (modeUsesLastFrame(code)) {
      out.push({
        cls: "last-frame",
        id: "last-frame",
        label: EXPOSED_PARAM_LABEL["last-frame"],
      });
    }
    out.push({ cls: "size", id: "size", label: EXPOSED_PARAM_LABEL.size });
    return out;
  }

  if (isImageEditMode(code)) {
    for (
      let i = 0;
      i < (allowsReferenceImages(code) ? REFERENCE_IMAGE_MAX : 1);
      i += 1
    ) {
      out.push({
        cls: "reference-image",
        id: i === 0 ? "reference-image" : `reference-image-${i + 1}`,
        label:
          i === 0 ? EXPOSED_PARAM_LABEL["reference-image"] : `参考图 ${i + 1}`,
      });
    }
  }
  out.push({ cls: "size", id: "size", label: EXPOSED_PARAM_LABEL.size });
  return out;
}

/** 契约里给定 id 的展示名（未知 id 原样返回，兼容历史落库键）。 */
export function exposedParamLabel(id: string): string {
  const cls = id as ExposedParamClass;
  return EXPOSED_PARAM_LABEL[cls] ?? id;
}

/** 某个统一参数 id 属于哪一类（`reference-image-2` 这类带序号的口归到同一类）。 */
export function exposedClassOf(id: string): ExposedParamClass | null {
  if (id in EXPOSED_PARAM_LABEL) return id as ExposedParamClass;
  if (/^reference-image-\d+$/.test(id)) return "reference-image";
  return null;
}
