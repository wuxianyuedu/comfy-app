// 工作流库里「对外参数 ↔ 节点参数」映射的标签与判定（纯配置 + 纯函数）。
//
// 映射本身的模型（聚类 / 自动映射 / 校验 / 序列化）与状态编排在
// `~/lib/workflow-param-mapping` 与 `~/components/studio/workflow-editor/hooks/use-param-mapping`；
// 本文件只负责把 `ParamEntry.cls` 翻译成面向作者的中文名与配色，并给出
// 「节点端口 → 对外参数卡片」的对应关系 —— 详情面板「画布节点」页签要靠它
// 把表单里的每个参数行挂到对应的映射卡片上。
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

/** 目标端口（ioKey）→ 它所属的对外参数条目 id。
 *
 *  同一个对外参数（= 一个节点上的一类输入）可能含多个端口（宽 + 高、首帧 + 尾帧），
 *  这几行共享同一张映射卡片，所以反查表按端口逐条登记、值都是同一个条目 id。
 *  `resolved` 是解析后的「条目 id → 目标 ioKey」表（自动映射叠加手工线）。 */
export function buildPortOwners(
  entries: readonly { id: string; pins: { ioKey: string }[] }[],
  resolved: Record<string, string | null>
): Record<string, string> {
  const owners: Record<string, string> = {};
  for (const entry of entries) {
    const target = resolved[entry.id];
    if (!target) continue;
    for (const pin of entry.pins) {
      if (pin.ioKey === target) owners[pin.ioKey] = entry.id;
    }
  }
  return owners;
}
