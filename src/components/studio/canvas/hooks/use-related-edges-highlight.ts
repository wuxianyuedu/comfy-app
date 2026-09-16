"use client";

/* ── 选中节点 → 相关连线 + 相关端口行高亮 ──
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
 * 「读 store → 调纯函数 → 写 edges / 写节点」这条接线。
 *
 * **端口行同源**：选中只把线加粗仍答不出「这条线落到节点的哪一行」，所以同一份
 * store 快照里顺手算出每个节点上「有连线落到的端口行」，写回节点 data（新的节点
 * 对象才触发 React Flow 重渲染，见下）。节点标记与边标记必须来自同一帧，否则会
 * 出现「线亮了但落到的那一行没亮」。
 *
 * 写入策略：仅在关注级别真的变化时才换掉那条边 / 那个节点的对象（未变化的原样
 * 返回）—— React Flow 的边与节点渲染都按引用 memo，整表重建会让全图一起重渲染，
 * 百级节点的图每次点击都能看出卡顿。
 */

import { useCallback, useEffect } from "react";
import { useStoreApi, type Edge, type Node } from "@xyflow/react";
import {
  resolveEdgeFocus,
  resolvePortFocusRoles,
  type EdgeFocusRole,
} from "../flow-focus-endpoints";

/** 写回边 data 上的字段名。边渲染层读它决定加粗 / 高亮。 */
export const EDGE_FOCUS_DATA_KEY = "focusRole";

/** 写回边 data 上的「画布当前有选中项」开关。边渲染层不知道全局选中状态，
 *  但「无关连线是否该压暗」是全局开关 —— 由这里逐条写下去，渲染层只读。 */
export const EDGE_FOCUS_ACTIVE_KEY = "focusActive";

/** 写回节点 data 上的「端口行关注级别」字段名。
 *
 *  形态是 `{ [端口名]: "upstream" | "downstream" | "related" }`；没有端口名在表里
 *  的行就是「没连线落到」。边渲染层读不到节点内部，端口行渲染层也拿不到选中状态
 *  —— 两端靠这一份 map 对齐。 */
export const NODE_PORT_FOCUS_DATA_KEY = "portFocus";

/** 写回节点 data 上的「画布当前有选中项」开关（与边上的 `EDGE_FOCUS_ACTIVE_KEY`
 *  同义）。端口行渲染层据此决定「没有标记的行是否压暗」——它读不到全局选中状态。 */
export const NODE_PORT_FOCUS_ACTIVE_KEY = "portFocusActive";

/** 从节点 data 读回某一行的关注级别（没标记过 → "none"）。 */
export function readPortFocusRole(
  data: Record<string, unknown> | undefined,
  handle: string | undefined | null,
): EdgeFocusRole {
  if (!handle) return "none";
  const table = data?.[NODE_PORT_FOCUS_DATA_KEY];
  if (!table || typeof table !== "object") return "none";
  const role = (table as Record<string, unknown>)[handle];
  return role === "upstream" || role === "downstream" || role === "related"
    ? role
    : "none";
}

/** 两个端口级别表是否等价（避免每次选中都重建节点对象）。 */
function portFocusEquals(
  a: Record<string, EdgeFocusRole> | undefined,
  b: Record<string, EdgeFocusRole> | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => a[key] === b[key]);
}

/** 写回节点表的函数形状。
 *
 *  只声明「写哪一张表」，不绑定具体节点类型：两处画布的节点各带自己的 data 类型
 *  （工作流节点 `WorkflowNodeData` / 项目画布 `CanvasNodeData`），而这里写入的
 *  只是 data 上的一个旁路字段（结构上兼容）。调用方若拿着更窄的 setter，需要显式
 *  说明这次写入不改变节点类型 —— 见 ProjectCanvas 的传参处。 */
export type NodeTableWriter = (updater: (nodes: Node[]) => Node[]) => void;

/** 从边 data 读回关注级别（没标记过 → "none"）。 */
export function readEdgeFocusRole(edge: Pick<Edge, "data">): EdgeFocusRole {
  const role = edge.data?.[EDGE_FOCUS_DATA_KEY];
  return role === "upstream" || role === "downstream" || role === "related"
    ? role
    : "none";
}

