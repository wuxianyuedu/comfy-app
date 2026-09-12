"use client";

/* ── 选中节点 → 相关连线高亮 ──
 *
 * 把「哪条连线与选中节点相关」做成画布状态的一部分：订阅 React Flow 的选中事实源
 * （`nodeLookup` 里每个内部节点的 `internals.userNode.selected`），算出每类连线的
 * 关注级别后写回 edges，由边渲染层按级别加成不同样式。
 *
 * 为什么走 store 订阅而不是画布的 `onSelectionChange`：「选中」在两处画布都由
 * 点击 / 框选直接改 React Flow 内部状态（选中节点后拖走再点空白取消等路径），
 * 回调顺序并不可靠；而 `internals.userNode` 永远是那一帧真实渲染的节点对象，
 * 是最稳定的单一事实源。
 *
 * 端点解析与判据在 `flow-focus-endpoints.ts`（纯函数、可单测）；本 hook 只负责
 * 「读 store → 调纯函数 → 写 edges」这条接线。
 *
 * 写入策略：仅在关注级别真的变化时才换掉那条边的对象（未变化的边原样返回）——
 * React Flow 的边渲染按引用 memo，整表重建会让全图边一起重渲染，百级节点的图
 * 每次点击都能看出卡顿。
 */

import { useCallback, useEffect } from "react";
import { useStoreApi, type Edge, type Node } from "@xyflow/react";
import { resolveEdgeFocus, type EdgeFocusRole } from "../flow-focus-endpoints";

/** 写回边 data 上的字段名。边渲染层读它决定加粗 / 高亮。 */
export const EDGE_FOCUS_DATA_KEY = "focusRole";

/** 写回边 data 上的「画布当前有选中项」开关。边渲染层不知道全局选中状态，
 *  但「无关连线是否该压暗」是全局开关 —— 由这里逐条写下去，渲染层只读。 */
export const EDGE_FOCUS_ACTIVE_KEY = "focusActive";

/** 从边 data 读回关注级别（没标记过 → "none"）。 */
export function readEdgeFocusRole(edge: Pick<Edge, "data">): EdgeFocusRole {
  const role = edge.data?.[EDGE_FOCUS_DATA_KEY];
  return role === "upstream" || role === "downstream" || role === "related" ? role : "none";
}

export interface UseRelatedEdgesHighlightOptions {
  /** 端点在当前画布坐标系下的解析（折叠锚点等）。默认按内部节点表恒等解析。 */
  resolveNodeId?: (visualNodeId: string) => string | null;
}

export function useRelatedEdgesHighlight(
  setEdges: (updater: (edges: Edge[]) => Edge[]) => void,
  options: UseRelatedEdgesHighlightOptions = {},
) {
  const store = useStoreApi();
  const resolveNodeIdOption = options.resolveNodeId;

  const apply = useCallback(() => {
    const state = store.getState();

    /* 选中集合：内部节点表里 `internals.userNode.selected` 为真的节点 id。
     * 读渲染期真实节点对象，而不是可能滞后的顶层 nodes 数组。 */
    const selectedIds = new Set<string>();
    state.nodeLookup.forEach((internal, nodeId) => {
      const userNode = internal.internals.userNode as Node | undefined;
      if (userNode?.selected) selectedIds.add(nodeId);
    });

    const resolveNodeId = (visualNodeId: string): string | null => {
      if (resolveNodeIdOption) return resolveNodeIdOption(visualNodeId);
      return state.nodeLookup.has(visualNodeId) ? visualNodeId : null;
    };
    const isSelected = (nodeId: string) => selectedIds.has(nodeId);

    const focusActive = selectedIds.size > 0;

    setEdges((currentEdges) => {
      let changed = false;
      const next = currentEdges.map((edge) => {
        const data = edge.data;
        /* 对外参数映射线（参数卡片 → 端口）表达的是「参数落到哪一行」，不是图上的
         * 数据流。一起高亮会让选中节点时整片映射线亮起来，反而看不清真正的上下游，
         * 所以这类线直接跳过（也不允许残留标记）。 */
        const skip = data?.paramMap === true;

        const role: EdgeFocusRole = skip
          ? "none"
          : resolveEdgeFocus({
              endpoints: { source: edge.source ?? null, target: edge.target ?? null },
              resolveNodeId,
              isSelected,
            });

        const previous = readEdgeFocusRole(edge);
        const previousActive = data?.[EDGE_FOCUS_ACTIVE_KEY] === true;
        /* 写入是不是已经正确 —— 关注级别与压暗开关都要对上，任何一个残留旧值
         * 都会让渲染层按上一次的选中状态画（线一直亮着 / 一直灰着）。 */
        const upToDate =
          previous === role && (focusActive ? previousActive : !previousActive);
        if (upToDate) return edge;

        changed = true;
        /* 重建 data 时显式摘掉旧的关注级别：降级回 "none" 的边若留着旧标记，
         * 渲染层会按它继续加粗。 */
        const rest = { ...(data ?? {}) };
        delete rest[EDGE_FOCUS_DATA_KEY];
        delete rest[EDGE_FOCUS_ACTIVE_KEY];
        if (role === "none") {
          /* 无关连线：没有选中项时什么都不留（边表回到未标记的初始形态）。 */
          if (!focusActive) {
            if (!data) return edge;
            return { ...edge, data: rest };
          }
          return { ...edge, data: { ...rest, [EDGE_FOCUS_ACTIVE_KEY]: true } };
        }
        return {
          ...edge,
          data: { ...rest, [EDGE_FOCUS_DATA_KEY]: role, [EDGE_FOCUS_ACTIVE_KEY]: true },
        };
      });
      return changed ? next : currentEdges;
    });
  }, [resolveNodeIdOption, setEdges, store]);

  useEffect(() => {
    apply();
    /* 订阅节点/边表：选中变化、节点增删（折叠会换掉锚点节点）都要重算。
     * 先比一个轻量签名再决定是否重算，拖动节点时位置更新不会反复重写边表。 */
    const signature = () => {
      const state = store.getState();
      const ids: string[] = [];
      state.nodeLookup.forEach((internal, nodeId) => {
        const userNode = internal.internals.userNode as Node | undefined;
        if (userNode?.selected) ids.push(nodeId);
      });
      return `${ids.sort().join(",")}|${state.edges.length}`;
    };
    let previousSignature = signature();
    const unsubscribe = store.subscribe(() => {
      const nextSignature = signature();
      if (nextSignature === previousSignature) return;
      previousSignature = nextSignature;
      apply();
    });
    return unsubscribe;
  }, [apply, store]);
}
