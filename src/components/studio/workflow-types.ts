/* Extracted types — originally declared inside WorkflowCanvasEditor.tsx.
 * Pure type declarations only; no runtime code.
 * `import type` below is compile-time only (fully erased) — it reuses the
 * server's API-graph node shape so detail.graph consumers keep their
 * class_type/inputs accessors without any. */
import type { ApiWorkflowNode } from "~/lib/comfyui/raw";
import type { WorkflowIOModeOverride } from "~/lib/workflow-io-types";

/* ── Types ── */
export interface RawInputMeta {
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
  /** ComfyUI wrapper-node widget proxy. Set on inputs
   *  that back an internal widget; absent on pure connections.  Used
   *  by WorkflowSubgraphNode to render a `VALUE` cell to the right of the
   *  label with the same colour rules as WorkflowNode (`valueCellColor`). */
  widget?: { name: string };
  /** Pre-paired widget value (string/number/bool).  Paired index is
   *  the running count of widgets seen before this row in inputs[],
   *  matching ComfyUI's `widgets_values[]` ordering.  Undefined when
   *  `widget` is absent (i.e. a pure connection row — the inner
   *  node's value isn't surfaced through the wrapper). */
  widgetValue?: unknown;
  /** server-stamped `multiline` flag — drives
   *  `isStringWidget` in WorkflowNode / WorkflowSubgraphNode so STRING inputs
   *  declared multiline by the upstream Python `INPUT_TYPES()` render
   *  as textareas regardless of how short the default value is.
   *  Computed by the server from a static (classType, name) table +
   *  length heuristic, since the API-format rawJson we receive does
   *  NOT preserve the original widget config (no `widgets[]` /
   *  `inputs[]`).  Stamped even when the widget spec has no
   *  `multiline` hint, because the heuristic only flags "definitely
   *  multiline" — absence means "no opinion". */
  multiline?: boolean;
  /** when this IMAGE input is fed by a LoadImage-family
   *  upstream node, the server resolves the upstream's uploaded filename
   *  and stamps it here so the canvas can render an inline thumbnail via
   *  the /api/images proxy.
   *
   *  SCOPE NARROWED — only stamped on the synthetic
   *  `preview: true` entry that the server pushes for LoadImage nodes
   *  themselves; downstream IMAGE inputs (ImageScale / CLIPVisionEncode /
   *  …) no longer carry it, because showing the unscaled / un-encoded
   *  upstream image there is misleading.  May also be undefined on the
   *  synthetic preview entry itself — when widgets_values[0] is missing
   *  (no image uploaded), the renderer falls back to a 「需要上传图片」
   *  placeholder so the body always has its preview slot. */
  imageRef?: { filename: string; subfolder: string; type: string };
  /** marker on the synthetic LoadImage preview entry.
   *  The renderer filters these out of BOTH connEntries and widgetEntries
   *  so they never paint a port-cylinder or a regular widget control —
   *  they're consumed exclusively by the dedicated <WorkflowImagePreview> tail
   *  block.  This keeps LoadImage's body clean (no fake input cylinders
   *  on the left for the synthetic `image` entry) and guarantees the
   *  preview / placeholder rendering is single-sourced. */
  preview?: boolean;
  /** 子工作流封装节点暴露口背后的「内部真实字段」（服务端由
   *  `properties.proxyWidgets` 解析后随条目下发）。
   *
   *  wrapper 的槽位名是本层自动编号的别名（`value_1`），业务名在内部节点
   *  上。画布与 IO 面板都按「内部字段 label → localized → 字段名」取名，
   *  避免同一 pin 在两处显示成不同字符串（ISSUE #349）。普通节点不携带。 */
  proxyField?: {
    nodeId: string;
    field: string;
    label?: string;
    localized?: string;
  };
}

