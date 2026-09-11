/* Extracted ReactFlow canvas from WorkflowEditorInner (wf-editor-inner.tsx).
 *
 *  The canvas lives inside the relative container that also hosts the
 *  subgraph-loading overlay / IO-edit hint / IO preview panel (those stay
 *  in the parent so they can be layered above the flow via z-index).
 *  `fitView` is intentionally NOT set here — the parent drives the initial
 *  viewport in a useEffect to enforce a minimum zoom of 0.35. */
"use client";

import React, { useCallback } from "react";
import {
  ReactFlow, Controls, MiniMap, useStoreApi,
  type Node, type Edge,
  type OnNodesChange, type OnEdgesChange,
} from "@xyflow/react";
import { CanvasGrid, ZoomIndicator, CanvasRulers } from "../WorkflowCanvasDecorations";
import {
  CanvasSettingsButton,
  isCustomCanvasSettings,
  type CanvasSettings,
} from "../canvas/WorkflowCanvasSettings";
import { PORT_ROLES } from "../canvas/WorkflowNode";
import type { WorkflowNodeData } from "../workflow-types";
import { workflowNodeTypes, workflowEdgeTypes } from "./WorkflowEditorNodes";

/** React Flow 的 error#008 文本前缀（见 @xyflow/system 的 errorMessages）。 */
const EDGE_HANDLE_ERROR = "Couldn't create edge for";

/** 过滤「视口裁剪」造成的 error#008 假告警，保留真正找不到 handle 的告警。
 *
 *  背景（ISSUE #374）：本画布开着 `onlyRenderVisibleElements`。React Flow 的
 *  节点裁剪按**每个节点各自**与视口求交（`getNodesInside`），而边的裁剪按
 *  **两端节点的并集包围盒**与视口求交（`isEdgeVisible`）。一条横跨整个画布的
 *  长边，其并集盒覆盖视口 → 判定为「可见」而进入渲染；但它的两端节点各自都在
 *  视口外、没有挂载，`handleBounds` 为空 —— `getEdgePosition` 于是返回 null 并
 *  打 error#008。这是裁剪策略的固有副作用，不是数据错误：用户一滚到那片区域，
 *  节点挂载、边随即正常渲染。
 *
 *  真正的 handle 缺失（渲染的 id 与边引用的 id 不同名）必须继续暴露 —— 那才是
 *  画布上「线永远画不出来」的 bug。判据：报错涉及的**两端节点此刻是否已挂载**。
 *  两端都挂载还报错 = 真问题；任一端未挂载 = 裁剪噪声。
 *
 *  返回值：`true` 表示这条告警应被忽略（纯函数，便于单测）。 */
export function isEdgeHandleCullingNoise(args: {
  message: string;
  /** 已挂载（进入 handleBounds 测量）的节点 id 集合。 */
  mountedNodeIds: ReadonlySet<string>;
  /** 该边引用的两端节点 id；节点不存在/已删除时传 null。 */
  sourceId: string | null;
  targetId: string | null;
}): boolean {
  const { message, mountedNodeIds, sourceId, targetId } = args;
  if (!message.startsWith(EDGE_HANDLE_ERROR)) return false;
  /* 端点信息缺失（边引用的节点已被删）→ 交给 React Flow 自己处理。 */
  if (!sourceId || !targetId) return false;
  /* 两端都挂载还报错 ⇒ 是真的找不到 handle，必须暴露。 */
  return !mountedNodeIds.has(sourceId) || !mountedNodeIds.has(targetId);
}

/* Role key → minimap colour.  Hoisted to a module-level Map so the MiniMap
 *  `nodeColor` callback can stay referentially stable (empty useCallback
 *  deps): MiniMap only re-runs it while painting, and never re-renders
 *  because of a fresh callback identity. */
const ROLE_COLOR_BY_KEY = new Map(PORT_ROLES.map((r) => [r.key, r.color]));

export interface WorkflowEditorCanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange<Node>;
  onEdgesChange: OnEdgesChange<Edge>;
  onNodeDragStop: (
    e: unknown,
    node: { id: string; type?: string; position: { x: number; y: number } }
  ) => void;
  canvasSettings: CanvasSettings;
  canvasSettingsHydrated: boolean;
  onMiniMapJump: (event: React.MouseEvent, position: { x: number; y: number }) => void;
  onOpenSettings: () => void;
  /** Lazily activates deletable/reconnectable for a clicked edge (see
   *  defaultEdgeOptions below). */
  onEdgeClick?: (event: React.MouseEvent, edge: Edge) => void;
}

