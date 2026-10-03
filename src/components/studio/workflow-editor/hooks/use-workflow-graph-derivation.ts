"use client";
/* ── 编辑器的数据派生管线：detail → 视图元数据 → 图节点 ──
 *
 * 把「工作流详情」加工成画布可以渲染的形状，三步都在这里：
 * ① `useWorkflowDerivedData` —— raw 节点元数据映射、按视图范围取的详情
 *    （RAW / API）、每个节点的输出槽位名；
 * ② `ioDetailMap` —— IO 预览的富化数据源（顶层用服务端产出，子图视图就地派生）；
 * ③ `graphNodes` —— 把图转成流程节点。渲染顺序（从后到前）：
 *    分组框 → 便签注释 → 真实图节点（恒在最上层）。
 * 真实节点的布局策略按优先级：
 *    1. **已保存的坐标**（RAW 导入）：原样使用 ComfyUI 里的坐标，
 *       让画布与用户当初摆的样子完全一致。
 *    2. **自动布局（按 BFS 分层）**：只给了 API JSON 时用。
 * 连线的构建（`buildEdges`）留在编辑器本体——它与 `setEdges` 的同步效应
 * 是同一件事（见 workflow-canvas-io-isolation-guard 的来源判据）。
 */
import { useMemo } from "react";

import { buildInitialNodes } from "../workflow-editor-build-nodes";
import { useWorkflowDerivedData } from "../workflow-editor-derived";
import { enrichFromViewNodes } from "../io-exposure";
import type { useWorkflowDetailLoader } from "./use-workflow-detail-loader";
import type { WorkflowDetail } from "../../workflow-types";

export function useWorkflowGraphDerivation(params: {
  detail: WorkflowDetail | null;
  paramMap: Record<string, unknown>;
  onEnterSubgraph: ReturnType<
    typeof useWorkflowDetailLoader
  >["onEnterSubgraph"];
  /** 当前视图的宿主（外层封装）节点 id 链 —— 顶层为空串，下钻后是 `4`（或
   *  嵌套时的 `4:5`）。带上它才能在勾选时落库「外层 + 内层」两个 id
   *  （ISSUE #349 后续）。 */
  viewHostNodeId: string;
}) {
  const { detail, paramMap, onEnterSubgraph, viewHostNodeId } = params;
  const { rawMetaById, scopeDetail, outSlotNameById } =
    useWorkflowDerivedData(detail);

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
    [
      detail,
      scopeDetail,
      rawMetaById,
      outSlotNameById,
      paramMap,
      onEnterSubgraph,
      viewHostNodeId,
    ],
  );

  return { rawMetaById, scopeDetail, outSlotNameById, ioDetailMap, graphNodes };
}
