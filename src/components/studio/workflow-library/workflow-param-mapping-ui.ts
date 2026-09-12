// 对外参数映射在视图层的标签与配色（纯配置 + 纯函数）。
//
// 映射本身的模型（聚类 / 默认落点 / 校验 / 序列化）在
// `~/lib/workflow-param-mapping`；本文件只负责把 `ParamEntry.cls` 翻译成面向
// 作者的中文名与配色，供工作流库画布上的「对外参数卡片」复用。
//
// 无 React、无副作用（规范 §17.2 第①层）。

import type { ParamClass } from "~/lib/workflow-param-mapping";

/** 分类 → 展示名。与参数映射模型里的默认名同口径。 */
export const PARAM_CLASS_LABEL: Record<ParamClass, string> = {
  prompt: "提示词",
  negative: "负面提示词",
  "size-width": "宽度",
  "size-height": "高度",
  "size-aspect": "宽高比",
  "size-megapixels": "像素量",
  "reference-image": "参考图",
  "first-frame": "首帧",
  "last-frame": "尾帧",
  other: "参数",
};

/** 分类 → 强调色。 */
export const PARAM_CLASS_COLOR: Record<ParamClass, string> = {
  prompt: "#a78bfa",
  negative: "#f87171",
  "size-width": "#38bdf8",
  "size-height": "#38bdf8",
  "size-aspect": "#38bdf8",
  "size-megapixels": "#38bdf8",
  "reference-image": "#22d3ee",
  "first-frame": "#34d399",
  "last-frame": "#fbbf24",
  other: "#94a3b8",
};

export interface ParamClassStyle {
  label: string;
  color: string;
}

/** 取分类的展示名与配色（未知分类回落到「参数」）。 */
export function paramClassStyle(cls: string): ParamClassStyle {
  const key = cls as ParamClass;
  return {
    label: PARAM_CLASS_LABEL[key] ?? PARAM_CLASS_LABEL.other,
    color: PARAM_CLASS_COLOR[key] ?? PARAM_CLASS_COLOR.other,
  };
}
