"use client";
/* 「查看源文件」弹窗的源数据派生：展示**磁盘上的原始 JSON**，而不是派生的可执行
 * 视图 —— 用户点这个按钮是想核对 ComfyUI 保存的源文件（nodes[] / links[] /
 * widgets_values），故顶层取 `detail.rawJson`。sub 视图同理会取父 rawJson 的
 * `definitions.subgraphs[subUid]`（上下文由 fetchDetail 在 drill-in 那一瞬缓存进
 * `subgraphRawContext`，见 WorkflowEditorInner 里该 state 的注释）。 */
import { useMemo } from "react";

import type { WorkflowDetail } from "../../workflow-types";

export function useSubgraphSourceModal(params: {
  detail: WorkflowDetail | null;
  subgraphRawContext: {
    parentRawJson: unknown;
    subUid: string;
  } | null;
  subgraphStackLength: number;
}) {
  const { detail, subgraphStackLength, subgraphRawContext } = params;
  return useMemo<{
    isSubgraph: boolean;
    name: string;
    source: unknown;
  } | null>(() => {
    if (!detail) {
      return null;
    }
    const isSubgraphView = subgraphStackLength > 0;
    const raw: unknown = (() => {
      if (!isSubgraphView) {
        return detail.rawJson ?? null;
      }
      /* sub 视图：源文件 = 父 rawJson 的 definitions.subgraphs[subUid]。 */
      const ctx = subgraphRawContext;
      if (!ctx) {
        return null;
      }
      /* SAFETY: 类型断言已复核 */
      const subs = (
        ctx.parentRawJson as {
          definitions?: { subgraphs?: Record<string, unknown> };
        } | null
      )?.definitions?.subgraphs;
      if (!subs) {
        return null;
      }
      return (
        subs[ctx.subUid] ??
        Object.values(subs).find(
          /* SAFETY: 类型断言已复核 */
          (s) => (s as { id?: unknown } | null)?.id === ctx.subUid,
        ) ??
        null
      );
    })();
    return {
      name: detail.name ?? "工作流",
      source: raw,
      isSubgraph: isSubgraphView,
    };
  }, [detail, subgraphStackLength, subgraphRawContext]);
}
