"use client";
/* 「查看源文件」弹窗的源数据派生。
 *
 * 要展示**磁盘上的原始 JSON**，而不是派生的可执行视图 —— 用户点这个按钮
 * 是想核对 ComfyUI 保存的源文件（nodes[] / links[] / widgets_values），
 * 所以顶层视图取 `detail.rawJson`。sub 视图同理：源文件 = 父 rawJson 的
 * `definitions.subgraphs[subUid]`（上下文由 fetchDetail 在 drill-in 那一瞬
 * 缓存进 `subgraphRawContext`，见 WorkflowEditorInner 里该 state 的注释）。 */
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
      // oxlint-disable-next-line no-unnecessary-condition -- detail 来自工作流详情响应 / sessionStorage 缓存，旧缓存可能缺 name
      name: detail.name ?? "工作流",
      source: raw,
      isSubgraph: isSubgraphView,
    };
  }, [detail, subgraphStackLength, subgraphRawContext]);
}
