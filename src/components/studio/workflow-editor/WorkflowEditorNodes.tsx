"use client";
/* Extracted node renderers + registries from wf-editor-inner.tsx:
 * WorkflowGroupNode / WorkflowIoPortNode / WorkflowNoteNode + shared constants +
 * workflowNodeTypes / workflowEdgeTypes. */
import React, { useMemo } from "react";
import { Handle, Position } from "@xyflow/react";
import { portColor } from "@/lib/comfyui/types";
import { renderMarkdown } from "@/lib/comfyui/markdown";
import { WorkflowEdge } from "@/components/studio/canvas/WorkflowEdge";
import { FlowNode } from "../canvas/WorkflowNode";
import { WorkflowSubgraphNode } from "../canvas/WorkflowSubgraphNode";
import type { WorkflowGroupData, WorkflowIoPortData, WorkflowNoteData } from "../workflow-types";
import { NODE_TITLE_H, lightenHex, hexToRgba, mixHex } from "../workflow-utils";

export const WorkflowGroupNode = React.memo(function WorkflowGroupNode({ data }: { data: WorkflowGroupData }) {
  /* title is now a "tab" inside the top-left corner of the
   *  frame (was floating ABOVE the box at `top-[-16px]` — looked detached
   *  and competed with adjacent note headers).  The tab's bg picks up
   *  the group colour at 0.12 alpha so it visually anchors to its
   *  parent frame; the body fill drops to 0.04 so internal nodes
   *  remain the visual focus.
   *
   *  user feedback — 0.12 alpha was too washed out
   *  against the `#0a0a0f` canvas, "Step2 · Image size" tab barely
   *  contrasted with the surrounding wireframe and looked almost
   *  transparent.  Bumped tab to 0.30 — clearly readable while still
   *  feeling like a light "tab chip" attached to the frame edge (vs
   *  the full WorkflowNote title bar at 0.65 mix which would feel like a
   *  separate card).
   *
   *  same complaint extended to the FRAME BODY
   *  "红框处的背景也很透明" (top-right of group interior).  Body was
   *  at 0.04 (effectively invisible against the dark canvas grid).
   *  Bumped to 0.12 so the group's spatial boundary is visible at a
   *  glance, but still 2.5× lighter than the 0.30 tab so the title
   *  remains the visual anchor and internal nodes aren't drowned by
   *  the tint. */
  const fill = hexToRgba(data.color, 0.12);
  const border = hexToRgba(data.color, 0.55);
  const titleBg = hexToRgba(data.color, 0.30);
  const titleCol = lightenHex(data.color, 0.4);
  const draggable = !!data.draggable;
  return (
    <div
      className={"relative h-full w-full rounded-md " + (draggable ? "cursor-move" : "")}
      style={{
        background: fill,
        border: `1.5px solid ${border}`,
        pointerEvents: draggable ? "auto" : "none",
      }}
    >
      {data.title ? (
        <div
          className="absolute top-0 left-2 rounded-b px-1.5 py-[1px] text-[11px] font-semibold leading-tight"
          style={{
            color: titleCol,
            background: titleBg,
            /* Soften the title tab into the frame edge with a 1px
             *  side/bottom divider that picks up the border colour at
             *  0.5 alpha — keeps the tab visually attached to the
             *  frame without an extra hard outline. */
            boxShadow: `inset 0 -1px 0 ${hexToRgba(data.color, 0.5)}, inset -1px 0 0 ${hexToRgba(data.color, 0.5)}`,
          }}
        >
          {data.title}
        </div>
      ) : null}
    </div>
  );
});

