"use client";
/* 从 FlowNode（workflow-node.tsx）抽出的输入 / 输出行计算。
 * 从 1276 行的 FlowNode 组件里拆出来，让渲染器只编排布局，
 * 条目分桶逻辑归这个 hook 管。 */
import { useMemo } from "react";
import { inferOutputTypeAll } from "../workflow-utils";
import type { WorkflowNodeData, RawInputMeta } from "../workflow-types";

export interface FlowNodeEntries {
  /** raw_inputs（每节点元数据，带本地化标签），按 API `name` 索引。 */
  rawMeta: Record<string, RawInputMeta>;
  /** 组装好的输入行：先是 rawInputs（服务端配对的 widget 值），再是 data.inputs。 */
  allEntries: [string, unknown][];
  /** 纯类型端口行（rawInputs[i].widget 缺省）—— 在左边缘拿一个 Handle。 */
  connEntries: [string, unknown][];
  /** 背后是 widgets_values 槽位的行（rawInputs[i].widget 存在）。 */
  widgetEntries: [string, unknown][];
  /** connEntries 去掉同时也是 widget 的名字（去重）。 */
  uniqueConnEntries: [string, unknown][];
  uniqueWidgetEntries: [string, unknown][];
  /** 遗留的合并列表 —— 留给溢出句柄的兜底用。 */
  orderedEntries: [string, unknown][];
  /** 不设上限 —— 每个 widget 都渲染（DaSiWa 之类要显示完整参数表）。 */
  visibleWidgetEntries: [string, unknown][];
  /** LoadImage 合成的 `preview: true` 条目（内联缩略图 / 占位）。 */
  imagePreviewEntries: RawInputMeta[];
  /** 输出端口：静态 inferOutputTypeAll 表 → rawOutputs → 空。 */
  outputs: [string, string][];
}

/**
 * 把一个节点的输入分桶成连接行（顶部针脚）与 widget 行
 *（旋钮），外加输出与图片预览目标。行为与拆分前
 * workflow-node.tsx 里内联的 useMemo 完全一致。
 */
export function useFlowNodeEntries(data: WorkflowNodeData): FlowNodeEntries {
  const rawMeta: Record<string, RawInputMeta> = useMemo(() => {
    const out: Record<string, RawInputMeta> = {};
    for (const r of data.rawInputs ?? []) out[r.name] = r;
    return out;
  }, [data.rawInputs]);

  const allEntries: [string, unknown][] = useMemo(() => {
    if (data.rawInputs && data.rawInputs.length > 0) {
      return data.rawInputs.map((rawInput) => {
        // 服务端配对的 widget 值 —— **每个** widget 型输入都有，
        // 连不连线都在。无论连线与否都显示它。
        if (rawInput.widgetValue !== undefined) {
          return [rawInput.name, rawInput.widgetValue] as [string, unknown];
        }
        // 纯连接型输入没有 widget 值 —— 发一个数组，好让
        // conn/widget 分流器把它们当成带 Handle 的连线行。
        return [rawInput.name, rawInput.isConnection ? [] : ""] as [
          string,
          unknown,
        ];
      });
    }
    const fromGraph = Object.entries(data.inputs ?? {});
    if (fromGraph.length > 0) return fromGraph;
    return [];
  }, [data.inputs, data.rawInputs]);

  // 用 ComfyUI 自己的输入定义（有没有 widget 标记）分成两桶。
  // 跳过合成的 `preview` 条目 —— 它们是只在卡片体里的缩略图
  // 槽位，从来不是输入端口。
  const connEntries = allEntries.filter(([k]) => {
    const m = rawMeta[k];
    return m && m.widget === undefined && !m.preview;
  });
  const widgetEntries = allEntries.filter(([k]) => {
    const m = rawMeta[k];
    return m?.widget !== undefined && !m.preview;
  });
  // 布局**之前**按 `name` 跨两桶去重 —— 把类型端口与内联 widget
  // 合在一起的自定义节点（Z-Image-Base）会让同一个名字出现两次；
  // 保留 widget 行（writes_values 是活的）。
  const widgetNameSet = new Set(widgetEntries.map(([k]) => k));
  const uniqueConnEntries = connEntries.filter(([k]) => !widgetNameSet.has(k));
  const uniqueWidgetEntries = widgetEntries;
  const orderedEntries = [...uniqueConnEntries, ...uniqueWidgetEntries];
  const visibleWidgetEntries = uniqueWidgetEntries;

  // IMAGE 型输入的内联缩略图预览（收窄后）：只有
  // LoadImage 合成的 `preview: true` 条目符合。
  const imagePreviewEntries = useMemo(
    () => (data.rawInputs ?? []).filter((raw) => raw.preview === true),
    [data.rawInputs],
  );

  // 输出端口：静态表 → raw outputs[]（只有这里能让 ResolutionSelector.width/height
  // 这类自定义节点输出存活下来）→ 空列表。
  const outputs: [string, string][] = useMemo(() => {
    const staticOuts = Object.entries(inferOutputTypeAll(data.classType));
    if (staticOuts.length > 0) return staticOuts;
    if (data.rawOutputs && data.rawOutputs.length > 0) {
      return data.rawOutputs.map(
        (rawOutput) => [rawOutput.name, rawOutput.type] as [string, string],
      );
    }
    return [];
  }, [data.classType, data.rawOutputs]);

  return {
    rawMeta,
    allEntries,
    connEntries,
    widgetEntries,
    uniqueConnEntries,
    uniqueWidgetEntries,
    orderedEntries,
    visibleWidgetEntries,
    imagePreviewEntries,
    outputs,
  };
}
