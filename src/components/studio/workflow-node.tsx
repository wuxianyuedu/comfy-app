"use client";
/* FlowNode (custom ComfyUI graph node renderer) — orchestrates the node
 * card.  T12: heavy blocks split into siblings:
 *   - workflow-node-entries.ts      (input/output row bucketing hook)
 *   - workflow-node-palette.ts      (mode/role colour computation)
 *   - FlowNodeHeader.tsx            (title bar)
 *   - FlowNodeCollapsedAnchors.tsx  (collapsed-mode cylinders + handles)
 *   - FlowNodePinRows.tsx           (TOP PINS connection rows)
 *   - FlowNodeWidgetRows.tsx        (widget/knob rows)
 * Originally inside WorkflowCanvasEditor.tsx. */
import React, { useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { friendlyNodeTitle } from "@/lib/comfyui/node-titles";
import { PackageFooter } from "@/components/workflow-canvas/nodes/PackageFooter";
import { DebugChainFooter } from "./DebugChainFooter";
import { getWorkflowRenderChainModules } from "./workflow-render-chain";
import { useDebugStore } from "./debug-store";
import { NODE_TITLE_H, resolveNodePackage } from "./workflow-utils";
import { FrontendOnlyBadge } from "./required-summary";
import { RgthreeFastGroupsBypasserBody, RgthreePowerLoraLoaderBody, RgthreeLabelBody } from "./rgthree-bodies";
import { FrostLayer } from "./node-frost";
import { WorkflowImagePreview } from "./workflow-image-preview";
import { useIOEditContext } from "./io-edit-context";
import { useFlowNodeEntries } from "./workflow-node-entries";
import { computeNodePalette } from "./workflow-node-palette";
import { FlowNodeHeader } from "./FlowNodeHeader";
import { FlowNodeCollapsedAnchors } from "./FlowNodeCollapsedAnchors";
import { FlowNodePinRows } from "./FlowNodePinRows";
import { FlowNodeWidgetRows } from "./FlowNodeWidgetRows";
import type { WorkflowNodeData } from "./workflow-types";

/** Node role palette definitions (assignedRole → label + accent colour). */
export const PORT_ROLES: { key: string; label: string; color: string; bg: string }[] = [
  { key: "positiveNode",   label: "正向提示词", color: "#a78bfa", bg: "rgba(167,139,250,0.15)" },
  { key: "negativeNode",   label: "反向提示词", color: "#f87171", bg: "rgba(248,113,113,0.15)" },
  { key: "checkpointNode", label: "模型(Checkpoint)", color: "#60a5fa", bg: "rgba(96,165,250,0.15)" },
  { key: "samplerNode",    label: "采样器",       color: "#fb923c", bg: "rgba(251,146,60,0.15)" },
  { key: "inputImageNode", label: "输入图像",      color: "#22d3ee", bg: "rgba(34,211,238,0.15)" },
];

/* ── Node data for the flow canvas (must satisfy Record<string, unknown> for @xyflow/react) ── */
export const INPUT_ROW_HEIGHT = 22; // px per input row (matches the py-1 + text-[11px] row)
export const HEADER_TOTAL = 60;     // header (32) + #id bar (22) + small breathing room (6)

/* (Note: we used to override `<Handle top: ...>` with these constants to
 *  line Handles up with their rows.  We no longer do that — React Flow
 *  pins every Handle to its row's `top: 50%` automatically.  The constants
 *  are kept around as a reference for any future layout work.) */

export const FlowNode = React.memo(function FlowNode({ data, selected }: { data: WorkflowNodeData; selected?: boolean }) {
  const role = PORT_ROLES.find((PORT_ROLES) => PORT_ROLES.key === data.assignedRole);
  const io = useIOEditContext();
  /* 2026-08-25: viewport zoom is NO LONGER subscribed here — the zoom read
   *  lives inside <FrostLayer> so only frosted nodes re-render while zooming. */
  const debugMode = useDebugStore((state) => state.debugMode);

  /* Input/output row bucketing + palette live in sibling modules so the
   *  renderer below only orchestrates layout. */
  const entries = useFlowNodeEntries(data);
  const palette = computeNodePalette(data, role);

  /* Collapsed state (ComfyUI LiteGraph flag `flags.collapsed`).  The
   *  imported config's flag seeds the INITIAL value; the user toggle owns
   *  the state thereafter (a naive `dataCollapsed || userCollapsed` could
   *  never re-expand an initially-collapsed node). */
  const [userCollapsed, setUserCollapsed] = useState<boolean>(
    data.flags?.collapsed === true
  );
  const isCollapsed = userCollapsed;

  /* Display title prefers zh-CN friendly map → raw `title` from ComfyUI →
   * prettified class_type. */
  const displayTitle = friendlyNodeTitle(data.classType, data.title, "zh");
  /* rgthree Label nodes paint their text across the whole card and have NO
   *  separate ComfyUI title bar — suppress the standard header for them. */
  const isLabel = data.classType === "Label (rgthree)";
  /* rgthree Power Lora Loader renders its own Lora Stack body — skip the
   *  standard widget-body section for this classType. */
  const isPowerLoraLoader = data.classType === "Power Lora Loader (rgthree)";

  /* When the imported config carries an exact box size, the node is forced
   *  to those dimensions; the body flexes to the raw CONTENT height. */
  const hasSize = !!data.size;

  return (
    <div
      className="relative flex flex-col rounded-lg border shadow-[0_4px_20px_rgba(0,0,0,0.55)]"
      style={{
        // Width tracks ComfyUI's saved `size.w` when present; height is
        // content-driven (`auto`) so the card grows with its ports/widgets
        // and shrinks to the title bar when collapsed.
        width: hasSize ? data.size?.w : undefined,
        height: "auto",
        minWidth: hasSize ? data.size?.w : (entries.outputs.length > 0 ? 268 : 248),
        // R49: data.size.h is BODY CONTENT height; the outer div includes
        // the pinned NODE_TITLE_H title bar, so the floor is content + title.
        minHeight: isCollapsed ? NODE_TITLE_H : (hasSize ? (data.size?.h ?? 0) + NODE_TITLE_H : undefined),
        // No maxWidth cap — ComfyUI lets the user resize the node box freely.
        borderColor: palette.nodeBorder,
        // Mode (bypass/disabled) nodes tint via <FrostLayer> + real blur, so
        // the root is transparent (isolation keeps the frost contained).
        // Normal nodes keep a solid panel.
        isolation: "isolate",
        background: palette.modeColor ? "transparent" : palette.nodeBg,
        outline: selected ? "2px solid rgba(56,189,248,0.9)" : "none",
        outlineOffset: selected ? "2px" : undefined,
      }}
    >
      {palette.modeColor && palette.nodeMode !== 0 && <FrostLayer color={palette.modeColor} nodeMode={palette.nodeMode} />}
      {/* Header — pinned to NODE_TITLE_H (litegraph's NODE_TITLE_HEIGHT).
       *  Suppressed entirely for rgthree Label nodes (see `isLabel`). */}
      {!isLabel && (
        <FlowNodeHeader
          data={data}
          role={role}
          io={io}
          outputs={entries.outputs}
          isCollapsed={isCollapsed}
          onToggleCollapsed={() => setUserCollapsed((value) => !value)}
          palette={palette}
          displayTitle={displayTitle}
        />
      )}

      {/* Collapsed-mode handle anchors — decorative cylinders + invisible
       *  per-port Handles so wires never detach when toggling. */}
      {isCollapsed && (
        <FlowNodeCollapsedAnchors
          data={data}
          orderedEntries={entries.orderedEntries}
          outputs={entries.outputs}
        />
      )}

      {/* TOP PINS section — pure-connection inputs paired with outputs on
       *  shared rows.  Hidden when collapsed. */}
      {!isCollapsed && (entries.uniqueConnEntries.length > 0 || entries.outputs.length > 0) && (
        <FlowNodePinRows
          data={data}
          io={io}
          rawMeta={entries.rawMeta}
          uniqueConnEntries={entries.uniqueConnEntries}
          outputs={entries.outputs}
        />
      )}

      {/* Widget inputs section — knobs only.  Skipped for Power Lora
       *  Loader (renders its own stack) and hidden when collapsed. */}
      {!isCollapsed && entries.visibleWidgetEntries.length > 0 && !isPowerLoraLoader && (
        <FlowNodeWidgetRows
          data={data}
          io={io}
          rawMeta={entries.rawMeta}
          visibleWidgetEntries={entries.visibleWidgetEntries}
          hasSize={hasSize}
        />
      )}

      {/* rgthree Fast Groups Bypasser runtime body — one toggle row per
       *  group matching `matchTitle` (PATCH → rawJson write). */}
      {data.classType === "Fast Groups Bypasser (rgthree)" &&
        typeof data.properties?.matchTitle === "string" && (
          <RgthreeFastGroupsBypasserBody
            matchTitle={data.properties.matchTitle}
            groups={data.groups ?? []}
          />
        )}

      {/* rgthree Power Lora Loader runtime body — renders the lora stack
       *  from `widgets_values`.  Read-only. */}
      {data.classType === "Power Lora Loader (rgthree)" && (
        <RgthreePowerLoraLoaderBody widgets={data.rawWidgetValues ?? []} />
      )}

      {/* rgthree Label runtime body — paints the title in `properties`
       *  styles, filling the (header-less) card. */}
      {isLabel && (
        <RgthreeLabelBody text={data.title} properties={data.properties ?? {}} />
      )}

      {/* IMAGE-input inline thumbnail preview (R27/R28) — every rawInput
       *  carrying `preview: true` (LoadImage family) gets a ComfyUI-style
       *  preview at the node-body tail. */}
      {!isCollapsed && entries.imagePreviewEntries.length > 0 && (
        <div className="flex flex-col gap-2 px-2 pb-2 pt-1">
          {entries.imagePreviewEntries.map((entry) => (
            <WorkflowImagePreview key={entry.name} entry={entry} />
          ))}
        </div>
      )}

      {/* Default target handle for nodes with no inputs at all —
       *  unmapped/fallback edges need somewhere to anchor. */}
      {entries.uniqueConnEntries.length === 0 && entries.uniqueWidgetEntries.length === 0 && (
        <Handle
          type="target"
          position={Position.Left}
          id="__default_in"
          className="!h-2.5 !w-2.5 !border-2 !border-(--color-canvas) !bg-violet-400/80"
          style={{ left: -5 }}
        />
      )}

      {/* Generic source handle — always present but invisible so edges that
       *  can't resolve a precise "out:<name>" handle still anchor. */}
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        isConnectable={false}
        style={{ opacity: 0, right: -5 }}
      />

      {/* ComfyUI-native bottom-left footers: package source + frontend_only
       *  badge.  Both hidden when collapsed. */}
      {!isCollapsed && (
        <>
          <PackageFooter
            classType={data.classType}
            name={resolveNodePackage(data.classType, data.properties)}
          />
          {data.properties?.frontend_only === true && <FrontendOnlyBadge />}
        </>
      )}
      {/* 2026-08-24: 调试模式 — 非折叠时在 PackageFooter 下方渲染渲染链路
       *  模块标签（仅 debugMode 开启时由 DebugChainFooter 自行显示）。 */}
      {!isCollapsed && debugMode && (
        <DebugChainFooter modules={getWorkflowRenderChainModules(data.classType)} />
      )}
    </div>
  );
});
