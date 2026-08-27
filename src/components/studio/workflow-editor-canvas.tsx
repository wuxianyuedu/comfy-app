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
  ReactFlow, Controls, MiniMap,
  type Node, type Edge,
  type OnNodesChange, type OnEdgesChange,
} from "@xyflow/react";
import { CanvasGrid, ZoomIndicator, CanvasRulers } from "./workflow-canvas-decorations";
import {
  CanvasSettingsButton,
  isCustomCanvasSettings,
  type CanvasSettings,
} from "./workflow-canvas-settings";
import { PORT_ROLES } from "./workflow-node";
import type { WorkflowNodeData } from "./workflow-types";
import { workflowNodeTypes, workflowEdgeTypes } from "./workflow-editor-nodes";

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
      /* 2026-08-25: commercial-grade perf — only mount nodes/edges that
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
        /* 2026-08-25: lazily activate edge interactivity.  `deletable` /
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
          /* 2026-08-13 R79: bump opacity 0.85→1 and strokeWidth 2→2.5
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
      {/* R-ardot95: gear button opens the right-side canvas settings
       *  panel (grid alpha, ruler toggle, etc.).  Sits below the zoom
       *  indicator so they don't compete for the same vertical slot;
       *  a violet dot lights up whenever the user has changed any
       *  setting from its default. */}
      <CanvasSettingsButton
        hasOverrides={canvasSettingsHydrated && isCustomCanvasSettings(canvasSettings)}
        onClick={onOpenSettings}
      />
      <Controls showInteractive={false} className="!bg-[#14141a]/90 !border-white/10 !text-gray-400 [&>button]:!bg-white/5 [&>button]:!border-white/10 [&>button]:!text-gray-400 [&>button:hover]:!bg-white/10" />
      {canvasSettings.showMiniMap && (
        <MiniMap
          pannable
          zoomable
          ariaLabel="小地图：拖动或点击切换主画布焦点"
          onClick={onMiniMapJump}
          nodeColor={miniMapNodeColor}
          maskColor="rgba(0,0,0,0.78)"
          className="!bg-[#14141a]/90 !border-white/10"
        />
      )}
    </ReactFlow>
  );
}
