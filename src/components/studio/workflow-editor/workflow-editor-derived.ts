"use client";

import { useMemo } from "react";
import type { ComfyGraphNode, RawOutputMeta, WorkflowDetail } from "../workflow-types";
import { inferSourceOutNames } from "../workflow-utils";

/** Raw ComfyUI node metadata — `widgets_values` elements and the flags /
 *  properties dicts are opaque raw-JSON payloads, kept `unknown` (they were
 *  `any` before; consumers already treat them opaquely). */
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
 * Derived lookups for the workflow editor canvas:
 *  - rawMetaById: raw-node metadata map (widgets / outputs / flags ...)
 *  - scopeDetail: view-scoped detail (RAW view swaps node/graph/position
 *    sources to `detail.rawView`, keeping wrapper-level data intact)
 *  - outSlotNameById: per-node output-slot name inference
 * Extracted from wf-editor-inner.tsx (P4 split).
 */
export function useWorkflowDerivedData(
  detail: WorkflowDetail | null,
): WorkflowDerivedData {
  const rawMetaById: Record<string, RawNodeMeta> = useMemo(() => {
    const m: Record<string, RawNodeMeta> = {};
    for (const rn of detail?.rawNodes ?? []) {
      if (rn?.id) {
        m[rn.id] = {
          widgets_values: Array.isArray(rn.widgets_values) ? rn.widgets_values : [],
          outputs: Array.isArray(rn.outputs) ? rn.outputs : [],
          flags: rn.flags && typeof rn.flags === "object" ? rn.flags : {},
          properties:
            rn.properties && typeof rn.properties === "object" ? rn.properties : {},
          mode: typeof rn.mode === "number" ? rn.mode : 0,
        };
      }
    }
    return m;
  }, [detail]);

  /* 2026-08-13 R82: 视图作用域 detail。RAW 视图下把节点/图/位置源切换为
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
