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
  | "last-frame"
  /** 视频：时长（秒）。落在工作流的 duration / length / frames 类端口上。 */
  | "duration";

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

/** 统一对外参数的**基础名**。
 *
 *  ⚠️ 这一份只给「id → 基础名」的映射用，**不是任何界面的展示名** —— 界面一律
 *  经 `exposedParamDisplayLabel` 取（见下方）。两处直接读它会话术再次漂移：
 *  「尺寸」在工坊里是一个「比例 + 分辨率 / (百万像素 + 倍数)」的组合控件，
 *  只写「尺寸」用户答不出这个控件到底要填什么。 */
export const EXPOSED_PARAM_LABEL: Record<ExposedParamClass, string> = {
  prompt: "提示词",
  negative: "负面提示词",
  size: "尺寸",
  "reference-image": "参考图",
  "first-frame": "首帧",
  "last-frame": "尾帧",
  duration: "时长",
};

/** 各口的**界面展示名** —— 整个仓库的**唯一出处**。
 *
 *  同一张契约清单会出现在三处（工坊封装的对外口一览、工作流库「画布节点」的
 *  卡片列、模式契约编辑器），三处各写一份字符串必然漂移：ISSUE #596 现场就是
 *  「尺寸」在工坊封装页写成 `尺寸（比例 + 分辨率 / (百万像素 + 倍数)）`、在同一
 *  页面的画布节点卡片上只写 `尺寸`，用户读到的像是两个不同的口。
 *
 *  另外「负向提示词」（契约编辑器）与「负面提示词」（契约表）本来就是同一个口
 *  的两种叫法，在这里统一为一套措辞。
 *
 *  措辞与具体形态无关的一律不带括号：括号是给「同一类的多种写法」用的，
 *  只有 `size` 与 `duration` 各有两类等价表达，需要在这里说清。 */
export const EXPOSED_PARAM_DISPLAY_LABEL: Record<ExposedParamClass, string> = {
  prompt: "提示词",
  negative: "负向提示词",
  size: "尺寸（比例 + 分辨率 / (百万像素 + 倍数)）",
  "reference-image": "参考图",
  "first-frame": "首帧图片",
  "last-frame": "尾帧图片",
  duration: "时长（秒）",
};

/** 内置默认给几张参考图槽 —— 只是默认值，契约编辑器里可以继续加，不设上限。 */
const REFERENCE_IMAGE_DEFAULT_COUNT = 2;

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
    { cls: "prompt", id: "prompt", label: EXPOSED_PARAM_DISPLAY_LABEL.prompt },
    {
      cls: "negative",
      id: "negative",
      label: EXPOSED_PARAM_DISPLAY_LABEL.negative,
      optional: true,
    },
  ];

  if (isVideoMode(code)) {
    if (modeUsesFirstFrame(code)) {
      out.push({
        cls: "first-frame",
        id: "first-frame",
        label: EXPOSED_PARAM_DISPLAY_LABEL["first-frame"],
      });
    }
    if (modeUsesLastFrame(code)) {
      out.push({
        cls: "last-frame",
        id: "last-frame",
        label: EXPOSED_PARAM_DISPLAY_LABEL["last-frame"],
      });
    }
    out.push({ cls: "size", id: "size", label: EXPOSED_PARAM_DISPLAY_LABEL.size });
    /* 视频还有时长口（秒）。落点由契约映射决定（duration / length / frames 类
     * 端口都算），值由调用方按该端口的单位折算后落下去。 */
    out.push({
      cls: "duration",
      id: "duration",
      label: EXPOSED_PARAM_DISPLAY_LABEL.duration,
    });
    return out;
  }

  if (isImageEditMode(code)) {
    for (
      let i = 0;
      i < (allowsReferenceImages(code) ? REFERENCE_IMAGE_DEFAULT_COUNT : 1);
      i += 1
    ) {
      out.push({
        cls: "reference-image",
        id: i === 0 ? "reference-image" : `reference-image-${i + 1}`,
        label: exposedParamDisplayLabel(
          i === 0 ? "reference-image" : `reference-image-${i + 1}`,
        ),
      });
    }
  }
  out.push({ cls: "size", id: "size", label: EXPOSED_PARAM_DISPLAY_LABEL.size });
  return out;
}

/** 任意契约口 id 的**界面展示名**（带序号的参考图口显示为「参考图 2」）。
 *
 *  未知 id（历史落库键 / 自定义口）原样返回 —— 界面读不出名字时宁可显示键本身，
 *  也不凭空编一个名字。 */
export function exposedParamDisplayLabel(id: string): string {
  const cls = exposedClassOf(id);
  if (!cls) return id;
  const slot = referenceImageSlotIndex(id);
  if (slot > 1) return `${EXPOSED_PARAM_DISPLAY_LABEL["reference-image"]} ${slot}`;
  return EXPOSED_PARAM_DISPLAY_LABEL[cls];
}

/** 带序号的参考图口的序号（`reference-image-2` → 2；其余口返回 0）。
 *  第一张不带序号，故「序号 > 1」才是「参考图 2」这种带序号的槽位。 */
export function referenceImageSlotIndex(id: string): number {
  const m = /^reference-image-(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
}

/** 契约里给定 id 的基础名（未知 id 原样返回，兼容历史落库键）。
 *
 *  **界面不要用它**：请走 `exposedParamDisplayLabel`。 */
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