export function WorkflowEditorCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onNodeDragStop,
  canvasSettings,
  canvasSettingsHydrated,
  onMiniMapJump,
  onOpenSettings,
  onEdgeClick,
}: WorkflowEditorCanvasProps) {
  /* Stable identity → colour lookup for the MiniMap.  Depends on nothing
   *  (role colours are static), so MiniMap never re-renders due to a fresh
   *  callback reference while nodes are dragged. */
  const miniMapNodeColor = useCallback((node: Node) => {
    const d = node.data as WorkflowNodeData | undefined;
    return (d?.assignedRole ? ROLE_COLOR_BY_KEY.get(d.assignedRole) : undefined) ?? "#333";
  }, []);

  /* ── error#008 假告警过滤器（ISSUE #374）──
   *  见 `isEdgeHandleCullingNoise` 的文档：视口裁剪下「长边可见 / 端点未挂载」
   *  会成批刷 error#008，而真正的 handle 不同名必须继续暴露。
   *
   *  「已挂载」的判据取 React Flow 内部事实源：`nodeLookup[id].internals
   *  .handleBounds` —— 它只在节点的 DOM 真正挂载、被测量之后才有值。用
   *  `useStoreApi` 在回调里按需读取，而不是订阅整张表，避免拖拽期间频繁重渲染。 */
  const store = useStoreApi();
  const handleError = useCallback(
    (id: string, message: string) => {
      if (!message.startsWith(EDGE_HANDLE_ERROR)) {
        console.warn(`[React Flow] ${message}`);
        return;
      }
      const { nodeLookup, edgeLookup } = store.getState();
      const edge = edgeLookup.get(id);
      const mounted = new Set<string>();
      nodeLookup.forEach((internal, nodeId) => {
        if (internal.internals.handleBounds) mounted.add(nodeId);
      });
      if (
        isEdgeHandleCullingNoise({
          message,
          mountedNodeIds: mounted,
          sourceId: edge?.source ?? null,
          targetId: edge?.target ?? null,
        })
      ) {
        return;
      }
      console.warn(`[React Flow] ${message}`);
    },
    [store]
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={onNodeDragStop}
      onEdgeClick={onEdgeClick}
      nodeTypes={workflowNodeTypes}
      edgeTypes={workflowEdgeTypes}
      /* 过滤视口裁剪造成的 error#008 假告警（ISSUE #374）—— 见 handleError。 */
      onError={handleError}
      /* commercial-grade perf — only mount nodes/edges that
       *  intersect the viewport.  The DaSiWa Wan 2.2 template ships 130
       *  nodes across a ~7000 px bbox; React Flow was previously mounting
       *  the ENTIRE graph (plus every rail IO port) and letting the
       *  browser paint off-screen DOM every frame.  With viewport culling
       *  the DOM stays proportional to what's visible, and drag/pan/zoom
       *  costs drop to a small constant.
       *  NOTE: the parent still drives the initial fitToMiddle() viewport
       *  (min zoom floor 0.35) — culling uses each node's measured size
       *  after first paint, so the initial fit is unaffected. */
      onlyRenderVisibleElements
      /* `fitView` is intentionally NOT set here — we drive the
       *  initial viewport ourselves in a useEffect above so we can
       *  enforce a minimum zoom of 0.35.  Without that floor, the
       *  DaSiWa Wan 2.2 template (130 nodes, bbox ≈ 7000 px wide)
       *  fitView'd to ~0.15x and every note became illegible.
       *  fitViewOptions={{ padding: 0.3 }}
       *  → see useEffect above; tight 0.10 + 0.35 zoom floor. */
      minZoom={canvasSettingsHydrated ? canvasSettings.minZoom : 0.15}
      maxZoom={canvasSettingsHydrated ? canvasSettings.maxZoom : 2}
      defaultEdgeOptions={{
        type: "default",
        animated: false,
        /* lazily activate edge interactivity. `deletable` /
         * `reconnectable` default to true, which makes React Flow attach
         * interaction plumbing to EVERY edge up front.  For 130+ node
         * graphs that is a measurable per-frame cost even though almost
         * every edge is never touched.  We default both to false and flip
         * them on the first time the user clicks an edge (onEdgeClick in
         * the parent), so ordinary edges stay inert and the graph keeps
         * its full drag/pan/zoom budget. */
        deletable: false,
        reconnectable: false,
        style: {
          /* bump opacity 0.85→1 and strokeWidth 2→2.5
           *  so the default `default`-typed edges look identical to
           *  `wf` edges (WorkflowEdge).  Previously the default was the
           *  silent fallback when the edge type wasn't set, leaving
           *  some wires visually faded vs the rest. */
          stroke: "rgba(167,139,250,1)",
          strokeWidth: 2.5,
        },
      }}
      proOptions={{ hideAttribution: true }}
    >
      {/* Grid background — 20px cells with a heavier rule every
       *  10 cells.  See <CanvasGrid> above. */}
      <CanvasGrid settings={canvasSettings} />
      {/* Coordinate rulers along the four edges — show the world
       *  X / Y of every visible major line.  See <CanvasRulers>. */}
      <CanvasRulers settings={canvasSettings} />
      <ZoomIndicator
        minZoom={canvasSettingsHydrated ? canvasSettings.minZoom : 0.15}
        maxZoom={canvasSettingsHydrated ? canvasSettings.maxZoom : 2}
      />
      {/* gear button opens the right-side canvas settings
       *  panel (grid alpha, ruler toggle, etc.).  Sits below the zoom
       *  indicator so they don't compete for the same vertical slot;
       *  a violet dot lights up whenever the user has changed any
       *  setting from its default. */}
      <CanvasSettingsButton
        hasOverrides={canvasSettingsHydrated && isCustomCanvasSettings(canvasSettings)}
        onClick={onOpenSettings}
      />
      {/* Controls / MiniMap 的配色由 globals.css 的 `.react-flow__controls*`
          / `.react-flow__minimap*` token 规则统一负责（画布与项目画布共用），
          组件侧不再叠加写死的暗色覆盖类。 */}
      <Controls showInteractive={false} />
      {canvasSettings.showMiniMap && (
        <MiniMap
          pannable
          zoomable
          ariaLabel="小地图：拖动或点击切换主画布焦点"
          onClick={onMiniMapJump}
          nodeColor={miniMapNodeColor}
          /* maskColor 是「小地图里非视口区域」的遮罩：必须跟随主题。
             写死 rgba(0,0,0,0.78) 时 Light 下整张缩略图被压成一块黑，
             与浅色画布割裂。改为引用 token——浅色用浅遮罩、深色保持近黑。 */
          maskColor="var(--color-canvas-minimap-mask)"
        />
      )}
    </ReactFlow>
  );
}
