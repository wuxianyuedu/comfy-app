"use client";

/* Extracted SubgraphHeader — the purple identity title bar of a ComfyUI
 * subgraph wrapper node (previously inlined inside WorkflowSubgraphNode).
 * Collapse chevron + "S" badge + drill-in affordance + IO-edit checkbox +
 * node-id chip.  Same NODE_TITLE_H as the regular WorkflowNode header so
 * titled nodes line up on the grid. */
import { ExternalLink } from "lucide-react";
import { mixHex, NODE_TITLE_H } from "../workflow-utils";
import { IoCheckbox, NodeIdChip, type IOEditContextValue } from "./IOEditContext";

export interface SubgraphHeaderProps {
  title: string;
  nodeId: string;
  accent: string;
  isCollapsed: boolean;
  onToggle: () => void;
  onEnter?: () => void;
  io?: IOEditContextValue;
  /** First output entry (already label-resolved) used by the per-node
   *  output checkbox.  Pass null when the subgraph exposes no outputs. */
  outputRef?: { name: string; label: string } | null;
}

export function SubgraphHeader({
  title,
  nodeId,
  accent,
  isCollapsed,
  onToggle,
  onEnter,
  io,
  outputRef,
}: SubgraphHeaderProps) {
  return (
    <div
      className="flex shrink-0 items-center gap-2 rounded-t-lg px-2 text-xs"
      style={{
        height: NODE_TITLE_H,
        background: mixHex("#16161E", accent, 0.2),
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Collapse / expand toggle. Same chevron as
       *  WorkflowNode's; sits on the top-left of the header.  stopPropagation
       *  on both click and pointer-down so ReactFlow's drag handler
       *  doesn't pick it up as a node-drag start, AND so the
       *  surrounding `onDoubleClick` (drill-down) doesn't fire after
       *  a double-click that began here. */}
      <button
        type="button"
        aria-label={isCollapsed ? "展开子图" : "折叠子图"}
        title={isCollapsed ? "展开" : "折叠"}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
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
        className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded text-[9px] font-bold"
        style={{ background: accent, color: "var(--color-canvas)", boxShadow: `0 0 6px ${accent}` }}
        title="子工作流"
      >
        S
      </span>
      {/* 展开入口只保留右上角的 ExternalLink 钻入按钮——标题点击与
       *  回车聚焦不再触发进入子工作流（见 WorkflowSubgraphNode 双击移除
       *  同一决策），避免用户误触。标题保持纯文本，禁止选中。 */}
      <span
        className="min-w-0 flex-1 select-none truncate text-[12px] font-semibold tracking-wide"
        style={{ color: "#E2E2EA" }}
        title={title || "子工作流"}
      >
        {title || "子工作流"}
      </span>
      {/* PER-NODE output checkbox at the subgraph
       *  node's top-right.  Same rationale as WorkflowNode — outputs are identified
       *  by node, so the per-port checkbox is gone; one checkbox marks the
       *  whole node as a workflow output source. */}
      {io?.ioEditMode && outputRef && (
        <IoCheckbox
          io={io}
          ioRef={{
            nodeId: String(nodeId),
            name: outputRef.name,
            kind: "output",
            direction: "output",
            // forward the subgraph wrapper's output label
            // (e.g. business `IMAGE_FINAL`) so it reaches the IO
            // preview unchanged.
            label: outputRef.label,
          }}
        />
      )}
      <NodeIdChip nodeId={String(nodeId)} variant="subgraph" />
      {onEnter && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onEnter();
          }}
          title="展开子工作流"
          /* bumped from h-4 w-4 (16×16) to h-6 w-6
           *  (24×24) — user feedback that the prior drill-in chip was
           *  too small a target on the 30px-tall title row.  24×24 is
           *  3px shy of NODE_TITLE_H so it still feels like an
           *  in-bar button (vs the 28-32px standalone chip look).
           *  Sits a step above the chevron collapse button's h-5 w-5
           *  to mark drill-in as the *primary* subgraph action. */
          className="ml-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] text-violet-700 dark:text-violet-200 transition-colors hover:bg-violet-500/30 hover:text-white"
        >
          <ExternalLink size={12} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
