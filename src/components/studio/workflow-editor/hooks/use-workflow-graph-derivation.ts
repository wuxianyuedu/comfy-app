"use client";
/* ── 编辑器的数据派生管线：detail → 视图元数据 → 图节点 ──
 * ① `useWorkflowDerivedData`（raw 元数据、RAW/API 详情、输出槽位名）；② `ioDetailMap`
 * （IO 预览富化源，子图就地派生）；③ `graphNodes`。渲染从后到前：分组框 → 便签 → 真实
 * 节点（最上层）。布局优先「已保存坐标」（RAW 导入，与 ComfyUI 一致），否则 BFS 分层。
 * `buildEdges` 留在编辑器本体（与 `setEdges` 同效）；派生结果同步进 viewer/rgthree store。 */
import { useEffect, useMemo } from "react";

import { buildInitialNodes } from "../workflow-editor-build-nodes";
import { useWorkflowDerivedData } from "../workflow-editor-derived";
import { enrichFromViewNodes } from "../io-exposure";
import type { useViewerApi, useRgthreeApi } from "../WorkflowStores";
import type { useWorkflowDetailLoader } from "./use-workflow-detail-loader";
import type { WorkflowDetail } from "../../workflow-types";

export function useWorkflowGraphDerivation(params: {
  detail: WorkflowDetail | null;
  onEnterSubgraph: ReturnType<typeof useWorkflowDetailLoader>["onEnterSubgraph"];
  paramMap: Record<string, unknown>;
  rgthreeApi: ReturnType<typeof useRgthreeApi>;
  subgraphRawContext: {
    parentRawJson: unknown;
    subUid: string;
  } | null;
  subgraphStackLength: number;
  viewerApi: ReturnType<typeof useViewerApi>;
  /** 当前视图的宿主（外层封装）节点 id 链 —— 顶层为空串，下钻后是 `4`（或
   *  嵌套时的 `4:5`）。带上它才能在勾选时落库「外层 + 内层」两个 id
   *  （ISSUE #349 后续）。 */
  viewHostNodeId: string;
  workflowId: string;
}) {
  const {
    detail,
    paramMap,
    onEnterSubgraph,
    viewHostNodeId,
    workflowId,
    viewerApi,
    rgthreeApi,
    subgraphRawContext,
    subgraphStackLength,
  } = params;
  const { rawMetaById, scopeDetail, outSlotNameById } = useWorkflowDerivedData(detail);

  /* IO 预览的富化数据源。顶层视图直接用服务端产出的 `detail.workflowIO`；
   * 下钻到子工作流后该字段为空（子图路由不产出它），于是退回「按当前视图
   * 节点元数据就地派生」——否则修复前落库的槽位名/别名会一直显示
   * （ISSUE #349）。派生只补齐缺失键，不覆盖服务端已给的富化结果。 */
  const ioDetailMap = useMemo(() => {
    if (detail?.workflowIO && Object.keys(detail.workflowIO).length > 0) {
      return detail.workflowIO;
    }
    return enrichFromViewNodes(scopeDetail?.nodes);
  }, [detail, scopeDetail]);

  const graphNodes = useMemo(
    () =>
      buildInitialNodes({
        detail,
        scopeDetail,
        rawMetaById,
        outSlotNameById,
        paramMap,
        onEnterSubgraph,
        hostNodeId: viewHostNodeId || undefined,
      }),
    [detail, scopeDetail, rawMetaById, outSlotNameById, paramMap, onEnterSubgraph, viewHostNodeId],
  );

  /* P2: 把 detail 派生的查找上下文同步进 viewer / rgthree store，让
   * getNodeJson/getNodeView/getBypass 读到实时 detail（等价于旧 Context
   * 每次用新 props 渲染）。 */
  useEffect(() => {
    viewerApi.setState({
      detail,
      rawMetaById,
      positions: detail?.positions ?? null,
      subgraphRawContext,
      subgraphStackLength,
    });
    rgthreeApi.setState({
      workflowId,
      detail,
      overrides: rgthreeApi.getState().overrides,
    });
    /* `workflowId` / `viewerApi` / `rgthreeApi` 有意不入依赖：两个 store 的 hook 返回
     *  稳定引用，写进依赖只让 linter 满意、不改变触发时机；`workflowId` 随 `detail`
     *  一起变（loader 就以它为键取详情），单独挂它会在详情落地前先跑一轮，把 store 的
     *  `workflowId` 提前改成新 id 而细节还是旧的。属规范 §13.4「规则静态盲区」。 */
    // oxlint-disable-next-line react/exhaustive-deps
  }, [detail, rawMetaById, subgraphRawContext, subgraphStackLength]);

  return { rawMetaById, scopeDetail, outSlotNameById, ioDetailMap, graphNodes };
}
