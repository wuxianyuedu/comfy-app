"use client";
/* FlowNode header bar — extracted from workflow-node.tsx.
 * Collapse toggle + status dot + title + per-node IO checkbox + #id chip
 * + role badge.  Pinned to NODE_TITLE_H like ComfyUI's title bar. */
import { colorToRgba, NODE_TITLE_H } from "../workflow-utils";
import { IoCheckbox, NodeIdChip, type IOEditContextValue } from "./IOEditContext";
import type { WorkflowNodeData, IoRef } from "../workflow-types";
import type { NodePalette } from "./workflow-node-palette";

export interface FlowNodeRole {
  key: string;
  label: string;
  color: string;
  bg: string;
}

interface FlowNodeHeaderProps {
  data: WorkflowNodeData;
  role?: FlowNodeRole;
  io: IOEditContextValue | null;
  outputs: [string, string][];
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  palette: Pick<NodePalette, "headerBg" | "titleColor" | "dotBg">;
  displayTitle: string;
}

export function FlowNodeHeader({
  data,
  role,
  io,
  outputs,
  isCollapsed,
  onToggleCollapsed,
  palette,
  displayTitle,
}: FlowNodeHeaderProps) {
  return (
    <div
      className="flex shrink-0 items-center gap-2 rounded-t-lg px-2 text-xs"
      style={{
        height: NODE_TITLE_H,
        background: palette.headerBg,
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Collapse / expand toggle.  type="button" so future <form> submits
       *  don't toggle the chip; stopPropagation on click AND mousedown so
       *  the node-drag handler doesn't pick this up as drag-start.  The
       *  chevron points RIGHT when collapsed (click expands), rotates 90°
       *  clockwise to DOWN when expanded (click collapses). */}
      <button
        type="button"
        aria-label={isCollapsed ? "展开节点" : "折叠节点"}
        title={isCollapsed ? "展开" : "折叠"}
        onClick={(event) => {
          event.stopPropagation();
          onToggleCollapsed();
        }}
        onMouseDown={(event) => event.stopPropagation()}
        className="text-ink-soft hover:bg-subtle hover:text-ink-bright active:bg-surface-2 flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors e/15"
        style={{ pointerEvents: "auto" }}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          style={{
            transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)",
            transition: "transform 120ms ease",
          }}
        >
          <path
            d="M3.5 2 L7 5 L3.5 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <span
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{ background: palette.dotBg, boxShadow: `0 0 6px ${palette.dotBg}` }}
      />
      <span
        className="flex-1 truncate text-[12px] font-medium tracking-wide"
        style={{ color: palette.titleColor }}
        title={data.title && data.title !== displayTitle ? data.title : displayTitle}
      >
        {displayTitle}
      </span>
      {/* Per-node output checkbox — workflow outputs are identified by NODE
       * (comfy-cli execution dict is keyed by nodeId), NOT by output port,
       * so a single checkbox marks the WHOLE node as a workflow output. */}
      {io?.ioEditMode && outputs.length > 0 && (
        <IoCheckbox
          io={io}
          ioRef={{
            nodeId: data.nodeId,
            hostNodeId: data.hostNodeId,
            name: outputs[0]![0],
            kind: "output",
            direction: "output",
            // Prefer the rawJson output label / zh localized_name so the IO
            // preview shows the meaningful name (e.g. IMAGE_FINAL) instead
            // of the bare port key (`images`).
            label:
              data.rawOutputs?.[0]?.label ??
              data.rawOutputs?.[0]?.localized ??
              outputs[0]![0],
          } satisfies IoRef}
        />
      )}
      {/* Right-aligned `#<nodeId>` chip — click opens the NodeJsonPopover.
       * stopPropagation so drag / double-click drilldown don't fire. */}
      <NodeIdChip nodeId={data.nodeId} variant="node" />
      {role && (
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium"
          style={{ background: colorToRgba(role.color, 0.25), color: role.color }}
        >
          {role.label}
        </span>
      )}
    </div>
  );
}