export interface UseRelatedEdgesHighlightOptions {
  /** 端点在当前画布坐标系下的解析（折叠锚点等）。默认按内部节点表恒等解析。 */
  resolveNodeId?: (visualNodeId: string) => string | null;
  /** 写回节点表：选中节点的相关端口行级别写进节点 data（见 `NODE_PORT_FOCUS_DATA_KEY`）。
   *  不传则只做连线高亮（部分画布没有节点级端口行，且这是历史行为）。 */
  setNodes?: NodeTableWriter;
}

export function useRelatedEdgesHighlight(
  setEdges: (updater: (edges: Edge[]) => Edge[]) => void,
  options: UseRelatedEdgesHighlightOptions = {},
) {
  const store = useStoreApi();
  const resolveNodeIdOption = options.resolveNodeId;
  const setNodes = options.setNodes;

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
              endpoints: {
                source: edge.source ?? null,
                target: edge.target ?? null,
              },
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
          data: {
            ...rest,
            [EDGE_FOCUS_DATA_KEY]: role,
            [EDGE_FOCUS_ACTIVE_KEY]: true,
          },
        };
      });
      return changed ? next : currentEdges;
    });

    /* 同一份快照里算出端口行级别并写回节点（未变的不换对象）。 */
    if (!setNodes) return;
    const { nodes } = resolvePortFocusRoles({
      connections: state.edges,
      selectedIds,
      resolveSourceId: resolveNodeId,
      resolveTargetId: resolveNodeId,
    });
    setNodes((currentNodes) => {
      let changed = false;
      const next = currentNodes.map((node) => {
        const bucket = nodes.get(node.id);
        const nextTable: Record<string, EdgeFocusRole> = {};
        if (bucket) {
          bucket.upstream.forEach((handle) => (nextTable[handle] = "upstream"));
          bucket.downstream.forEach(
            (handle) => (nextTable[handle] = "downstream"),
          );
          bucket.related.forEach((handle) => (nextTable[handle] = "related"));
        }
        const data = node.data as Record<string, unknown> | undefined;
        const previousTable = data?.[NODE_PORT_FOCUS_DATA_KEY] as
          Record<string, EdgeFocusRole> | undefined;
        /* 没有端口标记且本来就没有字段 → 原样返回，不制造无意义的新对象。 */
        const previousActive = data?.[NODE_PORT_FOCUS_ACTIVE_KEY] === true;
        const activeUpToDate = focusActive ? previousActive : !previousActive;
        /* 没有端口标记、开关也对上 → 原样返回，不制造无意义的新对象。 */
        if (
          Object.keys(nextTable).length === 0 &&
          previousTable === undefined &&
          activeUpToDate
        )
          return node;
        if (portFocusEquals(previousTable, nextTable) && activeUpToDate)
          return node;
        changed = true;
        const rest = { ...(data ?? {}) };
        delete rest[NODE_PORT_FOCUS_DATA_KEY];
        delete rest[NODE_PORT_FOCUS_ACTIVE_KEY];
        if (Object.keys(nextTable).length === 0) {
          /* 无关节点：没有选中项时什么都不留（节点回到未标记的初始形态）。 */
          if (!focusActive) {
            if (!data) return node;
            return { ...node, data: rest };
          }
          return {
            ...node,
            data: { ...rest, [NODE_PORT_FOCUS_ACTIVE_KEY]: true },
          };
        }
        return {
          ...node,
          data: {
            ...rest,
            [NODE_PORT_FOCUS_DATA_KEY]: nextTable,
            [NODE_PORT_FOCUS_ACTIVE_KEY]: true,
          },
        };
      });
      return changed ? next : currentNodes;
    });
  }, [resolveNodeIdOption, setEdges, setNodes, store]);

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
      /* 边表签名参与进来：端口行级别由边表算出，连线增删（含「连上 / 断开某一行」）
       * 必须重算，否则新连上的行不会亮、断开的行仍然亮着。 */
      const edgeSignature = state.edges
        .map(
          (edge) =>
            `${edge.source}>${edge.sourceHandle ?? ""}~${edge.target}>${edge.targetHandle ?? ""}`,
        )
        .sort()
        .join(",");
      return `${ids.sort().join(",")}|${edgeSignature}`;
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