export interface ComfyGraphNode {
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
  /** Boundary input port details for wfIoPort rendering (v3).
   *  Only set when `is_input_endpoint` is true.  Captured by the
   *  subgraph route from the sentinel -10 link + matching widget value. */
  boundary_input?: { name: string; type: string; value: unknown } | null;
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
export interface WorkflowIOParam {
  direction: "input" | "output";
  kind: "param" | "widget" | "output";
  nodeId: string;
  name: string;
  /** 作者在 IO 面板里显式重命名的显示名（**唯一**写入点是面板的 ✎ 改名框）。
   *
   *  勾选 IO 那一刻画布透传的名字不再进库：它本来就是画布从同一个 raw 槽位
   *  读出来的名字，抄一份下来只会在两处口径不一致时固化出一个陈旧名字。
   *  因此这里没有值 = 作者没重命名过，显示名走富化链
   *  （`ioLabel(e) = e.label ?? e.name` 之外还含子图内部业务名）。
   *  刻意不从 `data.title` 播种 —— 节点标题在同节点的兄弟 pin 之间是共用的
   *  （一个 T2I 节点上的 `text` / `text_1` 会拿到同一个标题），那样 IO 摘要
   *  反而没法看。 */
  label?: string;
  /* ── Server-enriched fields (GET /api/workflows/[id], ) ──
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
  /** mirror field of `WorkflowIOEntry.required`. Only
   *  meaningful for `kind === "widget"` — toggled in IO-edit mode and
   *  persisted on the next PATCH. */
  required?: boolean;
  /** user-defined display order written by the
   *  IO-edit preview's drag-to-reorder gesture.  Mirrors
   *  `WorkflowIOEntry.displayOrder`; see workflow-io.ts for the sort
   *  contract.  Persisted to server on the same PATCH as the rest of
   *  `workflowIO`. */
  displayOrder?: number;
  /** seed 类参数的「控件后行为」（fixed / increment / decrement / random）。
   *  镜像 `WorkflowIOEntry.seedMode`，随 workflowIO 一起 PATCH 落库。 */
  seedMode?: string;
  /** 多模式：按模式码的覆盖层。镜像 `WorkflowIOEntry.modes`，
   *  落在同一个 workflowIO JSON 列里（因此新增模式无需改表）。由 IO 预览面板的
   *  「模式页签」编辑，随整体 workflowIO 一起 PATCH 落库。 */
  modes?: Record<string, WorkflowIOModeOverride>;
  /** 宿主（外层封装）节点 id。仅在「下钻到子工作流内部」勾选时写入：此时
   *  `nodeId` 是子图内部节点 id（`1670`），运行期 comfy-cli 展开后是 `4:1670`
   *  （宿主 id + 内部 id），两个 id 都存下来才能在运行期确定性还原。 */
  hostNodeId?: string;
  /** 本层槽位上作者写的业务名（服务端富化下发，与槽位名不同才有值）。
   *
   *  事实字段：富化链把它排在 `localized` 之后（通用翻译会盖住它），所以显示
   *  名算不到它；想按「作者在本层槽位上写的名字」取名时只有这里有。 */
  slotLabel?: string;
}

/** A single parameter reference used to toggle IO exposure.
 *
 *  只带**身份字段**：显示名不进库（画布行上的名字与 IO 面板里的名字都由富化链
 *  一处给，抄一份下来只会在两处口径不一致时固化出陈旧名字）。作者想改名走
 *  IO 面板的 ✎ 改名框（`setIOLabel`）。 */
export interface IoRef {
  nodeId: string;
  name: string;
  kind: "param" | "widget" | "output";
  direction: "input" | "output";
  /** 宿主（外层封装）节点 id：当前视图是子工作流内部时，由画布把「从哪一层
   *  钻进来」的宿主 id 一并带上，落库后运行期据它还原 `host:inner` 拼接 id。 */
  hostNodeId?: string;
}

/** Shared context so every custom node (WorkflowNode / WorkflowSubgraphNode) can read the
 *  current IO-edit mode + the live selection without re-building node `data`
 *  on every toggle.  Toggling updates `workflowIO` state here, and every
 *  consuming node re-renders directly via context. */
export interface IOEditContextValue {
  ioEditMode: boolean;
  workflowIO: Record<string, WorkflowIOParam>;
  toggleIO: (ref: IoRef) => void;
  /** Update the user-facing display label for a single checked pin.  The
   *  new value is stored on `workflowIO[key].label` and persisted on the
   *  next `handleSave` (the existing PATCH body already ships the whole
   *  `workflowIO` map).  No-op when the key isn't currently in the map —
   *  labels only exist for checked pins. */
  setIOLabel: (key: string, label: string) => void;
  /** flip the `required` flag on a checked widget input.
   *  The flip is local-only (no IOEdit-mode state is added); it lives on
   *  the same `workflowIO[key]` record that toggleIO + setIOLabel mutate,
   *  so it shares the persistence path (next PATCH ships the full map).
   *  No-op when the key isn't currently in the map — required only makes
   *  sense for checked pins. */
  toggleIORequired: (key: string) => void;
  /** drag-to-reorder in the IO preview. Moves
   *  `fromKey` so it sits immediately before `beforeKey` in the rendered
   *  list (use `null` to send to the tail).  Renumbers the affected
   *  group's `displayOrder` and PATCHes the server inline so the
   *  arrangement survives a reload.  See `reorderIO` impl for the dense
   *  numbering strategy and group-segregation contract. */
  reorderIO: (fromKey: string, beforeKey: string | null) => void;
}
export interface RgthreeGroupsContextValue {
  /** Effective bypass for a group id (override > detail). */
  getBypass: (groupId: string) => boolean;
  /** Flip a group's bypass state; PATCHes server + sets local override. */
  setBypass: (groupId: string, bypass: boolean) => void;
}
export interface NodeJsonViewerRequest {
  /** `DOMRect` of the `#id` chip that triggered the popover.  Captured
   *  when the user clicks, then frozen for the lifetime of the popover
   *  so re-renders (or pan/zoom) don't drag it around mid-read. */
  anchorRect: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
  /** ComfyUI workflow JSON key — `data.nodeId`.  For subgraphs this is
   *  ALSO the same key (subgraph wrappers are top-level entries in
   *  `graph`, not nested). */
  nodeId: string;
  /** Visual distinction (affects popover accent + chip color echo). */
  kind: "node" | "subgraph";
}
export interface NodeJsonViewerContextValue {
  /** Lookup the raw `detail.graph[nodeId]` entry.  Pure read — returns
   *  `null` when `detail` hasn't loaded yet (top bar Loading… state) or
   *  the key isn't present (e.g. fully-decorated node whose API form
   *  omits the entry). */
  getNodeJson: (nodeId: string) => Record<string, unknown> | null;
  /** Richer lookup covering the same node for the popover's "节点视图"
   *  synthesised tab — bundles the byte-perfect graph entry together
   *  with the raw-ui metadata (`detail.rawNodes[i]` matched by id) and
   *  the canvas position (`detail.positions[id]`).  `raw` and `pos` are
   *  `undefined` / `null` for API-only imports. */
  getNodeView: (nodeId: string) => {
    entry: Record<string, unknown> | null;
    raw:
      | {
          widgets_values: unknown[];
          outputs: RawOutputMeta[];
          flags: Record<string, unknown>;
          properties: Record<string, unknown>;
          mode: number;
        }
      | undefined;
    /** Literal RAW node (`detail.rawJson.nodes[i]`) — byte-identical to the
     *  corresponding slice of the whole-workflow RAW view. `null` when the
     *  workflow was API-only imported (no rawJson) or the node isn't found. */
    rawNode?: Record<string, unknown> | null;
    pos: [number, number] | null;
  } | null;
  /** Show the popover.  `anchorEl` should be the `#id` chip element
   *  (used for positioning only — pointer-events fire on it AFTER the
   *  popover is mounted, so we capture rect synchronously here). */
  requestShow: (
    anchorEl: HTMLElement,
    nodeId: string,
    kind: "node" | "subgraph",
  ) => void;
  /** Manually dismiss.  ESC and outside-click both call this. */
  dismiss: () => void;
  /** Live viewer state — Provider exposes it ONLY for the popover
   *  component itself; downstream consumers normally only need
   *  requestShow/getNodeJson. */
  viewer: NodeJsonViewerRequest | null;
}
export type RawMetaEntry = {
  widgets_values: unknown[];
  outputs: RawOutputMeta[];
  flags: Record<string, unknown>;
  properties: Record<string, unknown>;
  mode: number;
};

export interface WorkflowDetail {
  id: string;
  name: string;
  taskType: string;
  /** 多模式：该工作流可运行的全部模式码（模板 modes 列解析），与库详情的
   *  「类型」同源；IO 预览面板的模式页签从这里取。子图变体缺省。 */
  modes?: string[];
  defaultMode?: string | null;
  graph: Record<string, ApiWorkflowNode>;
  /** 从 `/api/workflows/:id` 返回的原始导入格式 (LiteGraph
   *  JSON)；canvas 顶部「📋 查看 JSON」modal 直接读这里喂给 SourceModal。
   *  null 表示该工作流纯 API 导入，无原始格式。 */
  rawJson?: unknown;
  nodes: ComfyGraphNode[];
  /** RAW 视图专用数据包（从 rawJson 派生、保留 subgraph
   *  wrapper）。当存库 `graph` 被拆平成 N:xx 节点时，RAW 布局据此渲染原始
   *  ComfyUI 节点（含 wrapper 紫色整卡），而非炸开的 API 图。null = 无 rawJson。 */
  rawView?: {
    nodes: ComfyGraphNode[];
    positions: Record<string, [number, number]> | null;
    graph: Record<string, ApiWorkflowNode>;
  } | null;
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
   *  used by WorkflowSubgraphNode (widget values) and by both WorkflowNode &
   *  WorkflowSubgraphNode to render the OUTPUT port strip when the offline type
   *  table doesn't know the class (e.g. custom nodes like
   *  ResolutionSelector, or subgraph UUIDs whose outputs we discover from
   *  the raw JSON). */
  rawNodes:
    | {
        id: string;
        widgets_values: unknown[];
        outputs: RawOutputMeta[];
        /** Per-node LiteGraph flags (e.g. `collapsed`).  Empty when raw was
         *  absent (API-only import).  The Flow already consumed these via
         *  `(rn as any).flags`; declared here so the JSON popover can show
         *  them in the synthesised "节点视图" tab. */
        flags?: Record<string, unknown>;
        /** Custom-node properties (e.g. rgthree's `Fast Groups Bypasser`
         *  reads `matchTitle` from this).  Empty when raw was absent. */
        properties?: Record<string, unknown>;
        mode?: number;
      }[]
    | null;
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

export interface RawOutputMeta {
  name: string;
  localized?: string;
  /** Business label for the slot — `FRAMES` / `IMAGE_FINAL`.  Forwarded
   *  by /api/workflows/[id] from rawJson.outputs[].label so both the
   *  parent WorkflowSubgraphNode outputs strip and the inner WorkflowIoPortNode
   *  IO rail show the same name (fix). */
  label?: string;
  type: string;
  /** Source link ids coming out of this output (used to derive wires). */
  links: number[];
  /** True when at least one outgoing link targets the boundary sentinel
   *  `-20` (this output is exposed by the parent subgraph wrapper).
   *  Set by /api/workflows/[id]/subgraph.  Outer workflows always false. */
  isBoundary?: boolean;
}

export interface WorkflowGroup {
  id: string;
  title: string;
  bounding: [number, number, number, number];
  color: string;
  /** Group bypass state. Mirrors `rawJson.groups[i].flags.bypass`
   *  and is the handle used by the rgthree Fast Groups Bypasser integration:
   *  clicking a toggle in that node's body flips this field and PATCHes it
   *  back to the server.  Defaults to false on read. */
  bypass?: boolean;
}

export interface WorkflowNote {
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
export interface WorkflowNodeData {
  [key: string]: unknown;
  nodeId: string; // ComfyUI node ID
  classType: string;
  title: string;
  inputs: Record<string, unknown>;
  /** Which port role this node is assigned (if any) */
  assignedRole: string | null;
  /** For every input that is a connection ([srcId, slot]), the source node's
   *  title + class_type.  Used to render the "← <srcNode> #xx" label and to
   *  infer the data type flowing through the wire. */
  inputSources: Record<
    string,
    { id: string; title: string; slot: number; classType?: string }
  >;
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
   *  from `rawInputs[].isBoundary` so that WorkflowNode can keep mounting
   *  input Handles for boundary wires even if the server's input-stamp
   *  is missing from a stale cached detail. */
  boundaryInputs?: Set<string>;
  /** Widget values paired with `rawInputs` for custom nodes whose API
   *  `inputs` map is empty (the import pipeline stores custom-node widget
   *  values in rawJson.widgets_values rather than folding them into
   *  `graph[id].inputs`).  When set, WorkflowNode uses rawInputs as the input
   *  source with positional values from this array. */
  rawWidgetValues?: unknown[];
  /** Output NAMES (matching the keys of `inferOutputTypeAll(classType)`
   *  or `rawOutputs[i].name`) that have at least one downstream edge in
   *  this workflow.  WorkflowNode only renders a source Handle for output rows
   *  whose name appears here — "no wire ⇒ no dot".  When undefined / empty
   *  the renderer treats every output as unused (no Handle). */
  connectedOutputs?: Set<string>;
  /** Per-node LiteGraph flags forwarded verbatim from the raw JSON
   *  (ComfyUI emits `flags.collapsed: true` for collapsed widgets such as
   *  SetNode / rgthree Compact).  The editor reads `flags.collapsed` and
   *  collapses the chip body when present.  Other flag keys (pinned,
   *  allow_interaction, …) are kept opaque for future use. */
  flags?: Record<string, unknown>;
  /** LiteGraph `mode` value (0 = Always / normal, 2 = Never / muted, 4 = Bypass).
   *  Surfaced from raw JSON so the canvas can tint nodes by their ComfyUI
   *  status — bypass → purple, disabled → grey, normal → role/default. */
  mode?: number;
  /** LiteGraph `properties` dict from rawJson. Used by
   *  custom-frontends that derive their body UI at runtime from these
   *  values — the prime example being rgthree's `Fast Groups Bypasser`
   *  which reads `matchTitle` / `matchColors` / `sort` etc. to compute
   *  its toggle list.  WorkflowNode looks at `properties.matchTitle` when
   *  `classType === "Fast Groups Bypasser (rgthree)"` and renders the
   *  matched groups as a runtime body.  Empty / undefined for nodes
   *  that don't carry properties. */
  properties?: Record<string, unknown>;
  /** Workflow groups. Forwarded to WorkflowNode so the rgthree
   *  Fast Groups Bypasser runtime body can match against the live
   *  group list without re-fetching.  Read-only here — toggling a
   *  group's bypass goes through `RgthreeGroupsContext.setBypass` →
   *  PATCH, not a direct edit. */
  groups?: WorkflowGroup[];
  /** Exact ComfyUI box size { w, h } (body only, title bar excluded).
   *  When present the card is forced to these dimensions instead of the
   *  content-driven min/max-width layout.  Undefined → content-driven. */
  size?: { w: number; h: number };
  /** 当前视图的宿主（外层封装）节点 id —— 仅当视图是「下钻后的子工作流内部」
   *  时由编辑器注入（值 = 进入本层时的 wrapper 节点 id）。
   *
   *  本层节点都是子图内部节点（id 形如 `1670`），在顶层画布上不存在；勾选它们
   *  时 `IoRef.nodeId` 会带上 `hostNodeId`，运行期据此把内部 id 还原成 comfy-cli
   *  展开后的 `4:1670` 拼接形式。顶层视图不注入（undefined）。 */
  hostNodeId?: string;
}

/** Row dimensions used to lay out the target Handles next to each input row. */
export interface WorkflowGroupData {
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

export interface WorkflowIoPortData {
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

/* Layout constants for the boundary-pin wfIoPort cards (late).
 *  The pins live inside INPUTS / OUTPUTS wfGroup rectangles and are
 *  rendered as compact label rows stacked vertically.  These three values
 *  govern the column's visual rhythm; bumping IO_PORT_HEIGHT shrinks the
 *  whole rail, bumping PORT_ROW_GAP separates the pins more, and
 *  IO_PORT_WIDTH controls how much room the longest label gets before it
 *  starts clipping.  The previous render used {130, 26, ~10}; the user
 *  asked for tighter spacing + a slightly wider label slot, so we moved
 *  to {160, 22, 4}.
 *
 *  bumped IO_PORT_HEIGHT 22 → 24 because at 22 px the
 *  React Flow node wrapper clipped the descenders of letters with
 *  downward strokes (`p`, `g`, `y`, `q`) by ~1–2 px.  The 10.5 px font's
 *  ascender + cap + descender stack fills more than 22 px once you
 *  centre it via `flex items-center` inside a 2 px `py-[1px]` row, and
 *  the node's `style.height = IO_PORT_HEIGHT` makes the wrapper a hard
 *  clip box.  24 px gives the descender a clean ~4–5 px runway and the
 *  whole wfGroup only grows by 2 px × (rowCount−1) ≈ 20 px for a 10-row
 *  INPUT rail — well within the user's "紧凑" brief.
 *
 *  bumped IO_PORT_HEIGHT 24 → 26 + flipped the row's
 *  flex alignment from `items-center` to `items-end` with `pb-[1px]`
 *  inside WorkflowIoPortNode. gave a calculated ~7 px clearance, but in
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
 *  the user's third screenshot still showed the
 *  descenders amputated. The -end trick relied on the
 *  descender sitting at the *baseline of the line-box*, but with
 *  `leading-none` (= line-height: 1, so line-box = 10.5 px) the Inter
 *  descender (~3 px) still lives BELOW the line-box, clipped by
 *  `style.height = IO_PORT_HEIGHT` no matter how we align.
 *  replaces `leading-none` with `leading-[1.4]` (= 14.7 px line-box),
 *  which now INTERNALLY contains ascender + cap + descender with
 *  margin on both sides; with `items-center` the descender lands at
 *  y ≈ 10 px inside a 28 px wrapper, leaving a comfortable 4-5 px
 *  clear runway at the bottom.  IO_PORT_HEIGHT bumps 26 → 28 to
 *  keep a safety gap.  wfGroup rail grows by ~18 px for 10 rows.  If
 *  the user complains about row gaps looking too loose later, swap
 *  to leading-snug (1.375) and IO_PORT_HEIGHT = 26 to claw back 1 px. */
export interface WorkflowNoteData {
  [key: string]: unknown;
  title: string;
  text: string;
  color: string;
}

export interface WorkflowSubgraphData {
  [key: string]: unknown;
  /** ComfyUI real node id (matches `detail.graph[id]`, `rawMetaById[id]`,
   *  `positions[id]`).  Stamped by the initialNodes builder so the
   *  `#id` chip can look up the entry the same way `WorkflowNodeData.nodeId`
   *  does — using `data.uid` (classType 前 8 位) here would always miss
   *  because that's a hash, not the canonical ComfyUI id. */
  nodeId: string;
  title: string;
  uid: string; // first 8 chars of class_type — used as subtitle
  inputs: RawInputMeta[];
  /** Per-output display metadata from raw JSON (e.g. the IMAGE output a
   *  subgraph exposes).  Empty when the subgraph has no outputs. */
  outputs?: RawOutputMeta[];
  widgetValues: unknown[];
  /** Callback to enter the subgraph's internal graph. */
  onEnter?: () => void;
  /** Same semantics as WorkflowNodeData.connectedOutputs — only outputs in this
   *  set get a visible source Handle. */
  connectedOutputs?: Set<string>;
  /** Input NAMES (matching `inputs[i].name`) that have an external wire in
   *  the *parent* workflow.  WorkflowSubgraphNode only renders a target Handle
   *  for inputs whose name appears here.  Independent (un-wired) subgraph
   *  inputs still get their label row so the user can see what's exposed,
   *  but no Handle is rendered. */
  connectedInputs?: Set<string>;
  /** Exact ComfyUI box size { w, h } (body only, title bar excluded).
   *  When present the card is forced to these dimensions.  Undefined →
   *  content-driven. */
  size?: { w: number; h: number };
  /** LiteGraph `mode` (0 = Always / 2 = Never-mute / 4 = Bypass).  Same
   *  semantics as WorkflowNodeData.mode — drives the 3-state color overlay. */
  mode?: number;
  /** LiteGraph flags forwarded verbatim from raw JSON.  Currently
   *  read for `flags.collapsed` so an imported subgraph that ComfyUI
   *  ships collapsed stays collapsed here too. */
  flags?: Record<string, unknown>;
  /** 当前视图的宿主（外层封装）节点 id 链 —— 仅当视图是「下钻后的子工作流
   *  内部」时注入；本卡片自身的暴露口勾选时带着它落库，运行期还原
   *  comfy-cli 展开后的 `host:inner` 拼接 id（见 IoRef.hostNodeId）。 */
  hostNodeId?: string;
}
