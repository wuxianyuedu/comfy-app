"use client";

import { useMemo } from "react";
import type {
  ComfyGraphNode,
  RawOutputMeta,
  WorkflowDetail,
} from "../workflow-types";
import { inferSourceOutNames } from "../workflow-utils";

/** 原始 ComfyUI 节点元数据 —— `widgets_values` 元素与 flags /
 *  properties 字典都是不透明的 raw-JSON 负载，保持 `unknown`（此前
 *  是 `any`；消费方本来就当它们不透明处理）。 */
export type RawNodeMeta = {
  widgets_values: unknown[];
  outputs: RawOutputMeta[];
  flags: Record<string, unknown>;
  properties: Record<string, unknown>;
  mode: number;
};

export interface WorkflowDerivedData {
  rawMetaById: Record<string, RawNodeMeta>;
  scopeDetail: WorkflowDetail | null;
  outSlotNameById: Record<string, string[]>;
}

/**
 * 工作流编辑器画布的派生查表：
 *  - rawMetaById：原始节点元数据表（widgets / outputs / flags …）
 *  - scopeDetail：视图作用域的 detail（RAW 视图把 node/graph/position
 *    的来源换成 `detail.rawView`，包装层数据保持不变）
 *  - outSlotNameById：按节点的输出槽名推导
 */
export function useWorkflowDerivedData(
  detail: WorkflowDetail | null,
): WorkflowDerivedData {
  const rawMetaById: Record<string, RawNodeMeta> = useMemo(() => {
    const m: Record<string, RawNodeMeta> = {};
    for (const rn of detail?.rawNodes ?? []) {
      if (rn?.id) {
        m[rn.id] = {
          widgets_values: Array.isArray(rn.widgets_values)
            ? rn.widgets_values
            : [],
          outputs: Array.isArray(rn.outputs) ? rn.outputs : [],
          flags: rn.flags && typeof rn.flags === "object" ? rn.flags : {},
          properties:
            rn.properties && typeof rn.properties === "object"
              ? rn.properties
              : {},
          mode: typeof rn.mode === "number" ? rn.mode : 0,
        };
      }
    }
    return m;
  }, [detail]);

  /* 视图作用域 detail。RAW 视图下把节点/图/位置源切换为
   *  `detail.rawView`（rawJson 派生、wrapper 保留），让画布渲染 ComfyUI 原始
   *  布局，而非可能被拆平的 API 图。groups/notes/IO/边界 pin 等两种视图一致，
   *  通过展开保留。RAW 视图下已在 `detail.positions` 镜像的 raw-id 拖拽覆盖
   *  会叠加在最上层，使 RAW 视图的手动拖拽无需重新拉取即生效。 */
  const scopeDetail: WorkflowDetail | null = useMemo(() => {
    if (!detail) return null;
    if (detail.rawView) {
      const rawIds = new Set(detail.rawView.nodes.map((node) => node.id));
      const overrides: Record<string, [number, number]> = {};
      const dp = detail.positions ?? {};
      for (const k of Object.keys(dp)) {
        if (rawIds.has(k)) overrides[k] = dp[k]!;
      }
      return {
        ...detail,
        nodes: detail.rawView.nodes,
        graph: detail.rawView.graph,
        positions: { ...(detail.rawView.positions ?? {}), ...overrides },
      };
    }
    return detail;
  }, [detail]);

  const outSlotNameById: Record<string, string[]> = useMemo(() => {
    if (!scopeDetail) return {};
    const nodesById: Record<string, ComfyGraphNode> = {};
    for (const n of scopeDetail.nodes) nodesById[n.id] = n;
    return inferSourceOutNames(scopeDetail, nodesById, rawMetaById);
  }, [scopeDetail, rawMetaById]);

  return { rawMetaById, scopeDetail, outSlotNameById };
}
