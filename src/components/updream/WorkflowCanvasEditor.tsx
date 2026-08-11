"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState, useContext } from "react";
import { createPortal } from "react-dom";
import { DarkSelect } from "@/components/updream/ui/DarkSelect";
import { PackageFooter } from "@/components/workflow-canvas/nodes/PackageFooter";
import { getCustomNodePackage, refreshCustomNodes } from "@/config/customNodes";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useStore,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  portColor,
  portLabel,
  inferInputType,
  inferOutputType,
  inferIsMultiline,
  edgeType,
  edgeTypeByInputName,
} from "@/lib/comfyui/types";
import { friendlyNodeTitle, friendlyInputName, friendlySubgraphLabel } from "@/lib/comfyui/node-titles";
import { renderMarkdown } from "@/lib/comfyui/markdown";
import { DynamicWorkflowForm } from "@/components/updream/shared/DynamicWorkflowForm";
import { defaultInputValues, type WorkflowIOMap } from "@/components/updream/shared/workflow-io";
import { WfEdge } from "@/components/updream/WfEdge";
import { SourceModal } from "@/components/updream/SourceModal";
import { useToast } from "@/components/updream/Toast";

/* ── Types ── */
interface RawInputMeta {
  /** ComfyUI input name (English field name). */
  name: string;
  /** Optional human-readable English label. */
  label?: string;
  /** Optional ComfyUI zh-CN localised label (preferred for display). */
  localized?: string;
  /** ComfyUI data type — MODEL, CLIP, IMAGE, INT, FLOAT, … */
  type: string;
  /** True when this slot is occupied by an upstream connection. */
  isConnection: boolean;
  /** True when this slot is fed by a sentinel boundary link (subgraph
   *  exposed input/output wire — origin_id=-10 / target_id=-20).  The
   *  inner-node side still carries the wire as a `link`, but the value
   *  isn't bound to a real source node id, so the row stays in widget
   *  shape yet must mount a target Handle so the boundary wire can
   *  anchor.  See `WorkflowCanvasEditor` fatal-pitfall #5. */
  isBoundary?: boolean;
  /** ComfyUI wrapper-node widget proxy (2026-08-06).  Set on inputs
   *  that back an internal widget; absent on pure connections.  Used
   *  by WfSubgraphNode to render a `VALUE` cell to the right of the
   *  label with the same colour rules as WfNode (`valueCellColor`). */
  widget?: { name: string };
  /** Pre-paired widget value (string/number/bool).  Paired index is
   *  the running count of widgets seen before this row in inputs[],
   *  matching ComfyUI's `widgets_values[]` ordering.  Undefined when
   *  `widget` is absent (i.e. a pure connection row — the inner
   *  node's value isn't surfaced through the wrapper). */
  widgetValue?: unknown;
  /** 2026-08-10 R18: server-stamped `multiline` flag — drives
   *  `isStringWidget` in WfNode / WfSubgraphNode so STRING inputs
   *  declared multiline by the upstream Python `INPUT_TYPES()` render
   *  as textareas regardless of how short the default value is.
   *  Computed by the server from a static (classType, name) table +
   *  length heuristic, since the API-format rawJson we receive does
   *  NOT preserve the original widget config (no `widgets[]` /
   *  `inputs[]`).  Stamped even when the widget spec has no
   *  `multiline` hint, because the heuristic only flags "definitely
   *  multiline" — absence means "no opinion". */
  multiline?: boolean;
  /** 2026-08-10 R27: when this IMAGE input is fed by a LoadImage-family
   *  upstream node, the server resolves the upstream's uploaded filename
   *  and stamps it here so the canvas can render an inline thumbnail via
   *  the /api/images proxy.
   *
   *  2026-08-10 R28: SCOPE NARROWED — only stamped on the synthetic
   *  `preview: true` entry that the server pushes for LoadImage nodes
   *  themselves; downstream IMAGE inputs (ImageScale / CLIPVisionEncode /
   *  …) no longer carry it, because showing the unscaled / un-encoded
   *  upstream image there is misleading.  May also be undefined on the
   *  synthetic preview entry itself — when widgets_values[0] is missing
   *  (no image uploaded), the renderer falls back to a 「需要上传图片」
   *  placeholder so the body always has its preview slot. */
  imageRef?: { filename: string; subfolder: string; type: string };
  /** 2026-08-10 R28: marker on the synthetic LoadImage preview entry.
   *  The renderer filters these out of BOTH connEntries and widgetEntries
   *  so they never paint a port-cylinder or a regular widget control —
   *  they're consumed exclusively by the dedicated <WfImagePreview> tail
   *  block.  This keeps LoadImage's body clean (no fake input cylinders
   *  on the left for the synthetic `image` entry) and guarantees the
   *  preview / placeholder rendering is single-sourced. */
  preview?: boolean;
}

interface ComfyGraphNode {
  id: string;
  class_type: string;
  title: string;
  /** True when class_type is a UUID (ComfyUI subgraph wrapper). */
  is_subgraph?: boolean;
  /** Per-input display metadata from raw JSON (localized_name + type). */
  raw_inputs?: RawInputMeta[];
  /** Exact ComfyUI/litegraph node box size [w, h].  Undefined when the
   *  import carried no raw size (API-only import) — the client then falls
   *  back to its content-driven layout.  `h` is the BODY height only; the
   *  30px title bar is painted above the box and is NOT included. */
  size?: [number, number];
  /** True if any of this node's input slots receives a wire from the
   *  subgraph's input sentinel node (-10) — meaning this node sits on
   *  the INPUTS boundary of the current subgraph.  Stamped by the
   *  /api/workflows/[id]/subgraph route so the client can wrap these
   *  nodes in an INPUTS wfGroup without re-walking the link table.
   *  Outer (top-level) workflows never set this true — every node is
   *  just a regular node there. */
  is_input_endpoint?: boolean;
  /** True if any of this node's output slots feeds the subgraph's
   *  output sentinel target (-20) — meaning this node sits on the
   *  OUTPUTS boundary.  Mirror of `is_input_endpoint`. */
  is_output_endpoint?: boolean;
  /** Boundary input port details for wfIoPort rendering (2026-08-05 v3).
   *  Only set when `is_input_endpoint` is true.  Captured by the
   *  subgraph route from the sentinel -10 link + matching widget value. */
  boundary_input?: { name: string; type: string; value: any } | null;
  /** Boundary output port details for wfIoPort rendering.  Only set
   *  when `is_output_endpoint` is true. */
  boundary_output?: { name: string; type: string } | null;
  /** First non-sentinel middle node this endpoint's outputs feed into
   *  internally (for INPUT endpoints).  The client positions the wfIoPort
   *  adjacent to this middle node. */
  connects_to?: string | null;
  /** First non-sentinel middle node this endpoint's inputs come from
   *  internally (for OUTPUT endpoints).  Mirror of connects_to. */
  connects_from?: string | null;
}

/** One exposed parameter chosen in IO-edit mode.  The `ioKey` is the object
 *  key (`${nodeId}::${kind}::${name}`); the value records what it is so the
 *  final workflow IO summary can be built without re-walking the graph. */
interface WorkflowIOParam {
  direction: "input" | "output";
  kind: "param" | "widget" | "output";
  nodeId: string;
  name: string;
  /** Optional user-renamed display label.  When absent / empty, the
   *  consumers fall back to `name` (the parameter name) via
   *  `ioLabel(e) = e.label ?? e.name`.  We intentionally do NOT seed
   *  this from `data.title` — node titles are shared between sibling
   *  pins of the same node (e.g. two `text` / `text_1` inputs on a
   *  single Text-to-Image node end up with the same title), which
   *  makes the IO summary useless.  Users can override per-pin via
   *  the IO preview panel's ✎ editor. */
  label?: string;
  /* ── Server-enriched fields (GET /api/workflows/[id], 2026-08-09) ──
   * Absent on entries that were just toggled locally (the checkbox only
   * writes the four identity fields); the server re-derives them from
   * raw_inputs / rawNodes.outputs on the next read, so treat as optional. */
  /** ComfyUI data type: "STRING" | "INT" | "FLOAT" | "BOOLEAN" | "IMAGE" | … */
  type?: string;
  /** Current widget value / graph literal, used to pre-fill dynamic forms. */
  defaultValue?: unknown;
  /** Owning node's title — disambiguates same-named pins across nodes. */
  nodeTitle?: string;
  /** STRING inputs that should render as a textarea rather than one-liner. */
  multiline?: boolean;
}

/** A single parameter reference used to toggle IO exposure. */
interface IoRef {
  nodeId: string;
  name: string;
  kind: "param" | "widget" | "output";
  direction: "input" | "output";
  label?: string;
}

/** Shared context so every custom node (WfNode / WfSubgraphNode) can read the
 *  current IO-edit mode + the live selection without re-building node `data`
 *  on every toggle.  Toggling updates `workflowIO` state here, and every
 *  consuming node re-renders directly via context. */
interface IOEditContextValue {
  ioEditMode: boolean;
  workflowIO: Record<string, WorkflowIOParam>;
  toggleIO: (ref: IoRef) => void;
  /** Update the user-facing display label for a single checked pin.  The
   *  new value is stored on `workflowIO[key].label` and persisted on the
   *  next `handleSave` (the existing PATCH body already ships the whole
   *  `workflowIO` map).  No-op when the key isn't currently in the map —
   *  labels only exist for checked pins. */
  setIOLabel: (key: string, label: string) => void;
}
const IOEditContext = React.createContext<IOEditContextValue | null>(null);

/* ── rgthree Fast Groups Bypasser integration (2026-08-09) ──
 * rgthree's `Fast Groups Bypasser` is a utility node whose LiteGraph
 * definition carries ZERO inputs — its entire body is computed at
 * runtime by scanning the graph for groups matching the node's
 * `properties` (matchTitle, matchColors, sort, ...).  We replicate
 * that runtime here so the node renders the same way it does inside
 * ComfyUI + rgthree's frontend:
 *
 *   1. Read groups from the editor's detail (single source of truth).
 *   2. Filter by `matchTitle` (case-insensitive substring).  rgthree
 *      also supports a `matchColors` palette, but the property is a
 *      free-form string ("cyan", "#8AA", …) and the matching rule is
 *      perceptual; for v1 we keep the title filter (which is what
 *      the user actually configures 99% of the time) and skip colour.
 *   3. Sort alphanumerically by group title (rgthree default; the
 *      `sort` property is honoured when it parses to a known mode).
 *   4. Render one toggle row per match, label `Enable <matchTitle><idx>`
 *      (zero-padded to at least 2 digits), with a toggle bound to the
 *      group's bypass state.
 *   5. Toggle click → optimistic local override + PATCH
 *      `/api/workflows/{id}` with `{groups:[{id, bypass}]}`.  The
 *      route writes `rawJson.groups[i].flags.bypass` and invalidates
 *      the detail cache.
 */
interface RgthreeGroupsContextValue {
  /** Effective bypass for a group id (override > detail). */
  getBypass: (groupId: string) => boolean;
  /** Flip a group's bypass state; PATCHes server + sets local override. */
  setBypass: (groupId: string, bypass: boolean) => void;
}
const RgthreeGroupsContext = React.createContext<RgthreeGroupsContextValue | null>(null);

