"use client";

/* ── 选中节点 → 相关连线 + 相关端口行高亮 ──
 * 订阅 React Flow 的 `nodeLookup[*].internals.userNode.selected`（onSelectionChange 回调顺序不可靠，
 * 该字段是每帧真实渲染节点，最稳定的单一事实源）；判据在 flow-focus-endpoints.ts，本 hook 只做接线。
 * 端口行标记必须与边标记来自同一帧，否则「线亮而行不亮」。
 * 写入策略：仅在关注级别真的变化时换对象（未变化原样返回）—— 边/节点按引用 memo，整表重建会让百级图重渲染。 */

import { useCallback, useEffect } from "react";
import { useStoreApi, type Edge, type Node } from "@xyflow/react";
import { isRecord } from "~/lib/is-record";
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
  if (handle === undefined || handle === null || handle === "") {
    return "none";
  }
  const table = data?.[NODE_PORT_FOCUS_DATA_KEY];
  if (!isRecord(table)) {
    return "none";
  }
  const role = table[handle];
  return role === "upstream" || role === "downstream" || role === "related" ? role : "none";
}

/** 两个端口级别表是否等价（避免每次选中都重建节点对象）。
 *  入参来自节点 data 的原始 JSON，非对象形状一律按「不等价」处理（调用处据此重建清洗）。 */
function portFocusEquals(a: unknown, b: Record<string, EdgeFocusRole>): boolean {
  if (!isRecord(a)) {
    return false;
  }
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) {
    return false;
  }
  return keys.every((key) => a[key] === b[key]);
}

/** 写回节点表的函数形状：只声明「写哪张表」，不绑定节点类型 ——
 *  两处画布的 data 类型（WorkflowNodeData / CanvasNodeData）不同，这里只写 data 上的旁路字段（结构兼容）。
 *  调用方若持更窄 setter，需显式说明写入不改变节点类型（见 ProjectCanvas 传参处）。 */
export type NodeTableWriter = (updater: (nodes: Array<Node>) => Array<Node>) => void;

/** 从边 data 读回关注级别（没标记过 → "none"）。 */
export function readEdgeFocusRole(edge: Pick<Edge, "data">): EdgeFocusRole {
  const role = edge.data?.[EDGE_FOCUS_DATA_KEY];
  return role === "upstream" || role === "downstream" || role === "related" ? role : "none";
}

export type UseRelatedEdgesHighlightOptions = {
  /** 端点在当前画布坐标系下的解析（折叠锚点等）。默认按内部节点表恒等解析。 */
  resolveNodeId?: (visualNodeId: string) => string | null;
  /** 写回节点表：选中节点的相关端口行级别写进节点 data（见 `NODE_PORT_FOCUS_DATA_KEY`）。
   *  不传则只做连线高亮（部分画布没有节点级端口行，且这是历史行为）。 */
  setNodes?: NodeTableWriter;
};

export function useRelatedEdgesHighlight(
  setEdges: (updater: (edges: Array<Edge>) => Array<Edge>) => void,
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
      /* SAFETY: 类型断言已复核 */
      const userNode = internal.internals.userNode as Node | undefined;
      if (userNode?.selected === true) {
        selectedIds.add(nodeId);
      }
    });

    const resolveNodeId = (visualNodeId: string): string | null => {
      if (resolveNodeIdOption) {
        return resolveNodeIdOption(visualNodeId);
      }
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
                source: edge.source,
                target: edge.target,
              },
              resolveNodeId,
              isSelected,
            });

        const previous = readEdgeFocusRole(edge);
        const previousActive = data?.[EDGE_FOCUS_ACTIVE_KEY] === true;
        /* 写入是不是已经正确 —— 关注级别与压暗开关都要对上，任何一个残留旧值
         * 都会让渲染层按上一次的选中状态画（线一直亮着 / 一直灰着）。 */
        const upToDate = previous === role && (focusActive ? previousActive : !previousActive);
        if (upToDate) {
          return edge;
        }

        changed = true;
        /* 重建 data 时显式摘掉旧的关注级别：降级回 "none" 的边若留着旧标记，
         * 渲染层会按它继续加粗。 */
        const rest = { ...data };
        delete rest[EDGE_FOCUS_DATA_KEY];
        delete rest[EDGE_FOCUS_ACTIVE_KEY];
        if (role === "none") {
          /* 无关连线：没有选中项时什么都不留（边表回到未标记的初始形态）。 */
          if (!focusActive) {
            if (!data) {
              return edge;
            }
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
      // oxlint-disable-next-line no-unnecessary-condition -- changed 在 map 回调里写入，规则的控制流分析看不到该写入点
      return changed ? next : currentEdges;
    });

    /* 同一份快照里算出端口行级别并写回节点（未变的不换对象）。 */
    if (!setNodes) {
      return;
    }
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
          bucket.downstream.forEach((handle) => (nextTable[handle] = "downstream"));
          bucket.related.forEach((handle) => (nextTable[handle] = "related"));
        }
        const data: Record<string, unknown> | undefined = node.data;
        const previousTable = data?.[NODE_PORT_FOCUS_DATA_KEY];
        /* 没有端口标记且本来就没有字段 → 原样返回，不制造无意义的新对象。 */
        const previousActive = data?.[NODE_PORT_FOCUS_ACTIVE_KEY] === true;
        const activeUpToDate = focusActive ? previousActive : !previousActive;
        /* 没有端口标记、开关也对上 → 原样返回，不制造无意义的新对象。 */
        if (Object.keys(nextTable).length === 0 && previousTable === undefined && activeUpToDate) {
          return node;
        }
        if (portFocusEquals(previousTable, nextTable) && activeUpToDate) {
          return node;
        }
        changed = true;
        const rest = { ...data };
        delete rest[NODE_PORT_FOCUS_DATA_KEY];
        delete rest[NODE_PORT_FOCUS_ACTIVE_KEY];
        if (Object.keys(nextTable).length === 0) {
          /* 无关节点：没有选中项时什么都不留（节点回到未标记的初始形态）。 */
          if (!focusActive) {
            if (!data) {
              return node;
            }
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
      // oxlint-disable-next-line no-unnecessary-condition -- 同上：changed 在 map 回调里写入
      return changed ? next : currentNodes;
    });
  }, [resolveNodeIdOption, setEdges, setNodes, store]);

  useEffect(() => {
    apply();
    /* 订阅节点/边表：选中变化、节点增删（折叠会换掉锚点节点）都要重算。
     * 先比一个轻量签名再决定是否重算，拖动节点时位置更新不会反复重写边表。 */
    const signature = () => {
      const state = store.getState();
      const ids: Array<string> = [];
      state.nodeLookup.forEach((internal, nodeId) => {
        /* SAFETY: 类型断言已复核 */
        const userNode = internal.internals.userNode as Node | undefined;
        if (userNode?.selected === true) {
          ids.push(nodeId);
        }
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
      if (nextSignature === previousSignature) {
        return;
      }
      previousSignature = nextSignature;
      apply();
    });
    return unsubscribe;
  }, [apply, store]);
}
