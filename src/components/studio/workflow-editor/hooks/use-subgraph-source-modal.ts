"use client";
/* 「查看源文件」弹窗的源数据派生：展示**磁盘上的原始 JSON**，而不是派生的可执行
 * 视图 —— 用户点这个按钮是想核对 ComfyUI 保存的源文件（nodes[] / links[] /
 * widgets_values），故顶层取 `detail.rawJson`。sub 视图同理会取父 rawJson 的
 * `definitions.subgraphs[subUid]`（上下文由 fetchDetail 在 drill-in 那一瞬缓存进
 * `subgraphRawContext`，见 WorkflowEditorInner 里该 state 的注释）。 */
import { useMemo } from "react";

import { isPlainRecord } from "~/lib/is-record";
import type { WorkflowDetail } from "../../workflow-types";

/** 父级 rawJson 的 `definitions.subgraphs` 表；每层都按运行期形状收窄。 */
function subgraphsOf(parentRawJson: unknown): Record<string, unknown> | undefined {
  if (!isPlainRecord(parentRawJson)) {
    return undefined;
  }
  const definitions = parentRawJson.definitions;
  if (!isPlainRecord(definitions)) {
    return undefined;
  }
  const subgraphs = definitions.subgraphs;
  return isPlainRecord(subgraphs) ? subgraphs : undefined;
}

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
      const subs = subgraphsOf(ctx.parentRawJson);
      if (!subs) {
        return null;
      }
      return (
        subs[ctx.subUid] ??
        Object.values(subs).find((s) => isPlainRecord(s) && s.id === ctx.subUid) ??
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