function RgthreeGroupsProvider({
  workflowId,
  detail,
  children,
}: {
  workflowId: string;
  detail: WorkflowDetail | null;
  children: React.ReactNode;
}) {
  /* Optimistic overrides: groupId → bypass.  Wins over
   * `detail.groups[].bypass` until cleared (a successful PATCH followed
   * by a detail refetch reconciles).  This is the standard
   * "optimistic-update" pattern — the toggle snaps to the new state
   * immediately and the server write is fire-and-forget.  A failure
   * leaves the override in place; the next detail refetch will
   * reconcile once the cache TTL (30s) elapses. */
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const getBypass = useCallback(
    (groupId: string) => {
      if (Object.prototype.hasOwnProperty.call(overrides, groupId)) {
        return overrides[groupId];
      }
      const g = detail?.groups?.find((x) => x.id === groupId);
      return !!g?.bypass;
    },
    [overrides, detail]
  );
  const setBypass = useCallback(
    (groupId: string, bypass: boolean) => {
      setOverrides((prev) => ({ ...prev, [groupId]: bypass }));
      void fetch(`/api/workflows/${encodeURIComponent(workflowId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groups: [{ id: groupId, bypass }] }),
      }).catch(() => {});
    },
    [workflowId]
  );
  const value = useMemo<RgthreeGroupsContextValue>(
    () => ({ getBypass, setBypass }),
    [getBypass, setBypass]
  );
  return (
    <RgthreeGroupsContext.Provider value={value}>
      {children}
    </RgthreeGroupsContext.Provider>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 *  NodeJsonViewer  ─  clickable #id chip → popover with raw workflow JSON
 * ────────────────────────────────────────────────────────────────────────
 *  When the user clicks a node's right-aligned `#182` chip in its header
 *  (or `#abcdef12` for a subgraph), a popover opens pinned next to that
 *  chip and shows the EXACT entry of `detail.graph[nodeId]` — i.e. the
 *  literal JSON record ComfyUI would serialise back when you re-export
 *  this workflow.  Nothing gets rounded, summarised, or filtered: the
 *  author can see `widgets_values[2]`, `[1, 28]`, etc. byte-for-byte.
 *
 *  Rationale:
 *   • Diagnose "what did the JSON actually save?"  Field name drift
 *     between LiteGraph local IDs (`9b9009e4-…`) and ComfyUI IDs (`76`)
 *     used to confuse the eye — this puts the raw entry on screen.
 *   • Discover `mode` toggles (`mode: 2` → muted/grey), extra properties
 *     (`cnr_id`, `frontend_only`), and what the saved `widgets_values`
 *     array looks like vs. what's displayed.
 *
 *  Data flow:
 *   • `NodeJsonViewerProvider` lives at the `WorkflowCanvasEditor` root,
 *     so the whole tree sees the current `detail`.
 *   • WfNode / WfSubgraphNode call `ctx.requestShow(anchorEl, nodeId,
 *     kind)` from the `#id` chip — a stopPropagation-guarded click.
 *   • The popover is rendered through a React Portal to `document.body`
 *     so it floats ABOVE the React Flow viewport's `overflow: hidden`
 *     without being clipped at the canvas edge.  Position is computed
 *     from the chip's bounding-rect + viewport scroll, NOT from the
 *     React Flow `transform` — that way zoom/pan never shifts it.
 *
 *  Close triggers:
 *   • ESC key       ─ top-level listener cleared on unmount.
 *   • Outside click ─ click on the floating backdrop dismisses.
 *   • × button     ─ explicit close.
 *  The chip itself stays registered as a "double-tap to reopen" anchor
 *  to allow quick re-toggle. */
interface NodeJsonViewerRequest {
  /** `DOMRect` of the `#id` chip that triggered the popover.  Captured
   *  when the user clicks, then frozen for the lifetime of the popover
   *  so re-renders (or pan/zoom) don't drag it around mid-read. */
  anchorRect: { left: number; top: number; right: number; bottom: number; width: number; height: number };
  /** ComfyUI workflow JSON key — `data.nodeId`.  For subgraphs this is
   *  ALSO the same key (subgraph wrappers are top-level entries in
   *  `graph`, not nested). */
  nodeId: string;
  /** Visual distinction (affects popover accent + chip color echo). */
  kind: "node" | "subgraph";
}
interface NodeJsonViewerContextValue {
  /** Lookup the raw `detail.graph[nodeId]` entry.  Pure read — returns
   *  `null` when `detail` hasn't loaded yet (top bar Loading… state) or
   *  the key isn't present (e.g. fully-decorated node whose API form
   *  omits the entry). */
  getNodeJson: (nodeId: string) => Record<string, any> | null;
  /** Richer lookup covering the same node for the popover's "节点视图"
   *  synthesised tab — bundles the byte-perfect graph entry together
   *  with the raw-ui metadata (`detail.rawNodes[i]` matched by id) and
   *  the canvas position (`detail.positions[id]`).  `raw` and `pos` are
   *  `undefined` / `null` for API-only imports. */
  getNodeView: (
    nodeId: string
  ) => {
    entry: Record<string, any> | null;
    raw:
      | {
          widgets_values: any[];
          outputs: RawOutputMeta[];
          flags: Record<string, any>;
          properties: Record<string, any>;
          mode: number;
        }
      | undefined;
    /** Literal RAW node (`detail.rawJson.nodes[i]`) — byte-identical to the
     *  corresponding slice of the whole-workflow RAW view. `null` when the
     *  workflow was API-only imported (no rawJson) or the node isn't found. */
    rawNode?: Record<string, any> | null;
    pos: [number, number] | null;
  } | null;
  /** Show the popover.  `anchorEl` should be the `#id` chip element
   *  (used for positioning only — pointer-events fire on it AFTER the
   *  popover is mounted, so we capture rect synchronously here). */
  requestShow: (anchorEl: HTMLElement, nodeId: string, kind: "node" | "subgraph") => void;
  /** Manually dismiss.  ESC and outside-click both call this. */
  dismiss: () => void;
  /** Live viewer state — Provider exposes it ONLY for the popover
   *  component itself; downstream consumers normally only need
   *  requestShow/getNodeJson. */
  viewer: NodeJsonViewerRequest | null;
}
const NodeJsonViewerContext = React.createContext<NodeJsonViewerContextValue | null>(null);

/* Capture-rect helper: read a `DOMRect` and freeze the stable bits
 *  (positions only; width/height are recomputed live from the rect
 *  snapshot so an editor font load doesn't desync).  Done as a helper
 *  rather than inline so the same shape is used by requestShow and
 *  by the popover positioning effect. */
function rectToAnchor(rect: DOMRect): NodeJsonViewerRequest["anchorRect"] {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

/* Raw metadata the parent (`WorkflowCanvasEditor`) has already memoised
 *  at line 4948 — we accept it directly rather than recomputing from
 *  `detail.rawNodes` to avoid a second pass over the same array on every
 *  popover open. */
type RawMetaEntry = {
  widgets_values: any[];
  outputs: RawOutputMeta[];
  flags: Record<string, any>;
  properties: Record<string, any>;
  mode: number;
};

function NodeJsonViewerProvider({
  detail,
  rawMetaById,
  positions,
  /* 2026-08-11 R47: 子图单节点 RAW 需要父 rawJson 切出的子图 raw def。
   * 这两个值在主组件声明、provider 拿不到，故以 prop 传入。 */
  subgraphRawContext,
  subgraphStackLength,
  children,
}: {
  detail: WorkflowDetail | null;
  rawMetaById: Record<string, RawMetaEntry>;
  positions: Record<string, [number, number]> | null;
  subgraphRawContext: { parentRawJson: unknown; subUid: string } | null;
  subgraphStackLength: number;
  children: React.ReactNode;
}) {
  const [viewer, setViewer] = useState<NodeJsonViewerRequest | null>(null);

  const getNodeJson = useCallback(
    (nodeId: string) => {
      if (!detail || !detail.graph) return null;
      const entry = detail.graph[nodeId];
      return entry && typeof entry === "object" ? (entry as Record<string, any>) : null;
    },
    [detail]
  );

  const getNodeView = useCallback(
    (nodeId: string) => {
      if (!detail) return null;
      const rawEntry = detail.graph?.[nodeId];
      const entry =
        rawEntry && typeof rawEntry === "object" ? (rawEntry as Record<string, any>) : null;

      /* 2026-08-11 R47: 子图视图下 `detail.rawJson` 为 undefined（sub-detail
       * 不返回 rawJson），导致 sub 节点的 RAW · 节点视图退回「合成体」、
       * 与非子图（直接展示真·RAW 节点）结构不一致。子图自己的 LiteGraph
       * 定义其实藏在父 `rawJson.definitions.subgraphs[subUid].nodes` 里
       * （route.ts 确认其 nodes 形状与顶层 raw.nodes[i] 完全一致）。
       * 这里优先从 `subgraphRawContext` 切出子图 raw def 的 nodes 查 rawNode；
       * 顶层 / 无 ctx / 父非 RAW 导入时回退到顶层 `detail.rawJson.nodes`
       * （仍无则 null → 合成体，与 API-only 导入行为一致，不退化）。 */
      let rawNodesSource: any[] | null = null;
      const isSubView = subgraphStackLength > 0 && subgraphRawContext;
      if (isSubView) {
        const subs = (
          subgraphRawContext!.parentRawJson as
            | { definitions?: { subgraphs?: Record<string, any> } }
            | null
        )?.definitions?.subgraphs;
        /* 镜像 server route (route.ts line 73-78) 的兜底：
         *  - 先按 key 直接查 `subs[uid]`（标准 ComfyUI 工作流：subgraphs
         *    的 key 就是子图节点的 class_type，即 UUID）
         *  - miss 时按 sub.id 回查（处理 subgraphs 按数字 ID 编号的旧格式）
         *  这样无论 server 端能查到哪个子图 def，client 都能找到同一份
         *  raw def，节点 JSON 结构与非子图完全一致。 */
        const targetUid = subgraphRawContext!.subUid;
        let subDef: any = subs?.[targetUid];
        if (!subDef || !Array.isArray(subDef.nodes)) {
          const matchKey = subs
            ? Object.keys(subs).find((k) => subs[k]?.id === targetUid)
            : undefined;
          if (matchKey && subs) subDef = subs[matchKey];
        }
        if (subDef && Array.isArray(subDef.nodes)) {
          rawNodesSource = subDef.nodes as any[];
        }
      }
      if (!rawNodesSource && Array.isArray((detail.rawJson as any)?.nodes)) {
        rawNodesSource = (detail.rawJson as any).nodes as any[];
      }
      const rawNode = rawNodesSource
        ? (rawNodesSource.find((n) => String(n?.id) === nodeId) ?? null)
        : null;

      return {
        entry,
        raw: rawMetaById?.[nodeId],
        rawNode,
        pos: positions?.[nodeId] ?? null,
      };
    },
    [detail, rawMetaById, positions, subgraphRawContext, subgraphStackLength]
  );

  const requestShow = useCallback(
    (anchorEl: HTMLElement, nodeId: string, kind: "node" | "subgraph") => {
      const rect = anchorEl.getBoundingClientRect();
      setViewer({
        anchorRect: rectToAnchor(rect),
        nodeId,
        kind,
      });
    },
    []
  );

  const dismiss = useCallback(() => setViewer(null), []);

  const value = useMemo<NodeJsonViewerContextValue>(
    () => ({ getNodeJson, getNodeView, requestShow, dismiss, viewer }),
    [getNodeJson, getNodeView, requestShow, dismiss, viewer]
  );

  return (
    <NodeJsonViewerContext.Provider value={value}>
      {children}
      {viewer && (
        <NodeJsonPopover
          key={`${viewer.nodeId}-${viewer.kind}`}
          request={viewer}
          getJson={getNodeJson}
          getView={getNodeView}
          onDismiss={dismiss}
        />
      )}
    </NodeJsonViewerContext.Provider>
  );
}

/* The popover itself.  Three blocks stacked vertically:
 *   ┌────────────────────────────────────────────────┐
 *   │  Header  ─  📋 节点 JSON · #182 · class_type   │
 *   │              [⧉ 复制]   [× 关闭]                │
 *   ├────────────────────────────────────────────────┤
 *   │  Meta strip — mode / flags / boundaries / etc   │
 *   ├────────────────────────────────────────────────┤
 *   │  JSON dump — monospace, syntax-toned, copyable  │
 *   └────────────────────────────────────────────────┘
 *
 *  Where it sits:
 *    • Pin to the RIGHT of the chip, 8px gap, 24px inset from the screen
 *      edge.  If overflowing, flip LEFT of the chip.
 *    • Vertically aligned to the chip's centre, but clamped to within
 *      24px of the viewport's top and bottom (max-height: 60vh).
 *
 *  Visual mirrors the SourceModal (2026-08-09): dark aurora + monospace +
 *  friendly copy-button + backdrops match --color-bg from globals.css. */
function NodeJsonPopover({
  request,
  getJson,
  getView,
  onDismiss,
}: {
  request: NodeJsonViewerRequest;
  getJson: (nodeId: string) => Record<string, any> | null;
  /** Richer accessor returning `{ entry, raw, pos }` — `raw` and `pos` are
   *  undefined/null for API-only imports. */
  getView: (
    nodeId: string
  ) => {
    entry: Record<string, any> | null;
    raw?: {
      widgets_values: any[];
      outputs: RawOutputMeta[];
      flags: Record<string, any>;
      properties: Record<string, any>;
      mode: number;
    };
    /** Literal RAW node (`detail.rawJson.nodes[i]`) when present. */
    rawNode?: Record<string, any> | null;
    pos: [number, number] | null;
  } | null;
  onDismiss: () => void;
}) {
  const json = useMemo(() => getJson(request.nodeId), [getJson, request.nodeId]);
  const nodeView = useMemo(() => getView?.(request.nodeId) ?? null, [getView, request.nodeId]);
  /* Tab: "saved" = byte-perfect `detail.graph[nodeId]` (default OFF since
   *  users hit the chip wanting to see MORE, not less), "view" =
   *  synthesised canvas-state entry aggregating `raw` + `pos` from the
   *  raw metadata layer.  Default "view" because the "saved" tab was
   *  exactly what the user already saw and complained about. */
  const [tab, setTab] = useState<"saved" | "view">("view");
  /* Synthesised node-view object (only meaningful on `view` tab).  When the
   *  workflow was RAW-imported we prefer the LITERAL raw node
   *  (`nodeView.rawNode` = `detail.rawJson.nodes[i]`) so this tab is
   *  byte-identical to the corresponding slice of the whole-workflow RAW
   *  view.  We fall back to a sparse recombination (graph entry + raw
   *  metadata + pos) only for API-only imports where no rawJson exists. */
  const viewObj = useMemo<Record<string, any> | null>(() => {
    if (!nodeView) return null;
    if (nodeView.rawNode && typeof nodeView.rawNode === "object") {
      return nodeView.rawNode as Record<string, any>;
    }
    const out: Record<string, any> = {};
    const e = nodeView.entry;
    const r = nodeView.raw;
    if (e && typeof e.class_type === "string") out.class_type = e.class_type;
    if (e && typeof e === "object" && "inputs" in e) out.inputs = e.inputs;
    if (e && e._meta && Object.keys(e._meta as Record<string, any>).length) out._meta = e._meta;
    if (r) {
      if (r.mode !== 0) out.mode = r.mode;
      if (r.widgets_values?.length) out.widgets_values = r.widgets_values;
      if (r.outputs?.length) out.outputs = r.outputs;
      const flagKeys = Object.keys(r.flags ?? {});
      if (flagKeys.length) out.flags = r.flags;
      const propKeys = Object.keys(r.properties ?? {});
      if (propKeys.length) out.properties = r.properties;
    }
    if (nodeView.pos) out.pos = nodeView.pos;
    return Object.keys(out).length ? out : null;
  }, [nodeView]);
  const pretty = useMemo(() => {
    if (tab === "saved") {
      return json ? JSON.stringify(json, null, 2) : "（节点详情尚未加载 — 等待 detail.ready）";
    }
    if (viewObj) return JSON.stringify(viewObj, null, 2);
    if (json) {
      /* No raw metadata (API-only import) — still synthesise a thin view
       *  from the byte-perfect entry so the user sees SOMETHING on this
       *  tab instead of a confusing empty box. */
      const thin: Record<string, any> = {};
      if (typeof json.class_type === "string") thin.class_type = json.class_type;
      if (json.inputs && typeof json.inputs === "object") thin.inputs = json.inputs;
      if (json._meta && Object.keys(json._meta as Record<string, any>).length) thin._meta = json._meta;
      if (Object.keys(thin).length) return JSON.stringify(thin, null, 2);
    }
    return "（节点详情尚未加载 — 等待 detail.ready）";
  }, [tab, json, viewObj]);
  const [copied, setCopied] = useState(false);

  /* Position computation runs on every render — nothing here depends
   *  on dynamic layout (the chip rect is FROZEN at request-time), so
   *  pan/zoom/etc. don't move the popover.  We also re-run on each
   *  resize via window listener so dragging the editor border keeps
   *  the popover aligned with the chip (the chip itself moves when
   *  the canvas resizes, so we watch it). */
  const [position, setPosition] = useState<{ left: number; top: number }>(() => computePos(request.anchorRect));
  useEffect(() => {
    const update = () => setPosition(computePos(request.anchorRect));
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [request.anchorRect]);

  /* ESC dismiss.  Listener attached/detached on demand so other
   *  components (SourceModal, settings dialogs) can keep their own
   *  ESC handlers — only one effect is active at a time, but if two
   *  were mounted we'd let both fire and the higher layer would
   *  close.  Acceptable for now; revisit when simultaneous modals
   *  become a real concern. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  const handleCopy = () => {
    void navigator.clipboard.writeText(pretty).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      },
      () => {
        /* Clipboard denied (offline / sandbox / non-secure context).  Fall
         *  back to the legacy textarea selection dance. */
        const ta = document.createElement("textarea");
        ta.value = pretty;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy");
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch {
          /* give up; user can still select-and-copy manually */
        } finally {
          document.body.removeChild(ta);
        }
      }
    );
  };

  /* Popover accent — echo the colour of the trigger chip so the user
   *  sees a visual continuity (subgraphs: violet, regular: muted grey).
   *  Same accent drives both the title bar underline and the meta strip
   *  background tint. */
  const accent = request.kind === "subgraph" ? "#7C5CFC" : "#5BC6FF";
  const nodeClass = (json?.class_type ?? "?") as string;
  /* Mode resolution order: raw.mode (most reliable, present for raw-imported
   *  workflows) → json._meta.mode (ComfyUI's official _meta title/mode
   *  channel, when set by `convertRawToApi`) → top-level json.mode (legacy,
   *  never the case for API format but harmless) → 0. */
  const nodeMode = (
    typeof nodeView?.raw?.mode === "number"
      ? nodeView.raw.mode
      : typeof (json as any)?._meta?.mode === "number"
        ? (json as any)._meta.mode
        : typeof json?.mode === "number"
          ? json.mode
          : 0
  ) as number;
  const modeLabel =
    nodeMode === 4 ? "Bypass" : nodeMode === 2 ? "Disabled" : "Normal";
  const modeColor =
    nodeMode === 4 ? "#ec4899" : nodeMode === 2 ? "#6b7280" : "#10B981";

  return typeof document === "undefined"
    ? null
    : createPortal(
        <>
          {/* Semi-opaque click catcher.  NOT a modal — the canvas stays
           *  draggable behind it (pointer-events on the backdrop are
           *  auto, but stacked below the card); a click outside dismisses
           *  via the backdrop's `onMouseDown`. */}
          <div
            aria-hidden
            onMouseDown={onDismiss}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.20)",
              zIndex: 9000,
            }}
          />
          <div
            role="dialog"
            aria-modal="false"
            aria-label={`节点 #${request.nodeId} 的原始 JSON`}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              left: position.left,
              top: position.top,
              zIndex: 9001,
              width: 460,
              maxHeight: "60vh",
              borderRadius: 12,
              background: "var(--color-bg, #0a0a0f)",
              border: `1px solid ${accent}55`,
              boxShadow:
                "0 20px 48px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04) inset, 0 0 24px " +
                accent +
                "33",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              fontFamily:
                'system-ui, -apple-system, "Segoe UI", "Noto Sans SC", sans-serif',
            }}
          >
            {/* Top accent stripe — 2px coloured ribbon under the header. */}
            <div
              aria-hidden
              style={{
                height: 2,
                background: `linear-gradient(90deg, ${accent} 0%, ${accent}55 60%, transparent 100%)`,
              }}
            />

            {/* HEADER — node id, class_type, controls */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 12px 8px 14px",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  minWidth: 0,
                  flex: 1,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11,
                    color: "var(--color-muted, #9A9AAD)",
                    textTransform: "uppercase",
                    letterSpacing: 0.6,
                  }}
                >
                  <span style={{ fontSize: 11 }}>📋</span>
                  <span>节点 JSON</span>
                  <span style={{ color: "rgba(255,255,255,0.18)" }}>·</span>
                  <span
                    style={{
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                      color: accent,
                    }}
                  >
                    #{request.nodeId}
                  </span>
                </div>
                <div
                  title={nodeClass}
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--color-ink, #EDEDF2)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {nodeClass}
                </div>
              </div>
              <button
                type="button"
                onClick={handleCopy}
                title="复制 JSON 到剪贴板"
                style={{
                  fontSize: 11,
                  padding: "4px 8px",
                  borderRadius: 6,
                  background: copied ? `${accent}26` : "rgba(255,255,255,0.04)",
                  color: copied ? accent : "var(--color-ink, #EDEDF2)",
                  border: `1px solid ${copied ? accent + "66" : "rgba(255,255,255,0.08)"}`,
                  cursor: "pointer",
                  transition: "all 120ms ease",
                }}
              >
                {copied ? "✓ 已复制" : "⧉ 复制"}
              </button>
              <button
                type="button"
                onClick={onDismiss}
                title="关闭 (Esc)"
                aria-label="关闭"
                style={{
                  width: 26,
                  height: 26,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "var(--color-muted, #9A9AAD)",
                  cursor: "pointer",
                  fontSize: 14,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>

            {/* TAB STRIP — RAW (left, default) shows the literal raw node
             *  `detail.rawJson.nodes[id]` so it is byte-identical to the
             *  corresponding slice of the whole-workflow RAW view; API
             *  (right) shows the byte-perfect `detail.graph[nodeId]`
             *  execution entry.  Default "view" (RAW) because that's what
             *  the user wants to inspect the canvas metadata. */}
            <div
              role="tablist"
              aria-label="节点 JSON 视图切换"
              style={{
                display: "flex",
                gap: 4,
                padding: "6px 10px 0 14px",
                background: "rgba(255,255,255,0.01)",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              {(["view", "saved"] as const).map((t) => {
                const active = tab === t;
                return (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setTab(t)}
                    title={
                      t === "saved"
                        ? "API 格式：detail.graph[nodeId] —— ComfyUI /prompt 用的执行条目；不含画布元数据(pos/size/flags/order/inputs.spec)"
                        : "RAW 格式：detail.rawJson.nodes[id] —— 与整工作流「查看 JSON」RAW 逐字节一致；无 rawJson(API 导入)时回退到合成体"
                    }
                    style={{
                      fontFamily:
                        'ui-monospace, SFMono-Regular, Menlo, "Cascadia Mono", Consolas, monospace',
                      fontSize: 11,
                      padding: "5px 10px",
                      borderRadius: "6px 6px 0 0",
                      border: `1px solid ${active ? accent + "55" : "rgba(255,255,255,0.04)"}`,
                      borderBottom: active
                        ? `1px solid ${accent}33`
                        : "1px solid rgba(255,255,255,0.04)",
                      background: active
                        ? `${accent}22`
                        : "rgba(255,255,255,0.02)",
                      color: active
                        ? "var(--color-ink, #EDEDF2)"
                        : "var(--color-muted, #9A9AAD)",
                      cursor: "pointer",
                      transition: "all 120ms ease",
                    }}
                  >
                    {t === "saved" ? "API · 保存格式" : "RAW · 节点视图"}
                  </button>
                );
              })}
            </div>

            {/* META STRIP — mode / flags badges, lets the user see "why
             *  is the node grey?" without scrolling the JSON.  On the
             *  "saved" tab we read from the byte-perfect entry; on the
             *  "view" tab we read from the synthesised viewObj (which
             *  prefers raw.metadata.* as the source of truth). */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                padding: "8px 14px",
                background: `${accent}11`,
                borderBottom: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <Chip color={modeColor} label={`mode ${nodeMode} · ${modeLabel}`} />
              {tab === "saved" ? (
                <>
                  {json && "widgets_values" in json && (
                    <Chip color="#a1a1aa" label={`widgets: ${(json.widgets_values as any[])?.length ?? 0} 项`} />
                  )}
                  {json && "inputs" in json && (
                    <Chip color="#a1a1aa" label={`inputs: ${Object.keys((json.inputs as Record<string, any>) ?? {}).length} 个`} />
                  )}
                  {json && "outputs" in json && (
                    <Chip color="#a1a1aa" label={`outputs: ${(json.outputs as any[])?.length ?? 0} 个`} />
                  )}
                  {!json && <Chip color="#f59e0b" label="节点未在 graph 中" />}
                </>
              ) : (
                <>
                  {viewObj?.inputs && (
                    <Chip color="#a1a1aa" label={`inputs: ${Object.keys(viewObj.inputs as Record<string, any> ?? {}).length} 个`} />
                  )}
                  {viewObj?.outputs && Array.isArray(viewObj.outputs) && (
                    <Chip color="#a1a1aa" label={`outputs: ${(viewObj.outputs as any[]).length} 个`} />
                  )}
                  {viewObj?.widgets_values && Array.isArray(viewObj.widgets_values) && (
                    <Chip color="#a1a1aa" label={`widgets: ${(viewObj.widgets_values as any[]).length} 项`} />
                  )}
                  {viewObj?.properties && (
                    <Chip color="#a1a1aa" label={`properties: ${Object.keys(viewObj.properties as Record<string, any> ?? {}).length} 项`} />
                  )}
                  {viewObj?.pos && Array.isArray(viewObj.pos) && (
                    <Chip color="#a1a1aa" label={`pos: ${(viewObj.pos as number[]).map((n) => Math.round(n)).join(", ")}`} />
                  )}
                  {!viewObj && (
                    <Chip color="#f59e0b" label="无画布态数据 — 纯 API 工作流" />
                  )}
                </>
              )}
            </div>

            {/* JSON DUMP — scrollable body, monospace, syntax-toned by
             *  wrapping the value in a <pre>.  Native copy is still
             *  possible (Ctrl/Cmd+A → C works inside).  Re-keying on
             *  nodeId + tab re-mounts the pre so e.g. selection is
             *  preserved on the SAME tab but reset when switching. */}
            <pre
              key={`${request.nodeId}-${request.kind}-${tab}-${pretty.length}`}
              style={{
                margin: 0,
                padding: "12px 14px",
                overflow: "auto",
                flex: 1,
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, "Cascadia Mono", Consolas, monospace',
                fontSize: 11.5,
                lineHeight: 1.55,
                color: "var(--color-ink, #EDEDF2)",
                background: "rgba(255,255,255,0.02)",
                whiteSpace: "pre",
                userSelect: "text",
              }}
            >
              {pretty}
            </pre>

            {/* FOOTER — per-tab footer copy so each tab's guarantee is
             *  stated unambiguously.  Same UX as before for "saved";
             *  "view" makes it explicit that this is a diagnostic
             *  synthesis and NOT what's saved to disk. */}
            <div
              style={{
                padding: "6px 14px 8px",
                fontSize: 10.5,
                color: "var(--color-muted, #9A9AAD)",
                borderTop: "1px solid rgba(255,255,255,0.06)",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>
                {tab === "saved"
                  ? "展示的是 `detail.graph[nodeId]` 原始条目，再导出后字节级一致。"
                  : "画布视图：聚合 raw 元数据 + 画布坐标；非导出字节 — 仅排查用。"}
              </span>
              <span style={{ fontFamily: "ui-monospace, monospace" }}>esc ×</span>
            </div>
          </div>
        </>,
        document.body
      );
}

/* Compute popover anchor position relative to viewport.
 *  Heuristic:
 *    • default ─ to the RIGHT of the chip, 8px gap
 *    • fallback ─ if right would overflow 24px screen inset, flip LEFT
 *    • vertical ─ align chip center, clamped 24px from top/bottom */
function computePos(rect: { left: number; top: number; right: number; width: number; height: number }): {
  left: number;
  top: number;
} {
  const POPOVER_W = 460;
  const GAP = 8;
  const INSET = 24;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  /* Place the popover's LEFT edge here.  Try RIGHT first; flip LEFT if
   *  it would push past the viewport (i.e., chip-left + chip-width + gap
   *  + popover-width > viewport - inset). */
  const rightCandidate = rect.left + rect.width + GAP;
  const leftFits = rightCandidate + POPOVER_W + INSET <= vw;
  const left = leftFits ? rightCandidate : Math.max(INSET, rect.left - GAP - POPOVER_W);
  /* Vertical center on chip — clamp so the popover stays inside vh with
   *  a 24px top and bottom buffer (max-height 60vh is enforced in the
   *  popover style — this just keeps the anchor near the chip). */
  const chipCenter = rect.top + rect.height / 2;
  const desiredTop = chipCenter - 32; // header is ~64px tall
  const top = Math.min(Math.max(INSET, desiredTop), vh - INSET - 64);
  return { left, top };
}

/* Small metadata chip used in the meta strip.  Plain styled span — no
 *  button semantics needed (clicking does nothing). */
function Chip({ color, label }: { color: string; label: string }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        padding: "2px 7px",
        borderRadius: 999,
        background: `${color}1f`,
        border: `1px solid ${color}55`,
        color,
        letterSpacing: 0.2,
      }}
    >
      {label}
    </span>
  );
}

/** Body for rgthree's `Fast Groups Bypasser`.  Renders the matched
 *  groups as toggle rows that flip the group's `flags.bypass` on click.
 *  Matches the rgthree label convention: "Enable <matchTitle><idx>". */
function RgthreeFastGroupsBypasserBody({
  matchTitle,
  groups,
}: {
  matchTitle: string;
  groups: WorkflowGroup[];
}) {
  const ctx = React.useContext(RgthreeGroupsContext);
  if (!ctx) return null;
  const needle = matchTitle.trim().toLowerCase();
  if (!needle) return null;
  const matches = groups
    .filter((g) => (g.title || "").toLowerCase().includes(needle))
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title));
  if (matches.length === 0) return null;
  const pad = Math.max(2, String(matches.length).length);
  return (
    <div className="flex flex-col gap-[2px] px-1 pb-1">
      {matches.map((g, i) => {
        const idx = String(i + 1).padStart(pad, "0");
        const label = `Enable ${matchTitle}${idx}`;
        const bypass = ctx.getBypass(g.id);
        return (
          <div
            key={g.id}
            className="group relative flex h-[22px] items-center gap-1.5 pl-2 pr-2 text-[11px]"
          >
            <span
              className="min-w-0 shrink truncate text-left text-[11px]"
              style={{ flex: "0 1 auto", color: bypass ? "#71717a" : "#d4d4d8" }}
              title={g.title}
            >
              {label}
            </span>
            <span className="h-2 w-px shrink-0 bg-white/[0.05]" aria-hidden />
            <span
              className="min-w-0 truncate text-right text-[10.5px] tabular-nums"
              style={{ flex: "1 1 0", color: bypass ? "#ec4899" : "#a1a1aa" }}
            >
              {bypass ? "yes" : "no"}
            </span>
            {/* The toggle itself — a small clickable chip that flips the
             *  group's bypass via the context.  Uses a div+role=button
             *  pattern (consistent with the row-inline-button iron law)
             *  and stops pointer events so ReactFlow's drag handler
             *  never sees the click. */}
            <div
              role="button"
              tabIndex={0}
              aria-pressed={bypass}
              title={bypass ? "点击取消旁路" : "点击旁路此 group"}
              onClick={(e) => {
                e.stopPropagation();
                ctx.setBypass(g.id, !bypass);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  ctx.setBypass(g.id, !bypass);
                }
              }}
              style={{
                marginLeft: 6,
                width: 26,
                height: 14,
                borderRadius: 7,
                background: bypass
                  ? "rgba(236, 72, 153, 0.55)"
                  : "rgba(63, 63, 70, 0.55)",
                border: "1px solid rgba(255,255,255,0.18)",
                position: "relative",
                cursor: "pointer",
                flex: "0 0 auto",
                transition: "background 120ms",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 1,
                  left: bypass ? 13 : 1,
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  background: bypass ? "#fce7f3" : "#d4d4d8",
                  transition: "left 120ms",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Hardcoded classType → package mapping for well-known custom node packs
 *  that the manifest parser misses (e.g. its source tree isn't on the
 *  parse path, or its `MAPPING/CATEGORY` carries no package declaration).
 *  Keep this list narrow — anything beyond ~5 entries signals we should
 *  extend the parser instead.
 *
 *  Currently:
 *   • efficiency-nodes' SetNode / GetNode — its pkg has no on-disk marker
 *     in our install and its nodes carry no `cnr_id`, so we hard-code the
 *     attribution. */
const KNOWN_PACKAGE_HEURISTIC: Record<string, string> = {
  SetNode: "efficiency-nodes",
  GetNode: "efficiency-nodes",
};

/** Resolve the package-source label for a workflow node.
 *
 *  Resolution order (first non-empty wins):
 *    1. `getCustomNodePackage(classType)` — populated by
 *       `refreshCustomNodes()` from the on-disk custom-nodes manifest.
 *       Most accurate when present (exact directory name).
 *    2. `KNOWN_PACKAGE_HEURISTIC[classType]` — manual fallback for
 *       packages the parser missed (see above).
 *    3. `properties.cnr_id` — ComfyUI's own "this node was registered
 *       with registry X" stamp.  Treats the literal `"comfy-core"` as
 *       built-in (ComfyUI uses that string for internal LiteGraph UUID
 *       classes like `Extension` / `Preview3D`).
 *    4. `(rgthree)` suffix shortcut — `Fast Groups Bypasser (rgthree)`,
 *       `Power Lora Loader (rgthree)`, etc. live under the `rgthree-comfy`
 *       directory regardless of manifest/cnr_id state.  Suffix keyword kept
 *       in sync with the registered packages' `MAPPING` convention.
 *
 *  Returns the literal `"ComfyUI"` when nothing matched — `PackageFooter`
 *  treats that as the built-in hint and hides the label entirely. */
function resolveNodePackage(
  classType: string,
  properties?: Record<string, any>
): string {
  const fromManifest = getCustomNodePackage(classType);
  if (fromManifest) return fromManifest;
  const fromHeuristic = KNOWN_PACKAGE_HEURISTIC[classType];
  if (fromHeuristic) return fromHeuristic;
  const cnr = properties?.cnr_id;
  if (typeof cnr === "string" && cnr.length > 0 && cnr !== "comfy-core") {
    return cnr;
  }
  if (classType.includes("(rgthree)")) return "rgthree-comfy";
  return "ComfyUI";
}

/** ComfyUI-native `frontend_only` pill (bottom-left).  Rendered when a
 *  node's LiteGraph `properties.frontend_only === true`, indicating the
 *  node does all its work in the browser frontend and has no backend
 *  execution.  This is a SEPARATE UI element from the package-source
 *  footer — both can show at once, both sit bottom-left, and they answer
 *  two different questions ("where did this node come from?" vs "does it
 *  run on the server?").  Mirrors ComfyUI's own dim italic label. */
function FrontendOnlyBadge() {
  return (
    <div
      className="comfy-node__frontend-only"
      style={{
        display: "inline-block",
        alignSelf: "flex-start",
        marginTop: 4,
        marginLeft: 2,
        padding: "1px 5px",
        fontSize: 9,
        lineHeight: 1.2,
        fontFamily: '"SF Mono", ui-monospace, monospace',
        fontStyle: "italic",
        color: "rgba(255, 255, 255, 0.42)",
        letterSpacing: 0.2,
        border: "1px solid rgba(255, 255, 255, 0.16)",
        borderRadius: 4,
        pointerEvents: "none",
        userSelect: "none",
        whiteSpace: "nowrap",
      }}
      title="此节点仅在浏览器前端运行（无后端执行）"
    >
      frontend_only
    </div>
  );
}

/* NodeIdChip — right-aligned `#<nodeId>` badge inside a node's header
 *  (2026-08-10).  Tapping it opens the NodeJsonPopover pinned next to
 *  the chip, showing the literal `detail.graph[nodeId]` entry.  Two
 *  variants:
 *    • "node"     — plain grey/teal text (matches the previous WfNode
 *                   appearance).
 *    • "subgraph" — uppercase violet tint, matching WfSubgraphNode's
 *                   prior look.
 *  Implementation notes:
 *   • Native `<button>` (not `<div role="button">`) — semantically the
 *     right element, no extra a11y wiring needed.
 *   • `e.stopPropagation()` on BOTH onClick AND onMouseDown — React Flow
 *     attaches drag listeners on the node root, and double-click on the
 *     node would otherwise trigger drill-down.  Also need to swallow
 *     the onPointerDown so a press-and-drag never starts a pan from the
 *     chip's bounding box.
 *   • `type="button"` so the chip never accidentally submits an
 *     enclosing <form> (defensive — no forms today, but cheap to lock).
 *   • Visual feedback: chip becomes dotted-underline + brighter on
 *     hover/focus so the click affordance reads without a label. */
function NodeIdChip({ nodeId, variant }: { nodeId: string; variant: "node" | "subgraph" }) {
  const ctx = useContext(NodeJsonViewerContext);
  const ref = useRef<HTMLButtonElement | null>(null);

  /* If the provider hasn't been mounted (component used outside
   *  WorkflowCanvasEditor), fall back to a non-interactive span so the
   *  build doesn't crash.  In practice this branch is never taken —
   *  WfNode / WfSubgraphNode are only rendered inside the editor — but
   *  the nullish-narrowing keeps TS happy and is cheap insurance. */
  if (!ctx) {
    return (
      <span
        className={
          variant === "subgraph"
            ? "font-mono text-[9px] uppercase tracking-wider text-violet-300/80"
            : "shrink-0 font-mono text-[9px] text-gray-500/80"
        }
      >
        #{nodeId}
      </span>
    );
  }

  const handleOpen = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    ctx.requestShow(el, nodeId, variant);
  };

  return (
    <button
      ref={ref}
      type="button"
      data-node-id-chip={nodeId}
      data-variant={variant}
      onClick={handleOpen}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      title="查看节点在工作流 JSON 中的原始数据"
      aria-label={`查看节点 #${nodeId} 的原始 JSON 数据`}
      className={
        variant === "subgraph"
          ? "nodrag nopan group inline-flex cursor-pointer items-center gap-1 rounded border border-transparent px-1 font-mono text-[9px] uppercase tracking-wider text-violet-300/80 transition-colors hover:border-violet-400/40 hover:bg-violet-500/10 hover:text-violet-100 focus:outline-none focus:ring-1 focus:ring-violet-400/40"
          : "nodrag nopan group inline-flex cursor-pointer items-center gap-1 rounded border border-transparent px-1 font-mono text-[9px] text-gray-500/80 transition-colors hover:border-cyan-400/40 hover:bg-cyan-500/10 hover:text-cyan-100 focus:outline-none focus:ring-1 focus:ring-cyan-400/40"
      }
    >
      <span aria-hidden style={{ fontSize: 9, lineHeight: 1 }}>🔍</span>
      <span>#{nodeId}</span>
    </button>
  );
}

/** rgthree Power Lora Loader runtime body (2026-08-09, v2).  Always paints
 *  the Lora Stack section header + Add Lora CTA — rgthree's frontend shows
 *  these regardless of stack contents so the stack visually exists even when
 *  empty (so authors can grow it by clicking the button).  Per-lora rows
 *  are rendered between, parsing each entry from `widgets_values`.
 *
 *  Empty placeholders (`{}` / `""`) are dropped; the header widget
 *  (`{type:"PowerLoraLoaderHeaderWidget"}`) is recognised and not drawn
 *  here (the static header below stands in).  Strength sliders use the
 *  raw tuple's `model_strength` / `clip_strength` keys (rgthree uses
 *  `model_str` / `clip_str` aliases in some builds — we accept both).
 *
 *  Read-only: the canvas is a viewer, so the "+ Add Lora" button is a
 *  static pill that does not fire any handlers. */
function RgthreePowerLoraLoaderBody({ widgets }: { widgets: any[] }) {
  const fmtStrength = (v: any): string | undefined => {
    if (typeof v === "number") {
      // ComfyUI strips trailing zeros ("1.00" → "1", "0.85" stays).
      const s = v.toFixed(2);
      const stripped = s.replace(/\.?0+$/, "");
      return stripped.length > 0 ? stripped : "0";
    }
    if (typeof v === "string" && v.length > 0 && v !== "undefined") return v;
    return undefined;
  };

  // Per-lora rows: filter out the header widget and empty placeholders.
  const loras: any[] = (widgets ?? []).filter((w) => {
    if (w === null || w === undefined) return false;
    if (typeof w !== "object" || Array.isArray(w)) {
      return typeof w === "string" && w.length > 0; // bare lora filename
    }
    if (Object.keys(w).length === 0) return false; // {} placeholder
    if (w.type === "PowerLoraLoaderHeaderWidget") return false; // header widget
    return true; // real lora tuple
  });

  return (
    <div className="flex w-full flex-col gap-[3px] px-1 pb-1 pt-0.5">
      {/* Lora Stack section header — always drawn (matches rgthree even on
       *  empty stacks, so the author can always add a lora below it). */}
      <div
        className="flex items-center justify-between rounded px-1.5 py-[3px] text-[10px] font-medium uppercase"
        style={{
          background: "rgba(255, 255, 255, 0.04)",
          color: "rgba(255, 255, 255, 0.55)",
          letterSpacing: 0.4,
        }}
      >
        <span className="inline-flex items-center gap-1">
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: "rgba(167, 139, 250, 0.95)",
              display: "inline-block",
            }}
          />
          Lora Stack
        </span>
        <span
          className="inline-flex items-center gap-1.5 text-[9px]"
          style={{ color: "rgba(255, 255, 255, 0.36)", letterSpacing: 0.6 }}
        >
          <span>model</span>
          <span style={{ color: "rgba(255, 255, 255, 0.18)" }}>•</span>
          <span>clip</span>
        </span>
      </div>

      {/* Per-lora rows (empty placeholder area in this workflow). */}
      {loras.length === 0 ? (
        <div
          className="rounded px-1.5 py-3 text-center text-[10px]"
          style={{
            background: "rgba(0, 0, 0, 0.25)",
            color: "rgba(255, 255, 255, 0.30)",
            border: "1px dashed rgba(255, 255, 255, 0.08)",
          }}
        >
          暂无 Lora — 点击下方按钮添加
        </div>
      ) : (
        loras.map((w, i) => {
          const isObj = typeof w === "object" && !Array.isArray(w);
          const name =
            typeof w === "string"
              ? w
              : isObj
                ? w.name ?? w.lora_name ?? w.model_name ?? ""
                : "";
          const modelStr = isObj
            ? fmtStrength(w.model_strength ?? w.model_str ?? w.strength)
            : undefined;
          const clipStr = isObj
            ? fmtStrength(w.clip_strength ?? w.clip_str)
            : undefined;
          return (
            <div
              key={`pll-r-${i}`}
              className="flex items-center gap-2 rounded px-1.5 py-[3px] text-[11px]"
              style={{ background: "rgba(0, 0, 0, 0.30)" }}
            >
              <span
                className="min-w-0 flex-1 truncate"
                style={{
                  color: name ? "rgba(255, 255, 255, 0.85)" : "rgba(255, 255, 255, 0.30)",
                }}
                title={name}
              >
                {name || "（未选择 Lora）"}
              </span>
              {modelStr !== undefined && (
                <span
                  className="shrink-0 tabular-nums"
                  style={{ color: "rgba(255, 255, 255, 0.55)", fontSize: 10 }}
                >
                  {modelStr}
                </span>
              )}
              {clipStr !== undefined && (
                <span
                  className="shrink-0 tabular-nums"
                  style={{ color: "rgba(255, 255, 255, 0.40)", fontSize: 10 }}
                >
                  {clipStr}
                </span>
              )}
            </div>
          );
        })
      )}

      {/* "+ Add Lora" CTA — rgthree shows this even on empty stacks.  Read-only
       *  on the canvas, so it's a static pill (no click handler). */}
      <div
        aria-hidden
        className="mt-1 flex items-center justify-center gap-2 rounded py-[6px] text-[11px] font-medium"
        style={{
          background: "rgba(139, 92, 246, 0.10)",
          border: "1px solid rgba(139, 92, 246, 0.45)",
          color: "rgba(255, 255, 255, 0.78)",
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        <span
          style={{
            fontSize: 14,
            lineHeight: 1,
            color: "rgba(167, 139, 250, 0.95)",
            fontWeight: 600,
          }}
        >
          +
        </span>
        Add Lora
      </div>
    </div>
  );
}

/** rgthree Label runtime body (2026-08-09).  rgthree's Label node has no
 *  I/O — it paints its title (or `text` property) using the styles in
 *  `properties` (fontSize / fontFamily / fontColor / textAlign /
 *  backgroundColor / borderRadius / angle).  We render the styled text
 *  read-only, filling the node body.  The standard title bar is suppressed
 *  for this classType (ComfyUI shows no separate header) so the painted
 *  text reads as the whole node. */
function RgthreeLabelBody({
  text,
  properties,
}: {
  text: string;
  properties: Record<string, any>;
}) {
  const p = properties ?? {};
  const fontSize = typeof p.fontSize === "number" ? p.fontSize : 24;
  const fontFamily = typeof p.fontFamily === "string" ? p.fontFamily : "sans-serif";
  const fontColor = typeof p.fontColor === "string" ? p.fontColor : "#ffffff";
  const textAlign =
    p.textAlign === "center" || p.textAlign === "right" ? p.textAlign : "left";
  const bg =
    p.backgroundColor && p.backgroundColor !== "transparent" ? p.backgroundColor : "transparent";
  const angle = typeof p.angle === "number" ? p.angle : 0;
  return (
    <div
      className="flex min-h-[24px] w-full flex-1 items-center px-2 py-1"
      style={{
        background: bg,
        borderRadius: typeof p.borderRadius === "number" ? p.borderRadius : 0,
        transform: angle ? `rotate(${angle}deg)` : undefined,
        overflow: "hidden",
      }}
    >
      <span
        style={{
          fontFamily,
          fontSize,
          color: fontColor,
          textAlign,
          width: "100%",
          lineHeight: 1.1,
          wordBreak: "break-word",
          whiteSpace: "pre-wrap",
        }}
        title={text}
      >
        {text || "（空标签）"}
      </span>
    </div>
  );
}

/** Small checkbox rendered before a parameter row while in IO-edit mode. */
function IoCheckbox({
  ioRef,
  io,
}: {
  ioRef: IoRef;
  io: IOEditContextValue;
}) {
  const key = `${ioRef.nodeId}::${ioRef.kind}::${ioRef.name}`;
  const checked = !!io.workflowIO[key];
  const isOut = ioRef.direction === "output";
  const dirLabel = isOut ? "输出" : "输入";
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={() => io.toggleIO(ioRef)}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      title={checked ? `已暴露为工作流${dirLabel}` : `点击将其暴露为工作流${dirLabel}`}
      style={{
        width: 13,
        height: 13,
        // Direction-aware gutter: inputs read left→right (checkbox, then name),
        // outputs read right-aligned (name, then checkbox, then the Handle dot
        // which is absolutely positioned at right:5).  Mirror the margin so the
        // box never sits flush against the label on either side.
        marginLeft: isOut ? 6 : 0,
        marginRight: 6,
        flex: "0 0 auto",
        accentColor: checked ? "#fbbf24" : "#a1a1aa",
        cursor: "pointer",
      }}
    />
  );
}

interface WorkflowDetail {
  id: string;
  name: string;
  taskType: string;
  graph: Record<string, any>;
  /** 2026-08-11 R40: 从 `/api/workflows/:id` 返回的原始导入格式 (LiteGraph
   *  JSON)；canvas 顶部「📋 查看 JSON」modal 直接读这里喂给 SourceModal。
   *  null 表示该工作流纯 API 导入，无原始格式。 */
  rawJson?: unknown;
  nodes: ComfyGraphNode[];
  paramMap: Record<string, string>;
  /** User-curated exposure selection: ioKey → metadata.  ioKey =
   *  `${nodeId}::${kind}::${name}`.  Populated only after the user opens
   *  IO-edit mode and ticks params; empty object means "nothing exposed". */
  workflowIO: Record<string, WorkflowIOParam>;
  /** { nodeId: [x, y] } — only set for raw imports; null when only API JSON was given. */
  positions: Record<string, [number, number]> | null;
  /** ComfyUI group frames (raw UI format). bounding = [x, y, w, h]. */
  groups: WorkflowGroup[] | null;
  /** Note / MarkdownNote annotation nodes (raw UI format). */
  notes: WorkflowNote[] | null;
  /** Sparse raw-node metadata — only `id`, `widgets_values` and `outputs[]` —
   *  used by WfSubgraphNode (widget values) and by both WfNode &
   *  WfSubgraphNode to render the OUTPUT port strip when the offline type
   *  table doesn't know the class (e.g. custom nodes like
   *  ResolutionSelector, or subgraph UUIDs whose outputs we discover from
   *  the raw JSON). */
  rawNodes: {
    id: string;
    widgets_values: any[];
    outputs: RawOutputMeta[];
    /** Per-node LiteGraph flags (e.g. `collapsed`).  Empty when raw was
     *  absent (API-only import).  The Flow already consumed these via
     *  `(rn as any).flags`; declared here so the JSON popover can show
     *  them in the synthesised "节点视图" tab. */
    flags?: Record<string, any>;
    /** Custom-node properties (e.g. rgthree's `Fast Groups Bypasser`
     *  reads `matchTitle` from this).  Empty when raw was absent. */
    properties?: Record<string, any>;
    mode?: number;
  }[] | null;
  /** Boundary pin entities (subgraph.inputs/outputs from ComfyUI raw).
   *  Each pin has its own UUID, name, type, saved position, and linkIds
   *  pointing at the cross-boundary wires.  Rendered as compact
   *  wfIoPort nodes in a clean LEFT (inputs) / RIGHT (outputs) column
   *  inside the inner canvas. */
  boundaryPins?: {
    inputs: {
      id: string;
      name: string;
      type: string;
      localized?: string;
      label?: string;
      pos: [number, number];
      linkIds: number[];
    }[];
    outputs: {
      id: string;
      name: string;
      type: string;
      localized?: string;
      label?: string;
      pos: [number, number];
      linkIds: number[];
    }[];
  };
  /** Sentinel-bearing wires translated to (pin ↔ inner-node-slot)
   *  pairs — used by `buildEdges` to emit React Flow edges between the
   *  boundary pin's handle and the inner node's matching input/output
   *  handle. */
  boundaryLinks?: {
    linkId: number;
    kind: "input" | "output";
    pinId: string;
    innerNodeId: string;
    innerSlotName: string;
  }[];
  /** Absolute local file path if this workflow is file-backed (imported via
   *  "本机路径").  The server re-imports from it whenever the file changes. */
  sourcePath?: string | null;
  /** Set on a detail GET that detected + applied a change to the source file. */
  sourceChanged?: boolean;
  /** Set when the tracked source file no longer exists on disk. */
  sourceMissing?: boolean;
  /** Classification: "local" = file-backed; "online" = pasted/API import. */
  source?: "local" | "online";
}

interface RawOutputMeta {
  name: string;
  localized?: string;
  /** Business label for the slot — `FRAMES` / `IMAGE_FINAL`.  Forwarded
   *  by /api/workflows/[id] from rawJson.outputs[].label so both the
   *  parent WfSubgraphNode outputs strip and the inner WfIoPortNode
   *  IO rail show the same name (2026-08-06 fix). */
  label?: string;
  type: string;
  /** Source link ids coming out of this output (used to derive wires). */
  links: number[];
  /** True when at least one outgoing link targets the boundary sentinel
   *  `-20` (this output is exposed by the parent subgraph wrapper).
   *  Set by /api/workflows/[id]/subgraph.  Outer workflows always false. */
  isBoundary?: boolean;
}

interface WorkflowGroup {
  id: string;
  title: string;
  bounding: [number, number, number, number];
  color: string;
  /** Group bypass state (2026-08-09).  Mirrors `rawJson.groups[i].flags.bypass`
   *  and is the handle used by the rgthree Fast Groups Bypasser integration:
   *  clicking a toggle in that node's body flips this field and PATCHes it
   *  back to the server.  Defaults to false on read. */
  bypass?: boolean;
}

interface WorkflowNote {
  id: string;
  /** Display title — extracted from `title` field or first `#`-heading line. */
  title: string;
  text: string;
  pos: [number, number];
  size: [number, number];
  color: string;
}

/** Extract a note's display title from its raw JSON.  ComfyUI stores the title
 *  either at the root level (newer versions) or as the first markdown heading
 *  line (`# Title`) in the text body.  Falls back to the first non-empty line
 *  when no markdown heading is present, and finally to "" when even that is
 *  missing.  Leading "Note:" prefixes are stripped so the title bar doesn't
 *  echo "Note: Note: Foo". */
function extractNoteTitle(text: string, fallback?: string): string {
  let raw = "";
  if (fallback && fallback.trim()) {
    raw = fallback.trim();
    // Strip a leading "Note:" / "Note : " prefix ComfyUI bakes in for some
    // converted flows so the rendered title bar doesn't echo "Note: Note: X".
    raw = raw.replace(/^Note\s*[:：]\s*/i, "").trim();
    if (raw) return raw;
  }
  if (!text) return "";
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^#{1,3}\s+(.+?)\s*$/);
    if (m) return m[1];
  }
  for (const line of lines) {
    const t = line.trim();
    if (t) return t.length > 32 ? t.slice(0, 30) + "…" : t;
  }
  return "";
}

/** Node class types that are pure annotations (no inputs/outputs, no ports). */
function isNoteType(classType: string): boolean {
  return classType === "Note" || classType === "MarkdownNote";
}

/* ── Title bar height ──
 *  LiteGraph (and therefore ComfyUI) draws every titled node with a
 *  fixed `LiteGraph.NODE_TITLE_HEIGHT = 30` bar at the TOP of the node.
 *  2026-08-11 R49 (user rule): the serialised `size: [w, h]` in the
 *  raw archive is the BODY CONTENT height (the 30 px title bar is NOT
 *  included in `size[1]`).  So the actual rendered node box = content
 *  height + NODE_TITLE_H = `size[1] + 30`.
 *
 *  Convention (2026-08-11, user rule):
 *    • `data.size.h` carries the raw BODY CONTENT height = `size[1]`
 *      (NO subtraction).
 *    • The React Flow node `style.height` = `size[1] + NODE_TITLE_H`
 *      (total with title bar).
 *    • Each renderer's body uses `minHeight = data.size.h` as the
 *      content floor; the title bar lives above it and is part of the
 *      React Flow box, not the body flex container.
 *  Untitled notes do not have a separate title bar, so their React Flow
 *  box = `size[1]` (no addition). */
const NODE_TITLE_H = 30;

/* ---------------------------------------------------------------------------
 *  Pseudo "frosted glass" layer — FAILBACK ONLY, currently NOT rendered.
 *  It paints synthetic coloured blur blobs inside the node box and samples
 *  NO real pixels from behind, so Chromium's small-element re-tile artefact
 *  (4 / 9 / 16 repeated notes at low zoom) can never occur.  It was used
 *  between two real-backdrop attempts, but the user preferred the genuine
 *  see-through blur, so the live path is <NodeFrost> — a REAL
 *  `backdrop-filter` on an inner layer that counter-scales by 1/zoom so its
 *  on-screen footprint never shrinks small enough to re-tile (see WfNode).
 *  Kept here so it can be re-enabled instantly if the real-blur artefact
 *  ever resurfaces on some browser.
 * --------------------------------------------------------------------------- */
const PSEUDO_FROST_NOISE_URL =
  // 180×180 turbulence tile; alpha ~0.55; inlined SVG ⇒ no extra HTTP cost.
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.7' numOctaves='2' seed='9'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.55'/></svg>";

/* Synthetic blob layout — five overlapping ellipses covering the node body.
 *  Positions/sizes are in percentages so the layer reflows with the node's
 *  React-Flow-applied `minWidth` without any layout gymnastics.  Each blob
 *  uses its own `filter: blur(Npx)` so the silhouette stays soft even when
 *  the user's CSS `transform: scale(...)` is applied via parent zoom. */
const PSEUDO_FROST_BLOBS: { left: string; top: string; w: string; h: string; alphaKey: "primary" | "secondary" | "cool" | "warm" | "shadow"; blurPx: number }[] = [
  { left: "6%",  top: "10%", w: "58%", h: "42%", alphaKey: "primary",   blurPx: 28 },
  { left: "18%", top: "62%", w: "62%", h: "32%", alphaKey: "secondary", blurPx: 22 },
  { left: "62%", top: "6%",  w: "40%", h: "50%", alphaKey: "cool",      blurPx: 32 },
  { left: "30%", top: "30%", w: "32%", h: "32%", alphaKey: "warm",      blurPx: 18 },
  { left: "66%", top: "56%", w: "30%", h: "34%", alphaKey: "shadow",    blurPx: 24 },
];

/** Build the per-mode colour table consumed by `PSEUDO_FROST_BLOBS.alphaKey`.
 *  Disabled nodes lean grey, bypass leans pink-purple; the cool/warm/shadow
 *  channels stay constant so the panel reads as a coherent glass surface
 *  regardless of mode. */
function pseudoFrostPalette(modeColor: string | null) {
  const m = modeColor || "#ec4899";
  return {
    primary:   hexToRgba(m, 0.45),                    // mode-tinted mass
    secondary: hexToRgba(m, 0.30),                    // mode-tinted halftone
    cool:      "rgba(110, 145, 215, 0.32)",           // cool blue "leak"
    warm:      "rgba(255, 255, 255, 0.10)",           // light from above
    shadow:    "rgba(0, 0, 0, 0.36)",                 // unlit corner
  };
}

/** Pseudo-frost overlay.  Renders absolutely behind the node content (under
 *  the header / body), with `pointer-events: none` and `aria-hidden` so it
 *  never affects hit-testing, selection, or screen-reader output. */
function PseudoFrostLayer({ modeColor }: { modeColor: string | null }) {
  if (!modeColor) return null;
  const palette = pseudoFrostPalette(modeColor);
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg"
      style={{ zIndex: 0 }}
    >
      {PSEUDO_FROST_BLOBS.map((blob, idx) => (
        <div
          key={idx}
          className="absolute rounded-full"
          style={{
            left: blob.left,
            top: blob.top,
            width: blob.w,
            height: blob.h,
            background: palette[blob.alphaKey],
            filter: `blur(${blob.blurPx}px)`,
          }}
        />
      ))}
      {/* Final noise overlay — adds the fine "frosted" texture that pure
       *  blurred blobs alone would lack.  Mix-blend lets the colour blobs
       *  tint it instead of being hidden under it. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url("${PSEUDO_FROST_NOISE_URL}")`,
          backgroundSize: "180px 180px",
          opacity: 0.085,
          mixBlendMode: "overlay",
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 *  NodeFrost — REAL see-through frosted layer for bypass / disabled nodes.
 *
 *  Uses an actual `backdrop-filter: blur(...)` so the REAL canvas behind the
 *  node is what gets blurred (not synthetic blobs).  The classic Chromium bug
 *  is that `backdrop-filter` RE-TILES on very small on-screen elements — at low
 *  zoom a node's screen footprint shrinks, the blur kernel outgrows its
 *  backing texture, and the edge pixels wrap → the 2² / 3² / 4² (= 4 / 9 / 16)
 *  repeated-ghost artefact the user hit.
 *
 *  Fix: counter-scale the blur element by 1/zoom when zoomed out, holding its
 *  ON-SCREEN footprint at ~ the node's zoom=1 size (always large enough to
 *  blur cleanly).  The outer wrapper clips it back to the node bounds
 *  (`overflow:hidden`), so only the node-shaped slice of the — now correctly
 *  large — sampled backdrop is shown.  The blur radius is divided by the same
 *  scale so the effective on-screen blur stays ≈ 6px at every zoom.  Result:
 *  a genuine blurred view of the real canvas, with NO tiling at any zoom. */
function NodeFrost({ zoom, color, nodeMode }: { zoom: number; color: string | null; nodeMode: number }) {
  if (!color || nodeMode === 0) return null;
  // Hold the on-screen footprint ≥ the node's zoom=1 size.
  const scale = Math.max(1, 1 / Math.max(zoom, 0.01));
  const blur = 6 / scale; // keep on-screen blur ≈ 6px regardless of zoom
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[-1] overflow-hidden rounded-[inherit]"
    >
      <div
        className="absolute inset-0"
        style={{
          background: hexToRgba(color, nodeMode === 4 ? 0.16 : 0.11),
          backdropFilter: `blur(${blur}px)`,
          WebkitBackdropFilter: `blur(${blur}px)`,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 *  StringTextarea — multi-line read-only text box for long STRING widgets
 *  (prompts, captions, …).  Replaces the old `<div>` (whose Tailwind
 *  whitespace/overflow classes compiled unreliably inside this subtree) with
 *  the browser's native scrollable textarea, so wrapping + scroll work without
 *  any class dependency.
 *
 *  Height strategy (2026-08-10 R17, fully vertical STACKED layout):
 *    • Row uses `flex-col gap-1.5 flex-1` — LABEL row on top,
 *      this container fills the remaining vertical space below.
 *    • When the node has a fixed box (`hasSize`), the textarea container's
 *      `flex-1 min-h-0` chain handles height in CSS: the box has a fixed
 *      height, the WIDGET zone flex-1 claims the box's leftover space after
 *      header + body rows, and this textarea fills the STRING row's share.
 *      `maxHeight` is intentionally REMOVED (used to be 96px) so a 12-line
 *      prompt can claim the full STRING-row slot instead of being capped
 *      and silently scrolling behind a "标题内容同一排" layout.  Overflow
 *      scrolls natively inside this fixed box.
 *    • When the node is content-sized (no fixed box), useLayoutEffect sets
 *      the textarea height to `scrollHeight` uncapped so a 12-line prompt
 *      makes the row tall enough to show every line — same fill intent as
 *      the `flex-1` chain, just driven from JS instead of CSS. */
function StringTextarea({ value, mono, hasSize }: { value: string; mono?: boolean; hasSize: boolean }) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    if (!hasSize) {
      // Content-sized node: textarea decides its own height, capped at
      // content.  No 96px cap (R17): a multi-line prompt must stay
      // fully visible instead of being clipped behind the row's other
      // half.  `auto` first so the browser can compute the new
      // scrollHeight after the value changes.
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    }
    // hasSize: height is owned by the flex chain (the parent's `flex-1` +
    // `min-h-0`); leave the textarea inline style untouched so CSS wins.
  }, [value, hasSize]);
  return (
    <textarea
      ref={ref}
      readOnly
      value={value}
      rows={1}
      onFocus={(e) => e.currentTarget.blur()}
      className={
        "block w-full resize-none rounded border border-white/10 bg-black/40 px-2 py-1.5 text-[10.5px] leading-snug text-gray-200 outline-none" +
        (mono ? " font-mono" : "")
      }
      style={{
        /* `width: 100%` claims every pixel the row's flexbox gives us.
         * `flex: 1 1 0` + `minHeight: 0` joins the row's flex chain in
         *  the hasSize path — the textarea fills the STRING row's
         *  remaining vertical space (R17: vertical stacked).  R16 had
         *  `maxHeight: 96` here; removed because it capped a 12-line
         *  prompt behind the row's other half and was the "内容不可
         *  自适应高度，不铺满可用空间" the user reported.
         * `minWidth: 0` overrides the default `min-width: auto` so a
         *  very wide prompt line can ellipsize on the cross axis instead
         *  of pushing the label off-screen.  (Irrelevant now that the
         *  label sits on its own row above, but kept as defensive.)
         * `overflowY: "auto"` lets any leftover content scroll. */
        width: "100%",
        flex: "1 1 0",
        minHeight: 0,
        minWidth: 0,
        overflowY: "auto",
      }}
      title={value}
    />
  );
}

/** The roles a node can be assigned in the paramMap */
const PORT_ROLES: { key: string; label: string; color: string; bg: string }[] = [
  { key: "positiveNode",   label: "正向提示词", color: "#a78bfa", bg: "rgba(167,139,250,0.15)" },
  { key: "negativeNode",   label: "反向提示词", color: "#f87171", bg: "rgba(248,113,113,0.15)" },
  { key: "checkpointNode", label: "模型(Checkpoint)", color: "#60a5fa", bg: "rgba(96,165,250,0.15)" },
  { key: "samplerNode",    label: "采样器",       color: "#fb923c", bg: "rgba(251,146,60,0.15)" },
  { key: "inputImageNode", label: "输入图像",      color: "#22d3ee", bg: "rgba(34,211,238,0.15)" },
];

/* ── Node data for the flow canvas (must satisfy Record<string, unknown> for @xyflow/react) ── */
interface WfNodeData {
  [key: string]: unknown;
  nodeId: string;          // ComfyUI node ID
  classType: string;
  title: string;
  inputs: Record<string, any>;
  /** Which port role this node is assigned (if any) */
  assignedRole: string | null;
  /** For every input that is a connection ([srcId, slot]), the source node's
   *  title + class_type.  Used to render the "← <srcNode> #xx" label and to
   *  infer the data type flowing through the wire. */
  inputSources: Record<string, { id: string; title: string; slot: number; classType?: string }>;
  /** Per-input display metadata from raw JSON (localized_name + type). */
  rawInputs?: RawInputMeta[];
  /** True if this node is an INPUT endpoint of the current subgraph (its
   *  input slot receives from the subgraph's -10 sentinel).  Stamped by
   *  /api/workflows/[id]/subgraph.  Outer workflows always have false.
   *  The client uses this flag to wrap the cluster in an INPUTS wfGroup
   *  so the user can see where the parent wrapper's inputs flow into
   *  the subgraph. */
  isInputEndpoint?: boolean;
  /** True if this node is an OUTPUT endpoint (its output feeds the
   *  subgraph's -20 sentinel).  Mirror of `isInputEndpoint`. */
  isOutputEndpoint?: boolean;
  /** Per-output display metadata from raw JSON (localized_name + type +
   *  downstream link ids).  Used when inferOutputTypeAll can't resolve
   *  the class (e.g. custom nodes like ResolutionSelector). */
  rawOutputs?: RawOutputMeta[];
  /** Set of output slot NAMES that feed a subgraph boundary — derived from
   *  `detail.boundaryLinks` (kind === "output").  Source-independent from
   *  `rawOutputs[].isBoundary` so the canvas never goes dark if the
   *  sessionStorage cache miss fails to deliver the latest detail shape.
   *  Always empty for top-level (non-subgraph) workflows. */
  boundaryOutputs?: Set<string>;
  /** Set of input slot NAMES that come from a subgraph boundary pin —
   *  mirrors `boundaryOutputs` for the input side.  Source-independent
   *  from `rawInputs[].isBoundary` so that WfNode can keep mounting
   *  input Handles for boundary wires even if the server's input-stamp
   *  is missing from a stale cached detail. */
  boundaryInputs?: Set<string>;
  /** Widget values paired with `rawInputs` for custom nodes whose API
   *  `inputs` map is empty (the import pipeline stores custom-node widget
   *  values in rawJson.widgets_values rather than folding them into
   *  `graph[id].inputs`).  When set, WfNode uses rawInputs as the input
   *  source with positional values from this array. */
  rawWidgetValues?: any[];
  /** Output NAMES (matching the keys of `inferOutputTypeAll(classType)`
   *  or `rawOutputs[i].name`) that have at least one downstream edge in
   *  this workflow.  WfNode only renders a source Handle for output rows
   *  whose name appears here — "no wire ⇒ no dot".  When undefined / empty
   *  the renderer treats every output as unused (no Handle). */
  connectedOutputs?: Set<string>;
  /** Per-node LiteGraph flags forwarded verbatim from the raw JSON
   *  (ComfyUI emits `flags.collapsed: true` for collapsed widgets such as
   *  SetNode / rgthree Compact).  The editor reads `flags.collapsed` and
   *  collapses the chip body when present.  Other flag keys (pinned,
   *  allow_interaction, …) are kept opaque for future use. */
  flags?: Record<string, any>;
  /** LiteGraph `mode` value (0 = Always / normal, 2 = Never / muted, 4 = Bypass).
   *  Surfaced from raw JSON so the canvas can tint nodes by their ComfyUI
   *  status — bypass → purple, disabled → grey, normal → role/default. */
  mode?: number;
  /** LiteGraph `properties` dict from rawJson (2026-08-09).  Used by
   *  custom-frontends that derive their body UI at runtime from these
   *  values — the prime example being rgthree's `Fast Groups Bypasser`
   *  which reads `matchTitle` / `matchColors` / `sort` etc. to compute
   *  its toggle list.  WfNode looks at `properties.matchTitle` when
   *  `classType === "Fast Groups Bypasser (rgthree)"` and renders the
   *  matched groups as a runtime body.  Empty / undefined for nodes
   *  that don't carry properties. */
  properties?: Record<string, any>;
  /** Workflow groups (2026-08-09).  Forwarded to WfNode so the rgthree
   *  Fast Groups Bypasser runtime body can match against the live
   *  group list without re-fetching.  Read-only here — toggling a
   *  group's bypass goes through `RgthreeGroupsContext.setBypass` →
   *  PATCH, not a direct edit. */
  groups?: WorkflowGroup[];
  /** Exact ComfyUI box size { w, h } (body only, title bar excluded).
   *  When present the card is forced to these dimensions instead of the
   *  content-driven min/max-width layout.  Undefined → content-driven. */
  size?: { w: number; h: number };
}

/** Row dimensions used to lay out the target Handles next to each input row. */
const INPUT_ROW_HEIGHT = 22; // px per input row (matches the py-1 + text-[11px] row)
const HEADER_TOTAL = 60;     // header (32) + #id bar (22) + small breathing room (6)

/* (Note: we used to override `<Handle top: ...>` with these constants to
 *  line Handles up with their rows.  We no longer do that — React Flow
 *  pins every Handle to its row's `top: 50%` automatically, and the
 *  node-root `transform: scale(zoom)` would have skewed any manual
 *  absolute pixel offset.  The constants are kept around as a reference
 *  for any future layout work that may need to know a row's size.) */

/* ── Inline image thumbnail for IMAGE-typed inputs (2026-08-10 R27,
 *  narrowed R28).  Mirrors ComfyUI's LoadImage preview: the uploaded image
 *  is shown inline with its pixel dimensions beneath it.  Image bytes are
 *  proxied from the local ComfyUI through /api/images (the browser can't
 *  reach :8188 directly due to CORS + private-network exposure).
 *
 *  2026-08-10 R28: now ONLY renders for the LoadImage family itself
 *  (downstream IMAGE consumers no longer carry `imageRef`, per user
 *  feedback that showing the unscaled upstream image elsewhere is
 *  misleading).  When `imageRef` is absent (LoadImage with no uploaded
 *  image yet), we paint a 「需要上传图片」 placeholder so the body still
 *  has its preview slot — matching ComfyUI's empty-state affordance. */
function WfImagePreview({ entry }: { entry: RawInputMeta }) {
  const ref = entry.imageRef;
  const label = entry.localized || entry.label || entry.name;
  /* Empty LoadImage (no widgets_values[0]) → placeholder card.  Same layout
   * dimensions as the thumbnail (110px tall) so the preview area is
   * visually consistent regardless of upload state, and the bordered /
   * rounded box keeps the slot discoverable when scanning the canvas. */
  if (!ref) {
    return (
      <div className="flex flex-col gap-1">
        <div className="truncate text-[11px] text-zinc-300" title={label}>
          {label}
        </div>
        <div className="flex h-[110px] items-center justify-center rounded-md border border-dashed border-white/15 bg-black/40 text-[11px] text-gray-400">
          需要上传图片
        </div>
      </div>
    );
  }
  const src = `/api/images?filename=${encodeURIComponent(ref.filename)}&subfolder=${encodeURIComponent(
    ref.subfolder
  )}&type=${encodeURIComponent(ref.type)}`;
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <div className="truncate text-[11px] text-zinc-300" title={label}>
        {label}
      </div>
      <div className="overflow-hidden rounded-md border border-white/10 bg-black/40">
        {failed ? (
          <div className="flex h-[110px] items-center justify-center text-[10px] text-gray-500">图片不可用</div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={ref.filename}
            className="block max-h-[110px] w-full object-contain"
            loading="lazy"
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth && img.naturalHeight) {
                setSize({ w: img.naturalWidth, h: img.naturalHeight });
              }
            }}
            onError={() => setFailed(true)}
          />
        )}
      </div>
      {size && (
        <div className="text-right text-[10px] tabular-nums text-gray-400">
          {size.w} × {size.h}
        </div>
      )}
    </div>
  );
}

/* ── Custom node renderer for ComfyUI graph nodes ── */
function WfNode({ data, selected }: { data: WfNodeData; selected?: boolean }) {
  const role = PORT_ROLES.find((r) => r.key === data.assignedRole);
  const io = useContext(IOEditContext);
  // Live viewport zoom — drives <NodeFrost>'s counter-scale so its on-screen
  //  footprint never shrinks small enough to trigger the re-tile artefact.
  const zoom = useStore((s) => s.transform[2]);

  /*  Frosted glass uses the REAL `backdrop-filter` (the actual canvas behind
   *  the node is what gets blurred) — rendered by <NodeFrost>, NOT the
   *  synthetic <PseudoFrostLayer> fallback.  <NodeFrost> counter-scales its
   *  blur element by 1/zoom so the on-screen footprint never shrinks small
   *  enough to trigger Chromium's re-tile artefact (the 4/9/16 ghost bug). */

  /* Each row is a `position: relative` flex container (`relative flex
   *  h-[22px]`).  React Flow's <Handle> renders with `position: absolute;
   *  top: 50%` and uses the row as its offsetParent, so the Handle is
   *  automatically pinned to the row's vertical centre.  We do NOT
   *  override `top` here — manual absolute pixel offsets would only be
   *  correct in unscaled viewports, and React Flow applies a CSS
   *  `transform: scale(zoom)` to the node root, which would skew our
   *  math by the zoom factor.  The default `top: 50%` is correct in all
   *  zoom levels. */

  /* Map raw_inputs (per-node metadata with localized labels) into an index
   * keyed by the API `name` field.  Lets us label each connection / widget
   * row with its zh-CN ComfyUI label when available.  Empty array if the
   * workflow was imported as pure API JSON. */
  const rawMeta: Record<string, RawInputMeta> = useMemo(() => {
    const out: Record<string, RawInputMeta> = {};
    for (const r of data.rawInputs ?? []) out[r.name] = r;
    return out;
  }, [data.rawInputs]);

  /* Compose the input rows.  Two sources, in priority order:
   *    1. rawInputs (server-paired widget values from rawJson) — for
   *       nodes like DaSiWa_EnhancedVideoCombine that ship 18+ inputs
   *       but only 2 are wired at the API graph level.  data.inputs
   *       (the API graph) holds only the connected slots; the other
   *       16 widget inputs (codec/container/quality/save_metadata/…)
   *       live in rawJson.inputs[] and are stitched into
   *       `tpl.raw_inputs` by the server (route.ts).  Without
   *       preferring rawInputs here, a node renders as a 270px-tall
   *       "header + 2 IO pins" empty shell — exactly the bug seen
   *       on DaSiWa (2026-08-08).
   *    2. data.inputs (API graph form) — fallback for API-only
   *       imports that have no rawJson (rare, but supported).  Each
   *       entry here is the wire tuple `[]` for connected inputs and
   *       the literal value for inline widget rows.
   *    3. Empty.  A node with no inputs renders just the header +
   *       outputs.
   *
   *  Note: even when the input is ALSO wired (a connected widget
   *  input), the value still occupies a widgets_values slot and must
   *  stay visible — the wire shows the dot, the value shows the
   *  number/string.  We therefore never drop connected rows here. */
  const allEntries: [string, any][] = useMemo(() => {
    if (data.rawInputs && data.rawInputs.length > 0) {
      return data.rawInputs.map((r) => {
        // Server-paired widget value — present for EVERY widget-type input,
        // connected or not ("有连线的输入 → 不进 widgets_values" is wrong:
        // a wired widget input still occupies a widgets_values slot).  Show
        // it regardless of link state so a connected widget input is no
        // longer silently dropped from the widgets_values view.
        if (r.widgetValue !== undefined) {
          return [r.name, r.widgetValue] as [string, any];
        }
        // Pure-connection inputs (model / clip / cond) carry no widget
        // value — emit an array so the conn/widget splitter below keeps
        // them as wire rows with a Handle.
        return [r.name, r.isConnection ? [] : ""] as [string, any];
      });
    }
    const fromGraph = Object.entries(data.inputs ?? {});
    if (fromGraph.length > 0) return fromGraph;
    return [];
  }, [data.inputs, data.rawInputs]);
  /* Split inputs into two buckets using ComfyUI's own input definition:
   *    • connEntries   — pure-typed port rows: `rawInputs[i].widget` is
   *                      ABSENT.  These are the node's "ports": every
   *                      entry gets a Handle on the left edge regardless
   *                      of link state.  An unconnected typed port
   *                      (e.g. DaSiWa `audio`, AUDIO with no upstream
   *                      wire) still belongs here — ComfyUI's own
   *                      frontend renders it as a TOP PIN row with an
   *                      empty Handle, not buried in the widget section.
   *    • widgetEntries — rows that back a `widgets_values` slot: their
   *                      `rawInputs[i].widget` is `{ name }`.  Rendered
   *                      below the pins; the value comes from
   *                      `widgets_values[]`.  A widget-with-wire (rare,
   *                      e.g. subgraph wrapper inputs that double as
   *                      defaults) keeps a Handle inline so the wire
   *                      still anchors.
   * The old `Array.isArray(v)` rule mistakenly bucketed unconnected
   * typed ports into the widget section (their `v` was `""`, not `[]`),
   * which:
   *   (a) broke parity with ComfyUI's compact grid (audio floated
   *       below images as a bare label),
   *   (b) prevented the IO-edit mode from surfacing them as workflow
   *       inputs (their checkbox lived in the wrong row).
   * `rawMeta` is built above (L640) from `data.rawInputs`, so this rule
   * applies whenever `data.rawInputs` is populated.  When only the
   * legacy `data.inputs` map is available, `rawMeta` is empty → every
   * entry has `widget === undefined` → every entry goes to connEntries,
   * which matches the legacy behaviour (data.inputs only ever carried
   * connected ports). */
  const connEntries = allEntries.filter(([k]) => {
    const m = rawMeta[k];
    /* 2026-08-10 R28: skip LoadImage's synthetic `preview: true` entry —
     *  it's a body-only thumbnail slot, never an input port.  Without
     *  this exclusion the entry lands here (no widget marker) and paints
     *  a fake target-HANDLE row with the label "图像" duplicated on the
     *  left side of every LoadImage node. */
    return m && m.widget === undefined && !m.preview;
  });
  const widgetEntries = allEntries.filter(([k]) => {
    const m = rawMeta[k];
    /* 2026-08-10 R28: also skip `preview: true` from widgetEntries —
     *  even if we add a widget marker to it (we don't), the regular
     *  widget-row renderer would draw a default control.  Keeping this
     *  exclusion makes the invariant explicit. */
    return m && m.widget !== undefined && !m.preview;
  });
  /* R50 (2026-08-11): dedupe by `name` across the two buckets BEFORE
   *  layout — custom nodes that legitimately combine a typed port with
   *  an inline widget (e.g. Z-Image-Base Int8's `宽度 / 高度 /
   *  positive_prompt`) surface the same `name` twice in `rawInputs`:
   *  once as a typed-port entry (`widget === undefined`) and once as a
   *  widget entry (`widget: { name }`).  The old code happily routed
   *  the name into BOTH `connEntries` and `widgetEntries`, which drew
   *  two IoCheckbox rows per parameter (one `kind:"param"` on the TOP
   *  PIN strip, one `kind:"widget"` in the widget body) — visually
   *  rendered as two stacked tick-boxes for the same parameter, exactly
   *  what the user reported.  Drop the typed-port duplicate and keep
   *  the widget one — the widget form carries the live
   *  `widgets_values` slot and is the meaningful row to expose as
   *  workflow IO. */
  const widgetNameSet = new Set(widgetEntries.map(([k]) => k));
  const uniqueConnEntries = connEntries.filter(([k]) => !widgetNameSet.has(k));
  const uniqueWidgetEntries = widgetEntries;
  /* Legacy combined list — kept for the overflow-handle fallback below
   * in case a future cap reconnects some entry to a hidden slot.  Not
   * used for layout. */
  const orderedEntries = [...uniqueConnEntries, ...uniqueWidgetEntries];
  /* No cap on the widget section — render every widget so custom nodes
   * (e.g. DaSiWa with 17 params) show their full parameter list instead
   * of silently hiding the trailing ones.  The top-pins section is
   * uncapped too.  Long custom nodes simply grow taller, matching how
   * ComfyUI's own canvas renders them. */
  const visibleWidgetEntries = uniqueWidgetEntries;

  /* IMAGE-input inline thumbnail previews (2026-08-10 R27, narrowed R28).
   *  Filter targets the LoadImage synthetic entry marked `preview: true`,
   *  regardless of whether `imageRef` is set:
   *    • `imageRef` present  → WfImagePreview paints the thumbnail + dimensions
   *    • `imageRef` absent   → WfImagePreview paints 「需要上传图片」 placeholder
   *  Downstream IMAGE inputs (ImageScale / CLIPVisionEncode / …) are NOT
   *  tagged `preview` since R28, so they're filtered out here.  Only the
   *  source LoadImage renders the preview — exactly the ComfyUI parity the
   *  user wanted (no misleading unscaled-view thumbnails on consumers). */
  const imagePreviewEntries = useMemo(
    () => (data.rawInputs ?? []).filter((r) => r.preview === true),
    [data.rawInputs]
  );

  /* Output ports.  ComfyUI's frontend reads these from /object_info; we
   *  fall back to three sources, in priority order:
   *    1. The static `inferOutputTypeAll` table (KSampler → LATENT, etc.).
   *    2. The raw `outputs[]` array from the imported JSON — this is the
   *       only place we can find custom-node outputs like
   *       ResolutionSelector.width/height or subgraph IMAGE outputs.
   *    3. An empty list (no outputs, save node etc.). */
  const outputs: [string, string][] = useMemo(() => {
    const staticOuts = Object.entries(inferOutputTypeAll(data.classType));
    if (staticOuts.length > 0) return staticOuts as [string, string][];
    if (data.rawOutputs && data.rawOutputs.length > 0) {
      return data.rawOutputs.map((o) => [o.name, o.type] as [string, string]);
    }
    return [];
  }, [data.classType, data.rawOutputs]);

  // No cap on the widget section — every custom-node parameter renders
  // (the old 14-item clamp hid the trailing widgets of nodes like DaSiWa).
  // Connection ports in the top pins section are also uncapped.  Long
  // custom nodes simply grow taller, matching ComfyUI's own canvas.
  // (visibleWidgetEntries = uniqueWidgetEntries, defined above)

  /* Collapsed state (ComfyUI LiteGraph flag `flags.collapsed`).  When
   *  true we render the header-only chip — outputs strip and inputs
   *  list are skipped, but connected handles still need an anchor so
   *  wires don't visually detach.  We render those handles inline below
   *  in a sibling block with absolute positioning.
   *
   *  User-toggle: a small `>` chevron in the top-left of the header
   *  lets the user collapse / re-expand at will, on top of the
   *  The imported ComfyUI config's `flags.collapsed` is treated as the
   *  INITIAL value — `userCollapsed` is seeded from it on mount, then the
   *  user toggle owns the state thereafter.  This is critical: if we kept
   *  `isCollapsed = dataCollapsed || userCollapsed`, an initially-collapsed
   *  node (dataCollapsed === true) could NEVER be expanded, because
   *  `true || anything === true` always wins.  Seeding useState from the
   *  config and letting the toggle fully own `isCollapsed` fixes that.
   *  Resetting the page keeps the user's state for the current session
   *  (per-node useState, in-memory). */
  const [userCollapsed, setUserCollapsed] = useState<boolean>(
    data.flags?.collapsed === true
  );
  const isCollapsed = userCollapsed;

  /* ComfyUI's color palette is port-driven.  In default state, the node
   * is dark gray; the role assignment (positive/sampler/etc.) gives a
   * tinted header.  We keep both — role highlight on top of type colours.
   *
   *  Contrast-vs-canvas tweak (2026-08-04): the old defaults (`#0F0F15`
   *  body + `rgba(255,255,255,0.12)` border) sat almost flush with the
   *  `#0a0a0f` canvas — node frames vanished against the grid and
   *  selection was hard to read.  Bumped body to `#16161E` and border
   *  to `rgba(255,255,255,0.20)` so the chip clearly stands out at any
   *  zoom level without becoming visually heavy. */
  /* Opaque node-card backgrounds — body keeps the role tint very subtle so
   *  internal text / image previews stay readable against a near-neutral
   *  panel; header + border carry the role-colour identity.  See mixHex()
   *  doc for the (base, tint, t) convention.
   *  Mix with the canvas-ish dark base (`#16161E`) so roles such as a
   *  saturated green render as rgb(24, 49, 40) instead of rgb(32,171,84);
   *  the previous call swapped base↔tint and produced a vivid body that
   *  obscured inputs / image previews on tall nodes like First-Frame-Image. */
  /* Node mode (LiteGraph 0=Always / 2=Never-mute / 4=Bypass) overrides
   *  the role tint when set, so the user can read the ComfyUI status at
   *  a glance: bypass → pink (#ec4899), muted → grey, normal →
   *  role/default.  Mode 0 leaves roleColor untouched.
   *  See WfSubgraphNode for the matching subgraph-side override. */
  const BYPASS_COLOR = "#ec4899";
  const DISABLED_COLOR = "#6b7280";
  const nodeMode = data.mode ?? 0;
  const modeColor =
    nodeMode === 4 ? BYPASS_COLOR :
    nodeMode === 2 ? DISABLED_COLOR :
    null;
  const effectiveColor = modeColor ?? role?.color;

  const headerBg = effectiveColor ? mixHex("#16161E", effectiveColor, 0.22) : "#1A1A22";
  /* Body: only ~8% tint so role identity is a hint, not a flood.  The body
   *  carries no role accent beyond the subtle cast, so 1024×1024 image
   *  previews and value cells sit on a near-neutral panel. */
  /* Body background: stable mode-tinted shade.  The "see-through" feel comes
   *  from the real `backdrop-filter: blur(6px)` on the root div blurring the
   *  canvas behind; this `nodeBg` alpha (0.16 / 0.11) just tints the frost
   *  with the mode colour so bypass = pink-purple, muted = grey at a glance. */
  const nodeBg = modeColor
    ? hexToRgba(modeColor, nodeMode === 4 ? 0.16 : 0.11)
    : role ? mixHex("#16161E", role.color, 0.08) : "#16161E";
  /* Border: stronger tint so the silhouette still reads as "this is the
   *  green-role node" at a glance.  Mode override applies the same mix
   *  recipe so bypass / disabled nodes have a fully tinted frame. */
  const nodeBorder = effectiveColor ? mixHex("#16161E", effectiveColor, 0.55) : "rgba(255,255,255,0.20)";
  /* Title colour: lightened mode color for readability on the dark header,
   *  otherwise role color → light grey default. */
  const titleColor = modeColor ? lightenHex(modeColor, 0.3) : (role?.color ?? "#E2E2EA");
  const dotBg = effectiveColor ?? "#6b7280";
  /* Display title prefers zh-CN friendly map → raw `title` from ComfyUI →
   * prettified class_type. */
  const displayTitle = friendlyNodeTitle(data.classType, data.title, "zh");
  /* rgthree Label nodes paint their text across the whole card and have NO
   *  separate ComfyUI title bar — suppress our standard header for them so
   *  the styled text reads as the entire node (matches native rgthree). */
  const isLabel = data.classType === "Label (rgthree)";
  /* rgthree Power Lora Loader renders its own Lora Stack body (header +
   *  per-lora rows + "+ Add Lora" CTA).  The standard widget-body section
   *  would otherwise double up the widgets — skip it for this classType. */
  const isPowerLoraLoader = data.classType === "Power Lora Loader (rgthree)";

  /* When the imported config carries an exact box size, the node is forced
   *  to those dimensions: `style.width` = size.w, `style.height` = the raw
   *  content height + NODE_TITLE_H (the 30 px title bar is NOT included in
   *  `size[1]` per the R49 rule — see the NODE_TITLE_H comment).  So the
   *  React Flow box is `size[1] + NODE_TITLE_H`.  `data.size.h` carries
   *  the raw CONTENT height (`size[1]`) that the body flexes to.  The
   *  content-driven min/max-width layout is bypassed and the card fills
   *  the React Flow node box set by the builder's `style`, so whitespace
   *  in oversized ComfyUI boxes (e.g. a 530×1190 LoadImage) is preserved
   *  and the card stays exactly where the config places it. */
  const hasSize = !!data.size;

  return (
    <div
      className="relative flex flex-col rounded-lg border shadow-[0_4px_20px_rgba(0,0,0,0.55)]"
      style={{
        // Width tracks ComfyUI's saved `size.w` when present — the node box
        //  width is fixed (exactly like ComfyUI; only the height is fluid).
        //  When no size is carried we fall back to a sensible min width.
        width: hasSize ? data.size?.w : undefined,
        // Height is fully content-driven (`auto`) in BOTH states so the card
        //  GROWS with its ports/widgets when expanded and AUTO-SHRINKS to the
        //  title bar when collapsed (ports collapse from many → one cylinder,
        //  and the body + footer are hidden).  A `minHeight` floor keeps the
        //  expanded box from dropping below ComfyUI's saved `size.h`, while the
        //  collapsed chip never collapses below its own title bar.
        height: "auto",
        minWidth: hasSize ? data.size?.w : (outputs.length > 0 ? 268 : 248),
        // R49 (2026-08-11): data.size.h is the BODY CONTENT height (size[1]).
        //  The WfNode outer div INCLUDES the pinned 30px title bar, so the
        //  total floor for the outer div is content + title = size[1] + 30.
        //  This keeps the card filling the React Flow box (`size[1] + 30`)
        //  when content is smaller than the configured content height —
        //  matching ComfyUI's actual rendered height (content + title bar)
        //  instead of rendering short by 30px.
        minHeight: isCollapsed ? NODE_TITLE_H : (hasSize ? (data.size?.h ?? 0) + NODE_TITLE_H : undefined),
        // No maxWidth cap here: ComfyUI lets the user resize the node box
        //  freely and we must mirror that — a hard 320px cap would silently
        //  clip any wider box the user dragged in ComfyUI, breaking the
        //  config-fidelity contract established for `size`.
        borderColor: nodeBorder,
        // For mode (bypass/disabled) nodes the tint + real blur now live in
        //  <NodeFrost>, so the root is transparent and only a stacking context
        //  (isolation) so the frost's negative z-index stays contained and
        //  never bleeds behind sibling nodes.  Normal nodes keep a solid panel.
        isolation: "isolate",
        background: modeColor ? "transparent" : nodeBg,
        // ComfyUI draws a bright selection rectangle around the active node.
        outline: selected ? "2px solid rgba(56,189,248,0.9)" : "none",
        outlineOffset: selected ? "2px" : undefined,
      }}
    >
      <NodeFrost zoom={zoom} color={modeColor} nodeMode={nodeMode} />
      {/* Header — ComfyUI uses a darker top bar with the node class name.
       *  Pinned to NODE_TITLE_H (litegraph's NODE_TITLE_HEIGHT) so every
       *  titled node has an identical header height regardless of icon
       *  size or how many optional chips (role, #id) are present — and so
       *  it stays outside the body box that `size[1]` measures.
       *  Suppressed entirely for rgthree Label nodes (see `isLabel`). */}
      {!isLabel && (
      <div
        className="flex shrink-0 items-center gap-2 rounded-t-lg px-2 text-xs"
        style={{
          height: NODE_TITLE_H,
          background: headerBg,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {/* Collapse / expand toggle (2026-08-08).  Sits at the top-left
         *  of the header (matching ComfyUI's native `>` icon), controls
         *  per-user visibility independent of any `flags.collapsed`
         *  baseline carried by the imported config.  We:
         *   • `type="button"` so submitting any future <form> doesn't
         *     accidentally toggle the chip.
         *   • stopPropagation on `onClick` AND `onMouseDown` so the
         *     node-drag handler React Flow attaches to the root does
         *     not pick this up as a drag-start.
         *   • `pointer-events: auto` is the default but we keep it
         *     explicit in case the root is ever made `none`-ish.
         *  The chevron points RIGHT `>` when the node is COLLAPSED
         *  (clicking will expand it, revealing the body), and rotates
         *  90° clockwise to point DOWN `v` when EXPANDED (clicking will
         *  collapse again).  Tooltip mirrors the action in Chinese. */}
        <button
          type="button"
          aria-label={isCollapsed ? "展开节点" : "折叠节点"}
          title={isCollapsed ? "展开" : "折叠"}
          onClick={(e) => {
            e.stopPropagation();
            setUserCollapsed((v) => !v);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-white/10 hover:text-white active:bg-white/15"
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
          style={{ background: dotBg, boxShadow: `0 0 6px ${dotBg}` }}
        />
        <span
          className="flex-1 truncate text-[12px] font-medium tracking-wide"
          style={{ color: titleColor }}
          title={data.title && data.title !== displayTitle ? data.title : displayTitle}
        >
          {displayTitle}
        </span>
        {/* Right-aligned `#<nodeId>` chip — click to open the
         *  NodeJsonPopover (2026-08-10).  Replaces the previous plain
         *  `<span>`: the chip now acts as the disclosure trigger for the
         *  raw workflow JSON viewer.  `stopPropagation` is required
         *  because the React Flow root swallows mousedown for drag-handling,
         *  AND because double-click on the chip shouldn't fire the parent's
         *  `onNodeDoubleClick` (drilldown).  Hover hint via title="…" — a
         *  small 🔍 icon prepended so the affordance reads at a glance even
         *  without text label.  Border becomes more saturated on hover for
         *  a tactile feel. */}
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
      )}

      {/* Collapsed-mode handle anchors.  When the node is collapsed
       *  (`isCollapsed === true`), the body is hidden but wires still
       *  need an anchor so they don't visually snap to the node centre.
       *
       *  Visually each side collapses to a single vertical "cylinder"
       *  (a tall pill with rounded ends) — that matches ComfyUI's own
       *  collapsed-node look (every port of the same side piles into
       *  one rounded-bar shape).  The cylinder is purely decorative;
       *  underneath it we still render the per-port <Handle> stack as
       *  tiny invisible anchors so each wire's specific id ties to its
       *  own anchor and edges never detach when toggling.  ReactFlow
       *  pins every <Handle> to `top: 50%`, so stacking them inside the
       *  container's translateY(-50%) keeps them centred on the
       *  cylinder's midpoint.
       *
       *  Left cylinder: shown only when there ARE connected inputs.
       *  Right cylinder: shown whenever the node declares any output
       *  (matching ComfyUI's "outputs always visible" rule). */}
      {isCollapsed && (() => {
        /* Connected inputs (those whose value is a wire tuple `[]`).
         *  We rely on the existing split: allEntries[i] = [k, v], with
         *  Array.isArray(v) === true ⇒ wire-only / port-only input. */
        const connectedInputs = orderedEntries.filter(([, v]) => Array.isArray(v));
        const connectedOutputs = outputs.filter(([n]) => data.connectedOutputs?.has(n));
        /* Cylinder visual height scales with port count, clamped between
         *  16px (just a pill for one or two ports) and 64px (no longer
         *  than the chip body itself, otherwise the cylinder bleeds
         *  past the icon/title bar). */
        const cylH = (count: number) =>
          Math.min(64, Math.max(16, 12 + count * 4));
        return (
          <>
            {/* LEFT cylinder — only when there are connected inputs.
             *  Opaque gray→darker gradient sits on top of the wires
             *  (zIndex:10 above the wire layer + Handle anchors) so the
             *  user can clearly see "my ports are here" even when the
             *  canvas is busy with edges of arbitrary colour. */}
            {connectedInputs.length > 0 && (
              <div
                aria-hidden
                className="pointer-events-none absolute"
                style={{
                  left: -3,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 6,
                  height: cylH(connectedInputs.length),
                  borderRadius: 999,
                  background:
                    "linear-gradient(180deg, #d4d4d8 0%, #52525b 50%, #18181b 100%)",
                  border: "1px solid rgba(255,255,255,0.45)",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -1px 0 rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,0.6)",
                  zIndex: 10,
                }}
              />
            )}
            {/* RIGHT cylinder — whenever the node declares an output.
             *  Same opaque styling as the LEFT cylinder. */}
            {outputs.length > 0 && (
              <div
                aria-hidden
                className="pointer-events-none absolute"
                style={{
                  right: -3,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 6,
                  height: cylH(outputs.length),
                  borderRadius: 999,
                  background:
                    "linear-gradient(180deg, #d4d4d8 0%, #52525b 50%, #18181b 100%)",
                  border: "1px solid rgba(255,255,255,0.45)",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -1px 0 rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,0.6)",
                  zIndex: 10,
                }}
              />
            )}

            {/* Invisible per-port Handles — wires anchor here so the
             *  live edge geometry never breaks when toggling collapse.
             *  Centre on top:50% (ReactFlow default).  Hidden via
             *  opacity:0 but still `isConnectable:false` to avoid
             *  accidental new wires. */}
            {connectedInputs.map(([k, v], idx) => {
              const inputType = (data.rawInputs?.find((r) => r.name === k)?.type) ?? "*";
              const col = portColor(inputType);
              const total = connectedInputs.length;
              const offset = total > 1 ? (idx - (total - 1) / 2) * 6 : 0;
              return (
                <Handle
                  key={`collapsed-in-${k}-${idx}`}
                  type="target"
                  position={Position.Left}
                  id={k}
                  isConnectable={false}
                  className="!h-2 !w-2 !rounded-full"
                  style={{
                    left: 0,
                    top: `calc(50% + ${offset}px)`,
                    background: col,
                    opacity: 0,
                  }}
                  title={`${k} (${inputType})`}
                />
              );
            })}
            {connectedOutputs.map(([name, type], idx) => {
              const col = portColor(type);
              const total = connectedOutputs.length;
              const offset = total > 1 ? (idx - (total - 1) / 2) * 6 : 0;
              return (
                <Handle
                  key={`collapsed-out-${name}-${idx}`}
                  type="source"
                  position={Position.Right}
                  id={`out:${name}`}
                  isConnectable={false}
                  className="!h-2 !w-2 !rounded-full"
                  style={{
                    right: 0,
                    top: `calc(50% + ${offset}px)`,
                    background: col,
                    opacity: 0,
                  }}
                  title={`Output: ${name} (${type})`}
                />
              );
            })}
          </>
        );
      })()}

      {/* TOP PINS section — pure-connection inputs paired with outputs on
       *  shared rows (2026-08-06 redesign).
       *
       *  Layout principle: a ComfyUI node reads as "ports at the top,
       *  knobs below".  The two kinds of ports — INPUTS (left edge,
       *  target Handle) and OUTPUTS (right edge, source Handle) — are
       *  zipped positionally so a single 22-px row can hold one input
       *  on the left AND one output on the right.  When max(inputs,
       *  outputs) > 1 the rows stack; the leftover of the longer side
       *  keeps filling the trailing rows alone.
       *
       *  "Dot stays on permanently" rule (user feedback 2026-08-06):
       *  handles in this section are ALWAYS rendered, regardless of
       *  whether a wire is actually attached.  Previously outputs only
       *  showed their dot when `hasDownstream` was true; that made
       *  unconnected ports invisible and easy to overlook.  Every
       *  declared pin → visible port.
       *
       *  When the node is collapsed (`flags.collapsed`) the body is
       *  hidden; collapsed-mode handles live in the sibling block above. */}
      {!isCollapsed && (uniqueConnEntries.length > 0 || outputs.length > 0) && (
        <div
          className="border-b border-white/[0.05] py-0.5"
          style={{ background: "rgba(255,255,255,0.015)" }}
        >
          {Array.from({ length: Math.max(uniqueConnEntries.length, outputs.length) }).map(
            (_, rowIdx) => {
              const inEntry = uniqueConnEntries[rowIdx];
              const outEntry = outputs[rowIdx];
              const inName = inEntry?.[0];
              const outName = outEntry?.[0];
              const outType = outEntry?.[1];

              /* Input side — colour by declared slot type, label via the
               *  same zh-CN / label / friendly fallback chain the widget
               *  rows use, so e.g. "clip" surfaces as "CLIP" while a
               *  rawInputs entry with `localized_name` shows the
               *  localised label. */
              const inMeta = inName ? rawMeta[inName] : undefined;
              const inType = inMeta?.type ?? "*";
              const inCol = portColor(inType);
              const inLabel = inName
                ? sanitizeComboLabel(inMeta?.localized) ||
                  sanitizeComboLabel(inMeta?.label) ||
                  friendlyInputName(inName)
                : "";

              /* Output side — colour by `outputs[i][1]` (always set, even
               *  for static / dynamic fallbacks), label via rawOutputs
               *  `localized`, else the raw key. */
              const outCol = outType ? portColor(outType) : undefined;
              const outRaw = outName
                ? data.rawOutputs?.find((o) => o.name === outName)
                : undefined;
              const outDisplay = outRaw?.localized || outName;

              return (
                <div
                  /* Key includes both names so number-slot ports ("1",
                   *  "2", …) don't collide inside the array, AND so a
                   *  re-zip after a layout change remounts cleanly. */
                  key={`pinrow-${rowIdx}-${inName ?? "_"}-${outName ?? "_"}`}
                  className="relative flex h-[22px] items-center pl-5 pr-5 text-[11px]"
                  data-pin-input={inName}
                  data-pin-output={outName}
                >
                  {inEntry && (
                    <>
                      <Handle
                        type="target"
                        position={Position.Left}
                        id={inName}
                        isConnectable={false}
                        className="!h-2.5 !w-2.5 !rounded-full !border !border-[#0a0a0f]"
                        style={{
                          left: 5,
                          background: inCol,
                          boxShadow: `0 0 6px ${inCol}AA, inset 0 0 0 1px rgba(255,255,255,0.25)`,
                        }}
                        title={`${inName} (${inType})`}
                      />
                      {/* IO checkbox for TOP PINS inputs that are UNCONNECTED.
                       *  `connEntries` now includes both connected AND
                       *  unconnected typed ports (e.g. DaSiWa `audio` — AUDIO
                       *  with no upstream wire).  Workflow inputs MUST be
                       *  unconnected — a slot that already has an incoming
                       *  wire gets its value from upstream, so exposing it
                       *  as a workflow input is meaningless.  Only render
                       *  the checkbox when `!inMeta.isConnection` (and not a
                       *  subgraph boundary sentinel, which is also a wire). */}
                      {io?.ioEditMode && inMeta && !inMeta.isConnection && !inMeta.isBoundary && (
                        <IoCheckbox
                          io={io}
                          ioRef={{ nodeId: data.nodeId, name: inName, kind: "param", direction: "input" }}
                        />
                      )}
                      <span
                        className="min-w-0 flex-1 truncate text-left text-[11px] text-zinc-200"
                        title={String(inName)}
                      >
                        {inLabel}
                      </span>
                    </>
                  )}
                  {outEntry && (
                    <>
                      <span
                        className="min-w-0 flex-1 truncate text-right text-[11px] text-gray-200"
                        title={`${outName} (${outType})`}
                      >
                        {outDisplay}
                      </span>
                      {/* Output checkbox sits on the OUTPUT side (right) so it
                       *  visually pairs with the parameter name + Handle dot.
                       *  Earlier it was on the left with the input checkboxes,
                       *  which made the three checkboxes cluster on the left
                       *  even though the outputs anchored on the right. */}
                      {io?.ioEditMode && outName && (
                        <IoCheckbox
                          io={io}
                          ioRef={{ nodeId: data.nodeId, name: outName, kind: "output", direction: "output" }}
                        />
                      )}
                      <Handle
                        type="source"
                        position={Position.Right}
                        id={`out:${outName}`}
                        isConnectable={false}
                        className="!h-2.5 !w-2.5 !rounded-full !border !border-[#0a0a0f]"
                        style={{
                          right: 5,
                          background: outCol,
                          boxShadow: `0 0 6px ${outCol}AA, inset 0 0 0 1px rgba(255,255,255,0.25)`,
                        }}
                        title={`${outDisplay} (${outType})`}
                      />
                    </>
                  )}
                </div>
              );
            }
          )}
        </div>
      )}

      {/* Widget inputs section — knobs only (every entry here carries a
       *  widgets_values slot).  Pure-connection ports live in the TOP
       *  PINS section above; this section renders the actual scalar /
       *  object inputs with their values.
       *
       *  Inputs that ALSO carry a wire (subgraph wrappers with sentinel
       *  links, e.g. RandomNoise.noise_seed inside a NOISE subgraph)
       *  still keep their Handle so the wire anchors, but the row stays
       *  in the compact "NAME | VALUE" layout — exactly the same shape
       *  as an unwired widget row.
       *
       *  Hidden when the node is collapsed (collapsed-mode handles live
       *  in the sibling block above the header). */}
      {!isCollapsed && visibleWidgetEntries.length > 0 && !isPowerLoraLoader && (
        <div className="relative flex min-h-0 flex-1 flex-col py-0.5">
          {visibleWidgetEntries.map(([k, v], idx) => {
            /* `widgetEntries` only ever contains non-array scalars
             *  (the connection rows are filtered into `connEntries`
             *  above).  A row carries a wire only when `rawInputs`
             *  flags it as both connected AND a widget (rare — chiefly
             *  subgraph wrapper inputs that double as a default-value
             *  slot).  Render the Handle so the wire anchors, keep the
             *  compact widget layout. */
            const isConn = rawMeta[k]?.isConnection === true;
            const srcClass = isConn ? data.inputSources?.[k]?.classType : undefined;

            /* Boundary wire (2026-08-06): the wrapper-exposes-this-slot
             *  flag — surfaced by the subgraph route when the input is
             *  fed by a sentinel link (`origin_id === -10`).  Treat the
             *  row as a connection for Handle/colour but keep the
             *  compact widget row layout. */
            const isBoundary =
              rawMeta[k]?.isBoundary === true || data.boundaryInputs?.has(k) === true;

            // The *type* of this input — always inferred from the JS-typed
            // scalar value (no wire-tuple edgeType path here, those live
            // in the top pins section).
            const inputType = inferInputType(data.classType, k, v);
            const typeCol = portColor(inputType);

            /* Display label for the input.  ComfyUI's `localized_name` is the
             *  canonical zh-CN UI label; falling back through:
             *    localized_name → friendly map of input names → raw key.
             *  Custom COMBO widgets (KJNodes etc.) bake their full options
             *  list into `label` as "Model: True = 📀Safetensors | False =
             *  💿GGUF", which clutters the row — strip those descriptors
             *  before they reach the layout. */
            const meta = rawMeta[k];
            const friendlyLabel =
              sanitizeComboLabel(meta?.localized) ||
              sanitizeComboLabel(meta?.label) ||
              friendlyInputName(k);

            /* STRING widget inputs are rendered as a single inline row
             *  (label | value) by default — short scalars like "auto" /
             *  "fp16" / "small" / "true" don't justify a 56-px textbox
             *  that pushes the row to two visual lines.  Only collapse
             *  to a bordered textbox when the string is genuinely long
             *  (>=32 chars, e.g. a CLIPTextEncode prompt) OR
             *  multi-line — so authors still get a readable prompt
             *  surface, while Combo-flavoured inputs (KJNodes `sage_
             *  attention`, `allow_compile`, etc.) stay on the same
             *  22px line as INT/FLOAT widgets.
             *
             *  Connections (isConn) keep the compact single-line row
             *  (their names UNet / CLIP / VAE etc. must NOT be omitted).
             *
             *  Empty strings stay inline too — the `（空）` placeholder
             *  would otherwise add a 28-px textbox that draws the eye to
             *  inputs the author hasn't touched yet (every empty STRING
             *  widget would have to be ignored). */
            const stringText = typeof v === "string" ? v : "";
            /* 2026-08-10 R18: STRING widget detection now consults
             *  `inferIsMultiline(classType, name, defaultValue)` —
             *  the same helper that `DynamicWorkflowForm`'s
             *  `controlForEntry` uses on the workflowIO path.  Order of
             *  the conditions matters:
             *    1. inputType === "STRING" — only STRING-typed slots
             *       qualify; INT/FLOAT/COMBO keep their 22px row.
             *    2. inferIsMultiline — ComfyUI native multiline flag
             *       cannot survive the API-format export (our rawJson
             *       carries no widgets[] / inputs[]), so the helper
             *       backfills it from a static (class, name) table +
             *       name heuristic + length heuristic.  (Previously
             *       this branch required `stringText.length >= 32 ||
             *       \n`, which quietly dropped SHORT prompt inputs
             *       such as `negative_prompt` even when the author
             *       intended them to be multiline.)
             *
             *  2026-08-11 (R36): dropped the `!isConn` gate.  The old
             *  rule forced any *connected* STRING (e.g. CLIPTextEncode
             *  fed by a downstream text combiner) to fall back to the
             *  22px inline chip — a prompt like
             *  "狭小出租屋厨房的俯瞰中景镜头..." got truncated to
             *  "狭小出租屋厨房的俯瞰中景镜头, 午后阳光..." with the
             *  rest hidden behind `truncate`.  Removing the gate lets
             *  connected multiline STRING also render as the stacked
             *  textarea (R17/R18).  The Handle stays anchored at the
             *  LEFT edge regardless of layout because React Flow
             *  positions Handles from the node bbox, not from CSS —
             *  so the wire still lands on the dot even when the row
             *  is `flex-col` instead of `flex-row`.  SHORT connected
             *  STRING (`clip`, `vae_name`, etc.) still uses the
             *  compact inline chip since multiline stays false. */
            const isStringWidget =
              inputType === "STRING" &&
              (inferIsMultiline(data["classType"] as string, k, stringText) ||
                stringText.length >= 32 ||
                stringText.includes("\n"));

            return (
              <div
                /* `idx` is appended to the key so ComfyUI number-slot
                 *  inputs ("1", "2", …) don't collide across rows —
                 *  rgthree and similar packs carry those, and React
                 *  would throw "two children with the same key, `1`"
                 *  if two such slots landed in the same
                 *  `visibleWidgetEntries` list. */
                key={`${k}-${idx}`}
                data-input-key={k}
                data-input-type={inputType}
                /* 2026-08-10 R17: STRING widgets always render as a STACKED
                 *  block — LABEL/chip row on top, textarea fills the
                 *  remaining vertical space below.  Previous `flex-row
                 *  items-start gap-2` (2026-08-08, retained up through
                 *  R13) put them on the SAME row, squeezing the textarea
                 *  against the label and forcing it under `maxHeight: 96`
                 *  — the layout users reported as "标题和内容同一排 +
                 *  不可自适应高度 + 不铺满可用空间".  Vertical flex-col
                 *  frees the textarea to flex-1 fill the row's remaining
                 *  height; StringTextarea's own `flex: 1 1 0` + `minHeight:
                 *  0` lets it claim whatever space the box has left.
                 *  `flex-1` on the row makes the textarea compete
                 *  legitimately with the rest of the widget zone for the
                 *  box's leftover height (no more single-line prompt rows
                 *  inflated to node-tall by a zero-width label). */
                className={
                  isStringWidget
                    ? "group relative flex min-h-0 flex-1 flex-col gap-1.5 pl-5 pr-2 py-1.5 text-[11px]"
                    : "group relative flex h-[22px] items-center gap-1.5 pl-5 pr-2 text-[11px]"
                }
              >
                {isConn || isBoundary ? (
                  /* The Handle IS the dot — single point, single click
                   * target.  ReactFlow's Handle applies
                   * `transform: translate(50%, -50%)` which shifts the
                   * box 5px outward.  Setting `left: 5px` compensates
                   * so the dot's *centre* lands exactly on the node's
                   * left edge — incoming edge anchors through the
                   * dot's centre with no visible gap.  Widget inputs
                   * without a connection AND without a boundary wire
                   * get NO dot — only connected ports show a Handle.
                   * Connected STRING inputs never enter the textbox
                   * branch (`isStringWidget` requires `!isConn`), so
                   * the Handle always sits on the compact 22px row.
                   *
                   * `isBoundary` (2026-08-06): see sibling comment
                   * above — without this branch the boundary wire's
                   * Handle never mounts and the wire is silently
                   * dropped by React Flow at reconcile time. */
                  <Handle
                    type="target"
                    position={Position.Left}
                    id={k}
                    isConnectable={false}
                    className="!h-2.5 !w-2.5 !rounded-full !border !border-[#0a0a0f]"
                    style={{
                      left: 5,
                      background: typeCol,
                      boxShadow: `0 0 6px ${typeCol}AA, inset 0 0 0 1px rgba(255,255,255,0.25)`,
                    }}
                    title={`${k} (${inputType})`}
                  />
                ) : null}

                {/* Top row: label + (inline value).  The variable type
                 *  label was removed (2026-08-04) — it cluttered every row
                 *  with a near-meaningless COMBO/STRING/INT tag and added
                 *  no actionable info.  The connection dot still shows the
                 *  port colour via `typeCol` above; the label is ALWAYS
                 *  rendered (incl. enum names like UNet / CLIP / VAE).
                 *
                 *  STRING scalars below the 32-char threshold render
                 *  inline (e.g. `sage_attention | auto`) — only long /
                 *  multi-line STRING values (real prompts) get the
                 *  bordered textbox below.
                 *
                 *  Layout rules (2026-08-07 dynamic-value pass):
                 *    • LABEL — content width (no hard cap; flex: 0 1 auto
                 *              with min-width: 0).  Long keys still
                 *              ellipsise via `truncate` when the value
                 *              needs every remaining pixel.
                 *    • VALUE — flex: 1 1 auto, takes ALL row space the
                 *              label doesn't claim, capped at 75% so a
                 *              label is always at least 25% visible.
                 *              Filenames like
                 *              `DaSiWa_Wan22_I2V_14B_SnatchKiss_v1-…`
                 *              finally show in full on the wrapper
                 *              subgraph node (was being clipped by the
                 *              label's old 55% cap). */}
                {isStringWidget ? (
                  /* Top row of the STRING STACKED block (R17) — LABEL +
                   *  IoCheckbox sit on a horizontal flex at the top of a
                   *  `flex-col` row, leaving the StringTextarea below to
                   *  claim the remaining vertical space.  R7-R13 used
                   *  `flex-row items-start` here, which kept label and
                   *  textarea on the SAME row and forced the textarea
                   *  under `maxHeight: 96` — the "标题和内容同一排,
                   *  不铺满可用空间" layout the user reported.  shrink-0
                   *  kept the label at its natural width when the row
                   *  was inline; now that the row is vertical it is
                   *  harmless but left in place to defend against a
                   *  future regression where someone re-introduces a
                   *  flex-1 sibling at this level. */
                  <div className="flex shrink-0 items-center gap-1.5">
                    {io?.ioEditMode && !isConn && !isBoundary && (
                      <IoCheckbox
                        io={io}
                        ioRef={{ nodeId: data.nodeId, name: k, kind: "widget", direction: "input" }}
                      />
                    )}
                    <span
                      className="shrink-0 truncate text-left text-[11px]"
                      style={{ color: isConn ? "#e4e4e7" : "#d4d4d8" }}
                      title={k}
                    >
                      {friendlyLabel}
                    </span>
                  </div>
                ) : (
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    {/* Workflow inputs must be UNCONNECTED — a slot that already
                     *  has an incoming wire (or a sentinel boundary link) gets
                     *  its value from upstream, so exposing it as a workflow
                     *  input is meaningless.  Skip the checkbox for those. */}
                    {io?.ioEditMode && !isConn && !isBoundary && (
                      <IoCheckbox
                        io={io}
                        ioRef={{ nodeId: data.nodeId, name: k, kind: "widget", direction: "input" }}
                      />
                    )}
                    <span
                      className="min-w-0 shrink truncate text-left text-[11px]"
                      style={{ flex: "0 1 auto", color: isConn ? "#e4e4e7" : "#d4d4d8" }}
                      title={k}
                    >
                      {friendlyLabel}
                    </span>

                    {/* Soft 1px vertical divider between label and value
                     *  (2026-08-07 softened: was `bg-white/10 h-3` —
                     *  too heavy next to the type-coloured value text,
                     *  it read as "cut the row in half").  Halving the
                     *  alpha to 0.05 and dropping the height to 8px
                     *  keeps a subtle column anchor without dominating
                     *  the row. */}
                    {/* A widget input that ALSO carries a wire (e.g. KSampler
                     *  seed / steps / cfg, CLIPTextEncode.text,
                     *  VAEDecode.samples) must still show its control value —
                     *  ComfyUI keeps the widget control (readonly) when wired,
                     *  it never hides it.  Always render the value; only dim
                     *  it one notch on a wired row so the reader can tell the
                     *  live value arrives from the wire while this is the
                     *  widget's stored default.  The old `!isConn` guard
                     *  wrongly blanked exactly these rows. */}
                    <>
                      <span
                        className={
                          isConn
                            ? "h-2 w-px shrink-0 bg-white/[0.05] opacity-50"
                            : "h-2 w-px shrink-0 bg-white/[0.05]"
                        }
                        aria-hidden
                      />
                      <span
                        className="min-w-0 truncate text-right text-[10.5px] tabular-nums"
                        style={{
                          flex: "1 1 0",
                          color: isConn ? withAlpha(valueCellColor(v)) : valueCellColor(v),
                        }}
                        title={String(v)}
                      >
                        {renderWidgetValue(v, data.classType, k)}
                      </span>
                    </>
                  </div>
                )}
                {/* STRING-widget textbox — STACKED BELOW the LABEL row
                 *  (2026-08-10 R17).  The row is `flex-col gap-1.5 flex-1`
                 *  (label on top, textarea fills the rest of the row).
                 *  Previous `flex-row items-start` (R7-R13) paired label
                 *  and textarea inline and capped the textarea's height
                 *  with `maxHeight: 96`, which the user reported as
                 *  "标题和内容同一排 + 内容不铺满可用空间".  Now the
                 *  label sits on a dedicated top row, and the textarea
                 *  container (already `flex min-w-0 flex-1 flex-col` since
                 *  the original layout work) occupies every remaining
                 *  pixel of the row.
                 *
                 *  Implementation notes (unchanged from 2026-08-07 / -08):
                 *  — `<textarea readOnly>` (browser-native scroll-on-overflow)
                 *    beats `<div>` + Tailwind arbitrary-value classes that
                 *    silently drop inside this WfNode subtree.
                 *  — In `hasSize` path the container's `flex-1 min-h-0`
                 *    claims height; the textarea inside adds `flex: 1 1 0`
                 *    via inline style so it fills the container, not just
                 *    the row.
                 *  — In `!hasSize` path the useLayoutEffect grows the
                 *    textarea to its full `scrollHeight` (uncapped since
                 *    R17 — the old 96 cap is gone).
                 *  — Empty value falls back to a faint "（空）" placeholder
                 *    (an empty textarea still draws a caret rectangle). */}
                {isStringWidget && (
                  <div className="flex min-w-0 flex-1 flex-col">
                    {stringText.length > 0 ? (
                      <StringTextarea value={stringText} hasSize={hasSize} />
                    ) : (
                      <div
                        className="rounded border border-white/10 bg-black/30 px-2 py-1.5 text-[10.5px] leading-snug text-gray-600"
                        style={{ minHeight: 28 }}
                        title={stringText}
                      >
                        （空）
                      </div>
                    )}
                  </div>
                )}

              </div>
            );
          })}
        </div>
      )}

      {/* rgthree Fast Groups Bypasser runtime body (2026-08-09).
       *  Rendered as a static child of the node card so it flows under
       *  the (empty) I/O rows.  Only fires for the rgthree classType
       *  with a non-empty `matchTitle` property; every other node
       *  keeps the default empty body.  The body filters `data.groups`
       *  by `matchTitle` and renders one toggle row per match; each
       *  toggle flips the group's `flags.bypass` via
       *  `RgthreeGroupsContext.setBypass` (PATCH → rawJson write). */}
      {data.classType === "Fast Groups Bypasser (rgthree)" &&
        typeof data.properties?.matchTitle === "string" && (
          <RgthreeFastGroupsBypasserBody
            matchTitle={data.properties.matchTitle as string}
            groups={data.groups ?? []}
          />
        )}

      {/* rgthree Power Lora Loader runtime body (2026-08-09).  Renders the
       *  lora stack from the node's `widgets_values` (header widget + per-lora
       *  slots).  Flows under the MODEL/CLIP top pins, mirroring rgthree's
       *  own layout.  Read-only. */}
      {data.classType === "Power Lora Loader (rgthree)" && (
        <RgthreePowerLoraLoaderBody widgets={data.rawWidgetValues ?? []} />
      )}

      {/* rgthree Label runtime body (2026-08-09).  No I/O — paints the title
       *  in the styles carried by `properties`.  Renders whenever the node is
       *  a Label, filling the (header-less) card. */}
      {isLabel && (
        <RgthreeLabelBody text={data.title} properties={data.properties ?? {}} />
      )}

      {/* IMAGE-input inline thumbnail preview (2026-08-10 R27).  Every rawInput
       *  that carries `imageRef` (resolved server-side from a LoadImage upstream)
       *  gets a ComfyUI-style preview: label + thumbnail + pixel dimensions,
       *  rendered once at the node-body tail so it never disturbs the pinned
       *  two-column TOP-PINS layout above. */}
      {!isCollapsed && imagePreviewEntries.length > 0 && (
        <div className="flex flex-col gap-2 px-2 pb-2 pt-1">
          {imagePreviewEntries.map((entry) => (
            <WfImagePreview key={entry.name} entry={entry} />
          ))}
        </div>
      )}

      {/* Default target handle for nodes with no inputs at all
       *  (unmapped/fallback edges need somewhere to anchor).  Kept on
       *  the left so legacy edges still find a slot. */}
      {uniqueConnEntries.length === 0 && uniqueWidgetEntries.length === 0 && (
        <Handle
          type="target"
          position={Position.Left}
          id="__default_in"
          className="!h-2.5 !w-2.5 !border-2 !border-[#0a0a0f] !bg-violet-400/80"
          style={{ left: -5 }}
        />
      )}

      {/* Generic source handle — always present but invisible.  Edges that
       *  can't resolve a precise "out:<name>" handle (e.g. a node whose output
       *  slot isn't in our offline type table) fall back to this id so the wire
       *  still anchors instead of silently vanishing. */}
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        isConnectable={false}
        style={{ opacity: 0, right: -5 }}
      />

      {/* ComfyUI-native bottom-left footers.  Two independent labels can
       *  appear here:
       *   1. Package source (PackageFooter) — where the node came from.
       *      Built-in nodes hide it; custom nodes show the package (e.g.
       *      "rgthree-comfy").  Unregistered rgthree classes fall back to
       *      `properties.cnr_id` so they still show their package instead of
       *      being hidden under the old "ComfyUI" default.
       *   2. `frontend_only` badge — shown when the node's LiteGraph
       *      `properties.frontend_only === true` (a SEPARATE concept from the
       *      package name: it means "runs only in the browser frontend").
       *  Both are HIDDEN when the node is collapsed — a collapsed chip is just
       *  the title bar + a single port cylinder, matching ComfyUI's collapsed
       *  silhouette (no package / frontend_only label competing for the space). */}
      {!isCollapsed && (
        <>
          <PackageFooter
            classType={data.classType}
            name={resolveNodePackage(data.classType, data.properties)}
          />
          {data.properties?.frontend_only === true && <FrontendOnlyBadge />}
        </>
      )}
    </div>
  );
}

/** Wrap inferOutputType so we always get a [name, type] tuple list. */
function inferOutputTypeAll(classType: string): { [name: string]: string } {
  // ComfyUI lets nodes name their outputs; we don't have that info offline,
  // so we use slot-based names.  For CheckpointLoaderSimple etc. this is
  // MODEL/CLIP/VAE which lines up with ComfyUI's default display.
  const KNOWN_NAMES: Record<string, string[]> = {
    CheckpointLoaderSimple:          ["MODEL", "CLIP", "VAE"],
    CheckpointLoader:                ["MODEL", "CLIP", "VAE"],
    UNETLoader:                      ["MODEL"],
    UNetLoader:                      ["MODEL"],
    CLIPLoader:                      ["CLIP"],
    DualCLIPLoader:                  ["CLIP", "CLIP"],
    VAELoader:                       ["VAE"],
    ControlNetLoader:                ["CONTROL_NET"],
    LoraLoader:                      ["MODEL", "CLIP"],
    KSampler:                        ["LATENT"],
    KSamplerAdvanced:                ["LATENT"],
    CLIPTextEncode:                  ["CONDITIONING"],
    CLIPTextEncodeSDXL:              ["positive", "negative"],
    VAEDecode:                       ["IMAGE"],
    VAEEncode:                       ["LATENT"],
    EmptyLatentImage:                ["LATENT"],
    LoadImage:                       ["IMAGE", "MASK"],
    ImageScale:                      ["IMAGE"],
    ImageUpscaleWithModel:           ["IMAGE"],
    LatentUpscale:                   ["LATENT"],
    SetLatentNoiseMask:              ["LATENT"],
    ControlNetApply:                 ["CONDITIONING"],
    ConditioningCombine:             ["CONDITIONING"],
    ConditioningAverage:             ["CONDITIONING"],
    SaveImage:                       [],
    PreviewImage:                    [],
    WanVideoSampler:                 ["LATENT"],
    WanVideoDecode:                  ["IMAGE"],
    WanVideoImageToVideoEncode:      ["LATENT"],
    WanVideoTextEncode:              ["CONDITIONING"],
    WanVideoT5TextEncode:            ["CONDITIONING"],
    WanVideoModelLoader:             ["MODEL", "CLIP", "VAE"],
  };
  const types = KNOWN_NAMES[classType] ?? [];
  const out: { [k: string]: string } = {};
  for (let i = 0; i < types.length; i++) {
    out[types[i] || `out${i + 1}`] = types[i] || "UNKNOWN";
  }
  return out;
}

/** Render a widget value as ComfyUI would:
 *   - numbers → 4dp trailing-zero strip (e.g. 1.00)
 *   - booleans → ✓ / ✕ icon
 *   - long strings → first 50 chars + ellipsis (full text in title)
 *   - objects → "{...}" */
function renderWidgetValue(v: any, classType: string, key: string): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "boolean") return v ? "✓" : "✕";
  if (typeof v === "number") {
    // Keep small floats as 2dp; integers without dp.
    if (Number.isInteger(v) || v >= 10000) return String(v);
    const s = (Math.round(v * 100) / 100).toFixed(2);
    // strip trailing zeros (1.00 → 1) but keep precision
    return s.replace(/\.?0+$/, "") || "0";
  }
  if (typeof v === "string") {
    /* Filenames like "DaSiWa_Wan22_I2V_14B_SnatchKiss_v1.safetensors" run
     *  40+ chars; previously this function hard-truncated to 48 chars,
     *  which produced the "DaSiWa_Wan22_…" inline display regardless of
     *  node width.  The truncation now lives in CSS (`maxWidth: 480px`
     *  on the consuming <span>) — that way a wider node shows the full
     *  filename, and the full text remains available via `title`. */
    return v;
  }
  if (Array.isArray(v)) return "[…]";
  if (typeof v === "object") return "{…}";
  return String(v);
}

/** Choose a text color for the value cell based on its JS type.  The
 *  goal is to make the value-column visually subordinate to the label
 *  column while still being easy to scan at a glance — we keep all
 *  hues inside a low-saturation palette so the chip never looks like
 *  a rainbow.  Returns a CSS color (rgba) suitable for inline style. */
function valueCellColor(v: any): string {
  if (v === undefined || v === null) return "rgba(255,255,255,0.30)";
  if (typeof v === "boolean") return v ? "#86efac" /* green-300 */ : "#fca5a5" /* red-300 */;
  if (typeof v === "number") return "#fcd34d" /* amber-300 */;
  if (typeof v === "string") return "#c7d2fe" /* indigo-200 */;
  return "rgba(255,255,255,0.55)";
}

/** Append an alpha channel to a value-cell color so a wired-widget row's
 *  control value reads one notch dimmer than an unwired one — signalling
 *  "this is the widget default; the live value comes from the wire".
 *  `valueCellColor` returns 6-digit hex for real values; for any
 *  edge-case rgba input we lower the alpha instead. */
function withAlpha(color: string): string {
  if (color.startsWith("#") && color.length === 7) return color + "66";
  const m = color.match(/rgba\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(",").map((s) => s.trim());
    if (parts.length === 4) return `rgba(${parts[0]},${parts[1]},${parts[2]},0.40)`;
  }
  return color;
}

/** Same shape as WfNode's widget values but stripped of any classType
 *  / key-aware sanitisation — a Subgraph has no `class_type` to ask
 *  for a friendly name from, and the inputs are already chosen by
 *  their `name` (and `localized_name`).  We only need the JS-type-driven
 *  colour family here; the cell on the parent card shows the raw paired
 *  value as ComfyUI stored it. */
function renderSubgraphWidgetValue(v: unknown): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "boolean") return v ? "✓" : "✕";
  if (typeof v === "number") {
    if (Number.isInteger(v) || v >= 10000) return String(v);
    const s = (Math.round(v * 100) / 100).toFixed(2);
    return s.replace(/\.?0+$/, "") || "0";
  }
  if (typeof v === "string") {
    /* Same rationale as `renderWidgetValue`: the CSS layer (now with
     *  `maxWidth: 480px` + `text-overflow: ellipsis`) owns display
     *  truncation.  The previous 36-char data-truncation made every long
     *  filename render as "DaSiWa_Wan22_…" inline regardless of how
     *  wide the user had made the node — that broke once the user
     *  asked for value cells to actually use the available width.  Full
     *  text stays available via the `title` attr on the <span>. */
    return v;
  }
  if (Array.isArray(v)) return "[…]";
  if (typeof v === "object") return "{…}";
  return String(v);
}

