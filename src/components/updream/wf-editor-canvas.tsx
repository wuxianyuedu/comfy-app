/* Extracted ReactFlow canvas from WorkflowEditorInner (wf-editor-inner.tsx).
 *
 *  The canvas lives inside the relative container that also hosts the
 *  subgraph-loading overlay / IO-edit hint / IO preview panel (those stay
 *  in the parent so they can be layered above the flow via z-index).
 *  `fitView` is intentionally NOT set here — the parent drives the initial
 *  viewport in a useEffect to enforce a minimum zoom of 0.35. */
"use client";

import React from "react";
import {
  ReactFlow, Controls, MiniMap,
  type Node, type Edge,
  type OnNodesChange, type OnEdgesChange,
} from "@xyflow/react";
import { CanvasGrid, ZoomIndicator, CanvasRulers } from "./wf-canvas-decorations";
import {
  CanvasSettingsButton,
  isCustomCanvasSettings,
  type CanvasSettings,
} from "./wf-canvas-settings";
import { PORT_ROLES } from "./wf-node";
import type { WfNodeData } from "./wf-types";
import { wfNodeTypes, wfEdgeTypes } from "./wf-editor-nodes";

export interface WfEditorCanvasProps {
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
}

export function WfEditorCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onNodeDragStop,
  canvasSettings,
  canvasSettingsHydrated,
  onMiniMapJump,
  onOpenSettings,
}: WfEditorCanvasProps) {
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={onNodeDragStop}
      nodeTypes={wfNodeTypes}
      edgeTypes={wfEdgeTypes}
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
        style: {
          /* 2026-08-13 R79: bump opacity 0.85→1 and strokeWidth 2→2.5
           *  so the default `default`-typed edges look identical to
           *  `wf` edges (WfEdge).  Previously the default was the
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
          nodeColor={(n) => {
            const d = n.data as WfNodeData;
            const r = PORT_ROLES.find((role) => role.key === d.assignedRole);
            return r?.color ?? "#333";
          }}
          maskColor="rgba(0,0,0,0.78)"
          className="!bg-[#14141a]/90 !border-white/10"
        />
      )}
    </ReactFlow>
  );
}