/* ── IO boundary port node (late v3) ──
 * Compact label-only rendering for nodes sitting on a subgraph's INPUTS
 * or OUTPUTS boundary (i.e. nodes whose input is fed by the -10 sentinel
 * or whose output is consumed by the -20 sentinel).  Reference image:
 * the user wants these boundary nodes drawn as small label rows on the
 * LEFT (inputs) / RIGHT (outputs) of the inner canvas — no card chrome,
 * no title bar, no outputs strip — instead of the current "full FlowNode
 * scattered across canvas" behaviour.
 *
 * Visual contract:
 *   - No background card, no border.  Just label text + handle dot.
 *   - Width ~110 px (long enough for typical port names; capped at 200
 *     so a single "thisIsAnExtremelyLongWrapperInputName" doesn't blow
 *     out the column).
 *   - INPUT variant: handle on LEFT (sentinel -10 wire enters here).
 *   - OUTPUT variant: handle on RIGHT (sentinel -20 wire exits here).
 *   - Value column rendered in amber tabular-nums when present (the
 *     wrapper input's default value, e.g. seed `41`).  Matches the
 *     reference screenshot's "noise_seed  41  ▶" row styling.
 *   - `parentNodeTitle` shown in `title` attribute as tooltip so users
 *     can still identify the underlying node when hovering. */
export const IO_PORT_WIDTH = 160;
export const IO_PORT_HEIGHT = 28;
export const PORT_ROW_GAP = 4;
/** Horizontal padding applied inside the wfGroup around the wfIoPort
 *  column.  Keeps the label text from kissing the purple border. */
export const GROUP_PAD_X = 10;
/** Vertical padding at the top of a wfGroup — leaves room for the -top-16
 *  title chip (rendered at `top-[-16px]` above the box, taking ~18 px). */
export const GROUP_TITLE_BAR = 24;
/** Vertical padding at the bottom of a wfGroup. */
export const GROUP_PAD_Y_BOTTOM = 10;
/** Border + title-chip colour for the INPUTS / OUTPUTS wfGroups wrapping
 *  the boundary pins (late). A muted purple so the group
 *  frames read clearly against the dark `#0a0a0f` canvas while still
 *  staying distinct from the inner FlowNode / WorkflowSubgraphNode cards. */
export const GROUP_RAIL_COLOR = "#a855f7";

