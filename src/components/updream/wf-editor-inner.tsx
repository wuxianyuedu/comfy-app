"use client";
/* Extracted WorkflowEditorInner (the inner editor that must live inside
 * ReactFlowProvider) plus the small WfGroupNode / WfIoPortNode / WfNoteNode
 * node renderers and the wfNodeTypes / wfEdgeTypes registries.
 * Originally inside WorkflowCanvasEditor.tsx. */
import React, { useCallback, useEffect, useMemo, useRef, useState, useContext } from "react";
import {
  ReactFlow, Background, BackgroundVariant, Controls, MiniMap,
  Handle, Position, useNodesState, useEdgesState, useReactFlow,
  useStore, type Node, type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  portColor, portLabel, inferInputType, inferOutputType, inferIsMultiline,
  edgeType, edgeTypeByInputName,
} from "@/lib/comfyui/types";
import { friendlyNodeTitle, friendlyInputName, friendlySubgraphLabel } from "@/lib/comfyui/node-titles";
import { renderMarkdown } from "@/lib/comfyui/markdown";
import { PackageFooter } from "@/components/workflow-canvas/nodes/PackageFooter";
import { getCustomNodePackage, refreshCustomNodes } from "@/config/customNodes";
import { DynamicWorkflowForm } from "@/components/updream/shared/DynamicWorkflowForm";
import { WfEdge } from "@/components/updream/WfEdge";
import { SourceModal } from "@/components/updream/SourceModal";
import { useToast } from "@/components/updream/Toast";
import { defaultInputValues, type WorkflowIOMap } from "@/components/updream/shared/workflow-io";
import type {
  WfNodeData, WfSubgraphData, WfGroupData, WfIoPortData, WfNoteData,
  RawInputMeta, RawOutputMeta, ComfyGraphNode, WorkflowDetail, WorkflowGroup,
  WorkflowIOParam, IoRef, IOEditContextValue, RgthreeGroupsContextValue,
  NodeJsonViewerRequest, NodeJsonViewerContextValue, RawMetaEntry,
} from "./wf-types";
import {
  inferOutputTypeAll, renderWidgetValue, valueCellColor, withAlpha,
  renderSubgraphWidgetValue, sanitizeComboLabel, resolveNodePackage,
  pseudoFrostPalette, NODE_TITLE_H, computeKahnLayout, buildEdges,
  buildInputSources, buildConnectedOutputs, inferSourceOutNames,
  computeGroupDepths, rectToAnchor, computePos, extractNoteTitle,
  isNoteType, colorToRgba, hexToRgba, lightenHex, parseHex, mixHex,
} from "./wf-utils";
import { Chip, FrontendOnlyBadge, RequiredSummary } from "./wf-chips";
import { useMiniMapJump } from "./shared/useMiniMapJump";
import { PseudoFrostLayer, NodeFrost } from "./wf-frost";
import { WfImagePreview, StringTextarea } from "./wf-image-preview";
import { CanvasGrid, ZoomIndicator, CanvasRulers } from "./wf-canvas-decorations";
import {
  useCanvasSettings,
  CanvasSettingsButton,
  CanvasSettingsPanel,
  isCustomCanvasSettings,
} from "./wf-canvas-settings";
import { GlobalStepLogPanel } from "./canvas/GlobalStepLogPanel";
import {
  IOEditContext, RgthreeGroupsContext, NodeJsonViewerContext,
  RgthreeGroupsProvider, NodeJsonViewerProvider, NodeJsonPopover,
  IoCheckbox, NodeIdChip,
} from "./wf-contexts";
import { WfNode, PORT_ROLES } from "./wf-node";
import { WfSubgraphNode } from "./wf-subgraph-node";
export function WfGroupNode({ data }: { data: WfGroupData }) {
  /* 2026-08-07: title is now a "tab" inside the top-left corner of the
   *  frame (was floating ABOVE the box at `-top-[16px]` — looked detached
   *  and competed with adjacent note headers).  The tab's bg picks up
   *  the group colour at 0.12 alpha so it visually anchors to its
   *  parent frame; the body fill drops to 0.04 so internal nodes
   *  remain the visual focus.
   *
   *  2026-08-11 (R29): user feedback — 0.12 alpha was too washed out
   *  against the `#0a0a0f` canvas, "Step2 · Image size" tab barely
   *  contrasted with the surrounding wireframe and looked almost
   *  transparent.  Bumped tab to 0.30 — clearly readable while still
   *  feeling like a light "tab chip" attached to the frame edge (vs
   *  the full WfNote title bar at 0.65 mix which would feel like a
   *  separate card).
   *
   *  2026-08-11 (R30): same complaint extended to the FRAME BODY —
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
}

/* ── IO boundary port node (2026-08-05 late v3) ──
 * Compact label-only rendering for nodes sitting on a subgraph's INPUTS
 * or OUTPUTS boundary (i.e. nodes whose input is fed by the -10 sentinel
 * or whose output is consumed by the -20 sentinel).  Reference image:
 * the user wants these boundary nodes drawn as small label rows on the
 * LEFT (inputs) / RIGHT (outputs) of the inner canvas — no card chrome,
 * no title bar, no outputs strip — instead of the current "full WfNode
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
 *  title chip (rendered at `-top-[16px]` above the box, taking ~18 px). */
export const GROUP_TITLE_BAR = 24;
/** Vertical padding at the bottom of a wfGroup. */
export const GROUP_PAD_Y_BOTTOM = 10;
/** Border + title-chip colour for the INPUTS / OUTPUTS wfGroups wrapping
 *  the boundary pins (2026-08-06 late).  A muted purple so the group
 *  frames read clearly against the dark `#0a0a0f` canvas while still
 *  staying distinct from the inner WfNode / WfSubgraphNode cards. */
export const GROUP_RAIL_COLOR = "#a855f7";

export function WfIoPortNode({ data }: { data: WfIoPortData }) {
  const isInput = data.direction === "input";
  const isBoth = data.direction === "both";
  /* The handle dot colour tracks the port type, matching the row dot
   * convention used in the rest of the canvas.  Fall back to a neutral
   * white-ish dot when type is missing. */
  const dotColor = data.type ? portColor(data.type) : "#9ca3af";
  const valueStr =
    data.value === undefined || data.value === null ? null : String(data.value);
  /* Boundary pin entities (definitions.subgraphs[uid].inputs/outputs)
   * carry no inner-node title — they're the wrapper's exposed port
   * directly.  In that case `parentNodeTitle` is "" so the tooltip
   * collapses to just the port label + type. */
  const hoverLabel = data.parentNodeTitle
    ? `${data.parentNodeTitle} · ${data.title}`
    : data.title;
  return (
    <div
      /* 2026-08-06 late — input panels right-align their label so the
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
      {/* Boundary-pin signal model (2026-08-06, flipped 2026-08-06 late):
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
        /* 2026-08-07 — "letter truncation" on the boundary-pin labels: at
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
}

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
export function WfNoteNode({ data }: { data: WfNoteData }) {
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
      className="relative z-[5] flex h-full w-full cursor-move flex-col overflow-hidden rounded-md"
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
        /* Same NODE_TITLE_H as WfNode / WfSubgraphNode.  The wrapper node's
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
        /* eslint-disable-next-line react/no-danger */
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

/* ── Subgraph wrapper node (ComfyUI extension display node) ──
 * ComfyUI's subgraph instances serialise with class_type === a UUID and
 * a synthetic set of inputs from the inner graph's *exposed* ports
 * (`proxyWidgets`).  Each input carries a `localized_name` Chinese label
 * (e.g. "正面提示词") and a widget name (English, e.g. "text").  This
 * component renders them as a compact form-like node so the user can see
 * what's inside without expanding the subgraph. */
export const wfNodeTypes = { wfNode: WfNode, wfNote: WfNoteNode, wfGroup: WfGroupNode, wfSubgraph: WfSubgraphNode, wfIoPort: WfIoPortNode };
// Custom edge renderer — rounder bezier (curvature 0.85) + ComfyUI-style
// white hub dot at the curve midpoint.  Defined at module scope so React
// Flow doesn't re-register edgeTypes on every render.
export const wfEdgeTypes = { default: WfEdge };

/* ── Canvas grid ──
 *  Two stacked native <Background> layers so the grid pans / zooms with
 *  the viewport (an earlier CSS-on-`.react-flow__pane` grid was static
 *  because the pane is the un-transformed interaction layer):
 *
 *    · minor — one line every GRID_CELL px  (1 cell)
 *    · major — one line every 10 cells, slightly thicker + brighter
 *
 *  Cell size = 10px canvas units so common node widths (e.g. a 230px
 *  MarkdownNote) line up cleanly on integer cell counts (23 cells),
 *  which makes "snap every N cells" meaningful instead of an odd fraction.
 *
 *  `BackgroundVariant.Lines` draws a full-height + full-width segment per
 *  pattern tile, so the tiles butt up into continuous orthogonal rules —
 *  not the `+` constellation an older comment in this file claimed.
 *
 *  Layer order matters: the major grid is rendered last so it paints over
 *  the minor one.  Only the minor layer carries `bgColor`; the major layer
 *  must stay `transparent` or it would blank out the layer beneath it.
 *
 *  Below ~0.65 zoom a 10px cell collapses to <6.5 screen px and the fine
 *  grid turns into noise, so its alpha fades out while the 10-cell major
 *  rules stay put and keep the canvas readable.  The selector returns an
 *  already-quantised alpha so panning/zooming only re-renders when the
 *  fade actually steps.
 *
 *  2026-08-11: user request — once the viewport is zoomed out to ≤ 60%
 *  the entire grid (minor + major) is hidden.  At that scale the canvas
 *  reads as a whole-workflow map and the grid just adds clutter, so we
 *  short-circuit and render nothing.  Note `<ReactFlow>` minZoom is 0.15
 *  (see ZoomIndicator), so we never hit a zoom where we'd still want the
 *  grid but it's missing for technical reasons. */
export function WorkflowEditorInner({
  workflowId,
  onClose,
  onSave,
}: {
  workflowId: string;
  onClose: () => void;
  onSave?: () => void;
}) {
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [paramMap, setParamMap] = useState<Record<string, string>>({});
  const [workflowIO, setWorkflowIO] = useState<Record<string, WorkflowIOParam>>({});
  const [ioEditMode, setIoEditMode] = useState(false);
  const toast = useToast();
  /* Side-panel toggle for the IO preview (2026-08-09).  Independent of
   *  `ioEditMode` so the author can A/B toggle before vs. after opening
   *  the panel.  Default closed — the canvas already gives a busy
   *  experience and we don't want to pile on a second floating panel
   *  before the user asks for one. */
  const [ioPreviewOpen, setIoPreviewOpen] = useState(false);
  /* R-ardot95 (2026-08-17): canvas-settings panel state — sits next to
   *  ioPreviewOpen / viewJsonOpen as a sibling overlay opened by a gear
   *  button in the canvas chrome.  Default closed. */
  const [canvasSettingsOpen, setCanvasSettingsOpen] = useState(false);
  /* The settings hook owns a single localStorage-backed settings object
   *  that drives CanvasGrid / CanvasRulers / ZoomIndicator / MiniMap.
   *  Until `hydrated` is true we render with defaults so SSR / first
   *  paint don't briefly show saved values before the read completes. */
  const { settings: canvasSettings, update: updateCanvasSetting, reset: resetCanvasSettings, hydrated: canvasSettingsHydrated } = useCanvasSettings();
  /* 2026-08-11 R40: 画布顶部「📋 查看 JSON」按钮 — 复用 SourceModal。
   *  数据直接从 `detail.graph/rawJson` 读 (缓存里的磁盘已保存版本)，
   *  无需网络请求；当前未保存的画布修改不在内，文案里写明。 */
  const [viewJsonOpen, setViewJsonOpen] = useState(false);
  const toggleIO = useCallback((ref: IoRef) => {
    const key = `${ref.nodeId}::${ref.kind}::${ref.name}`;
    setWorkflowIO((prev) => {
      if (prev[key]) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return {
        ...prev,
        [key]: {
          direction: ref.direction,
          kind: ref.kind,
          nodeId: ref.nodeId,
          name: ref.name,
          label: ref.label,
        },
      };
    });
  }, []);
  /* Rename a checked pin's display label.  We DO NOT clobber the label
   * when the user submits an empty string (e.g. accidentally hit delete)
   * — falling back to `e.name` keeps the form functional and lets the
   * author clear the override on purpose without producing an empty UI. */
  const setIOLabel = useCallback((key: string, label: string) => {
    const next = label.trim();
    setWorkflowIO((prev) => {
      const cur = prev[key];
      if (!cur) return prev;
      if (!next) return { ...prev, [key]: { ...cur, label: undefined } };
      if (next === cur.label) return prev;
      return { ...prev, [key]: { ...cur, label: next } };
    });
  }, []);
  /* 2026-08-11 (R57): flip `required` on a checked widget input.  Symmetric
   *  with setIOLabel — touches `workflowIO[key].required` on the same
   *  record, ships on next PATCH.  No-op when the key isn't currently
   *  checked (required only exists for checked pins). */
  const toggleIORequired = useCallback((key: string) => {
    setWorkflowIO((prev) => {
      const cur = prev[key];
      if (!cur) return prev;
      if (cur.kind !== "widget") return prev; /* only widget inputs are tunable */
      return { ...prev, [key]: { ...cur, required: !cur.required } };
    });
  }, []);
  /* 2026-08-17 R94: write author overrides of default values.  Mirrors
   *  setIOLabel / toggleIORequired — only touches `workflowIO[key].value`
   *  and ships on the next PATCH.  Only widget inputs (kind === "widget")
   *  carry an editable value; connection-only pins are skipped.  Called
   *  with the DynamicWorkflowForm's full `{ ioKey: value }` map on every
   *  edit so each key lands on the right pin. */
  const setIOValues = useCallback((next: Record<string, unknown>) => {
    setWorkflowIO((prev) => {
      const nextMap = { ...prev };
      for (const [ioKey, v] of Object.entries(next)) {
        const cur = nextMap[ioKey];
        if (!cur || cur.kind !== "widget") continue;
        nextMap[ioKey] = { ...cur, value: v };
      }
      return nextMap;
    });
  }, []);
  /* R94: clear every author override so all widget pins fall back to the
   *  workflow's graph-derived default.  Wired to the preview panel's
   *  「恢复默认」 action. */
  const resetIOPreviewValues = useCallback(() => {
    setWorkflowIO((prev) => {
      const nextMap: Record<string, WorkflowIOParam> = {};
      let changed = false;
      for (const [k, e] of Object.entries(prev)) {
        if (e && e.kind === "widget" && e.value !== undefined) {
          const { value, ...rest } = e;
          nextMap[k] = rest as WorkflowIOParam;
          changed = true;
        } else {
          nextMap[k] = e;
        }
      }
      return changed ? nextMap : prev;
    });
  }, []);
  /* R-ardot35 (2026-08-15): drag-to-reorder for the IO-edit preview
   *  panel.  Moves `fromKey` so that it sits immediately before
   *  `beforeKey` in the rendered list (use `null` to send it to the
   *  end).  Re-numbers every entry in the same group (wire / widget /
   *  output) so the next render — anywhere `splitWorkflowIO` is
   *  consumed — reflects the new order, and immediately PATCHes the
   *  server so closing / reopening the editor doesn't reset the
   *  arrangement.
   *
   *  The number assignment is intentionally NOT sparse (1, 2, 3, …)
   *  even though that's the simplest scheme: leaving gaps of 1000
   *  would let the user insert "in between" without rewriting every
   *  other entry, but `splitWorkflowIO` would then sort numerically,
   *  not by gap, and the visual mental model ("the 4th row") would
   *  drift.  Picking dense integers keeps a one-to-one mapping between
   *  visual position and `displayOrder` value, which makes future
   *  debugging (grep the PATCH body) trivial. */
  const reorderIO = useCallback((fromKey: string, beforeKey: string | null) => {
    if (fromKey === beforeKey) return;
    setWorkflowIO((prev) => {
      const fromEntry = prev[fromKey];
      if (!fromEntry) return prev;
      /* Group the moved entry belongs to — only items in the SAME
       *  group get renumbered, so wire/widget/output stay segregated
       *  in the rendered list. */
      const groupOf = (e: WorkflowIOParam): "wire" | "widget" | "output" => {
        if (e.direction === "output") return "output";
        return e.kind === "widget" ? "widget" : "wire";
      };
      const movingGroup = groupOf(fromEntry);
      const ordered = Object.entries(prev)
        .map(([k, e]) => ({ k, e }))
        .filter(({ e }) => e && groupOf(e) === movingGroup)
        .sort((a, b) => {
          const ao = a.e.displayOrder;
          const bo = b.e.displayOrder;
          if (ao === bo) return 0;
          if (ao === undefined) return 1;
          if (bo === undefined) return -1;
          return ao - bo;
        });
      /* Strip the moved entry from the ordered list and decide its new
       *  slot.  beforeKey=null → append; otherwise insert at the slot
       *  immediately preceding the matching key. */
      const without = ordered.filter(({ k }) => k !== fromKey);
      let targetIdx = without.length;
      if (beforeKey) {
        const i = without.findIndex(({ k }) => k === beforeKey);
        if (i >= 0) targetIdx = i;
      }
      without.splice(targetIdx, 0, { k: fromKey, e: fromEntry });
      /* Re-stamp every member of the group with dense 1-based
       *  displayOrder so the next render shows the new layout and any
       *  newly toggled pin (displayOrder=undefined) cleanly lands at
       *  the tail via splitWorkflowIO's +Infinity fallback. */
      const renumbered: Record<string, WorkflowIOParam> = { ...prev };
      for (let i = 0; i < without.length; i++) {
        const { k, e } = without[i];
        renumbered[k] = { ...e, displayOrder: i + 1 };
      }
      /* Ship to the server alongside the rest of the IO map.  This
       *  reuses the same fetch shape that toggleIO / setIOLabel
       *  already trigger via onSave, so the payload contract is
       *  identical from the server's perspective.  We deliberately do
       *  NOT surface a toast on success — reorders are frequent and
       *  don't need confirmation, and a toast on every drag would
       *  drown the toast slot.  Errors still bubble up so a network
       *  blip doesn't silently lose the change. */
      fetch(`/api/workflows/${workflowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowIO: renumbered }),
      }).catch(() => {});
      return renumbered;
    });
  }, [workflowId]);
  const [error, setError] = useState("");
  /* Sync the on-disk custom-node manifest into the in-memory registry once
   *  on mount so <PackageFooter> can resolve every node's `classType` →
   *  package mapping without each node firing its own /api fetch. The
   *  manifest is already cached server-side after the first parse, so
   *  this is one cheap roundtrip per page open. */
  useEffect(() => {
    refreshCustomNodes().catch(() => {});
  }, []);
  /* Subgraph navigation stack.  Empty while viewing the top-level workflow.
   *  Each entry is {uid, name} for breadcrumb display; clicking a crumb
   *  pops back to that level. */
  const [subgraphStack, setSubgraphStack] = useState<{ uid: string; name: string }[]>([]);
  /* The root workflow's display name is captured on the FIRST top-level
   *  fetch and then preserved across subgraph navigation, so the breadcrumb
   *  can always render "<root workflow> / <subgraph 1> / <subgraph 2> …".
   *  Without this, drilling into a subgraph rewrites the leading crumb to
   *  the subgraph's own name (since `detail.name` becomes the subgraph's
   *  title), producing a confusing "subA / subA" duplicate and triggering
   *  the recursive "click subgraph name → enter another layer" bug. */
  const [rootWorkflowName, setRootWorkflowName] = useState<string>("");
  const [subgraphLoading, setSubgraphLoading] = useState(false);

  /* 2026-08-11 R42: 子工作流「查看 JSON」要支持 RAW。
   *
   * 后端 `/api/workflows/:id/subgraph?uid=...` 返回的 sub-detail 只携带
   * sub 自己的 API graph (`graph`)，**不带 rawJson** —— 因为 sub 的
   * LiteGraph json 物理上存放在父 `rawJson.definitions.subgraphs[uid]`
   * 里，没有独立的"sub rawJson"概念。
   *
   * 所以我们在 drill-in 进 sub 的那一瞬把**父 rawJson + 当前 sub uid**
   * 缓存进 `subgraphRawContext`；SourceModal 在 sub 视图下用这个 state
   * 拼出 `parentRawJson.definitions.subgraphs[subUid]` 喂给 JsonViewer。
   * 顶层 detail 视图下此 state 为 null，SourceModal 直接读 `detail.rawJson`。
   *
   * 为什么不把 sub rawJson 直接灌到 `detail.rawJson`?
   *  - detail 是 WorkflowDetail 形状，rawJson 字段语义是"该工作流本身的
   *    原始格式"，sub 视图下注入父 rawJson 会污染 detail 语义；
   *  - 保留 `subgraphRawContext` 这个独立槽位，fetchDetail 内部清/设，
   *    配合 `detailRef` 抓"drill-in 那一瞬的父 detail"，时序最稳。
   */
  const [subgraphRawContext, setSubgraphRawContext] = useState<{
    parentRawJson: unknown;
    subUid: string;
  } | null>(null);
  /* 同步 detail 进 ref —— fetchDetail 是 useCallback, 内部读
   * `detail?.rawJson` 时, 因为 closure, 拿到的可能是 stale detail
   * (drill-in 之后 setDetail 已经把 detail 换成 sub 的)。detailRef
   * 总是反映**当前**的 detail, 配合 fetchDetail 顶部读取, 能稳定
   * 拿到"drill-in 那一瞬还是父 detail"的 rawJson。 */
  const detailRef = useRef<WorkflowDetail | null>(null);
  useEffect(() => {
    detailRef.current = detail;
  }, [detail]);

  /* 2026-08-11 R42 → R43: 喂给 SourceModal 的数据派生。
   *  - 顶层 detail: 直接读 `detail.graph / detail.rawJson`
   *  - sub 视图 (subgraphStack.length > 0): 优先从 `subgraphRawContext` 缓存的
   *    父 rawJson 中切 `definitions.subgraphs[subUid]` 作为 sub 的 RAW;
   *    若父不是 RAW 导入 (无 sub-definition)，**fallback 用 `detail.graph`
   *    本身** — sub 自己的 API graph 本身就是 LiteGraph JSON 节点视图，
   *    不应该让 modal 出现"无 RAW"的死角。
   *  - `isSubgraph` + `isSubRawFromParent` 传给 modal 用于文案区分
   *    "父级真切片 / sub API 派生 / API-only 顶层" 三种情况。 */
  const sourceModalData = useMemo<{
    name: string;
    graph: unknown;
    rawJson: unknown;
    isSubgraph: boolean;
    /* 仅当 isSubgraph=true 时有意义: true=从父 rawJson 切的真 sub-definition;
     * false=从 sub API graph 派生 fallback */
    isSubRawFromParent: boolean;
  } | null>(() => {
    if (!detail) return null;
    const isSubgraphView = subgraphStack.length > 0;
    if (!isSubgraphView) {
      return {
        name: detail.name ?? "工作流",
        graph: detail.graph,
        rawJson: detail.rawJson ?? null,
        isSubgraph: false,
        isSubRawFromParent: false,
      };
    }
    // sub 视图: 优先切父 rawJson; 兜底用 sub 自己的 graph
    const ctx = subgraphRawContext;
    if (ctx) {
      const subs = (ctx.parentRawJson as { definitions?: { subgraphs?: Record<string, unknown> } } | null)
        ?.definitions?.subgraphs;
      if (subs && Object.prototype.hasOwnProperty.call(subs, ctx.subUid)) {
        return {
          name: detail.name ?? "工作流",
          graph: detail.graph,
          rawJson: subs[ctx.subUid],
          isSubgraph: true,
          isSubRawFromParent: true,
        };
      }
    }
    // fallback: 把 sub 自己的 API 当 RAW —— sub 本身就是 LiteGraph JSON
    return {
      name: detail.name ?? "工作流",
      graph: detail.graph,
      rawJson: detail.graph,
      isSubgraph: true,
      isSubRawFromParent: false,
    };
  }, [detail, subgraphStack.length, subgraphRawContext]);

  /* After fitView completes, lock the viewport onto the middle (real
   *  WfNode / WfSubgraph / wfNote / wfGroup) nodes.  We (a) run
   *  rf.fitView WITHOUT passing a `nodes` filter — that option was
   *  unreliable across React Flow v12 minor versions and made the
   *  viewport randomly include stray boundary pins, (b) immediately
   *  compute the middle-node bbox ourselves and call setViewport so
   *  the centre is guaranteed to land on the real workflow regardless
   *  of what the three-block rail layout did to the canvas bounds.
   *  Also enforce a *minimum* zoom of 0.35 — wide workflows (130+ nodes,
   *  bbox ~7000 px vs a 1280 px viewport) otherwise auto-shrink to
   *  ~0.15x where every note collapses to ~5–15 px and becomes
   *  indistinguishable from background.  Re-runs on subgraph
   *  navigation so a cramped child graph still fits. */
  const rf = useReactFlow();
  const fittedRef = useRef(false);
  /* R-ardot106 (2026-08-17): MiniMap → main-viewport single-click jump.
   *  Pairs with <MiniMap pannable zoomable onClick={onMiniMapJump} /> below. */
  const onMiniMapJump = useMiniMapJump(rf);

  /* 2026-08-06 R3: monotonically-increasing token so background fetches
   *  can't overwrite the current fetchDetail's commit.  Bumped inside
   *  fetchDetail; whichever invocation holds the highest number
   *  when its response arrives is the one allowed to write to state.
   *  This guarantees the cacheKey upgrade never sits behind "background
   *  fetch silently updates storage while UI remains stale". */
  const latestRequestIdRef = useRef(0);

  /* Centre the viewport on the *middle* workflow nodes only (never the
   *  left/right boundary-pin rails / their wfGroup frames — see below).
   *  Reads the live node list from React Flow's store (`rf.getNodes()`)
   *  instead of the React `nodes` closure, so it can be called both from
   *  the auto-fit effect on subgraph entry AND from the manual "重置布局"
   *  (reset layout) button after the nodes have been re-laid-out by the
   *  sync effect — no stale-closure / render-order races. */
  const fitToMiddle = useCallback(() => {
    const all = rf.getNodes();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let hasMiddle = false;
    for (const n of all) {
      // Skip boundary-pin labels and their wfGroup frames — they live in
      // the left/right rails (minX - RAIL_GAP) and would otherwise pull
      // the centre leftward and shrink the workflow to a sliver.
      if (n.type === "wfIoPort") continue;
      if (String(n.id).startsWith("grp:bpin:")) continue;
      hasMiddle = true;
      const w = (n as any).measured?.width ?? (n as any).width ?? 240;
      const h = (n as any).measured?.height ?? (n as any).height ?? 80;
      const x = n.position.x;
      const y = n.position.y;
      if (x < minX) minX = x;
      if (x + w > maxX) maxX = x + w;
      if (y < minY) minY = y;
      if (y + h > maxY) maxY = y + h;
    }
    if (!hasMiddle || !Number.isFinite(minX)) {
      rf.fitView({ padding: 0.10, duration: 0 });
      return;
    }
    const bboxW = Math.max(1, maxX - minX);
    const bboxH = Math.max(1, maxY - minY);
    const containerW = document.querySelector(".react-flow")?.clientWidth ?? 1200;
    const containerH = document.querySelector(".react-flow")?.clientHeight ?? 700;
    // Zoom that fully encloses the middle bbox with ~12% margin on each
    // side, floored at 0.35 so wide workflows stay legible.
    let zoom = Math.min((containerW * 0.76) / bboxW, (containerH * 0.76) / bboxH, 1.5);
    if (zoom < 0.35) zoom = 0.35;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    rf.setViewport(
      { x: containerW / 2 - zoom * centerX, y: containerH / 2 - zoom * centerY, zoom },
      { duration: 0 }
    );
  }, [rf]);

  useEffect(() => {
    if (nodes.length === 0) return;
    fittedRef.current = false;
    // Defer one frame so ReactFlow has measured the viewport and laid
    // nodes out before we fit.
    const raf = requestAnimationFrame(() => {
      fitToMiddle();
      fittedRef.current = true;
      // One final settle (some React Flow minor versions re-trigger
      // their own fitView once measurements resolve a frame later; this
      // reasserts ours).
      requestAnimationFrame(() => fitToMiddle());
    });
    return () => cancelAnimationFrame(raf);
  }, [rf, detail?.id, fitToMiddle]);

  /* Fetch workflow detail (or subgraph detail when navigating into one).
   * Performance: a per-session (sessionStorage) cache keyed by URL lets a
   * re-opened canvas paint instantly without waiting on the network. The
   * first open still benefits from the server-side LRU cache (see
   * src/lib/server-cache.ts). On a cache hit we render immediately and then
   * refresh the stored copy in the background without disturbing the UI. */
  const pushSubgraphStack = useCallback(
    (uid: string, name: string) => {
      setSubgraphStack((prev) => [...prev, { uid, name }]);
    },
    []
  );

  const fetchDetail = useCallback(
    async (opts?: { subgraphUid?: string; parentTitle?: string; bust?: boolean }) => {
      const url = opts?.subgraphUid
        ? `/api/workflows/${workflowId}/subgraph?uid=${encodeURIComponent(opts.subgraphUid)}`
        : `/api/workflows/${workflowId}`;

      // 2026-08-11 R42: 维护 subgraphRawContext
      //  - drill-in (subgraphUid 有值): 缓存父 rawJson + sub uid, 供
      //    SourceModal 在 sub 视图下从父 rawJson.definitions.subgraphs[uid]
      //    切出 sub 自己的 LiteGraph json 当 RAW 渲染。
      //    * 用 detailRef 而不是 closure 里的 detail, 避免 stale;
      //      第一次 drill-in 触发时 detail 还是父的, setDetail 还没生效。
      //    * 同一 subUid 重复调用 (比如 background refresh) 不要覆盖
      //      已捕获的父 rawJson, 防止 race 把正确的父 rawJson 洗掉。
      //  - 顶层 detail (无 subgraphUid): 清空 subgraphRawContext,
      //    回到 "SourceModal 读 detail.rawJson" 的常规路径。
      if (opts?.subgraphUid) {
        const targetUid = opts.subgraphUid;
        setSubgraphRawContext((prev) =>
          prev && prev.subUid === targetUid
            ? prev
            : { parentRawJson: detailRef.current?.rawJson ?? null, subUid: targetUid }
        );
      } else {
        setSubgraphRawContext(null);
      }
      //     architecture (2026-08-06 v2).  v3 (2026-08-06) added the
      //     `isBoundary` stamp on rawInputs/rawOutputs so WfNode knows
      //     which handles exist for boundary wires (input -10 sentinel
      //     / output -20 sentinel) — without the flag the "no wire ⇒
      //     no dot" rule hides the Handle and React Flow silently drops
      //     the matching boundary edges.
      //     v4 (2026-08-06 late) invalidates any v3 entries cached BEFORE
      //     the server's `.next` was actually rebuilt with that change
      //     (Turbopack doesn't always hot-reload route.ts; without a
      //     cache bump the UI keeps reading pre-isBoundary data forever,
      //     even after a hard refresh).
      //     On ANY further detail-shape change bump this version so
      //     stale sessionStorage entries can't mask new behaviour for
      //     5 min — remember that Ctrl+Shift+R does NOT clear
      //     sessionStorage, only closing the tab does.  v5 (2026-08-06)
      //     is a defensive bump: even though the *response shape* didn't
      //     change, the runtime now reads `data.boundaryOutputs` /
      //     `data.boundaryInputs` sets — derived in initialNodes from
      // 2026-08-06 late (v6): wfIoPort boundary pins are now wrapped
      //     in two wfGroup rectangles ("grp:bpin:inputs" /
      //     "grp:bpin:outputs") with parentId + extent:"parent" on the
      //     children; the layout pass reads `positions["grp:bpin:…
      //     "]"` to honour a manually dragged column.  v5-cached
      //     `detail` had no such keys and would silently fall back to
      //     the rail-layout anchor on next paint, looking like the
      //     change "didn't take".  Bumping to v6 invalidates every old
      //     wfdetail:v5:* entry so the new boundary-group render kicks
      //     in immediately on next open.
      // 2026-08-06 (v7): the layout pass now anchors each rail at the
      //     raw pin.pos coords (sub.inputs[i].pos / sub.outputs[i].pos)
      //     instead of bbox-snapping every rail to the middle column's
      //     minY.  v6-cached detail already carries the raw coords (the
      //     raw subgraph endpoint has emitted them since this morning),
      //     but the LAYOUT DECISION was different — v6 would still pick
      //     the bbox fallback for workflows whose pin.pos is all-zero.
      //     v7 invalidates any stale sessionStorage v6 entry that
      //     matched the old layout decision so the new pin-anchored
      //     render kicks in immediately on next open.
      // 2026-08-06 16:29 → v8: input-pin wfIoPort children now sit at
      //     `relX = 2*GROUP_PAD_X` instead of `GROUP_PAD_X`, so their
      //     right edge anchors flush to the parent wfGroup's right
      //     border.  v7 cached entries would still render with the
      //     10-px inner gap and look like nothing changed.
      // 2026-08-06 16:50 → v9: top-level layout now requires
      //     `Object.keys(positions).length >= realNodes.length` to
      //     take the saved-positions branch.  A partial positions
      //     snapshot (e.g. 2/114 nodes) used to make 112 nodes fall
      //     through to `{padX, padY}` = (80, 80) and stack on top of
      //     each other, producing a broken main-graph render.  v9
      //     invalidates any stale v8 entry so the new guard takes
      //     effect on next open.
      /* 2026-08-06 终极缓存方案 R3：4 重保险
       *  ① SCHEMA fingerprint：cacheKey 嵌入了「route.ts 输出字段映射」指
       *     纹，凡再加/删/改 API 返回字段，必须同步改本常量（语义注释强
       *     制显式记录 schema 变更）——比单纯 v9→v10 手敲版本号更难漏。
       *  ② __purgeStaleWorkflowCache() 主动清理：fetchDetail 进入即扫一
       *     遍 sessionStorage，凡命名空间不对的 wfdetail: 全部物理删除，
       *     杜绝老 key 在新 sessionStorage 里残留被误命中。
       *  ③ fetch 改 cache:"no-store"：浏览器/HTTP 缓存层强制走完。
       *  ④ 顶栏 🔄 强制重载按钮：用户可以一键清光所有 sessionStorage 并
       *     带 ?bust 重新拉 server LRU bypass。
       *  附带：TTL 5min → 30s；后台 fetch 也更新 UI（latestRequestId 守
       *     卫 race condition）；console.banner 在每次 fetchDetail 入口打
       *     显眼状态。 */
      const cacheKey = `wfdetail:R6:outputsLabel+boundaryPinLocalized+rawInputsRawStamp+nodeMode+workflowIOTyped:${url}`;
      const WFCACHE_TTL_MS = 30_000;

      /* Once-per-page-load purge: drop every wfdetail:* entry that doesn't
       *  share the current namespace suffix.  Catches the entire family of
       *  "stuck v8/v9/v10" keys that used to lock users into a stale canvas
       *  for up to 5 minutes.  Safe to call repeatedly — best-effort only. */
      try {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
          const k = sessionStorage.key(i);
          if (k && k.startsWith("wfdetail:") && !k.startsWith("wfdetail:R6:")) {
            sessionStorage.removeItem(k);
          }
        }
      } catch {
        /* sessionStorage may be blocked (private mode); skip silently */
      }

      // 1) Synchronous sessionStorage lookup → instant paint on re-open.
      let cached: any = null;
      try {
        const raw = sessionStorage.getItem(cacheKey);
        if (raw) {
          const obj = JSON.parse(raw);
          if (Date.now() - obj.t < WFCACHE_TTL_MS) cached = obj.d;
        }
      } catch {
        cached = null;
      }

      // Race-safe token: only the most recent fetchDetail invocation for a
      // given URL is allowed to commit setDetail.  Solves "background fetch
      // returns fresh data but UI still shows the cached one" by routing
      // both branches through the same commit path.
      const myReqId = ++latestRequestIdRef.current;

      if (cached) {
        if (myReqId === latestRequestIdRef.current) {
          setDetail(cached);
          setParamMap(cached.paramMap ?? {});
          setWorkflowIO(cached.workflowIO ?? {});
          setLoading(false);
          setSubgraphLoading(false);
          /* Capture root workflow name on the first top-level fetch only. */
          if (!opts?.subgraphUid) {
            setRootWorkflowName((prev) => prev || cached.name || "");
          }
          if (opts?.subgraphUid) {
            pushSubgraphStack(opts.subgraphUid, opts.parentTitle || cached.name || "子工作流");
          }
        }
        // Background refresh: ALWAYS commit if it wins the race (it's
        // newer than what we just painted), so schema-fingerprint
        // upgrades automatically surface without a manual reload.
        const bgUrl = url + (url.includes("?") ? "&" : "?") + "_r3=" + Date.now();
        fetch(bgUrl, {
          cache: "no-store",
        })
          .then((r) => r.json())
          .then((d) => {
            if (!d || d.error) return;
            try {
              sessionStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), d }));
            } catch {
              /* ignore quota errors */
            }
            if (latestRequestIdRef.current === myReqId) {
              setDetail(d);
              setParamMap(d.paramMap ?? {});
              setWorkflowIO(d.workflowIO ?? {});
              if (!opts?.subgraphUid) {
                setRootWorkflowName((prev) => prev || d.name || "");
              }
            }
          })
          .catch(() => {});
        if (typeof window !== "undefined") {
          // eslint-disable-next-line no-console
          console.log(
            "%c[WFCACHE R3] HIT%c url=" + url + " ns=wfdetail:R3 ttl=" + WFCACHE_TTL_MS + "ms",
            "background:#7C5CFC;color:#fff;padding:2px 4px;border-radius:3px",
            "color:#aaa"
          );
        }
        return;
      }

      // 2) Cold path: network fetch (no-store → bypasses HTTP cache).
      /* 2026-08-06 R3: callers may pass {bust:true} via fetchDetail so that
       *  the server's in-memory LRU is also invalidated (matches the
       *  顶栏 🔄 强制重载按钮 contract).  Otherwise we add a cache-busting
       *  timestamp query so HTTP cache layers don't serve a stale body. */
      const isBust = opts?.bust === true;
      const tsParam = isBust ? "_bust=1" : "_r3=" + Date.now();
      const fetchUrl = url + (url.includes("?") ? "&" : "?") + tsParam;
      if (!detail) setLoading(true);
      try {
        const r = await fetch(fetchUrl, {
          cache: "no-store",
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), d }));
        } catch {
          /* ignore quota errors */
        }
        if (myReqId === latestRequestIdRef.current) {
          setDetail(d);
          setParamMap(d.paramMap ?? {});
          setWorkflowIO(d.workflowIO ?? {});
          /* Capture root workflow name on first top-level fetch. */
          if (!opts?.subgraphUid) {
            setRootWorkflowName((prev) => prev || d.name || "");
          }
          if (opts?.subgraphUid) {
            pushSubgraphStack(opts.subgraphUid, opts.parentTitle || d.name || "子工作流");
          }
        }
        if (typeof window !== "undefined") {
          // eslint-disable-next-line no-console
          console.log(
            "%c[WFCACHE R3] MISS → FRESH%c url=" + url + " ttl=" + WFCACHE_TTL_MS + "ms",
            "background:#10b981;color:#fff;padding:2px 4px;border-radius:3px",
            "color:#aaa"
          );
        }
      } catch (e: any) {
        setError(e.message ?? "加载失败");
      } finally {
        if (myReqId === latestRequestIdRef.current) {
          setLoading(false);
          setSubgraphLoading(false);
        }
      }
    },
    [workflowId, pushSubgraphStack]
  );

  /* 2026-08-06 R3 终极方案 #4: 顶栏 🔄 强制重载按钮触发的入口
   *  - 清空整个 sessionStorage（不只是 wfdetail:*，避免任何层残渣）
   *  - 提前把 latestRequestIdRef 自增一次让任何 in-flight fetch 全部失效
   *  - 重新调用 fetchDetail({bust:true})（服务器 LRU 也会被 ?_bust=1 清掉）
   *  - server side 通过 url 上的 _r3= 时间戳参数穿透 server LRU 的 30s 边界
   */
  const forceReloadDetail = useCallback(() => {
    try {
      // 1) 清光所有 sessionStorage key（防御性）
      sessionStorage.clear();
    } catch {
      /* private mode 等 */
    }
    // 2) 任何 in-flight fetchDetail 都作废
    latestRequestIdRef.current++;
    setError("");
    // 3) 重新跑一次（冷路径 → network → setDetail → 立刻看到新数据）
    setDetail(null);
    setLoading(true);
    setSubgraphLoading(false);
    fetchDetail({ bust: true });
    if (typeof window !== "undefined") {
      // eslint-disable-next-line no-console
      console.log(
        "%c[WFCACHE R3] FORCE RELOAD%c cleared sessionStorage + bumped request id → fresh fetch (server LRU busted)",
        "background:#ef4444;color:#fff;padding:2px 4px;border-radius:3px",
        "color:#aaa"
      );
    }
  }, [fetchDetail]);

  useEffect(() => {
    /* When the parent reuses this editor instance for a *different*
     *  workflow (same `WorkflowCanvasEditor` element, new `workflowId`
     *  prop), reset the breadcrumb state.  Otherwise the old root
     *  name + subgraph stack would briefly show against the new
     *  workflow before the new top-level fetch lands. */
    setSubgraphStack([]);
    setRootWorkflowName("");
    setDetail(null);
    setError("");
    fetchDetail();
  }, [workflowId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Enter a subgraph: flash the loading overlay synchronously, then fetch
   *  the inner graph in a separate macrotask so React 18 commits the
   *  overlay before the new `detail` arrives.  We no longer stash a
   *  WfSubgraphData "summary" — the user wants the I/O to live ON the
   *  WfSubgraphNode card in the parent graph, not in a separate full-
   *  canvas panel; clicking expand jumps straight into the inner graph. */
  const onEnterSubgraph = useCallback(
    (nodeId: string, uid: string, parentTitle: string) => {
      /* R50 (2026-08-11): a subgraph can't run on its own — it lives
       *  inside the parent workflow and only takes data in via the
       *  parent's IO-boundary pin nodes.  Once we drill in, the IO edit
       *  affordances are meaningless (you can't `run` this subgraph to
       *  collect outputs the way you can with the root workflow), so we
       *  tear them down before the new detail arrives.  The toolbar
       *  buttons are also conditionally hidden (see `isSubgraphView`
       *  guard below), but flipping the states off here prevents the
       *  short window where the toolbar still shows the old toggle but
       *  every WfNode already renders the subgraph view with stale
       *  `ioEditMode=true` checkboxes dotted across it. */
      setIoEditMode(false);
      setIoPreviewOpen(false);
      setSubgraphLoading(true);
      setTimeout(() => fetchDetail({ subgraphUid: uid, parentTitle }), 0);
    },
    [fetchDetail]
  );

  /* Pop one level off the subgraph stack and re-render.  If we end up
   *  back at the top level, re-fetch the workflow detail. */
  const onExitSubgraph = useCallback(async () => {
    setSubgraphLoading(true);
    setSubgraphStack((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice(0, -1);
      // Schedule a re-fetch of the right level outside the setter.
      if (next.length === 0) {
        // Back at top level
        setTimeout(() => fetchDetail(), 0);
      } else {
        const parent = next[next.length - 1];
        setTimeout(() => fetchDetail({ subgraphUid: parent.uid, parentTitle: parent.name }), 0);
      }
      return next;
    });
  }, [fetchDetail]);

  /* Convert graph → flow nodes.  Rendering order (back→front):
   *   groups (frames) → notes (annotations) → real graph nodes (always on top).
   *  Layout strategies for the real nodes, in priority order:
   *   1. **Saved positions** (raw imports): use the original ComfyUI coordinates
   *      verbatim so the canvas looks exactly like the user arranged it.
   *   2. **Auto layout (BFS levels)** when only API JSON was provided. */
  /* Hoisted raw meta + slot-name table — also referenced from the edges
   * useEffect below, so we keep them at component scope (not inside the
   * initialNodes memo). */
  const rawMetaById: Record<string, { widgets_values: any[]; outputs: RawOutputMeta[]; flags: Record<string, any>; properties: Record<string, any>; mode: number }> = useMemo(() => {
    const m: Record<string, { widgets_values: any[]; outputs: RawOutputMeta[]; flags: Record<string, any>; properties: Record<string, any>; mode: number }> = {};
    for (const rn of detail?.rawNodes ?? []) {
      if (rn?.id) {
        m[rn.id] = {
          widgets_values: Array.isArray(rn.widgets_values) ? rn.widgets_values : [],
          outputs: Array.isArray((rn as any).outputs) ? (rn as any).outputs : [],
          flags: (rn as any).flags && typeof (rn as any).flags === "object" ? (rn as any).flags : {},
          properties: (rn as any).properties && typeof (rn as any).properties === "object" ? (rn as any).properties : {},
          mode: typeof (rn as any).mode === "number" ? (rn as any).mode : 0,
        };
      }
    }
    return m;
  }, [detail]);

  /* 2026-08-12 R78.2: 主画布 RAW / API 视图切换。
   *  - "raw"  = 用 detail.positions（服务端已把 rawJson 原始位置合并进去）
   *            排布，即 ComfyUI 原始布局。
   *  - "api"  = 强制用 detail.graph 的拓扑做 Kahn 最长路径自动布局，
   *            与 rawJson 的导入位置无关，呈现「执行图」形态。
   *  两种视图渲染的是**同一批可编辑节点 + 同一套连线**，仅节点位置不同。
   *  API 视图下的拖拽只存会话级 override (apiLayoutOverrides)，不写 DB，
   *  以免污染 rawJson / tpl.positions 里的 ComfyUI 原始布局。 */
  const [viewMode, setViewMode] = useState<"raw" | "api">("raw");
  const [apiLayoutOverrides, setApiLayoutOverrides] = useState<Record<string, [number, number]>>({});

  /* 2026-08-13 R82: 视图作用域 detail。RAW 视图下把节点/图/位置源切换为
   *  `detail.rawView`（rawJson 派生、wrapper 保留），让画布渲染 ComfyUI 原始
   *  布局，而非可能被拆平的 API 图。groups/notes/IO/边界 pin 等两种视图一致，
   *  通过展开保留。RAW 视图下已在 `detail.positions` 镜像的 raw-id 拖拽覆盖
   *  会叠加在最上层，使 RAW 视图的手动拖拽无需重新拉取即生效。 */
  const scopeDetail: WorkflowDetail | null = useMemo(() => {
    if (!detail) return null;
    if (viewMode === "raw" && detail.rawView) {
      const rawIds = new Set(detail.rawView.nodes.map((n) => n.id));
      const overrides: Record<string, [number, number]> = {};
      const dp = detail.positions ?? {};
      for (const k of Object.keys(dp)) {
        if (rawIds.has(k)) overrides[k] = dp[k];
      }
      return {
        ...detail,
        nodes: detail.rawView.nodes,
        graph: detail.rawView.graph,
        positions: { ...(detail.rawView.positions ?? {}), ...overrides },
      };
    }
    return detail;
  }, [detail, viewMode]);

  const outSlotNameById: Record<string, string[]> = useMemo(() => {
    if (!scopeDetail) return {};
    const nodesById: Record<string, ComfyGraphNode> = {};
    for (const n of scopeDetail.nodes) nodesById[n.id] = n;
    return inferSourceOutNames(scopeDetail, nodesById, rawMetaById);
  }, [scopeDetail, rawMetaById]);

  const initialNodes: Node[] = useMemo(() => {
    if (!detail) return [];
    if (!scopeDetail) return [];
    const colW = 300;
    const rowH = 220;
    const padX = 80;
    const padY = 80;

    // Index nodes by id so we can resolve [srcId, slot] inputs to source titles.
    const nodesById: Record<string, ComfyGraphNode> = {};
    for (const n of scopeDetail.nodes) nodesById[n.id] = n;

    /* Look up the raw input metadata per node by id (for the graph view) */
    const rawById: Record<string, RawInputMeta[]> = {};
    for (const n of scopeDetail.nodes) rawById[n.id] = n.raw_inputs ?? [];

    /* Source-independent view of "this node's OUTPUT slots feed a
     *  subgraph boundary" — derived directly from detail.boundaryLinks
     *  where bl.kind === "output".  Used as a backup signal in WfNode's
     *  hasDownstream check so boundary wires keep rendering even if the
     *  server's rawOutputs[].isBoundary stamp hasn't propagated yet
     *  (e.g. due to an older sessionStorage cache shape — 2026-08-06
     *  fix after v4 cache still masked the output handles for
     *  RandomNoise's NOISE slot).  Top-level (non-subgraph) workflows
     *  leave `detail.boundaryLinks` undefined → returns empty map. */
    const boundaryOutputsByNodeId: Record<string, Set<string>> = {};
    /* Mirror for input side: bl.kind === "input" maps an outer pin to an
     *  inner node + input slot name.  Used by WfNode to mark widget rows
     *  (no `link` in rawInputs) as boundary, so the wire still anchors
     *  when isBoundary stamp is missing from a stale cache. */
    const boundaryInputsByNodeId: Record<string, Set<string>> = {};
    if (Array.isArray(detail.boundaryLinks)) {
      for (const bl of detail.boundaryLinks) {
        const nid = String(bl.innerNodeId);
        const slot = String(bl.innerSlotName || "");
        if (!nid || !slot) continue;
        if (bl.kind === "output") {
          (boundaryOutputsByNodeId[nid] ??= new Set()).add(slot);
        } else if (bl.kind === "input") {
          (boundaryInputsByNodeId[nid] ??= new Set()).add(slot);
        }
      }
    }

    /* rawMetaById + outSlotNameById are hoisted above (used by edges). */

    /* rawMetaById + outSlotNameById are hoisted above (used by edges). */

    /* Pre-compute which outputs of every node are wired downstream.  We
     *  do this once on detail load so each WfNode/WfSubgraphNode can ask
     *  "is this output connected?" and hide its dot when it isn't. */
    const connectedOutputsById = buildConnectedOutputs(scopeDetail, nodesById, rawMetaById, outSlotNameById);

    // Shared builder for a real ComfyUI graph node.
    //
    // 2026-08-07 — anchor convention: the React Flow `position` is the
    // *card's* top-left (i.e. the title bar top), and the body is painted
    // NODE_TITLE_H (=30px) *below* it.  The user wants the node BODY's
    // top to land exactly on the ComfyUI config `pos[1]` (the imported
    // coordinate), so we SUBTRACT NODE_TITLE_H here: cardTop = bodyTop − 30.
    // onNodeDragStop inverts this by ADDING NODE_TITLE_H before persisting,
    // so the on-disk `positions[id]` keeps the ComfyUI body-top convention
    // and a drag never accumulates a 30px offset on every save.
    //
    // When `n.size` is provided we force the node box to the exact
    // ComfyUI dimensions: width = size[0], height = `size[1] + NODE_TITLE_H`
    // (the raw `size[1]` is the BODY CONTENT height per the R49 rule —
    // see the NODE_TITLE_H comment for the full rationale).  The body
    // content height carried in `data.size.h` is exactly `size[1]`.
    const NODE_ANCHOR_OFFSET_Y = NODE_TITLE_H;
    const buildWfNode = (n: ComfyGraphNode, pos: { x: number; y: number }): Node => ({
      id: n.id,
      type: "wfNode",
      position: { x: pos.x, y: pos.y - NODE_ANCHOR_OFFSET_Y },
      style: n.size
        ? { width: n.size[0], height: n.size[1] + NODE_TITLE_H }
        : undefined,
      zIndex: 10,
      data: {
        nodeId: n.id,
        classType: n.class_type,
        title: n.title,
        inputs: (detail.graph[n.id]?.inputs ?? {}) as Record<string, any>,
        inputSources: buildInputSources(detail.graph[n.id]?.inputs, nodesById),
        assignedRole: Object.entries(paramMap).find(([, nid]) => nid === n.id)?.[0] ?? null,
        rawInputs: n.raw_inputs ?? [],
        rawOutputs: rawMetaById[n.id]?.outputs ?? [],
        rawWidgetValues: rawMetaById[n.id]?.widgets_values ?? [],
        connectedOutputs: connectedOutputsById[n.id],
        /* Backup source (2026-08-06 fix): stamped from detail.boundaryLinks
         *  so the output Handle still mounts for nodes that don't carry
         *  the rawOutputs[].isBoundary stamp yet (e.g. cached detail
         *  shape from before the schema change).  Independent channel
         *  → hasDownstream reads it via `data.boundaryOutputs.has`. */
        boundaryOutputs: boundaryOutputsByNodeId[n.id],
        boundaryInputs: boundaryInputsByNodeId[n.id],
        flags: rawMetaById[n.id]?.flags ?? {},
        mode: rawMetaById[n.id]?.mode ?? 0,
        /* Boundary stamps from the subgraph route (2026-08-05).  Outer
         *  (top-level) workflows always leave both false — sentinel
         *  nodes only exist inside a subgraph.  The client uses these
         *  flags to draw an INPUTS / OUTPUTS wfGroup around each cluster
         *  so the user can see where the wrapper's exposed ports end up
         *  on the canvas. */
        isInputEndpoint: !!n.is_input_endpoint,
        isOutputEndpoint: !!n.is_output_endpoint,
        /* LiteGraph `properties` (2026-08-09).  Fed through to WfNode so
         *  rgthree's `Fast Groups Bypasser` can read `matchTitle` etc.
         *  and render its runtime toggle list.  Forwarded verbatim. */
        properties: rawMetaById[n.id]?.properties ?? {},
        /* Workflow groups (2026-08-09).  Passed to WfNode so the
         *  rgthree runtime body can match against them; other nodes
         *  ignore this field.  The reference is shared (not cloned) so
         *  the cost stays O(1) per node regardless of workflow size. */
        groups: detail.groups ?? [],
        size: n.size ? { w: n.size[0], h: n.size[1] } : undefined,
      } as WfNodeData,
    });

    /* Subgraph wrapper node: class_type is a UUID and ComfyUI exposed
     *  inputs via proxyWidgets + a localised_name per slot.
     *
     *  2026-08-05 evening — IO rows REMOVED from the parent chip.
     *  The parent card is now a compact "stats + drill-in CTA" chip
     *  (see WfSubgraphNode).  Drilling in (via double-click or the
     *  header expand button) loads the subgraph's inner graph where
     *  IO member nodes get wrapped in INPUTS / OUTPUTS wfGroups.
     */
    const buildSubgraphNode = (n: ComfyGraphNode, pos: { x: number; y: number }): Node => {
      /* Inputs of this subgraph that have an *external* edge are the
       *  ones the parent workflow wires into it.  We pull this from
       *  detail.graph[subgraph_node_id].inputs — anything keyed here
       *  whose value is a [srcId, slot] tuple is connected. */
      const subgraphInp = (detail.graph?.[n.id]?.inputs ?? {}) as Record<string, any>;
      const connectedInputs = new Set<string>();
      for (const [name, v] of Object.entries(subgraphInp)) {
        if (Array.isArray(v) && typeof v[0] === "string") connectedInputs.add(name);
      }
      return {
        id: n.id,
        type: "wfSubgraph",
        // Same anchor convention as buildWfNode (see comment above the
        // builder): card top = config body top − NODE_TITLE_H, so the body
        // lands exactly on the imported pos.y.
        position: { x: pos.x, y: pos.y - NODE_ANCHOR_OFFSET_Y },
        zIndex: 11, // render above regular nodes so the purple outline reads
        style: n.size
          ? { width: n.size[0], height: n.size[1] + NODE_TITLE_H }
          : undefined,
        data: {
          nodeId: n.id,
          title: friendlyNodeTitle(n.class_type, n.title, "zh"),
          uid: n.class_type.slice(0, 8),
          inputs: n.raw_inputs ?? [],
          outputs: rawMetaById[n.id]?.outputs ?? [],
          widgetValues: rawMetaById[n.id]?.widgets_values ?? [],
          connectedOutputs: connectedOutputsById[n.id],
          connectedInputs,
          size: n.size ? { w: n.size[0], h: n.size[1] } : undefined,
          mode: rawMetaById[n.id]?.mode ?? 0,
          onEnter: () => onEnterSubgraph?.(n.id, n.class_type, n.title),
        } as WfSubgraphData,
      };
    };

    /* ── Group frames (background, behind everything) ── */
    const groups = detail.groups ?? [];
    const groupDepth = computeGroupDepths(groups);
    /* ComfyUI group ids are bare integers ("1", "2", "32") and can collide
     *  BOTH with graph-node ids AND with each other (a sub-workflow's
     *  `groups` array may legitimately contain two entries with the same
     *  `id`, e.g. id="32" appearing twice in the same inner graph — the
     *  outer `group:` prefix protects against node-id collision but does
     *  nothing for group-vs-group, which produced
     *  `Encountered two children with the same key, "group:32"` from
     *  React Flow's <MiniMapNodes>).  We dedupe here by tracking used ids
     *  and appending `-${i}` on collision.  `groupDepth` (keyed by the
     *  raw g.id) is untouched, as is the WfGroupNode's data.title/color. */
    const usedGroupIds = new Set<string>();
    const groupNodes: Node[] = groups
      .filter((g) => g.bounding[2] > 0 && g.bounding[3] > 0)
      .map((g) => {
        const [x, y, w, h] = g.bounding;
        let nodeId = `group:${g.id}`;
        let dupIdx = 0;
        while (usedGroupIds.has(nodeId)) {
          dupIdx += 1;
          nodeId = `group:${g.id}-${dupIdx}`;
        }
        usedGroupIds.add(nodeId);
        return {
          id: nodeId,
          type: "wfGroup",
          position: { x, y },
          // deeper nesting → higher zIndex, but always below notes/nodes
          zIndex: 1 + Math.min(groupDepth[g.id] ?? 0, 3),
          draggable: false,
          selectable: false,
          connectable: false,
          data: { title: g.title, color: g.color } as WfGroupData,
          style: { width: w, height: h, pointerEvents: "none" },
        } as Node;
      });

    /* ── Note / MarkdownNote annotations ── */
    const notes = detail.notes ?? [];
    const noteNodes: Node[] = notes.map((n) => {
      const title = extractNoteTitle(n.text, n.title);
      /* Anchor convention (2026-08-07, same as graph nodes): the React
       *  Flow `position` is the card top (title-bar top), body is NODE_TITLE_H
       *  below it.  To land the BODY top on the imported `pos[1]` we SUBTRACT
       *  NODE_TITLE_H for titled notes; untitled notes render no bar so their
       *  body IS the whole card and need no offset.  The onNodeDragStop for
       *  notes ADDS NODE_TITLE_H back before persisting. */
      const noteHasTitle = !!title;
      return {
        id: `note:${n.id}`,
        type: "wfNote",
        position: {
          x: n.pos[0],
          y: n.pos[1] - (noteHasTitle ? NODE_ANCHOR_OFFSET_Y : 0),
        },
        zIndex: 5,
        draggable: true,
        selectable: true,
        connectable: false,
        data: { title, text: n.text, color: n.color } as WfNoteData,
        /* `size` in the ComfyUI/litegraph payload stores the BODY CONTENT
         *  height (the 30 px title bar is NOT included in `size[1]` per the
         *  R49 rule — see the NODE_TITLE_H comment).  Titled notes add the
         *  title bar on top of the raw content size, so the React Flow box
         *  is `size[1] + NODE_TITLE_H` for titled notes.  Untitled notes
         *  render no bar so their `size[1]` is already the full height. */
        style: {
          width: n.size[0],
          height: n.size[1] + (noteHasTitle ? NODE_TITLE_H : 0),
        },
      } as Node;
    });

    // Real graph nodes only (note-class nodes are rendered separately above).
    const realNodes = scopeDetail.nodes.filter((n) => !isNoteType(n.class_type));

    /* IO port node dimensions live as module-level constants at the top of
     *  this file (IO_PORT_HEIGHT / PORT_ROW_GAP / GROUP_*) so both the
     *  layout pass below and the WfIoPortNode renderer stay in sync. */

    /* ── Boundary pins → wfGroup(wfIoPort …) (2026-08-06 late) ──
     *
     *  The user asked: "子工作流的输入节点和输出参数节点不需要可用单独拖动，
     *  支持整体拖动即可，参数间的距离没必要那么大，紧凑些，再像图中那样
     *  加个边框就行了".  So:
     *    • Each rail (inputs / outputs) is now wrapped in its OWN wfGroup
     *      rectangle with the purple draggable style (draggable: true +
     *      pointerEvents: auto + cursor: move).  Users grab the group once
     *      and the whole column slides.
     *    • The individual wfIoPort children carry parentId: <groupId> +
     *      extent: "parent" + draggable: false, so React Flow keeps them
     *      inside the group frame and moves them automatically with the
     *      parent's transform.
     *    • Vertical spacing is the new PORT_ROW_GAP (4 px) with the new
     *      IO_PORT_HEIGHT (22 px) → rows are tight without labels
     *      touching.
     *    • Group position is persisted via `detail.positions["grp:bpin:…
     *      "]`.  A saved override (left over from a previous session) is
     *      preferred over the rail-layout fallback that anchors to the
     *      inner bbox.  The previous single-pin-per-card render dropped
     *      positions to positionsById which is a no-op, so reload
     *      always reset to bbox-anchored rail; persisting the group
     *      position is what makes a moved column stay put. */
    const buildBoundaryPinNode = (
      pin: any,
      kind: "input" | "output",
      parentId: string,
      relY: number,
      relX: number
    ): Node => ({
      id: `bpin:${pin.id}`,
      type: "wfIoPort",
      parentId,
      extent: "parent",
      position: { x: relX, y: relY },
      zIndex: 11,
      draggable: false,
      selectable: true,
      connectable: false,
      style: { width: IO_PORT_WIDTH, height: IO_PORT_HEIGHT },
      data: {
        /* Display label chain (2026-08-06 fix): the boundary pin's
         *  `label` is the author-set business name (`FRAMES`,
         *  `IMAGE_FINAL`, `MODEL_HIGH_1st`) and is the *primary* read.
         *  Falls back to `localized` (ComfyUI's i18n) then to `name`
         *  so we never ship an empty title.  Same chain as
         *  WfSubgraphNode.outputs.display so both layers render the
         *  same string; the tooltip adds the resolved type for
         *  disambiguation when `name === type`. */
        title: pin.label ?? pin.localized ?? pin.name ?? "",
        type: pin.type,
        direction: kind,
        parentNodeId: null as any,
        parentNodeTitle: "",
        connectsTo: null as any,
        connectsFrom: null as any,
      } as WfIoPortData,
    });

    /* X-anchor for a wfIoPort child inside its rail group (2026-08-08
     *  fixed).  Both rails now anchor the port from the wfGroup's
     *  top-right / top-left CORNER, not from the same (left) edge —
     *  the previous input layout pushed the port flush against the
     *  wfGroup's right border (`relX = 2 * GROUP_PAD_X`), which made
     *  the handle `right:-4` stick OUTSIDE the box — visible in the
     *  screenshot as green dots leaking past the red Inputs frame.
     *
     *   - input  pin: name on right side of port (justify-end → label
     *                 hugs the right edge); port anchored from the
     *                 wfGroup's RIGHT-TOP corner so its right edge
     *                 sits GROUP_PAD_X inside the wfGroup border.
     *                 Handle (`right:-4`) ends up 6 px INSIDE the
     *                 box, mirroring the output row exactly.
     *                 ⇒ relX = wfGroupWidth - IO_PORT_WIDTH - GROUP_PAD_X.
     *   - output pin: name on left side of port (justify-start → label
     *                 hugs the left edge); port anchored from the
     *                 wfGroup's LEFT-TOP corner so its left edge sits
     *                 GROUP_PAD_X inside the wfGroup border.  Handle
     *                 (`left:-4`) ends up 6 px inside the box.
     *                 ⇒ relX = GROUP_PAD_X. */
    const wfGroupWidth = IO_PORT_WIDTH + 2 * GROUP_PAD_X;
    const inputRelX = wfGroupWidth - IO_PORT_WIDTH - GROUP_PAD_X;
    const outputRelX = GROUP_PAD_X;

    /* Build a wfGroup node for the whole rail.  `draggable: true` flips
     *  WfGroupNode into interaction mode (pointerEvents: auto, cursor:
     *  move) and React Flow moves the children declared with
     *  extent:"parent" along automatically.  Height is supplied directly
     *  (the variable pin-row offsets below don't fit the old
     *  `pinCount * IO_PORT_HEIGHT + (n-1)*PORT_ROW_GAP` formula). */
    const buildBoundaryGroup = (
      id: string,
      title: string,
      pos: { x: number; y: number },
      height: number
    ): Node | null => {
      if (height <= 0) return null;
      return {
        id,
        type: "wfGroup",
        position: pos,
        zIndex: 0,
        draggable: true,
        selectable: true,
        connectable: false,
        data: { title, color: GROUP_RAIL_COLOR, draggable: true } as WfGroupData,
        style: { width: IO_PORT_WIDTH + 2 * GROUP_PAD_X, height },
      } as Node;
    };

    /* Compute rail-anchor positions and (when needed) fall back to
     *  bbox-anchored defaults.  `savedGroupPos` may already contain a
     *  user-moved position from a previous session — honour it.
     *
     *  2026-08-06 (final): instead of forcing both rails into a
     *  bbox-aligned vertical column, anchor each group at the raw
     *  coordinates ComfyUI stored on `boundaryPins.inputs[i].pos` /
     *  `boundaryPins.outputs[i].pos`.  These are the absolute canvas
     *  coords where the corresponding inner-slot port sits in the
     *  unmodified workflow — exactly what the user pointed at in
     *  screenshot #2 ("这里有子图的输入节点和输出节点的位置，要按照
     *  这个来").  The fallback (bbox-anchored) only kicks in when those
     *  raw positions are absent or all-zero, e.g. older or hand-rolled
     *  workflows.  Pin y-coords are derived as `rawPinY - groupY` so
     *  variable vertical spacing is preserved. */
    const layoutBoundaryPins = (
      middlePos: Record<string, { x: number; y: number }>
    ): Node[] => {
      if (!detail.boundaryPins) return [];
      const mIds = Object.keys(middlePos);
      if (mIds.length === 0) return [];
      let minX = Infinity, maxX = -Infinity, minY = Infinity;
      for (const id of mIds) {
        const p = middlePos[id];
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
      }
      /* Reference layout: ┃ leftInputColumn ┃ middleCanvasColumn ┃
       *  rightOutputColumn ┃.  The gap between each rail and the
       *  middle bbox must be ≥ one middle-node width (~280 px) +
       *  breathing room so the wfIoPort label is never buried inside
       *  a middle WfNode card.  The raw-pin-anchored default below
       *  WINS when the workflow carries real pin.pos coords (the
       *  common path); this 360 px bbox fallback only fires for
       *  workflow files where every pin.pos is missing or zero. */
      const RAIL_GAP = 360;
      const leftRailX = minX - RAIL_GAP;
      const rightRailX = maxX + RAIL_GAP;

      const rawPosOf = (pin: any): [number, number] | null => {
        if (Array.isArray(pin.pos) && pin.pos.length >= 2) {
          const x = Number(pin.pos[0]) || 0;
          const y = Number(pin.pos[1]) || 0;
          /* Treat (0,0) as "not provided" — happens for workflows
           *  imported without UI positions (API-only).  Falling back
           *  to the bbox-anchored rail is safer than popping every
           *  pin at the canvas origin. */
          if (x !== 0 || y !== 0) return [x, y];
        }
        return null;
      };
      const inputsRaw = (detail.boundaryPins.inputs ?? []).map(rawPosOf);
      const outputsRaw = (detail.boundaryPins.outputs ?? []).map(rawPosOf);
      /* Group default anchor: take the smallest (= leftmost for inputs,
       *  rightmost for outputs) x of all pins with a real raw pos, and
       *  the minimum y, then shift the group origin up-and-left so the
       *  topmost pin sits inside the title bar + ~ GROUP_PAD_X.  Inputs
       *  and outputs face inward so left uses minX, right uses maxX. */
      const computeGroupDefault = (
        list: ([number, number] | null)[],
        side: "left" | "right"
      ): { x: number; y: number } | null => {
        let anchorX = side === "left" ? Infinity : -Infinity;
        let minRy = Infinity;
        let any = false;
        for (const p of list) {
          if (!p) continue;
          any = true;
          if (side === "left" ? p[0] < anchorX : p[0] > anchorX) anchorX = p[0];
          if (p[1] < minRy) minRy = p[1];
        }
        if (!any) return null;
        return {
          x: anchorX - GROUP_PAD_X,
          y: minRy - GROUP_TITLE_BAR - GROUP_PAD_X,
        };
      };
      const inputsDefault = computeGroupDefault(inputsRaw, "left");
      const outputsDefault = computeGroupDefault(outputsRaw, "right");

      const positionsById = detail.positions ?? {};
      const savedIn: [number, number] | undefined = positionsById["grp:bpin:inputs"];
      const savedOut: [number, number] | undefined = positionsById["grp:bpin:outputs"];

      const inputsGroupPos = savedIn
        ? { x: savedIn[0], y: savedIn[1] }
        : inputsDefault
        ? inputsDefault
        : { x: leftRailX - GROUP_PAD_X, y: minY - GROUP_TITLE_BAR };
      const outputsGroupPos = savedOut
        ? { x: savedOut[0], y: savedOut[1] }
        : outputsDefault
        ? outputsDefault
        : { x: rightRailX - GROUP_PAD_X, y: minY - GROUP_TITLE_BAR };

      const stackRel = (i: number) => GROUP_TITLE_BAR + i * (IO_PORT_HEIGHT + PORT_ROW_GAP);
      const inputsRelYs = detail.boundaryPins.inputs.map((_p: any, i: number) => {
        const r = inputsRaw[i];
        return r ? r[1] - inputsGroupPos.y : stackRel(i);
      });
      const outputsRelYs = detail.boundaryPins.outputs.map((_p: any, i: number) => {
        const r = outputsRaw[i];
        return r ? r[1] - outputsGroupPos.y : stackRel(i);
      });
      const minHeight = GROUP_TITLE_BAR + GROUP_PAD_Y_BOTTOM;
      const computedHeight = (relYs: number[]): number => {
        if (relYs.length === 0) return 0;
        return Math.max(minHeight, Math.max(...relYs) + IO_PORT_HEIGHT + GROUP_PAD_Y_BOTTOM);
      };

      const out: Node[] = [];

      const inputsGroup = buildBoundaryGroup(
        "grp:bpin:inputs",
        "Inputs",
        inputsGroupPos,
        computedHeight(inputsRelYs)
      );
      if (inputsGroup) {
        out.push(inputsGroup);
        detail.boundaryPins.inputs.forEach((pin: any, i: number) => {
          out.push(
            buildBoundaryPinNode(pin, "input", "grp:bpin:inputs", inputsRelYs[i], inputRelX)
          );
        });
      }

      const outputsGroup = buildBoundaryGroup(
        "grp:bpin:outputs",
        "Outputs",
        outputsGroupPos,
        computedHeight(outputsRelYs)
      );
      if (outputsGroup) {
        out.push(outputsGroup);
        detail.boundaryPins.outputs.forEach((pin: any, i: number) => {
          out.push(
            buildBoundaryPinNode(pin, "output", "grp:bpin:outputs", outputsRelYs[i], outputRelX)
          );
        });
      }

      return out;
    };

    /* All inner graph nodes render as full WfNode / WfSubgraphNode cards
     *  (we no longer convert any of them to wfIoPort based on
     *  is_input_endpoint / is_output_endpoint — that approach collapsed
     *  for subgraphs where every node has both flags, and the
     *  reference layout wants the inner nodes to STAY as full cards). */
    /* ── 1) Saved positions ──
     *  Guard against an empty `{}` (which a "重置布局" (reset layout) can
     *  write to the server when the original workflow had NO saved
     *  positions, e.g. an API-only import).  An empty object is truthy,
     *  so without this guard every node would fall through to the
     *  `{padX, padY}` default and stack at the origin.  With the guard,
     *  empty → treated as "no positions" → Kahn auto-layout, which is the
     *  original behaviour for API-only workflows.
     *
     *  2026-08-06: also guard against PARTIAL positions (count less than
     *  realNodes.length).  This workflow can land in a state where the
     *  user has only placed a couple of nodes by hand (e.g. the workflow
     *  was imported as JSON-only and the user dragged 1-2 of them
     *  before opening the editor); the saved-positions branch would
     *  then place every un-positioned node at `{padX, padY}` = (80, 80)
     *  and visually stack 100+ nodes behind a single card.  Detection:
     *  Object.keys(detail.positions).length < realNodes.length →
     *  treat the snapshot as "absent" and run Kahn on the WHOLE graph
     *  for a predictable, grid-like starting layout.  Users can still
     *  drag nodes after to fine-tune.  The opposite (mixed: some nodes
     *  on saved pos, rest on Kahn) would be technically better but
     *  gives a chaotic result because the auto-layout assumes a
     *  blank canvas — half-placed nodes disrupt the longest-path
     *  levels and produce a worse-looking fallback. */
    // 2026-08-12 R78.2: 视图模式决定中部图节点的布局来源。
    //  - "api": 强制 Kahn 拓扑布局（忽略 rawJson 导入位置，呈现执行图形态）；
    //           叠加会话级 apiLayoutOverrides（API 视图下的拖拽，不写 DB）。
    //  - "raw": 优先用 detail.positions（已含 rawJson 原始位置 + 用户拖拽覆盖），
    //           不足时退回 Kahn（API-only 导入的历史兜底行为）。
    const kahn = computeKahnLayout(realNodes, scopeDetail.graph ?? {}, colW, rowH, padX, padY);

    if (viewMode === "api") {
      const middleNodes = realNodes.map((n) => {
        const ov = apiLayoutOverrides[n.id];
        const pos = ov ? { x: ov[0], y: ov[1] } : kahn[n.id] ?? { x: padX, y: padY };
        return n.is_subgraph ? buildSubgraphNode(n, pos) : buildWfNode(n, pos);
      });
      const middlePosById = Object.fromEntries(
        middleNodes.map((m) => [m.id, m.position])
      ) as Record<string, { x: number; y: number }>;
      return [...groupNodes, ...noteNodes, ...middleNodes, ...layoutBoundaryPins(middlePosById)];
    }

    const positionsCount = Object.keys(scopeDetail.positions ?? {}).length;
    const useSavedPositions =
      scopeDetail.positions != null &&
      positionsCount > 0 &&
      positionsCount >= realNodes.length;
    if (useSavedPositions) {
      const positionsById = scopeDetail.positions as Record<string, [number, number]>;
      const middleNodes = realNodes.map((n) => {
        const p = positionsById[n.id];
        return n.is_subgraph
          ? buildSubgraphNode(n, p ? { x: p[0], y: p[1] } : { x: padX, y: padY })
          : buildWfNode(n, p ? { x: p[0], y: p[1] } : { x: padX, y: padY });
      });
      const middlePosById = Object.fromEntries(
        middleNodes.map((m) => [m.id, m.position])
      ) as Record<string, { x: number; y: number }>;
      return [...groupNodes, ...noteNodes, ...middleNodes, ...layoutBoundaryPins(middlePosById)];
    }

    /* 2026-08-13 R78.3: hybrid — 客户端 RAW 视图的「部分 saved-positions」兜底
     *  当 detail.positions 数量不足以覆盖所有 realNodes（典型场景：含子图
     *  wrapper 的工作流 —— 服务端早期只提了顶层节点 pos，wrapper 内部 17 个
     *  节点 pos 漏了；现在服务端 extractPositions 已修，理论上不会再走到这里），
     *  不要粗暴地把整图退回 Kahn 自动布局。改为：
     *    - 已匹配的节点 → 用真实 LiteGraph pos；
     *    - 未匹配的节点 → 复用上面算好的 kahn 排到一块独立区域（紧贴第一行下方）。
     *  这样至少已定位的节点不会"乱跳"，新增的 subgraph 内层节点也不会堆在 (padX, padY)。*/
    if (positionsCount > 0) {
      const positionsById = scopeDetail.positions as Record<string, [number, number]>;
      const middleNodes = realNodes.map((n) => {
        const saved = positionsById[n.id];
        const kahnPos = kahn[n.id];
        let pos: { x: number; y: number };
        if (saved) {
          pos = { x: saved[0], y: saved[1] };
        } else if (kahnPos) {
          pos = kahnPos;
        } else {
          pos = { x: padX, y: padY };
        }
        return n.is_subgraph ? buildSubgraphNode(n, pos) : buildWfNode(n, pos);
      });
      const middlePosById = Object.fromEntries(
        middleNodes.map((m) => [m.id, m.position])
      ) as Record<string, { x: number; y: number }>;
      return [...groupNodes, ...noteNodes, ...middleNodes, ...layoutBoundaryPins(middlePosById)];
    }

    /* ── 2) Auto-layout via Kahn longest-path ── (raw 视图兜底，复用上面算好的 kahn) */
    const middleNodes = realNodes.map((n) => {
      const pos = kahn[n.id] ?? { x: padX, y: padY };
      return n.is_subgraph ? buildSubgraphNode(n, pos) : buildWfNode(n, pos);
    });
    const middlePosById = Object.fromEntries(
      middleNodes.map((m) => [m.id, m.position])
    ) as Record<string, { x: number; y: number }>;
    return [...groupNodes, ...noteNodes, ...middleNodes, ...layoutBoundaryPins(middlePosById)];
  }, [detail, paramMap, onEnterSubgraph, viewMode, apiLayoutOverrides]); // eslint-disable-line react-hooks/exhaustive-deps

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  /* Sync nodes/edges when detail (or paramMap) changes.  useNodesState only
   * takes initialNodes on mount, so when the workflow detail arrives async
   * we have to push the freshly computed initialNodes into the flow state. */
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(buildEdges(scopeDetail, initialNodes, outSlotNameById));
  }, [initialNodes, scopeDetail, outSlotNameById, setNodes, setEdges]);

  /* Snapshot the original layout for the current view (keyed by
   *  detail.id) the FIRST time we see each workflow / subgraph.  The
   *  "重置布局" (reset layout) button restores these so users can undo
   *  every manual drag and return to the workflow's as-loaded arrangement:
   *  raw imports → the imported coordinates; API-only workflows → `null`
   *  (which makes `initialNodes` fall through to the Kahn auto-layout, the
   *  original behaviour for those workflows).  Covers both graph-node
   *  `positions` and `notes` (notes are draggable too, so "所有节点"
   *  must reset them as well).  Captured once per detail.id so drilling
   *  into / back out of subgraphs keeps each view's own baseline. */
  const originalLayoutByIdRef = useRef<{
    [id: string]: {
      positions: Record<string, [number, number]> | null;
      notes: WorkflowDetail["notes"] | null;
    };
  }>({});
  useEffect(() => {
    if (!detail) return;
    /* 2026-08-13 R82: RAW / API 视图各有独立基线。RAW 视图按 rawView 的节点/
     *  位置快照，API 视图按 API 图的快照，互不干扰（避免 RAW 重置时误还原 API
     *  坐标，反之亦然）。 */
    const snapKey = `${detail.id}:${viewMode}`;
    if (!(snapKey in originalLayoutByIdRef.current)) {
      originalLayoutByIdRef.current[snapKey] = {
        positions: scopeDetail?.positions ?? null,
        notes: scopeDetail?.notes ?? null,
      };
    }
  }, [detail?.id, viewMode, scopeDetail]);

  /* Reset every node back to the layout as originally loaded for this view.
   *  - Restore `detail.positions` + `detail.notes` to the snapshot taken
   *    on entry, so the in-memory canvas (via the sync effect above)
   *    re-lays the nodes out to their original coordinates.
   *  - Persist the same to the server (`PATCH positions` + `PATCH notes`)
   *    so a reload keeps the reset.  For API-only workflows the snapshot
   *    `positions` is `null` → we send `{}`; with the `Object.keys>0`
   *    guard in `initialNodes` the reload falls back to the Kahn
   *    auto-layout (the original behaviour).
   *  - Subgraph view: send `merge: true` so the inner-subgraph node ids
   *    in `positions` are merged into `tpl.positions` instead of replacing
   *    it.  The top-level workflow's positional data (a different
   *    id-namespace) stays intact.  Top-level view keeps the default
   *    REPLACE behaviour, which is what the previous top-level reset
   *    did and the snapshot contains the complete saved layout.
   *  - 2026-08-06: detect a SPARSE snapshot (positions count < node
   *    count).  If the snapshot is partial, do NOT write it back to the
   *    server — that would re-poison the column and the user's next
   *    open would be just as broken.  Instead, just clear the local
   *    `positions` to `null` so the in-memory canvas re-lays out via
   *    Kahn; the next manual drag will start populating the column
   *    properly.  Mirror the same logic for notes. */
  const resetLayout = useCallback(() => {
    if (!detail) return;
    if (!scopeDetail) return;
    const snapKey = `${detail.id}:${viewMode}`;
    const snap = originalLayoutByIdRef.current[snapKey] ?? null;
    const orig = snap?.positions ?? null;
    const origNotes = snap?.notes ?? null;
    const isSparse =
      (orig && Object.keys(orig).length < scopeDetail.nodes.length) ||
      (origNotes &&
        scopeDetail.notes &&
        Array.isArray(origNotes) &&
        Array.isArray(scopeDetail.notes) &&
        origNotes.length < scopeDetail.notes.length);
    if (isSparse) {
      /* Snapshot is incomplete — keep the server's existing positions
       * untouched and just clear locally so the canvas re-lays out via
       * Kahn.  Subsequent drags will populate a fresh, complete map. */
      setDetail((prev) =>
        prev ? { ...prev, positions: null, notes: prev.notes ?? null } : prev
      );
      requestAnimationFrame(() => requestAnimationFrame(() => fitToMiddle()));
      return;
    }
    setDetail((prev) =>
      prev
        ? {
            ...prev,
            positions: orig ?? null,
            notes: origNotes ?? prev.notes,
          }
        : prev
    );
    const isSubgraphView = subgraphStack.length > 0;
    const payload: Record<string, unknown> = {
      positions: orig ?? {},
      notes: origNotes ?? [],
    };
    /* 2026-08-13 R82: RAW 视图的快照只含 raw-id 坐标，若用顶层默认的 REPLACE
     *  写回会清空 tpl.positions 里并存的 api-id 坐标。统一走 merge:true，只把
     *  当前视图的键写回、保留另一视图的键，避免跨视图数据损坏。 */
    payload.merge = true;
    fetch(`/api/workflows/${workflowId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {});
    requestAnimationFrame(() => requestAnimationFrame(() => fitToMiddle()));
  }, [detail?.id, subgraphStack.length, workflowId, viewMode, scopeDetail, fitToMiddle]);

  /* Re-sync nodes when paramMap changes (update assignedRole badges) */
  useEffect(() => {
    if (!detail) return;
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: {
          ...n.data,
          assignedRole:
            Object.entries(paramMap).find(([, nid]) => nid === n.data.nodeId)?.[0] ?? null,
        },
      }))
    );
  }, [paramMap, detail, setNodes]);

  /* Assign / unassign a role to a node */
  const toggleRole = useCallback(
    (nodeId: string, roleKey: string) => {
      setParamMap((prev) => {
        const next = { ...prev };
        if (next[roleKey] === nodeId) {
          // Unassign
          delete next[roleKey];
        } else {
          // Assign (unassign same role from other node first)
          for (const k of Object.keys(next)) {
            if (next[k] === nodeId) delete next[k];
          }
          next[roleKey] = nodeId;
        }
        return next;
      });
    },
    []
  );

  /* Save paramMap + workflowIO (exposed inputs/outputs) */
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/workflows/${workflowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paramMap, workflowIO }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "保存失败");
      onSave?.();
      onClose();
    } catch (e: any) {
      setError(e.message ?? "保存失败");
    } finally {
      setSaving(false);
    }
  }, [workflowId, paramMap, workflowIO, onSave, onClose]);

  /* Persist a node's position after the user finishes dragging it.
   *  - Note nodes (`note:<id>`) → write back into rawJson.nodes[i].pos via
   *    the `notes` PATCH field, and reflect the new coord in local `detail`
   *    so the canvas stays consistent (no snap-back on the next render).
   *  - Real graph nodes → write into the `positions` column via the
   *    `positions` PATCH field, likewise mirrored into local `detail`.
   *  - Boundary-pin GROUPS (`grp:bpin:inputs|outputs`, 2026-08-06 late)
   *    → write the group rect into `positions` so the rail stays where the
   *    user dropped it after reload.  The children carry parentId +
   *    extent:"parent" and move automatically with the group, so we don't
   *    persist them individually — only the parent.
   *  - Individual `bpin:*` nodes are NOT draggable (`draggable: false` in
   *    the layout pass) so this branch never fires for them; if a future
   *    change makes them draggable we'd persist their position the same
   *    way as a real graph node.
   *  The write is fire-and-forget: it must NOT trigger a detail re-fetch, so
   *  the canvas never re-mounts or flashes. */
    const onNodeDragStop = useCallback(
      (_e: unknown, node: { id: string; type?: string; position: { x: number; y: number } }) => {
        /* `detail` may be null during the loading → ready transition
         * (e.g. user closes the editor mid-load); if so we have nowhere
         * to persist the new position.  Bail silently — the canvas
         * re-mounts with the persisted state on the next open. */
        if (!detail) return;
        const x = Math.round(node.position.x);
        /* Anchor inversion (2026-08-07): wfNode / wfSubgraph cards paint a
         *  30 px title bar ABOVE their body, so the React Flow `position.y`
         *  is the CARD (title-bar) top, and the body sits `NODE_TITLE_H`
         *  below it.  The on-disk `positions[id]` must keep the ComfyUI
         *  body-top convention (what the user/other tools expect), so we
         *  ADD NODE_TITLE_H before persisting: bodyTop = cardTop + 30.
         *  Untitled notes, wfGroup and wfIoPort don't carry a title bar,
         *  so their `position` already equals the ComfyUI top-left. */
        const ANCHOR_BACK: Record<string, number> = {
          wfNode: NODE_TITLE_H,
          wfSubgraph: NODE_TITLE_H,
        };
        const back = node.type ? ANCHOR_BACK[node.type] ?? 0 : 0;
        const y = Math.round(node.position.y + back);
        if (node.id.startsWith("note:")) {
          const noteId = node.id.replace(/^note:/, "");
          /* Same anchor convention as the wfNode / wfSubgraph branch: a
           *  titled note's React Flow `position.y` is its CARD top
           *  (title-bar top), while the body sits NODE_TITLE_H below.  The
           *  on-disk `pos` keeps the ComfyUI body-top convention, so we
           *  ADD NODE_TITLE_H before persisting.  Untitled notes need no
           *  inversion because their React Flow box has no title bar. */
          const noteMeta = (detail.notes ?? []).find((nn) => String(nn.id) === noteId);
          const noteHasTitle = noteMeta ? !!extractNoteTitle(noteMeta.text, noteMeta.title) : false;
          const noteY = Math.round(node.position.y + (noteHasTitle ? NODE_TITLE_H : 0));
          setDetail((prev) =>
            prev
              ? { ...prev, notes: (prev.notes ?? []).map((n) => (n.id === noteId ? { ...n, pos: [x, noteY] } : n)) }
              : prev
          );
          fetch(`/api/workflows/${workflowId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notes: [{ id: noteId, pos: [x, noteY] }] }),
          }).catch(() => {});
        } else {
          /* 2026-08-12 R78.2: API 视图下的图节点拖拽只存会话级 override，
           * 不写 DB —— 保护 rawJson / tpl.positions 里的 ComfyUI 原始布局。
           * RAW 视图照旧写回 detail.positions。 */
          if (viewMode === "api") {
            setApiLayoutOverrides((prev) => ({ ...prev, [node.id]: [x, y] }));
            return;
          }
          const nodeId = node.id;
          setDetail((prev) =>
            prev ? { ...prev, positions: { ...(prev.positions ?? {}), [nodeId]: [x, y] } } : prev
          );
          /* Subgraph view: write with `merge: true` so a single inner-node
           *  drag doesn't overwrite the entire top-level `tpl.positions`
           *  column.  Top-level view keeps the default REPLACE behaviour
           *  (it never touches other namespaces).  `subgraphStack` is the
           *  canonical "are we inside a subgraph" signal — empty array
           *  when browsing the root workflow. */
          const payload: Record<string, unknown> = { positions: { [nodeId]: [x, y] } };
          /* 2026-08-13 R82: RAW 视图（顶层）拖拽也走 merge:true。tpl.positions
           *  现在并存 api-id（来自 API 图）与 raw-id（来自 RAW 视图）两套坐标，
           *  顶层默认 REPLACE 会把另一套坐标清空。单键合并既能落盘当前节点，
           *  又保留另一视图的键。 */
          payload.merge = true;
          fetch(`/api/workflows/${workflowId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }).catch(() => {});
        }
      },
      [workflowId, subgraphStack.length, viewMode, setApiLayoutOverrides]
    );

  /* IO-preview merge (2026-08-09).  IMPORTANT: this useMemo MUST sit
   *  BEFORE any early-return (loading / error below) so the hook order
   *  is stable across renders — otherwise React fires "Rendered more
   *  hooks than during the previous render" the moment the loading
   *  state flips from true → false.  `workflowIO` (local state) only
   *  carries the four identity fields written by toggleIO; the server
   *  returns an enriched map (type / defaultValue / nodeTitle /
   *  multiline).  The preview panel needs the union: a freshly-toggled
   *  pin must inherit the server-side enrichment so `controlForEntry`
   *  picks the right widget, while an un-saved label rename from local
   *  state must win immediately. */
  const detailIOMap = (detail?.workflowIO as unknown as WorkflowIOMap | null) ?? null;
  const previewIO = useMemo<WorkflowIOMap>(() => {
    const out: WorkflowIOMap = {};
    if (!detailIOMap) return out;
    for (const [key, local] of Object.entries(workflowIO)) {
      if (!local) continue;
      const e = detailIOMap[key];
      if (e) {
        /* Local override beats server label so an un-saved rename wins.
         *  Identity fields always come from local (the toggle is the
         *  source of truth for what was actually checked). */
        out[key] = { ...e, ...local, label: local.label ?? e.label };
      } else {
        /* No server enrichment yet (e.g. user toggled + immediately opened
         *  preview without waiting for a refetch) — render with what we
         *  know; controlForEntry will degrade gracefully. */
        out[key] = {
          direction: local.direction,
          kind: local.kind,
          nodeId: local.nodeId,
          name: local.name,
          label: local.label,
          type: local.type ?? "*",
        };
      }
    }
    return out;
  }, [workflowIO, detailIOMap]);
  /* R94 (2026-08-17): does any widget pin carry an author override?  Drives
   *  the 「恢复默认」 button's enabled state in the IO preview panel. */
  const hasIOOverrides = useMemo(
    () => Object.values(workflowIO).some((e) => e?.kind === "widget" && e.value !== undefined),
    [workflowIO]
  );

  /* Loading state */
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0a0a0f]">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-violet-500/30 border-t-violet-500" />
          <p className="text-sm text-gray-400">加载工作流节点…</p>
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0a0a0f]">
        <div className="text-center">
          <p className="text-red-400">{error ?? "未知错误"}</p>
          <button
            type="button"
            onClick={onClose}
            className="mt-3 rounded-lg bg-white/10 px-4 py-2 text-sm text-gray-300 hover:bg-white/15"
          >
            返回
          </button>
        </div>
      </div>
    );
  }

  /* (IO-preview merge was hoisted above the loading/error early-returns
   *  so React hook order stays stable — see comment at the top of the
   *  component for the full rationale.) */

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0a0a0f]">
      {/* ── Top bar ── */}
      <header className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-4 py-3 backdrop-blur-md" style={{ background: "rgba(10,10,15,0.85)" }}>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-white/10 hover:text-gray-300"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>
          <div className="flex flex-col">
            {/* Breadcrumb: <root workflow name> · <subgraph 1> · <subgraph 2> …
             *  The leading crumb is always the **root** workflow's display
             *  name (captured on first top-level fetch and preserved across
             *  subgraph navigation), so drilling into a subgraph never
             *  rewrites the leading crumb to the subgraph's own name.
             *  Clicking the root crumb jumps back to top level.  Each
             *  intermediate subgraph crumb is a clickable button that
             *  drills back to that level.  The LAST crumb (the subgraph
             *  the user is currently inside) is rendered as a non-
             *  interactive span with a violet selection box — clicking
             *  it does NOT re-enter the same subgraph (which used to
             *  stack another layer in `subgraphStack` and was confusing).
             *  Truncation uses `max-w` + `truncate` so an over-long name
             *  collapses to ellipsis; the full name stays accessible via
             *  the `title` attribute (browser native tooltip). */}
            <div className="flex items-center gap-1.5 text-[12px]">
              <button
                type="button"
                onClick={() => {
                  if (subgraphStack.length > 0) {
                    setSubgraphStack([]);
                    fetchDetail();
                  }
                }}
                className="truncate font-title text-[18px] font-bold leading-tight tracking-tight transition-colors hover:text-violet-300"
                style={{ color: "#F4F4F8", textShadow: "0 1px 0 rgba(0,0,0,0.4)", maxWidth: 280 }}
                title={
                  subgraphStack.length
                    ? `${rootWorkflowName || detail.name}（返回顶层工作流）`
                    : rootWorkflowName || detail.name
                }
              >
                {rootWorkflowName || detail.name}
              </button>
              {subgraphStack.map((crumb, i) => {
                const isLast = i === subgraphStack.length - 1;
                /* Common truncation styling for every crumb. */
                const baseCls =
                  "max-w-[260px] truncate text-[14px] font-medium transition-colors";
                if (isLast) {
                  /* Current subgraph: non-clickable span with a violet
                   *  selection pill so it's visually pinned as the
                   *  "here" marker.  No button = no accidental
                   *  re-entry that used to push a phantom layer onto
                   *  `subgraphStack`. */
                  return (
                    <React.Fragment key={crumb.uid + i}>
                      <span className="text-[14px] text-gray-600">/</span>
                      <span
                        className={`${baseCls} rounded-md border border-violet-500/40 bg-violet-500/15 px-2 py-0.5 text-violet-100`}
                        style={{ cursor: "default" }}
                        title={crumb.name}
                      >
                        {crumb.name}
                      </span>
                    </React.Fragment>
                  );
                }
                /* Intermediate subgraph (i < last): clickable button that
                 *  drills back to that level (truncates the stack at i+1
                 *  and re-fetches that subgraph's data). */
                return (
                  <React.Fragment key={crumb.uid + i}>
                    <span className="text-[14px] text-gray-600">/</span>
                    <button
                      type="button"
                      onClick={() => {
                        const next = subgraphStack.slice(0, i + 1);
                        setSubgraphStack(next);
                        fetchDetail({ subgraphUid: crumb.uid, parentTitle: crumb.name });
                      }}
                      className={`${baseCls} rounded-md px-1.5 py-0.5 text-gray-400 hover:bg-white/5 hover:text-violet-200`}
                      title={`${crumb.name}（跳到此层）`}
                    >
                      {crumb.name}
                    </button>
                  </React.Fragment>
                );
              })}
              {subgraphStack.length > 0 && (
                <button
                  type="button"
                  onClick={onExitSubgraph}
                  className="ml-2 inline-flex items-center gap-1 rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-200 transition-colors hover:bg-violet-500/20"
                  title="返回上一级"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 12H5M12 19l-7-7 7-7"/>
                  </svg>
                  返回上一级
                </button>
              )}
              {/* 2026-08-06 R3 终极方案 #4：🔄 一键强制重载缓存.
               *   - 清 sessionStorage + 跳过 server LRU + 重置 in-flight req
               *   - 任何 R3 之前的旧缓存条目都不会被读到，因为入口扫描删了
               *   - 任何之后人为改了 route.ts 没同步 SCHEMA_FINGERPRINT 的，
               *     schema 不匹配会直接导致 cacheKey 不命中，走冷路径 */}
              <button
                type="button"
                onClick={forceReloadDetail}
                className="ml-1 inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-200 transition-colors hover:bg-rose-500/20"
                title="强制重载（清 sessionStorage + 跳过 server LRU + 重拉数据）"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-3-6.7L21 8"/>
                  <polyline points="21 3 21 8 16 8"/>
                </svg>
                强制重载
              </button>
            </div>
            <p className="mt-0.5 text-[11px] font-medium text-gray-400">
              {detail.nodes.filter((n) => !isNoteType(n.class_type)).length} 个节点
              <span className="mx-1.5 text-gray-600">·</span>
              {Object.keys(workflowIO).length} 个暴露 IO
              <span className="mx-1.5 text-gray-600">·</span>
              {(detail.notes?.length ?? 0)} 个注释
              <span className="mx-1.5 text-gray-600">·</span>
              {(detail.groups?.length ?? 0)} 个分组
              {subgraphStack.length > 0 && (
                <>
                  <span className="mx-1.5 text-gray-600">·</span>
                  <span className="text-violet-300">子工作流 #{subgraphStack[subgraphStack.length - 1].uid}</span>
                </>
              )}
            </p>
            {detail.sourcePath ? (
              detail.sourceMissing ? (
                <p className="mt-1 flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/[0.07] px-2 py-1 text-[11px] text-red-300">
                  <span className="font-semibold">本地文件已丢失：</span>
                  <span className="truncate font-mono">{detail.sourcePath}</span>
                  <span className="ml-1 shrink-0 text-red-400/80">· 修改保存后刷新将自动重连</span>
                </p>
              ) : detail.sourceChanged ? (
                <p className="mt-1 flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/[0.07] px-2 py-1 text-[11px] text-emerald-300">
                  <span className="font-semibold">已从本地文件刷新最新内容</span>
                  <span className="truncate font-mono text-emerald-400/80">{detail.sourcePath}</span>
                </p>
              ) : (
                <p className="mt-1 truncate rounded-md border border-emerald-500/20 bg-emerald-500/[0.05] px-2 py-1 text-[11px] text-emerald-400/80" title={detail.sourcePath}>
                  已连接本地文件 · 文件改动后刷新即可同步
                </p>
              )
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 2026-08-12 R78.2: 主画布 RAW / API 视图切换。
           *  - "raw" = ComfyUI 原始布局（detail.positions，已含 rawJson 位置）
           *  - "api" = 执行图拓扑自动布局（detail.graph），与导入位置无关
           *  两者都渲染同一批可编辑节点 + 同一套连线，仅位置不同。 */}
          <div className="flex items-center rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
            <button
              type="button"
              onClick={() => {
                setViewMode("raw");
                setApiLayoutOverrides({});
              }}
              className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
                viewMode === "raw"
                  ? "bg-violet-500/90 text-white shadow"
                  : "text-gray-400 hover:text-gray-200"
              }`}
              title="RAW 布局：按 rawJson 原始位置（ComfyUI 画布布局）排布节点"
            >
              RAW 布局
            </button>
            <button
              type="button"
              onClick={() => {
                setViewMode("api");
                setApiLayoutOverrides({});
              }}
              className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
                viewMode === "api"
                  ? "bg-cyan-500/90 text-white shadow"
                  : "text-gray-400 hover:text-gray-200"
              }`}
              title="API 布局：按执行图拓扑自动排布节点（忽略 rawJson 导入位置）"
            >
              API 布局
            </button>
          </div>
          {error && <span className="text-xs text-red-400">{error}</span>}
          {/* R50 (2026-08-11): the "编辑 IO" / "预览 IO" affordances are
           *  scoped to the ROOT workflow only — subgraphs (子工作流) can't
           *  run independently.  The whole concept of `workflowIO` is a
           *  contract between this workflow's author and whoever calls
           *  it (currently the DynamicWorkflowForm generator); a subgraph
           *  is reached through its parent, so it never needs to publish
           *  its own IO surface.  Hiding the buttons keeps the toolbar
           *  honest about what's even meaningful here.  State cleanup
           *  happens in `onEnterSubgraph` (above) so the buttons
           *  disappear *before* the subgraph's WfNodes would otherwise
           *  inherit any leftover `ioEditMode=true` and render stray
           *  checkboxes. */}
          {subgraphStack.length === 0 && (
            <button
              type="button"
              onClick={() => setIoEditMode((v) => !v)}
              className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
                ioEditMode
                  ? "border-amber-400/60 bg-amber-400/20 text-amber-100 hover:bg-amber-400/30"
                  : "border-white/15 bg-white/5 text-gray-200 hover:bg-white/10"
              }`}
              title="进入 IO 编辑模式：在每个节点参数前显示勾选框，勾选即把该参数暴露为工作流的外部输入或输出"
            >
              {ioEditMode ? "✓ 编辑 IO 中" : "📌 编辑 IO"}
              {ioEditMode && Object.keys(workflowIO).length > 0 && (
                <span className="ml-1 rounded-full bg-amber-300/30 px-1.5 text-[11px] font-bold text-amber-50">
                  {Object.keys(workflowIO).length}
                </span>
              )}
            </button>
          )}
          {/* IO preview toggle (2026-08-09).  Sits next to "编辑 IO" so the
           *  author can flip into edit + open the preview in one sweep.
           *  Disabled outside edit mode — preview is meaningful only when
           *  there's an IO selection to render.  When the user opens the
           *  panel but hasn't entered edit mode, auto-flip edit on too,
           *  so checkboxes remain useful alongside the preview.  Also
           *  hidden in subgraph view (R50) — same rationale as the edit
           *  toggle: a subgraph has no IO contract to preview. */}
          {subgraphStack.length === 0 && (
            <button
              type="button"
              onClick={() => {
                if (!ioEditMode) setIoEditMode(true);
                setIoPreviewOpen((v) => !v);
              }}
              disabled={!ioEditMode && !ioPreviewOpen && Object.keys(workflowIO).length === 0}
              className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
                ioPreviewOpen
                  ? "border-sky-400/60 bg-sky-400/20 text-sky-100 hover:bg-sky-400/30"
                  : "border-white/15 bg-white/5 text-gray-200 hover:bg-white/10 disabled:opacity-40"
              }`}
              title="预览当前勾选的 IO 在最终表单中的样子；预览面板中每个名称都可点击重命名"
            >
              {ioPreviewOpen ? "👁 关闭预览" : "👁 预览 IO"}
            </button>
          )}
          {/* 2026-08-11 R40: 顶部直达 JSON 源码查看器。复用 WorkflowLibrary
           *  的 SourceModal —— 从缓存里的 disk snapshot 拿 graph/rawJson,
           *  无需再 fetch。打开 modal 前判读 detail 是否已就绪,否则 toast 提醒。 */}
          <button
            type="button"
            onClick={() => {
              if (!detail) {
                toast.info("工作流尚未加载完成");
                return;
              }
              setViewJsonOpen(true);
            }}
            disabled={!detail}
            className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-gray-200 transition-colors hover:bg-white/10 disabled:opacity-40"
            title="查看当前工作流的 API + RAW 源码（基于磁盘已保存版本，未保存的画布修改不在内）"
          >
            📋 查看 JSON
          </button>
          <button
            type="button"
            onClick={resetLayout}
            className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-gray-200 transition-colors hover:bg-white/10"
            title="把所有节点恢复到进入工作流时的原始位置（撤销全部手动拖动）"
          >
            重置布局
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-violet-500/90 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
          >
            {saving ? "保存中…" : "💾 保存"}
          </button>
        </div>
      </header>

      {/* ── Canvas ── */}
      <div className="relative min-h-0 flex-1">
        {/* Subgraph drill-in / drill-out overlay: covers the canvas the instant
         *  `subgraphLoading` flips true (set synchronously on click), so the
         *  user never sees the parent graph flash before the subgraph paints. */}
        {subgraphLoading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0a0a0f]/70 backdrop-blur-sm">
            <div className="text-center">
              <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-violet-500/30 border-t-violet-500" />
              <p className="text-sm text-gray-400">加载子工作流…</p>
            </div>
          </div>
        )}
        {ioEditMode && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full border border-amber-400/40 bg-amber-500/15 px-4 py-1.5 text-[12px] font-medium text-amber-100 shadow-lg backdrop-blur-sm">
            📌 IO 编辑模式：勾选节点参数前的复选框，即可将其暴露为工作流的「输入」或「输出」
          </div>
        )}
        {/* IO preview side panel (2026-08-09).  Renders the same
         *  DynamicWorkflowForm that CreatePanel / the canvas workflow node
         *  consume, fed by the **live** `workflowIO` state (not the cached
         *  server-side enrichment).  This lets the author toggle a
         *  checkbox on the canvas and immediately see the new row appear
         *  in the preview, plus rename any row's display label and watch
         *  it flow back into the persisted selection.  Compact mode to
         *  match the on-canvas rendering the user will see at run time.
         *
         *  Position: top-right, ~360px wide, max-h that respects the
         *  bottom toolbar.  z-30 so it sits above the MiniMap + Controls
         *  but below the save toast.  Pointer events on the panel itself
         *  are enabled; the wrapper stays pointer-events:none-equivalent
         *  only on the padding outside the panel (we use a single flex
         *  container, so the whole thing is interactive).
         *
         *  DATA MERGE (2026-08-09).  The local `workflowIO` state only
         *  carries the four identity fields written by toggleIO — it
         *  does NOT have type/defaultValue/nodeTitle/multiline, those
         *  come from the server-side enrichment in
         *  `api/workflows/[id].route.ts`.  Without merging, every freshly
         *  toggled pin would render as a read-only `link` placeholder
         *  (controlForEntry falls through to "link" for type "*" with no
         *  scalar).  Solution: for each key in the local state, prefer
         *  `detail.workflowIO[key]` (already enriched), and overlay the
         *  local `label` on top so an un-saved rename wins immediately. */}
        {ioPreviewOpen && (
          <div className="pointer-events-none absolute right-4 top-4 z-30 flex max-h-[calc(100%-2rem)] w-[360px] flex-col">
            <div className="pointer-events-auto flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-sky-400/30 bg-[#0a0a14]/92 shadow-2xl backdrop-blur-md">
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-sky-400" />
                  <span className="truncate text-[12px] font-semibold text-gray-200">IO 预览</span>
                  <span className="rounded-full bg-white/[0.06] px-1.5 py-px text-[10px] font-mono text-gray-400">
                    {Object.keys(workflowIO).length}
                  </span>
                </div>
                {hasIOOverrides && (
                  <button
                    type="button"
                    onClick={resetIOPreviewValues}
                    className="rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[11px] text-gray-300 transition-colors hover:bg-white/[0.08] hover:text-gray-100"
                    title="把所有参数恢复到工作流原本的默认值"
                  >
                    恢复默认
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIoPreviewOpen(false)}
                  className="rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[11px] text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-gray-200"
                  title="关闭预览"
                >
                  ✕
                </button>
              </div>
              <div className="nodrag nopan flex-1 overflow-y-auto px-3 py-3 text-gray-200">
                {Object.keys(workflowIO).length === 0 ? (
                  <div className="rounded-lg border border-dashed border-white/[0.10] bg-white/[0.02] px-3 py-4 text-center text-[11px] leading-relaxed text-gray-500">
                    尚未勾选任何 IO。
                    <br />
                    在画布上勾选参数后，这里会同步出现对应的表单行；每个名称旁的 ✎ 可点击重命名。
                  </div>
                ) : (
                  <DynamicWorkflowForm
                    io={previewIO}
                    values={defaultInputValues(previewIO)}
                    onChange={setIOValues}
                    compact
                    showOutputs
                    onLabelChange={setIOLabel}
                    /* R57: 必填 / 可选 toggle.  Preview only — purely
                     *  visual; the toggle writes into the same
                     *  workflowIO map that setIOLabel uses, which gets
                     *  shipped to the server on next PATCH. */
                    onRequiredChange={toggleIORequired}
                    /* R-ardot35: drag-to-reorder.  Only the canvas-side
                     *  IO preview exposes this — the author is editing
                     *  the workflow's IO layout here.  CreatePanel
                     *  intentionally doesn't (consumers just see the
                     *  result); WorkflowLibrary / canvas workflow
                     *  nodes also omit it (read-only surfaces). */
                    onReorder={reorderIO}
                    emptyHint={null}
                  />
                )}
              </div>
              <div className="shrink-0 border-t border-white/[0.06] px-3 py-1.5 text-[10px] text-gray-500">
                <span className="opacity-80">点击任意名称旁的</span>
                <span className="mx-1 inline-block rounded bg-white/[0.08] px-1 font-mono text-[10px] text-gray-300">✎</span>
                <span className="opacity-80">可重命名；「必填 / 可选」切换是否在运行时强校验。</span>
                <RequiredSummary io={previewIO} />
              </div>
            </div>
          </div>
        )}
        <NodeJsonViewerProvider detail={detail} rawMetaById={rawMetaById} positions={detail?.positions ?? null} subgraphRawContext={subgraphRawContext} subgraphStackLength={subgraphStack.length}>
        <RgthreeGroupsProvider workflowId={workflowId} detail={detail}>
        <IOEditContext.Provider
          value={{ ioEditMode, workflowIO, toggleIO, setIOLabel, toggleIORequired, reorderIO }}
        >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
          nodeTypes={wfNodeTypes}
          edgeTypes={wfEdgeTypes}
          /* `fitView` is intentionally NOT set here — we drive the
           *  initial viewport ourselves in a useEffect below so we can
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
            onClick={() => setCanvasSettingsOpen(true)}
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
        </IOEditContext.Provider>
        </RgthreeGroupsProvider>
        </NodeJsonViewerProvider>

        {/* Floating instruction tooltip */}
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-4 py-2 text-[11px] text-gray-400 backdrop-blur-sm">
          点击节点查看详情 · 拖拽移动节点位置 · 滚轮缩放
        </div>

        {/* R-ardot95: right-edge canvas settings drawer.  Portaled to
         *  document.body by the panel itself so it can sit above the
         *  WorkflowCanvasEditor root overlay stack (`z-50`); rendered
         *  only when the gear button is clicked. */}
        {canvasSettingsOpen && (
          <CanvasSettingsPanel
            settings={canvasSettings}
            update={updateCanvasSetting}
            reset={resetCanvasSettings}
            onClose={() => setCanvasSettingsOpen(false)}
          />
        )}

        {/* R-ardot118 (2026-08-18): global, separate execution-log panel.
         *  Gated entirely by the canvas "调试模式" setting (renders null
         *  when off), so it never competes with the node body for space
         *  and there is no per-node log toggle. */}
        <GlobalStepLogPanel />

        {/* 2026-08-11 R40: 顶部「📋 查看 JSON」触发的全屏 modal。
            派生数据由 `sourceModalData` (useMemo) 给出:
              - 顶层 detail: graph/rawJson 来自 detail
              - sub 视图: graph 来自 sub-detail, rawJson 切自父
                rawJson.definitions.subgraphs[uid] (R42 修复)
            关闭则清空 viewJsonOpen。 */}
        {viewJsonOpen && sourceModalData && (
          <SourceModal
            data={sourceModalData}
            onClose={() => setViewJsonOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

/* ── Public API ── */