/** Trim a raw `label` / `localized_name` down to its user-facing key.
 *  Custom COMBO widgets (KJNodes etc.) bake their full options list
 *  into the label as `"<Key>: True = 📀Safetensors | False = �GGUF"`,
 *  which clutters the row.  This strips everything from the first
 *  `:` onward *if* what follows contains another `=` or `|` — i.e.
 *  looks like a COMBO descriptor — and leaves well-formed labels
 *  like `"choose 1st frame to upload"` untouched. */
function sanitizeComboLabel(label: string | undefined | null): string {
  if (!label) return "";
  const colon = label.indexOf(":");
  if (colon <= 0 || colon === label.length - 1) return label.trim();
  const tail = label.slice(colon + 1);
  /* Only strip when the tail looks like COMBO options: contains another
   *  `=` (True = ...) or `|` (option separator).  Plain colon-bearing
   *  sentences like "Note: keep this secret" are kept intact. */
  if (/[=|]/.test(tail)) {
    return label.slice(0, colon).trim();
  }
  return label.trim();
}


/* ── Group frame node (ComfyUI group / frame rectangle) ──
 * Pure decoration: a translucent filled rectangle with a coloured border and a
 * title chip.  It never carries ports and never intercepts pointer events, so
 * it sits behind the real graph nodes and clicks pass straight through. */