export const WorkflowIoPortNode = React.memo(function WorkflowIoPortNode({ data }: { data: WorkflowIoPortData }) {
  const isInput = data.direction === "input";
  const isBoth = data.direction === "both";
  /* The handle dot colour tracks the port type, matching the row dot
   * convention used in the rest of the canvas.  Fall back to a neutral
   * white-ish dot when type is missing. */
  const dotColor = data.type ? portColor(data.type) : "#9ca3af";
  const rawValue = data.value;
  let valueStr: string | null = null;
  if (
    typeof rawValue === "string" ||
    typeof rawValue === "number" ||
    typeof rawValue === "boolean" ||
    typeof rawValue === "bigint"
  ) {
    valueStr = String(rawValue);
  } else if (rawValue !== null && rawValue !== undefined) {
    valueStr = JSON.stringify(rawValue);
  }
  /* Boundary pin entities (definitions.subgraphs[uid].inputs/outputs)
   * carry no inner-node title — they're the wrapper's exposed port
   * directly.  In that case `parentNodeTitle` is "" so the tooltip
   * collapses to just the port label + type. */
  const hoverLabel = data.parentNodeTitle
    ? `${data.parentNodeTitle} · ${data.title}`
    : data.title;
  return (
    <div
      /* late — input panels right-align their label so the
       *  name hugs the right-edge handle dot, matching the user-supplied
       *  reference (`noise_seed  ●`, `noise_seed 1  ●`, ...).  Output
       *  panels stay left-aligned so their label hugs the LEFT-edge
       *  handle dot (`● noise_seed`).  React Flow positions the Handle
       *  absolutely via the `Position` prop, so changing flex `justify-…`
       *  only moves the visible label/value — the dot stays anchored to
       *  its side of the wfGroup. */
      className={`relative flex items-center ${isInput ? "justify-end" : "justify-start"} gap-1 px-1.5 py-[1px] text-[10.5px] leading-[1.4] text-white/90`}
      style={{
        width: IO_PORT_WIDTH,
        background: "transparent",
        border: "none",
      }}
      title={`${hoverLabel}${data.type ? ` · ${data.type}` : ""}${valueStr ? ` · ${valueStr}` : ""}`}
    >
      {/* Boundary-pin signal model (flipped late):
          pins face the *centre* of the canvas so the wires run short and
          straight.  INPUT pin ("in") carries data INTO the subgraph
          (React Flow `type="source"` — it supplies the inner node's
          target handle), so its handle sits on the RIGHT edge of the
          label (toward the middle column).  OUTPUT pin ("out") accepts
          data flowing OUT of the subgraph (`type="target"`), so its
          handle sits on the LEFT edge of the label (also toward the
          middle column).  The "in" / "out" ids stay so the edges in
          `buildEdges` can resolve a stable handle name. */}
      {(!isInput || isBoth) ? (
        <Handle
          type="target"
          position={Position.Left}
          id="out"
          style={{ background: dotColor, left: -4 }}
        />
      ) : null}
      <span
        className="truncate font-medium"
        /* — "letter truncation" on the boundary-pin labels: at
         *  low canvas zoom the default browser text-rendering produces a
         *  soft, anti-aliased glyph that visually reads as a gap between
         *  characters ("s a m p l e s").  `geometricPrecision` + a tiny
         *  negative letter-spacing tightens the glyphs so they read as a
         *  single word at every zoom level.  We deliberately leave the
         *  font-family and `font-medium` alone — the 500 weight is the
         *  right optical weight for the column's 10.5 px size; bumping
         *  to 600 reads too heavy once the rendering is tightened. */
        style={{
          maxWidth: IO_PORT_WIDTH - (valueStr ? 56 : 24),
          textRendering: "geometricPrecision",
          letterSpacing: "-0.01em",
        }}
      >
        {data.title}
      </span>
      {valueStr ? (
        <span className="text-amber-300/90 font-mono text-[10px] tabular-nums shrink-0">
          {valueStr}
        </span>
      ) : null}
      {(isInput || isBoth) ? (
        <Handle
          type="source"
          position={Position.Right}
          id="in"
          style={{ background: dotColor, right: -4 }}
        />
      ) : null}
    </div>
  );
});

/* ── Note / MarkdownNote annotation node ──
 * ComfyUI's note widget renders two parts stacked vertically:
 *   1. **Title bar** — a coloured chip with a small dot icon and the
 *      resolved title (either an explicit `title` property or the first
 *      `# Heading` line of the body).
 *   2. **Body** — the markdown text wrapped to the note's width with the
 *      surrounding bg colour.
 * Notes are draggable (the whole node acts as a drag handle) so users can
 * reposition annotations freely; the markdown body still renders links/scroll
 * without blocking the underlying graph where the note doesn't cover it. */
export const WorkflowNoteNode = React.memo(function WorkflowNoteNode({ data }: { data: WorkflowNoteData }) {
  /* Note background is fully OPAQUE — a baked tint of `data.color` into the
   *  dark canvas.  The base colour matters: the canvas itself is `#0a0a0f`
   *  (rgb 10,10,15).  Using the same base for the note body produced a
   *  computed bg of ~rgb(22,18,19) for a dark note colour like `#432` —
   *  only ~12 RGB units above the canvas, so the note visually dissolved
   *  into the background and only the React Flow selection ring was
   *  visible.  Bumping the base to `#22222c` (rgb 34,34,44) guarantees a
   *  ~25-unit contrast against the canvas for ANY note colour, so even
   *  the darkest note (`#432`) is now clearly outlined.
   *
   *  Visibility at low zoom: for wide workflows like the DaSiWa Wan 2.2
   *  template (130 nodes, viewport fitView lands at scale ~0.15), the
   *  note bbox collapses to ~5–15 px on-screen.  A 1.5 px solid border
   *  is barely a pixel there.  So we also paint a strong outer halo
   *  (boxShadow + 4 px ring) so the user can still *count* the 17 notes
   *  by their colour rings even when the text is illegible, plus a high
   *  z-index so notes float above ordinary nodes and aren't hidden
   *  behind groups. */
  const bg = mixHex("#22222c", data.color, 0.20);
  const border = mixHex("#22222c", data.color, 0.65);
  const titleBg = mixHex("#22222c", data.color, 0.65);
  const titleText = lightenHex(data.color, 0.7);
  /* Render the body markdown once per render.  The renderer is XSS-safe
   * (input is HTML-escaped, hrefs go through a URL allow-list). */
  const html = useMemo(() => renderMarkdown(data.text), [data.text]);
  return (
    <div
      className="relative z-5 flex h-full w-full cursor-move flex-col overflow-hidden rounded-md"
      style={{
        background: bg,
        border: `2.5px solid ${border}`,
        boxShadow:
          `0 0 0 4px ${border}55, ` +       /* 33 % alpha outer ring */
          `0 0 14px 2px ${border}33, ` +     /* soft colour glow */
          `0 8px 18px rgba(0,0,0,0.55)`,     /* drop shadow */
      }}
    >
      {data.title && (
        /* Same NODE_TITLE_H as FlowNode / WorkflowSubgraphNode.  The wrapper node's
         *  React Flow height already adds this bar on top of the raw
         *  `size[1]` body box (see the noteNodes builder), so pinning the
         *  height here is what keeps the markdown body at exactly the
         *  authored size instead of losing a title bar's worth of rows. */
        <div
          className="flex shrink-0 items-center gap-1.5 px-2.5 text-[11.5px] font-bold leading-tight"
          style={{
            height: NODE_TITLE_H,
            background: titleBg,
            borderBottom: `1.5px solid ${border}`,
            color: titleText,
            textShadow: `0 0 6px ${titleText}66`,
          }}
        >
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ background: titleText, boxShadow: `0 0 6px ${titleText}` }}
          />
          <span className="truncate" title={data.title}>
            Note: {data.title}
          </span>
        </div>
      )}
      <div
        className="wf-markdown min-h-0 flex-1 overflow-auto p-2 text-[11px]"
        style={{ color: "#e6e6ea", lineHeight: 1.5 }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
});

/* ── Subgraph wrapper node (ComfyUI extension display node) ──
 * ComfyUI's subgraph instances serialise with class_type === a UUID and
 * a synthetic set of inputs from the inner graph's *exposed* ports
 * (`proxyWidgets`).  Each input carries a `localized_name` Chinese label
 * (e.g. "正面提示词") and a widget name (English, e.g. "text").  This
 * component renders them as a compact form-like node so the user can see
 * what's inside without expanding the subgraph. */
/* 节点类型注册表 = **工作流自身的图**：普通节点 / 备注 / 分组 / 子图封装 /
 *  子图边界口。这里**没有**「对外参数卡片」这一类：卡片会浮在图节点之上（`zIndex`
 *  比图节点高、贴着宿主节点左右各排一列）把工作流本身挡掉一片，且落点映射编辑
 *  已收敛到工作流库详情的「画布节点」页签（卡片列 + 连线层，见
 *  workflow-library/WorkflowParamCardColumn 与 WorkflowParamWires）。勾选 IO
 *  只写 workflowIO / paramMap，不再产生任何画布节点。 */
export const workflowNodeTypes = { wfNode: FlowNode, wfNote: WorkflowNoteNode, wfGroup: WorkflowGroupNode, wfSubgraph: WorkflowSubgraphNode, wfIoPort: WorkflowIoPortNode };
// Custom edge renderer — rounder bezier (curvature 0.85) + ComfyUI-style
// white hub dot at the curve midpoint.  Defined at module scope so React
// Flow doesn't re-register edgeTypes on every render.
export const workflowEdgeTypes = { default: WorkflowEdge };