interface WfGroupData {
  [key: string]: unknown;
  title: string;
  color: string;
  /** When true, the group becomes a real draggable unit: pointerEvents
   *  flip to auto, the cursor signals move-on-grab, and any React Flow
   *  children declared with `parentId: this.id` + `extent:"parent"` move
   *  in lock-step.  When false/undefined the group is pure decoration in
   *  the back layer (pointers pass through to nodes/edges underneath) —
   *  the legacy behaviour used by ComfyUI's own `group` rectangles. */
  draggable?: boolean;
}

function WfGroupNode({ data }: { data: WfGroupData }) {
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
interface WfIoPortData {
  [key: string]: unknown;
  title: string;
  type?: string;
  value?: unknown;
  direction: "input" | "output" | "both";
  parentNodeId: string;
  parentNodeTitle: string;
  /** First middle node this endpoint feeds into (input side) — used to
   *  vertically align the port to its consumer in the left column. */
  connectsTo?: string | null;
  /** First middle node this endpoint is fed by (output side) — used to
   *  vertically align the port to its producer in the right column. */
  connectsFrom?: string | null;
}

/* Layout constants for the boundary-pin wfIoPort cards (2026-08-06 late).
 *  The pins live inside INPUTS / OUTPUTS wfGroup rectangles and are
 *  rendered as compact label rows stacked vertically.  These three values
 *  govern the column's visual rhythm; bumping IO_PORT_HEIGHT shrinks the
 *  whole rail, bumping PORT_ROW_GAP separates the pins more, and
 *  IO_PORT_WIDTH controls how much room the longest label gets before it
 *  starts clipping.  The previous render used {130, 26, ~10}; the user
 *  asked for tighter spacing + a slightly wider label slot, so we moved
 *  to {160, 22, 4}.
 *
 *  2026-08-11 (R52): bumped IO_PORT_HEIGHT 22 → 24 because at 22 px the
 *  React Flow node wrapper clipped the descenders of letters with
 *  downward strokes (`p`, `g`, `y`, `q`) by ~1–2 px.  The 10.5 px font's
 *  ascender + cap + descender stack fills more than 22 px once you
 *  centre it via `flex items-center` inside a 2 px `py-[1px]` row, and
 *  the node's `style.height = IO_PORT_HEIGHT` makes the wrapper a hard
 *  clip box.  24 px gives the descender a clean ~4–5 px runway and the
 *  whole wfGroup only grows by 2 px × (rowCount−1) ≈ 20 px for a 10-row
 *  INPUT rail — well within the user's "紧凑" brief.
 *
 *  2026-08-11 (R53): bumped IO_PORT_HEIGHT 24 → 26 + flipped the row's
 *  flex alignment from `items-center` to `items-end` with `pb-[1px]`
 *  inside WfIoPortNode.  R52 gave a calculated ~7 px clearance, but in
 *  the user's screenshot the `p` / `g` descenders STILL read as partial
 *  stubs — likely a combination of (a) Windows ClearType / sub-pixel
 *  rendering at non-integer zoom levels amputating the bottom 1 px of
 *  every glyph, and (b) `flex items-center` placing the *glyph block
 *  centre* rather than the baseline — so the descender sits roughly
 *  mid-row, where it visually crowds into the row below.  End-aligning
 *  pins the line box to the bottom of the node (with 1 px breathing
 *  room), which guarantees the descender terminal sits just above the
 *  row boundary and reads as a fully formed character at every zoom
 *  level.  Net wfGroup growth ≈ 2 px × 9 = 18 px for a 10-row rail.
 *
 *  2026-08-11 (R54): the user's third screenshot still showed the
 *  descenders amputated.  The R53 / items-end trick relied on the
 *  descender sitting at the *baseline of the line-box*, but with
 *  `leading-none` (= line-height: 1, so line-box = 10.5 px) the Inter
 *  descender (~3 px) still lives BELOW the line-box, clipped by
 *  `style.height = IO_PORT_HEIGHT` no matter how we align.  R54
 *  replaces `leading-none` with `leading-[1.4]` (= 14.7 px line-box),
 *  which now INTERNALLY contains ascender + cap + descender with
 *  margin on both sides; with `items-center` the descender lands at
 *  y ≈ 10 px inside a 28 px wrapper, leaving a comfortable 4-5 px
 *  clear runway at the bottom.  IO_PORT_HEIGHT bumps 26 → 28 to
 *  keep a safety gap.  wfGroup rail grows by ~18 px for 10 rows.  If
 *  the user complains about row gaps looking too loose later, swap
 *  to leading-snug (1.375) and IO_PORT_HEIGHT = 26 to claw back 1 px. */
const IO_PORT_WIDTH = 160;
const IO_PORT_HEIGHT = 28;
const PORT_ROW_GAP = 4;
/** Horizontal padding applied inside the wfGroup around the wfIoPort
 *  column.  Keeps the label text from kissing the purple border. */
const GROUP_PAD_X = 10;
/** Vertical padding at the top of a wfGroup — leaves room for the -top-16
 *  title chip (rendered at `-top-[16px]` above the box, taking ~18 px). */
const GROUP_TITLE_BAR = 24;
/** Vertical padding at the bottom of a wfGroup. */
const GROUP_PAD_Y_BOTTOM = 10;
/** Border + title-chip colour for the INPUTS / OUTPUTS wfGroups wrapping
 *  the boundary pins (2026-08-06 late).  A muted purple so the group
 *  frames read clearly against the dark `#0a0a0f` canvas while still
 *  staying distinct from the inner WfNode / WfSubgraphNode cards. */
const GROUP_RAIL_COLOR = "#a855f7";

function WfIoPortNode({ data }: { data: WfIoPortData }) {
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
interface WfNoteData {
  [key: string]: unknown;
  title: string;
  text: string;
  color: string;
}

function WfNoteNode({ data }: { data: WfNoteData }) {
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
interface WfSubgraphData {
  [key: string]: unknown;
  /** ComfyUI real node id (matches `detail.graph[id]`, `rawMetaById[id]`,
   *  `positions[id]`).  Stamped by the initialNodes builder so the
   *  `#id` chip can look up the entry the same way `WfNodeData.nodeId`
   *  does — using `data.uid` (classType 前 8 位) here would always miss
   *  because that's a hash, not the canonical ComfyUI id. */
  nodeId: string;
  title: string;
  uid: string;             // first 8 chars of class_type — used as subtitle
  inputs: RawInputMeta[];
  /** Per-output display metadata from raw JSON (e.g. the IMAGE output a
   *  subgraph exposes).  Empty when the subgraph has no outputs. */
  outputs?: RawOutputMeta[];
  widgetValues: any[];
  /** Callback to enter the subgraph's internal graph. */
  onEnter?: () => void;
  /** Same semantics as WfNodeData.connectedOutputs — only outputs in this
   *  set get a visible source Handle. */
  connectedOutputs?: Set<string>;
  /** Input NAMES (matching `inputs[i].name`) that have an external wire in
   *  the *parent* workflow.  WfSubgraphNode only renders a target Handle
   *  for inputs whose name appears here.  Independent (un-wired) subgraph
   *  inputs still get their label row so the user can see what's exposed,
   *  but no Handle is rendered. */
  connectedInputs?: Set<string>;
  /** Exact ComfyUI box size { w, h } (body only, title bar excluded).
   *  When present the card is forced to these dimensions.  Undefined →
   *  content-driven. */
  size?: { w: number; h: number };
  /** LiteGraph `mode` (0 = Always / 2 = Never-mute / 4 = Bypass).  Same
   *  semantics as WfNodeData.mode — drives the 3-state color overlay. */
  mode?: number;
  /** LiteGraph flags forwarded verbatim from raw JSON.  Currently
   *  read for `flags.collapsed` so an imported subgraph that ComfyUI
   *  ships collapsed stays collapsed here too. */
  flags?: Record<string, any>;
}

function WfSubgraphNode({ data, selected }: { data: WfSubgraphData; selected?: boolean }) {
  const io = useContext(IOEditContext);
  /* Parent-graph subgraph card — mirrors WfNode's two-zone layout
   * (2026-08-07): a purple HEADER, a TOP PINS zone that zips the
   * wrapper's pure-connection input ports (left dot) with its exposed
   * output ports (right dot) on shared 22px rows, and a WIDGET zone
   * listing the wrapper's exposed widget inputs as LABEL | VALUE rows
   * (a dot only when the widget slot is ALSO wired, matching WfNode's
   * "both" behaviour).  The purple identity + drill-in affordance are
   * the only subgraph-specific bits; the IO rows use the exact same
   * connection model as a regular node so wiring stays uniform. */
  /* Subgraph identity tint: purple by default, switching to bypass-pink
   *  (#ec4899) when the wrapper itself is bypassed and to grey when
   *  muted.  Mirrors WfNode's mode→color logic (2026-08-07). */
  const nodeMode = data.mode ?? 0;

  /*  Subgraph wrapper uses the same REAL `backdrop-filter` via <NodeFrost>
   *  as WfNode — counter-scaled by 1/zoom to avoid Chromium's low-zoom
   *  re-tile artefact.  <PseudoFrostLayer> stays an unused fallback. */
  const accent =
    nodeMode === 4 ? "#ec4899" :
    nodeMode === 2 ? "#6b7280" :
    "#7C5CFC";  // subgraph default purple identity (mode 0)

  /* Same box semantics as WfNode: when the imported config carries an
   *  explicit size, the root div is forced to width/height: 100% (see the
   *  `style` block below) so the card fills the React Flow node box.  The
   *  textarea then joins the flex chain and fills the box's remaining
   *  vertical space instead of being capped at a fixed pixel height. */
  const hasSize = !!data.size;
  // Live viewport zoom — drives <NodeFrost>'s counter-scale (see WfNode).
  const zoom = useStore((s) => s.transform[2]);
  const inputsList = data.inputs ?? [];
  const outputsList = data.outputs ?? [];

  /* User-toggleable collapse state.  Mirrors WfNode (2026-08-08): the
   *  left-side chevron flips between header-only chip and full body.
   *  Seed `userCollapsed` from the imported `flags.collapsed` so an
   *  initially-collapsed subgraph can still be expanded by the toggle
   *  (same `true || anything` trap as WfNode — must not OR them). */
  const [userCollapsed, setUserCollapsed] = useState<boolean>(
    data.flags?.collapsed === true
  );
  const isCollapsed = userCollapsed;

  /* Filter rows whose display label would be empty (2026-08-06 fix).
   *  ComfyUI sometimes exports sentinel / placeholder IO on subgraph
   *  wrappers — e.g. Settings.outputs[11] = `{name:"", type:"*",
   *  label:"PREVIEW"}`.  Without this filter the canvas would render
   *  a 22px-tall empty row that the user mistakes for a render bug. */
  const cleanedInputs = inputsList
    .map((inp) => ({
      inp,
      label:
        sanitizeComboLabel(inp.label) ||
        sanitizeComboLabel(inp.localized) ||
        inp.name ||
        "",
    }))
    .filter(({ label }) => label.trim().length > 0);

  const cleanedOutputs = outputsList
    .map((out) => ({
      out,
      display:
        sanitizeComboLabel(out.label) ||
        sanitizeComboLabel(out.localized) ||
        out.name ||
        "",
    }))
    .filter(({ display }) => display.trim().length > 0);

  /* Split the wrapper inputs into the two WfNode-style buckets:
   *   - connInputs   — pure-connection ports (no widgetValue).  Each gets
   *                    a left-edge dot (always on, shown even when
   *                    unwired) and is zipped with outputs in TOP PINS.
   *   - widgetInputs — exposed widget slots (widgetValue defined).  Rendered
   *                    in the WIDGET zone as LABEL | VALUE; a dot appears
   *                    only when the slot is ALSO wired (isConnection /
   *                    isBoundary), mirroring WfNode's "both" row. */
  const connInputs = cleanedInputs.filter(({ inp }) => inp.widgetValue === undefined);
  const widgetInputs = cleanedInputs.filter(({ inp }) => inp.widgetValue !== undefined);

  /* Top Pins rows: every declared input port AND every output port is a
   *  row, zipped left/right on 22px rows (same as a regular WfNode). */
  const pinRows = Math.max(connInputs.length, cleanedOutputs.length);

  return (
    <div
      className="relative flex flex-col rounded-lg border shadow-[0_6px_22px_rgba(0,0,0,0.6)]"
      style={{
        // Width tracks ComfyUI's saved `size.w` when present (fixed-width box,
        //  exactly like ComfyUI — only the height is fluid).  Falls back to a
        //  sensible min width when no size is carried.
        width: data.size ? data.size.w : undefined,
        // Height is fully content-driven (`auto`) in BOTH states: the subgraph
        //  card GROWS with its pins when expanded and AUTO-SHRINKS to the title
        //  bar when collapsed.  A `minHeight` floor keeps the expanded box from
        //  dropping below ComfyUI's saved `size.h`, and the collapsed chip never
        //  collapses below its own title bar.
        height: "auto",
        minWidth: data.size ? data.size.w : 280,
        // R49 (2026-08-11): data.size.h is the BODY CONTENT height (size[1]).
        //  The WfSubgraphNode outer div INCLUDES the pinned 30px title bar,
        //  so the total floor is content + title = size[1] + 30.  Mirrors
        //  WfNode's R49 fix so the card fills the React Flow box instead of
        //  rendering short by 30px.
        minHeight: isCollapsed ? NODE_TITLE_H : (data.size ? (data.size.h ?? 0) + NODE_TITLE_H : undefined),
        // No maxWidth cap here either: ComfyUI lets the user resize the
        //  subgraph box freely, and we must respect whatever `size` the
        //  config carries (a hard 320 cap would clip wider subgraph
        //  boxes the user explicitly set in ComfyUI).
        borderColor: hexToRgba(accent, 0.55),
        // Tint + real blur for bypass/disabled subgraphs live in <NodeFrost>;
        //  root is transparent + a stacking context (isolation) so the frost's
        //  negative z stays contained.  Normal subgraphs keep a solid panel.
        isolation: "isolate",
        background: nodeMode !== 0 ? "transparent" : "#16161E",
        // ComfyUI draws a bright selection rectangle around the active node.
        outline: selected ? "2px solid rgba(56,189,248,0.9)" : "none",
        outlineOffset: selected ? "2px" : undefined,
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        data.onEnter?.();
      }}
      title="双击进入子工作流"
    >
      <NodeFrost zoom={zoom} color={accent} nodeMode={nodeMode} />
      {/* Header — purple accent (subgraph identity).  Same NODE_TITLE_H as
       *  the regular WfNode header so titled nodes line up on the grid. */}
      <div
        className="flex shrink-0 items-center gap-2 rounded-t-lg px-2 text-xs"
        style={{
          height: NODE_TITLE_H,
          background: mixHex("#16161E", accent, 0.20),
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {/* Collapse / expand toggle (2026-08-08).  Same chevron as
         *  WfNode's; sits on the top-left of the header.  stopPropagation
         *  on both click and pointer-down so ReactFlow's drag handler
         *  doesn't pick it up as a node-drag start, AND so the
         *  surrounding `onDoubleClick` (drill-down) doesn't fire after
         *  a double-click that began here. */}
        <button
          type="button"
          aria-label={isCollapsed ? "展开子图" : "折叠子图"}
          title={isCollapsed ? "展开" : "折叠"}
          onClick={(e) => {
            e.stopPropagation();
            setUserCollapsed((v) => !v);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-white/10 hover:text-white active:bg-white/15"
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
          style={{ background: accent, color: "#0a0a0f", boxShadow: `0 0 6px ${accent}` }}
          title="子工作流"
        >
          S
        </span>
        <span
          className="min-w-0 flex-1 truncate text-[12px] font-semibold tracking-wide"
          style={{ color: "#E2E2EA" }}
          title={data.title || "子工作流"}
        >
          {data.title || "子工作流"}
        </span>
        <NodeIdChip nodeId={String(data.nodeId)} variant="subgraph" />
        {data.onEnter && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              data.onEnter?.();
            }}
            title="展开子工作流"
            /* 2026-08-11 (R35): bumped from h-4 w-4 (16×16) to h-6 w-6
             *  (24×24) — user feedback that the prior drill-in chip was
             *  too small a target on the 30px-tall title row.  24×24 is
             *  3px shy of NODE_TITLE_H so it still feels like an
             *  in-bar button (vs the 28-32px standalone chip look).
             *  Sits a step above the chevron collapse button's h-5 w-5
             *  to mark drill-in as the *primary* subgraph action. */
            className="ml-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] text-violet-200 transition-colors hover:bg-violet-500/30 hover:text-white"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h6v6" />
              <path d="M10 14L21 3" />
              <path d="M21 14v7H3V3h7" />
            </svg>
          </button>
        )}
      </div>

      {/* Collapsed-mode handle anchors (2026-08-08).  Hidden when the
       *  subgraph chip is expanded — body sections below render
       *  instead.  Visual is the same cylinder (rounded vertical
       *  pill): one on the LEFT for wired boundary inputs, one on the
       *  RIGHT whenever the wrapper declares any output.  Invisible
       *  per-port <Handle>s sit underneath so live wire geometry is
       *  preserved across toggle. */}
      {isCollapsed && (() => {
        const wiredInputs = connInputs.filter(({ inp }) => data.connectedInputs?.has(inp.name));
        const wiredOutputs = cleanedOutputs.filter(({ out }) => data.connectedOutputs?.has(out.name));
        const cylH = (count: number) =>
          Math.min(64, Math.max(16, 12 + count * 4));
        return (
          <>
            {wiredInputs.length > 0 && (
              <div
                aria-hidden
                className="pointer-events-none absolute"
                style={{
                  left: -3,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 6,
                  height: cylH(wiredInputs.length),
                  borderRadius: 999,
                  background:
                    "linear-gradient(180deg, #d4d4d8 0%, #52525b 50%, #18181b 100%)",
                  border: "1px solid rgba(255,255,255,0.45)",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -1px 0 rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,0.6)",
                  zIndex: 10,
                }}
              />
            )}
            {cleanedOutputs.length > 0 && (
              <div
                aria-hidden
                className="pointer-events-none absolute"
                style={{
                  right: -3,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 6,
                  height: cylH(cleanedOutputs.length),
                  borderRadius: 999,
                  background:
                    "linear-gradient(180deg, #d4d4d8 0%, #52525b 50%, #18181b 100%)",
                  border: "1px solid rgba(255,255,255,0.45)",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -1px 0 rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,0.6)",
                  zIndex: 10,
                }}
              />
            )}
            {wiredInputs.map(({ inp, label }, idx) => {
              const col = portColor(inp.type ?? "*");
              const total = wiredInputs.length;
              const offset = total > 1 ? (idx - (total - 1) / 2) * 6 : 0;
              return (
                <Handle
                  key={`collapsed-sub-in-${inp.name}-${idx}`}
                  type="target"
                  position={Position.Left}
                  id={inp.name}
                  isConnectable={false}
                  className="!h-2 !w-2 !rounded-full"
                  style={{ left: 0, top: `calc(50% + ${offset}px)`, background: col, opacity: 0 }}
                  title={`${label} (${inp.type})`}
                />
              );
            })}
            {wiredOutputs.map(({ out, display }, idx) => {
              const col = portColor(out.type ?? "*");
              const total = wiredOutputs.length;
              const offset = total > 1 ? (idx - (total - 1) / 2) * 6 : 0;
              return (
                <Handle
                  key={`collapsed-sub-out-${out.name}-${idx}`}
                  type="source"
                  position={Position.Right}
                  id={`out:${out.name}`}
                  isConnectable={false}
                  className="!h-2 !w-2 !rounded-full"
                  style={{ right: 0, top: `calc(50% + ${offset}px)`, background: col, opacity: 0 }}
                  title={`${display} (${out.type})`}
                />
              );
            })}
          </>
        );
      })()}

      {/* TOP PINS zone — pure-connection input ports (left dot) zipped with
       *  exposed output ports (right dot) on shared rows, exactly like a
       *  regular WfNode.  Every declared pin shows its dot permanently
       *  (always-on) so unconnected ports stay visible.
       *  Hidden when the user / config marks the chip collapsed. */}
      {!isCollapsed && pinRows > 0 && (
        <div
          className="border-b border-white/[0.05] py-0.5"
          style={{ background: "rgba(255,255,255,0.015)" }}
        >
            {Array.from({ length: pinRows }).map((_, rowIdx) => {
              const inEntry = connInputs[rowIdx];
              const outEntry = cleanedOutputs[rowIdx];
              const inInp = inEntry?.inp;
              const outMeta = outEntry?.out;
              const inName = inInp?.name;
              const outName = outMeta?.name;
              const inType = inInp?.type ?? "*";
              const outType = outMeta?.type ?? "*";
              const inCol = portColor(inType);
              const outCol = portColor(outType);
              const inLabel = inEntry?.label ?? "";
              const outDisplay = outEntry?.display ?? "";
              return (
                <div
                  key={`subpin-${rowIdx}-${inName ?? "_"}-${outName ?? "_"}`}
                  className="relative flex h-[22px] items-center pl-5 pr-5 text-[11px]"
                  data-sub-pin-input={inName}
                  data-sub-pin-output={outName}
                >
                  {inEntry && (
                    <>
                      <Handle
                        type="target"
                        position={Position.Left}
                        id={inName}
                        isConnectable={false}
                        className="!h-2.5 !w-2.5 !rounded-full !border !border-[#0a0a0f]"
                        style={{
                          left: 5,
                          background: inCol,
                          boxShadow: `0 0 6px ${inCol}AA, inset 0 0 0 1px rgba(255,255,255,0.25)`,
                        }}
                        title={`${inLabel} (${inType})`}
                      />
                      {/* Subgraph boundary inputs that already have an incoming
                       *  wire from the parent workflow (or are themselves a
                       *  sentinel boundary link) get their value upstream — they
                       *  cannot be exposed as workflow inputs.  Skip the checkbox
                       *  for connected slots. */}
                      {io?.ioEditMode && inName && !inInp?.isConnection && !inInp?.isBoundary && (
                        <IoCheckbox
                          io={io}
                          ioRef={{ nodeId: String(data.nodeId), name: inName, kind: "param", direction: "input" }}
                        />
                      )}
                      <span
                        className="min-w-0 flex-1 truncate text-left text-[11px] text-zinc-200"
                        title={`${inLabel} (${inType})`}
                      >
                        {inLabel}
                      </span>
                    </>
                  )}
                  {outEntry && (
                    <>
                      <span
                        className="min-w-0 flex-1 truncate text-right text-[11px] text-gray-200"
                        title={`${outDisplay} (${outType})`}
                      >
                        {outDisplay}
                      </span>
                      {/* Output checkbox sits on the OUTPUT side (right) so it
                       *  visually pairs with the parameter name + Handle dot. */}
                      {io?.ioEditMode && outName && (
                        <IoCheckbox
                          io={io}
                          ioRef={{ nodeId: String(data.nodeId), name: outName, kind: "output", direction: "output" }}
                        />
                      )}
                      <Handle
                        type="source"
                        position={Position.Right}
                        id={`out:${outName}`}
                        isConnectable={false}
                        className="!h-2.5 !w-2.5 !rounded-full !border !border-[#0a0a0f]"
                        style={{
                          right: 5,
                          background: outCol,
                          boxShadow: `0 0 6px ${outCol}AA, inset 0 0 0 1px rgba(255,255,255,0.25)`,
                        }}
                        title={`${outDisplay} (${outType})`}
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>
      )}

      {/* WIDGET zone — exposed wrapper widget inputs as LABEL | VALUE rows.
       *  A dot (target Handle) mounts only when the slot is ALSO wired
       *  (isConnection / isBoundary), matching WfNode's "both" row.  Even
       *  then the value stays visible (连线不消失 + 值照常显示).
       *  STRING widgets with long values break out into a stacked block.
       *  Hidden when the chip is collapsed. */}
      {!isCollapsed && widgetInputs.length > 0 && (
        <div className="relative flex min-h-0 flex-1 flex-col py-0.5" style={{ background: "rgba(255,255,255,0.01)" }}>
          {widgetInputs.map(({ inp, label }, i) => {
            const v: unknown = inp.widgetValue;
            const isConn = inp.isConnection === true || inp.isBoundary === true;
            const typeCol = portColor(inp.type);
            const stringText: string = typeof v === "string" ? v : "";
            /* R18 (parity with WfNode): STRING widget detection now
             *  uses the shared `inferIsMultiline` helper rather than
             *  the `length >= 32 || \n` heuristic.  Subgraph wrapper
             *  inputs (the wrapper-node's own exposed pins) hit this
             *  branch — without the helper a short prompt input
             *  silently degrades to a one-line chip. */
            const isStringWidget =
              !isConn &&
              inp.type === "STRING" &&
              (inferIsMultiline(data["classType"] as string | undefined, inp.name, stringText) ||
                stringText.length >= 32 ||
                stringText.includes("\n"));
            const displayValue = isStringWidget ? "" : renderSubgraphWidgetValue(v);
            return (
              <div
                key={`sub-w-${inp.name}-${i}`}
                className={
                  isStringWidget
                    ? /* R17 (parity with WfNode): vertical STACKED layout
                       *  for STRING widgets on the subgraph wrapper too.
                       *  LABEL + charCount chip on the top row, textarea
                       *  fills the remaining vertical space below.
                       *  Previous `flex-row items-start` (kept inline with
                       *  R7-R13 WfNode) had the same title-and-value-
                       *  on-one-row + maxHeight-capped regression; see
                       *  the WfNode branch comment for the full rationale. */
                      "group relative flex min-h-0 flex-1 flex-col gap-1.5 pl-5 pr-2 py-1.5 text-[11px]"
                    : "group relative flex h-[22px] items-center gap-1.5 pl-5 pr-2 text-[11px]"
                }
                data-sub-widget-name={inp.name}
                data-sub-widget-value={String(v)}
              >
                {isConn && (
                  <Handle
                    type="target"
                    position={Position.Left}
                    id={inp.name}
                    isConnectable={false}
                    className="!h-2.5 !w-2.5 !rounded-full !border !border-[#0a0a0f]"
                    style={{
                      left: 5,
                      background: typeCol,
                      boxShadow: `0 0 6px ${typeCol}AA, inset 0 0 0 1px rgba(255,255,255,0.25)`,
                    }}
                    title={`${label} (${inp.type})`}
                  />
                )}
                {/* Workflow inputs must be UNCONNECTED — a slot already carrying a wire
                 *  (isConnection / isBoundary) gets its value from upstream, so
                 *  exposing it as a workflow input is meaningless. */}
                {io?.ioEditMode && !isConn && (
                  <IoCheckbox
                    io={io}
                    ioRef={{ nodeId: String(data.nodeId), name: inp.name, kind: "widget", direction: "input" }}
                  />
                )}
                {!isStringWidget && (
                  <>
                    <span
                      className="min-w-0 shrink truncate text-left text-[11px]"
                      style={{ flex: "0 1 auto", color: isConn ? "#e4e4e7" : "#d4d4d8" }}
                      title={label}
                    >
                      {label}
                    </span>
                    {/* Vertical 1px divider between label and value.
                     *  2026-08-07: now a soft vertical gradient (top/bottom
                     *  fade to transparent) instead of a hard bar — reads as
                     *  a column hint rather than a "cut the row in half" line.
                     *  Width still 1px so it doesn't claim row real estate. */}
                    <span className="h-2 w-px shrink-0 bg-white/[0.05]" aria-hidden />
                    <span
                      className="min-w-0 truncate text-right text-[10.5px] tabular-nums"
                      style={{
                        /* Same rationale as the WfNode value span — `truncate`
                         *  is back, but only the text itself ellipsises; the
                         *  node width stays under the user's control
                         *  (ComfyUI resize ↔ canvas mirror).  No `minWidth:
                         *  fit-content` (would blow up to 810px on long
                         *  filenames) and no `maxWidth` cap (would clip
                         *  legitimate wide nodes). */
                        flex: "1 1 0",
                        color: valueCellColor(v),
                      }}
                      title={String(v)}
                    >
                      {displayValue}
                    </span>
                  </>
                )}
                {/* STRING-widget textbox on subgraph wrapper.  STACKED
                 *  BELOW the LABEL row (R17 parity with WfNode).  Row is
                 *  `flex-col gap-1.5 flex-1` so the label + charCount
                 *  chip occupy the top row and the textarea below fills
                 *  the remaining vertical space.  See WfNode branch for
                 *  the full rationale on the `flex-row items-start` →
                 *  `flex-col gap-1.5 flex-1` migration and the removal
                 *  of `maxHeight: 96`.
                 *
                 *  Pairs with the WfNode branch: a real <textarea readOnly>
                 *  so multi-line prompts wrap and any overflow scrolls
                 *  natively (no Tailwind className dependence — WfNode
                 *  subtree historically has unreliable arbitrary-value
                 *  compilation).  `mono` font for subgraph wrapper widgets
                 *  (they're typically system names / IDs).  Empty value
                 *  falls back to a faint "（空）" placeholder wrapped in a
                 *  flex-1 container so the row layout stays balanced. */}
                {isStringWidget && (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="flex shrink-0 items-center gap-1.5">
                      {io?.ioEditMode && !isConn && (
                        <IoCheckbox
                          io={io}
                          ioRef={{ nodeId: String(data.nodeId), name: inp.name, kind: "widget", direction: "input" }}
                        />
                      )}
                      <span
                        className="shrink-0 truncate text-left text-[11px]"
                        style={{ color: isConn ? "#e4e4e7" : "#d4d4d8" }}
                        title={label}
                      >
                        {label}
                      </span>
                      <span className="h-2 w-px shrink-0 bg-white/[0.05]" aria-hidden />
                      <span
                        className="text-right text-[10px] uppercase tracking-wider text-gray-500"
                        title={`STRING · ${stringText.length} chars`}
                      >
                        {stringText.length}c
                      </span>
                    </div>
                    {stringText.length > 0 ? (
                      <StringTextarea value={stringText} mono hasSize={hasSize} />
                    ) : (
                      <div
                        className="flex-1 rounded border border-white/10 bg-black/30 px-2 py-1.5 text-[10.5px] leading-snug text-gray-600"
                        style={{ minHeight: 28 }}
                      >
                        （空）
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const wfNodeTypes = { wfNode: WfNode, wfNote: WfNoteNode, wfGroup: WfGroupNode, wfSubgraph: WfSubgraphNode, wfIoPort: WfIoPortNode };
// Custom edge renderer — rounder bezier (curvature 0.85) + ComfyUI-style
// white hub dot at the curve midpoint.  Defined at module scope so React
// Flow doesn't re-register edgeTypes on every render.
const wfEdgeTypes = { default: WfEdge };

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
const GRID_CELL = 10;
const GRID_MAJOR_EVERY = 10;
const CANVAS_BG = "#0a0a0f";
const GRID_HIDE_ZOOM = 0.6; // ≤ 60% → no grid

function CanvasGrid() {
  const { minorAlpha, hideGrid } = useStore((s) => {
    const zoom = s.transform[2];
    const cellPx = GRID_CELL * zoom;
    // Fade the fine grid out below ~8 screen-px per cell so it stops
    // turning into noise at low zoom.  Quantised to 0.1 so the minor
    // layer only re-renders when the alpha actually steps.
    const t = Math.max(0, Math.min(1, (cellPx - 5) / 3));
    return {
      minorAlpha: Math.round(t * 10) / 10,
      hideGrid: zoom <= GRID_HIDE_ZOOM,
    };
  });
  if (hideGrid) return null;
  return (
    <>
      <Background
        id="wf-grid-minor"
        variant={BackgroundVariant.Lines}
        gap={GRID_CELL}
        lineWidth={1}
        color={`rgba(148,163,184,${(0.14 * minorAlpha).toFixed(3)})`}
        bgColor={CANVAS_BG}
      />
      {/*
       *  Major lines (every 100 canvas px) used to render at 0.30 alpha +
       *  1.75 lineWidth which produced a strong "graph-paper cell" feel
       *  against the dark canvas.  2026-08-11 (R32): dialed back to alpha
       *  0.14 + lineWidth 1.25 so the 100-px reference is still legible for
       *  ruler alignment but no longer dominates.
       *
       *  2026-08-11 (R33): user request — change major line COLOR to black
       *  (was the slate `rgba(148,163,184,…)`).  On the `#0a0a0f` canvas a
       *  black line at 0.14 alpha lands ~1 level DARKER than the bg, so it
       *  reads as a faint "engraved" groove rather than a cool blue rule —
       *  which further kills the spreadsheet feel.  If a more present black
       *  grid is ever wanted, raise the alpha; pure black can't "brighten"
       *  over a near-black bg so higher alpha = deeper groove, not brighter.
       *
       *  2026-08-11 (R34): user request — switch major back to a COOL GRAY
       *  (slate `rgba(148,163,184,…)`) so the 100-px rule reads as a faint
       *  light line ABOVE the near-black bg (vs black's "engraved" groove).
       *  Alpha/lineWidth kept at the R32 values (0.14 / 1.25): subtle enough
       *  to avoid the spreadsheet cell feel, bright enough to be visible.
       */}
      <Background
        id="wf-grid-major"
        variant={BackgroundVariant.Lines}
        gap={GRID_CELL * GRID_MAJOR_EVERY}
        lineWidth={1.25}
        color="rgba(148,163,184,0.14)"
        bgColor="transparent"
      />
    </>
  );
}

/* ── Canvas rulers (2026-08-07) ──
 *  Tiny coordinate readout along the four edges of the canvas window
 *  so the user can read a node's world position at a glance.  Each
 *  ruler renders the *world* X / Y of every major grid line that
 *  currently crosses the corresponding edge, positioned in screen
 *  pixels (so labels stay readable regardless of zoom).
 *
 *  Step size auto-doubles when the major lines would be < 48px apart
 *  on screen — at zoom 0.1 labels would otherwise stack on top of
 *  each other.  Negative world coords render as `−N` via Unicode
 *  minus for typographic consistency.
 *
 *  The whole overlay is `pointer-events: none` so it never blocks
 *  node/edge interaction, and sits at `z-index: 3` — above the
 *  transformed viewport (z 0) but below Controls/MiniMap (z 5+),
 *  which means a ruler label that happens to land on a zoom button
 *  is hidden behind it instead of occluding the control. */

/**
 * Zoom readout chip — sits in the top-right corner and shows the live canvas
 *  zoom as a percentage.  Two ways to adjust it:
 *    • Click the chip to type an exact percentage, Enter (or blur) to apply —
 *      `rf.zoomTo` honours the `<ReactFlow>` minZoom/maxZoom bounds (0.15–2).
 *    • Press and hold, then drag vertically (up = zoom in, down = zoom out)
 *      for a continuous scrub.  A press with <4px of travel counts as a click.
 *  ESC cancels the editor; empty / non-numeric input leaves zoom untouched. */
function ZoomIndicator() {
  const zoom = useStore((s) => s.transform[2]);
  const rf = useReactFlow();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startY: number; startZoom: number; moved: boolean } | null>(null);
  const justDraggedRef = useRef(false);

  const pct = Math.round(zoom * 100);

  const applyZoom = (z: number) => {
    const clamped = Math.min(2, Math.max(0.15, z));
    rf.zoomTo(clamped, { duration: 0 });
  };

  const beginEdit = () => {
    setDraft(String(pct));
    setEditing(true);
  };

  const commit = () => {
    const n = parseInt(draft, 10);
    if (!Number.isNaN(n) && n > 0) applyZoom(n / 100);
    setEditing(false);
  };

  //  Scrub: hold + drag vertically to scale zoom continuously.  Up zooms in,
  //  down zooms out, using a multiplicative (log) mapping so each pixel of
  //  travel feels proportional at any zoom level.
  const onScrubStart = (e: React.MouseEvent) => {
    if (editing) return;
    e.preventDefault();
    justDraggedRef.current = false;
    dragRef.current = { startY: e.clientY, startZoom: zoom, moved: false };
    setDragging(true);

    const onMove = (ev: MouseEvent) => {
      const st = dragRef.current;
      if (!st) return;
      const dy = st.startY - ev.clientY; // up = positive
      if (Math.abs(dy) > 4) st.moved = true;
      applyZoom(st.startZoom * Math.exp(dy / 220));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const st = dragRef.current;
      dragRef.current = null;
      setDragging(false);
      if (st && st.moved) justDraggedRef.current = true;
      else if (st) beginEdit();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        inputMode="numeric"
        onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
          }
        }}
        title="输入缩放百分比后回车"
        className="absolute right-3 top-3 z-[6] h-7 w-16 rounded-md border border-purple-400/60 bg-[#14141a] px-2 text-right text-[11px] font-medium tabular-nums text-gray-100 shadow-lg outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      onMouseDown={onScrubStart}
      onClick={() => {
        if (justDraggedRef.current) {
          justDraggedRef.current = false;
          return;
        }
        beginEdit();
      }}
      title="点击输入缩放倍数，或按住上下拖动调整"
      className={`pointer-events-auto absolute right-3 top-3 z-[6] select-none rounded-md border border-white/10 bg-[#14141a]/90 px-2.5 py-1 text-[11px] font-medium tabular-nums tracking-tight text-gray-300 shadow-lg backdrop-blur-sm transition-colors hover:border-white/25 hover:text-gray-100 ${
        dragging ? "cursor-grabbing border-purple-400/50" : "cursor-ns-resize"
      }`}
    >
      {pct}%
    </button>
  );
}

function CanvasRulers() {
  const tx = useStore((s) => s.transform[0]);
  const ty = useStore((s) => s.transform[1]);
  const zoom = useStore((s) => s.transform[2]);
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);

  // Pick the smallest world-unit step that keeps screen spacing ≥ 48px
  // so labels never overlap.  Always a multiple of the major grid step.
  const labelStep = useMemo(() => {
    const base = GRID_CELL * GRID_MAJOR_EVERY; // 100
    let s = base;
    while (s * zoom < 48) s *= 2;
    return s;
  }, [zoom]);

  // World X of each visible major vertical line → screen X.
  const xLabels = useMemo(() => {
    if (zoom <= 0.01 || !width) return [] as { world: number; screen: number }[];
    const start = Math.floor(-tx / zoom / labelStep) * labelStep;
    const end = Math.ceil((width - tx) / zoom / labelStep) * labelStep;
    const out: { world: number; screen: number }[] = [];
    for (let x = start; x <= end + 0.5; x += labelStep) {
      const sx = x * zoom + tx;
      if (sx < -4 || sx > width + 4) continue;
      out.push({ world: x, screen: sx });
    }
    return out;
  }, [tx, zoom, width, labelStep]);

  // World Y of each visible major horizontal line → screen Y.
  const yLabels = useMemo(() => {
    if (zoom <= 0.01 || !height) return [] as { world: number; screen: number }[];
    const start = Math.floor(-ty / zoom / labelStep) * labelStep;
    const end = Math.ceil((height - ty) / zoom / labelStep) * labelStep;
    const out: { world: number; screen: number }[] = [];
    for (let y = start; y <= end + 0.5; y += labelStep) {
      const sy = y * zoom + ty;
      if (sy < -4 || sy > height + 4) continue;
      out.push({ world: y, screen: sy });
    }
    return out;
  }, [ty, zoom, height, labelStep]);

  // Unicode minus for typographic parity (the existing widget values
  // use plain `-`; rulers use `−` because they sit at a larger size
  // and the difference is noticeable on negative coords).
  const fmt = (n: number) => (n < 0 ? `−${-n}` : `${n}`);

  const labelBase =
    "pointer-events-none absolute select-none whitespace-nowrap text-[10px] font-medium tabular-nums tracking-tight";

  return (
    <div className="pointer-events-none absolute inset-0 z-[3]" aria-hidden>
      {/* Top edge — X coords */}
      {xLabels.map(({ world, screen }) => (
        <div
          key={`rt-${world}`}
          className={labelBase}
          style={{
            left: screen,
            top: 2,
            transform: "translateX(-50%)",
            color: "rgba(203, 213, 225, 0.85)",
            textShadow: "0 0 3px rgba(10,10,15,0.95), 0 0 1px rgba(10,10,15,0.95)",
          }}
        >
          {fmt(world)}
        </div>
      ))}
      {/* Bottom edge — X coords (offset above the zoom controls so the
       *  bottom-left button cluster doesn't cover the leftmost labels) */}
      {xLabels.map(({ world, screen }) => (
        <div
          key={`rb-${world}`}
          className={labelBase}
          style={{
            left: screen,
            bottom: 2,
            transform: "translateX(-50%)",
            color: "rgba(203, 213, 225, 0.85)",
            textShadow: "0 0 3px rgba(10,10,15,0.95), 0 0 1px rgba(10,10,15,0.95)",
          }}
        >
          {fmt(world)}
        </div>
      ))}
      {/* Left edge — Y coords */}
      {yLabels.map(({ world, screen }) => (
        <div
          key={`rl-${world}`}
          className={labelBase}
          style={{
            top: screen,
            left: 3,
            transform: "translateY(-50%)",
            color: "rgba(203, 213, 225, 0.85)",
            textShadow: "0 0 3px rgba(10,10,15,0.95), 0 0 1px rgba(10,10,15,0.95)",
          }}
        >
          {fmt(world)}
        </div>
      ))}
      {/* Right edge — Y coords */}
      {yLabels.map(({ world, screen }) => (
        <div
          key={`rr-${world}`}
          className={labelBase}
          style={{
            top: screen,
            right: 3,
            transform: "translateY(-50%)",
            color: "rgba(203, 213, 225, 0.85)",
            textShadow: "0 0 3px rgba(10,10,15,0.95), 0 0 1px rgba(10,10,15,0.95)",
          }}
        >
          {fmt(world)}
        </div>
      ))}
    </div>
  );
}

/* ── Color helper ── */
function colorToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Parse a #rgb / #rrggbb colour into an rgba() string, tolerating
 *  malformed input by falling back to a neutral slate. */
function hexToRgba(hex: string, alpha: number): string {
  let h = (hex || "").trim();
  if (h.startsWith("#")) h = h.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length < 6) return `rgba(120,120,135,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Mix a hex colour towards white by `amt` (0..1) so dark group colours still
 *  produce a readable title chip on the dark canvas. */
function lightenHex(hex: string, amt: number): string {
  let h = (hex || "").trim();
  if (h.startsWith("#")) h = h.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length < 6) return hex;
  let r = parseInt(h.slice(0, 2), 16);
  let g = parseInt(h.slice(2, 4), 16);
  let b = parseInt(h.slice(4, 6), 16);
  r = Math.round(r + (255 - r) * amt);
  g = Math.round(g + (255 - g) * amt);
  b = Math.round(b + (255 - b) * amt);
  return `rgb(${r},${g},${b})`;
}

/** Parse #rgb / #rrggbb → [r,g,b]; falls back to a neutral slate on
 *  malformed input. */
function parseHex(hex: string): [number, number, number] {
  let h = (hex || "").trim();
  if (h.startsWith("#")) h = h.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length < 6 || /[^0-9a-fA-F]/.test(h)) return [120, 120, 135];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Blend hex `a` (the *base*, e.g. a node's canvas-coloured body) towards
 *  hex `b` (the *tint*, e.g. the node's role colour) by factor `t ∈ [0,1]`,
 *  returning an opaque `rgb(r,g,b)`.  Convention:
 *
 *    t=0  →  pure `a` (the base colour, no tint applied)
 *    t=1  →  pure `b` (fully replaced by the tint)
 *    0<t<1 → opaque equivalent of "semi-transparent tint painted over the
 *            base" (what a CSS `rgba(tint, t)` over the base would look
 *            like, baked into a single solid `rgb()`).
 *
 *  Always call as `mixHex(baseColor, tintColor, t)` — same direction as
 *  "mix X% of the tint into the base".  Behaviour mirrors CSS
 *  `color-mix(in srgb, base X%, tint Y%)` where Y/(X+Y) ≡ t. */
function mixHex(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

/* Build ReactFlow edges from a ComfyUI graph: every input value of shape
 * [nodeId, outputIndex] becomes an edge from that node to the consumer.
 *  - `targetHandle` is the input field name so ReactFlow snaps the wire to
 *    the matching Handle id (which WfNode renders for each connection row).
 *  - `sourceHandle` is "out:<outputName>" so the wire lands on the
 *    per-output Handle we render at the bottom of each node.
 *  - Stroke colour comes from the data type flowing through the wire —
 *    MODEL→purple, CLIP→yellow, LATENT→violet, etc. — so the canvas
 *    reads like a faithful ComfyUI graph. */
function buildEdges(
  detail: WorkflowDetail | null,
  _nodes: Node[],
  outSlotNameById?: Record<string, string[]>
): Edge[] {
  if (!detail) return [];
  // Only real graph nodes carry edges; group/note frames never do.
  const known = new Set(detail.nodes.map((n) => n.id));
  const nodesById: Record<string, ComfyGraphNode> = {};
  for (const n of detail.nodes) nodesById[n.id] = n;

  const edges: Edge[] = [];
  let i = 0;
  for (const [nodeId, raw] of Object.entries(detail.graph ?? {})) {
    if (!raw || typeof raw !== "object") continue;
    const inputs = (raw as any).inputs;
    if (!inputs || typeof inputs !== "object") continue;
    const dstClass = nodesById[nodeId]?.class_type;
    for (const [inputName, v] of Object.entries(inputs)) {
      if (!Array.isArray(v) || v.length < 1 || typeof v[0] !== "string") continue;
      const srcId = v[0];
      if (!known.has(srcId) || !known.has(nodeId)) continue;
      const srcSlot = Number(v[1] ?? 0);
      const srcClass = nodesById[srcId]?.class_type;
      const type =
        edgeType(srcClass, srcSlot) !== "UNKNOWN"
          ? edgeType(srcClass, srcSlot)
          : edgeTypeByInputName(inputName);
      const stroke = portColor(type);
      // Pin to the precise output handle when we know its name; otherwise
      // fall back to the generic hidden "out" handle every node exposes.
      // For unknown custom nodes the inferred slot→name table (built by
      // inferSourceOutNames) fills in names like `width` / `height` that
      // both `inferOutputTypeAll` and `raw.outputs[]` miss.
      const slotNames = outSlotNameById?.[srcId];
      const staticNames = Object.keys(inferOutputTypeAll(srcClass ?? ""));
      let outName: string | null = null;
      if (slotNames && srcSlot < slotNames.length) outName = slotNames[srcSlot];
      else if (srcSlot < staticNames.length) outName = staticNames[srcSlot];
      edges.push({
        id: `e-${srcId}-${nodeId}-${inputName}-${i++}`,
        source: srcId,
        target: nodeId,
        sourceHandle: outName ? `out:${outName}` : "out",
        targetHandle: inputName,
        animated: false,
        style: {
          stroke,
          strokeWidth: 2,
          opacity: 0.9,
        },
      });
    }
  }

  /* Boundary-pin wiring (2026-08-06 fix): direction matters — React Flow
   * only renders an edge when the source handle is `type="source"` and
   * the target handle is `type="target"`.  Our pin nodes expose:
   *   - input pin:  Left handle `id="in"`, type="source"
   *   - output pin: Right handle `id="out"`, type="target"
   * So an "input" boundary link flows pin → inner (external seed feeds
   * into the wrapper), and an "output" boundary link flows inner → pin
   * (wrapper exposes inner result).  Previously these were inverted and
   * pointed at the wrong handle id, which yielded zero rendered edges. */
  if (detail.boundaryLinks) {
    const bp = detail.boundaryPins;
    const lookupPin = (pinId: string): { type: string } | null => {
      if (!bp) return null;
      return bp.inputs.find((x) => x.id === pinId) ?? bp.outputs.find((x) => x.id === pinId) ?? null;
    };
    for (const bl of detail.boundaryLinks) {
      const pinNodeId = `bpin:${bl.pinId}`;
      const stroke = portColor(lookupPin(bl.pinId)?.type ?? "*");
      if (bl.kind === "input") {
        /* Pin (external seed) → inner node's matching input slot. */
        edges.push({
          id: `e-bb-${bl.linkId}-in`,
          source: pinNodeId,
          sourceHandle: "in",
          target: bl.innerNodeId,
          targetHandle: bl.innerSlotName || "in",
          animated: false,
          style: { stroke, strokeWidth: 2, opacity: 0.9 },
        });
      } else {
        /* Inner node's matching output handle → output pin. */
        edges.push({
          id: `e-bb-${bl.linkId}-out`,
          source: bl.innerNodeId,
          sourceHandle: bl.innerSlotName ? `out:${bl.innerSlotName}` : "out",
          target: pinNodeId,
          targetHandle: "out",
          animated: false,
          style: { stroke, strokeWidth: 2, opacity: 0.9 },
        });
      }
    }
  }

  return edges;
}

/* Resolve a node's input map into per-connection source metadata.  For every
 * input whose value is `[srcId, slot]`, we look up the source node's title
 * and class_type from the provided `nodesById` map so the renderer can show
 * "← <title> #id" next to that row and so the edge colour can be chosen
 * by data type.  Inputs that aren't connections are skipped. */
function buildInputSources(
  inputs: Record<string, any> | undefined,
  nodesById: Record<string, ComfyGraphNode>
): Record<string, { id: string; title: string; slot: number; classType?: string }> {
  const out: Record<string, { id: string; title: string; slot: number; classType?: string }> = {};
  if (!inputs) return out;
  for (const [k, v] of Object.entries(inputs)) {
    if (!Array.isArray(v) || v.length < 1 || typeof v[0] !== "string") continue;
    const src = nodesById[v[0]];
    out[k] = {
      id: v[0],
      title: src?.title ?? `#${v[0]}`,
      slot: Number(v[1] ?? 0),
      classType: src?.class_type,
    };
  }
  return out;
}

/* Scan the workflow graph once and produce, for every source node, the set
 * of output *names* that have at least one downstream edge.  Used by both
 * WfNode and WfSubgraphNode to decide whether to render a source Handle on
 * each output row — "no wire ⇒ no dot".  Output names are resolved the same
 * way the buildWfNode / buildSubgraphNode output list does so that
 * `connectedOutputs.has(name)` matches the row key.  The optional
 * `outSlotNameById` table is produced by `inferSourceOutNames` for nodes
 * whose outputs are absent from the static table *and* the raw JSON. */
function buildConnectedOutputs(
  detail: WorkflowDetail,
  nodesById: Record<string, ComfyGraphNode>,
  rawMetaById: Record<string, { widgets_values: any[]; outputs: RawOutputMeta[]; flags?: Record<string, any>; properties?: Record<string, any> }>,
  outSlotNameById?: Record<string, string[]>
): Record<string, Set<string>> {
  const map: Record<string, Set<string>> = {};
  for (const raw of Object.values(detail.graph ?? {})) {
    const inp = (raw as any)?.inputs ?? {};
    for (const v of Object.values(inp)) {
      if (!Array.isArray(v) || v.length < 1 || typeof v[0] !== "string") continue;
      const srcId = v[0];
      const slot = Number(v[1] ?? 0);
      const node = nodesById[srcId];
      if (!node) continue;
      const slotNames = outSlotNameById?.[srcId];
      const staticOuts = Object.keys(inferOutputTypeAll(node.class_type));
      const rawOuts = rawMetaById[srcId]?.outputs ?? [];
      let name: string | null = null;
      if (slotNames && slot < slotNames.length) {
        name = slotNames[slot] || null;
      } else if (slot < staticOuts.length) {
        name = staticOuts[slot];
      } else if (slot < rawOuts.length) {
        name = rawOuts[slot].name;
      }
      if (!name) continue;
      if (!map[srcId]) map[srcId] = new Set();
      map[srcId].add(name);
    }
  }
  return map;
}

/* For every source node, derive the per-slot output NAME we'd attach to
 * its source Handle, even for nodes that aren't in the static
 * `inferOutputTypeAll` table and that have no `outputs[]` in the raw
 * JSON.  Sources lookup chain, per node:
 *   1. Static `inferOutputTypeAll` table (KSampler → LATENT, etc.).
 *   2. Raw `outputs[]` array from the imported JSON.
 *   3. Destinations' input key, stripped of ComfyUI's "duplicate field"
 *      suffix (`_N`).  Returns `width` for input `width_1`, etc. — this
 *      is the only way to recover names for fully custom nodes like
 *      ResolutionSelector whose exported workflow carries no outputs.
 *   4. Generic `out<N>` fallback if none of the above produced a name. */
function inferSourceOutNames(
  detail: WorkflowDetail,
  nodesById: Record<string, ComfyGraphNode>,
  rawMetaById: Record<string, { widgets_values: any[]; outputs: RawOutputMeta[]; flags?: Record<string, any> }>
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [nodeId, node] of Object.entries(nodesById)) {
    const staticNames = Object.keys(inferOutputTypeAll(node.class_type));
    if (staticNames.length > 0) { out[nodeId] = staticNames; continue; }
    const rawNames = (rawMetaById[nodeId]?.outputs ?? []).map((o) => o.name);
    if (rawNames.length > 0) { out[nodeId] = rawNames; continue; }

    // 静态 + raw 都没有，从消费者（下游节点）的输入键反推
    const bySlot: Record<number, string[]> = {};
    for (const [_, consumerRaw] of Object.entries(detail.graph ?? {})) {
      const inp = (consumerRaw as any)?.inputs ?? {};
      for (const [inputKey, v] of Object.entries(inp)) {
        if (!Array.isArray(v) || v.length < 1 || typeof v[0] !== "string") continue;
        if (v[0] !== nodeId) continue;
        const slot = Number(v[1] ?? 0);
        const stripped = inputKey.replace(/_\d+$/g, "");
        if (!bySlot[slot]) bySlot[slot] = [];
        if (!bySlot[slot].includes(stripped)) bySlot[slot].push(stripped);
      }
    }
    const slotCount = Math.max(1, ...Object.keys(bySlot).map(Number), 0);
    const slotNames: string[] = [];
    for (let i = 0; i <= slotCount; i++) {
      const candidates = bySlot[i] ?? [];
      slotNames.push(candidates[0] || `out${i + 1}`);
    }
    if (slotNames.length > 0) out[nodeId] = slotNames;
  }
  return out;
}

/* Compute nesting depth for each group by bounding-box containment.  A group's
 * depth is how many other groups directly/indirectly contain it, so child frames
 * render on top of (above) their parents and nested groups read correctly. */
function computeGroupDepths(groups: WorkflowGroup[]): Record<string, number> {
  if (groups.length === 0) return {};
  const inside = (inner: WorkflowGroup, outer: WorkflowGroup) => {
    const [ix, iy, iw, ih] = inner.bounding;
    const [ox, oy, ow, oh] = outer.bounding;
    const e = 2;
    const same = ix === ox && iy === oy && iw === ow && ih === oh;
    return (
      !same &&
      ox - e <= ix && oy - e <= iy &&
      ox + ow + e >= ix + iw && oy + oh + e >= iy + ih
    );
  };
  const findParent = (g: WorkflowGroup): WorkflowGroup | null => {
    let best: WorkflowGroup | null = null;
    let bestArea = Infinity;
    for (const p of groups) {
      if (p.id === g.id) continue;
      if (inside(g, p)) {
        const area = p.bounding[2] * p.bounding[3];
        if (area < bestArea) {
          bestArea = area;
          best = p;
        }
      }
    }
    return best;
  };
  const depth: Record<string, number> = {};
  for (const g of groups) {
    let d = 0;
    let parent = findParent(g);
    while (parent) {
      d++;
      parent = findParent(parent);
    }
    depth[g.id] = d;
  }
  return depth;
}

/* ── Inner editor (must be inside ReactFlowProvider) ── */
function WorkflowEditorInner({
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

  const outSlotNameById: Record<string, string[]> = useMemo(() => {
    if (!detail) return {};
    const nodesById: Record<string, ComfyGraphNode> = {};
    for (const n of detail.nodes) nodesById[n.id] = n;
    return inferSourceOutNames(detail, nodesById, rawMetaById);
  }, [detail, rawMetaById]);

  const initialNodes: Node[] = useMemo(() => {
    if (!detail) return [];
    const colW = 300;
    const rowH = 220;
    const padX = 80;
    const padY = 80;

    // Index nodes by id so we can resolve [srcId, slot] inputs to source titles.
    const nodesById: Record<string, ComfyGraphNode> = {};
    for (const n of detail.nodes) nodesById[n.id] = n;

    /* Look up the raw input metadata per node by id (for the graph view) */
    const rawById: Record<string, RawInputMeta[]> = {};
    for (const n of detail.nodes) rawById[n.id] = n.raw_inputs ?? [];

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
    const connectedOutputsById = buildConnectedOutputs(detail, nodesById, rawMetaById, outSlotNameById);

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
    const realNodes = detail.nodes.filter((n) => !isNoteType(n.class_type));

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
    const positionsCount = Object.keys(detail.positions ?? {}).length;
    const useSavedPositions =
      detail.positions != null &&
      positionsCount > 0 &&
      positionsCount >= realNodes.length;
    if (useSavedPositions) {
      const positionsById = detail.positions as Record<string, [number, number]>;
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

    /* ── 2) Auto-layout via Kahn longest-path ── */
    const level: Record<string, number> = {};
    const incoming: Record<string, Set<string>> = {};
    const outAdj: Record<string, Set<string>> = {};
    for (const n of realNodes) {
      incoming[n.id] = new Set();
      outAdj[n.id] = new Set();
    }
    for (const [id, raw] of Object.entries(detail.graph)) {
      const inputs = (raw as any)?.inputs;
      if (!inputs || typeof inputs !== "object") continue;
      for (const v of Object.values(inputs)) {
        if (Array.isArray(v) && v.length >= 1 && typeof v[0] === "string" && outAdj[v[0]] && incoming[id]) {
          incoming[id].add(v[0]);
          outAdj[v[0]].add(id);
        }
      }
    }
    const remaining = new Map(Object.entries(incoming).map(([k, v]) => [k, v.size]));
    const queue: string[] = [];
    for (const [id, deg] of remaining) {
      if (deg === 0) {
        level[id] = 0;
        queue.push(id);
      }
    }
    while (queue.length) {
      const id = queue.shift()!;
      for (const nxt of outAdj[id]) {
        level[nxt] = Math.max(level[nxt] ?? 0, (level[id] ?? 0) + 1);
        remaining.set(nxt, (remaining.get(nxt) ?? 0) - 1);
        if ((remaining.get(nxt) ?? 0) === 0) queue.push(nxt);
      }
    }
    for (const n of realNodes) if (!(n.id in level)) level[n.id] = 0;

    /* group by level, then by row within level */
    const byLevel: Record<number, string[]> = {};
    for (const n of realNodes) {
      const lv = level[n.id] ?? 0;
      (byLevel[lv] ||= []).push(n.id);
    }
    for (const arr of Object.values(byLevel)) arr.sort();

    // All inner nodes are now full WfNode / WfSubgraphNode cards
    // (no endpoint flag — see 2026-08-06 note above).  Auto-layout
    // places each middle node on its Kahn longest-path level.column.
    const middleNodes = realNodes.map((n) => {
      const lv = level[n.id] ?? 0;
      const arr = byLevel[lv] ?? [];
      const row = arr.indexOf(n.id);
      const pos = { x: padX + lv * colW, y: padY + row * rowH };
      return n.is_subgraph ? buildSubgraphNode(n, pos) : buildWfNode(n, pos);
    });
    const middlePosById = Object.fromEntries(
      middleNodes.map((m) => [m.id, m.position])
    ) as Record<string, { x: number; y: number }>;
    return [...groupNodes, ...noteNodes, ...middleNodes, ...layoutBoundaryPins(middlePosById)];
  }, [detail, paramMap, onEnterSubgraph]); // eslint-disable-line react-hooks/exhaustive-deps

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  /* Sync nodes/edges when detail (or paramMap) changes.  useNodesState only
   * takes initialNodes on mount, so when the workflow detail arrives async
   * we have to push the freshly computed initialNodes into the flow state. */
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(buildEdges(detail, initialNodes, outSlotNameById));
  }, [initialNodes, detail, outSlotNameById, setNodes, setEdges]);

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
    if (!(detail.id in originalLayoutByIdRef.current)) {
      originalLayoutByIdRef.current[detail.id] = {
        positions: detail.positions ?? null,
        notes: detail.notes ?? null,
      };
    }
  }, [detail?.id]);

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
    const snap = originalLayoutByIdRef.current[detail.id] ?? null;
    const orig = snap?.positions ?? null;
    const origNotes = snap?.notes ?? null;
    const isSparse =
      (orig && Object.keys(orig).length < detail.nodes.length) ||
      (origNotes &&
        detail.notes &&
        Array.isArray(origNotes) &&
        Array.isArray(detail.notes) &&
        origNotes.length < detail.notes.length);
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
    if (isSubgraphView) payload.merge = true;
    fetch(`/api/workflows/${workflowId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {});
    requestAnimationFrame(() => requestAnimationFrame(() => fitToMiddle()));
  }, [detail?.id, subgraphStack.length, workflowId, fitToMiddle]);

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
          const isSubgraphView = subgraphStack.length > 0;
          const payload: Record<string, unknown> = { positions: { [nodeId]: [x, y] } };
          if (isSubgraphView) payload.merge = true;
          fetch(`/api/workflows/${workflowId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }).catch(() => {});
        }
      },
      [workflowId, subgraphStack.length]
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
                    onChange={() => {
                      /* Preview-only — values are seeded from
                       * defaultInputValues and never persisted.  Keeping
                       * onChange a no-op avoids the preview competing
                       * with the run-time form (CreatePanel / canvas
                       * node) for state ownership. */
                    }}
                    compact
                    showOutputs
                    onLabelChange={setIOLabel}
                    emptyHint={null}
                  />
                )}
              </div>
              <div className="shrink-0 border-t border-white/[0.06] px-3 py-1.5 text-[10px] text-gray-500">
                <span className="opacity-80">点击任意名称旁的</span>
                <span className="mx-1 inline-block rounded bg-white/[0.08] px-1 font-mono text-[10px] text-gray-300">✎</span>
                <span className="opacity-80">可重命名，回车或失焦保存；点「保存端口映射」后写入服务。</span>
              </div>
            </div>
          </div>
        )}
        <NodeJsonViewerProvider detail={detail} rawMetaById={rawMetaById} positions={detail?.positions ?? null} subgraphRawContext={subgraphRawContext} subgraphStackLength={subgraphStack.length}>
        <RgthreeGroupsProvider workflowId={workflowId} detail={detail}>
        <IOEditContext.Provider
          value={{ ioEditMode, workflowIO, toggleIO, setIOLabel }}
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
          minZoom={0.15}
          maxZoom={2}
          defaultEdgeOptions={{
            type: "default",
            animated: false,
            style: {
              stroke: "rgba(167,139,250,0.85)",
              strokeWidth: 2,
            },
          }}
          proOptions={{ hideAttribution: true }}
        >
          {/* Grid background — 20px cells with a heavier rule every
           *  10 cells.  See <CanvasGrid> above. */}
          <CanvasGrid />
          {/* Coordinate rulers along the four edges — show the world
           *  X / Y of every visible major line.  See <CanvasRulers>. */}
          <CanvasRulers />
          <ZoomIndicator />
          <Controls showInteractive={false} className="!bg-[#14141a]/90 !border-white/10 !text-gray-400 [&>button]:!bg-white/5 [&>button]:!border-white/10 [&>button]:!text-gray-400 [&>button:hover]:!bg-white/10" />
          <MiniMap
            nodeColor={(n) => {
              const d = n.data as WfNodeData;
              const r = PORT_ROLES.find((role) => role.key === d.assignedRole);
              return r?.color ?? "#333";
            }}
            maskColor="rgba(0,0,0,0.65)"
            className="!bg-[#14141a]/90 !border-white/10"
          />
        </ReactFlow>
        </IOEditContext.Provider>
        </RgthreeGroupsProvider>
        </NodeJsonViewerProvider>

        {/* Floating instruction tooltip */}
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-4 py-2 text-[11px] text-gray-400 backdrop-blur-sm">
          点击节点查看详情 · 拖拽移动节点位置 · 滚轮缩放
        </div>

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
export function WorkflowCanvasEditor({
  workflowId,
  open,
  onClose,
  onSave,
}: {
  workflowId: string;
  open: boolean;
  onClose: () => void;
  onSave?: () => void;
}) {
  if (!open) return null;

  return (
    <ReactFlowProvider>
      <WorkflowEditorInner
        workflowId={workflowId}
        onClose={onClose}
        onSave={onSave}
      />
    </ReactFlowProvider>
  );
}
