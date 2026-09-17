/**
 * Subgraph (inner workflow) parsing helpers — extracted from
 * workflow-detail.ts (batch 4).
 *
 * These pure functions turn a `definitions.subgraphs[uid]` definition into
 * the API graph, node metadata, boundary pins and annotations the subgraph
 * detail builder serves.  All are free of I/O (positions overlay is passed
 * in), so the caller can cache the serialized result.
 */
import {
  asRecord,
  pairWidgetValues,
  SubgraphLinkSchema,
  SubgraphPinSchema,
  toStringValue,
  type ApiWorkflowNode,
  type RawNodeInput,
  type RawNode,
  type RawSubgraphDef,
} from "~/lib/comfyui/raw";
import { inferIsMultiline } from "~/lib/comfyui/types";
import { logger } from "~/lib/core/logger";
import {
  type DetailNodeView,
  type RawInputEntry,
  type RawNodeMeta,
  type RawOutputEntry,
} from "~/lib/comfyui/workflow-detail-raw";

/* IMAGE-input thumbnail preview (narrowed in ).
 * Mirrors the parent route.  We surface the LoadImage upstream filename as
 * a synthetic `preview`-marked entry on the LoadImage node itself; we do
 * NOT propagate `imageRef` to downstream IMAGE inputs (ImageScale /
 * CLIPVisionEncode / …) since those would only show the un-scaled /
 * un-encoded upstream image — meaningless, per user feedback.
 * Empty LoadImage uploads (widgets_values[0] missing/empty) still push
 * the synthetic entry so the body can show a 「需要上传图片」 placeholder. */
const LOAD_IMAGE_NODE_TYPES = new Set([
  "LoadImage",
  "LoadImageMasked",
  "ComfyUI LoadImage",
  "ComfyUI-LoadImage",
  "Load Image",
  "ImageLoader",
  "ComfyUI-ImageLoader",
]);

/** 按节点归拢「被哨兵边实际关联的槽位」——**这是下标口径的唯一权威事实**。
 *
 *  ComfyUI 在不同导出路径上给出的「槽位」下标口径并不一致：有的写它在内层节点
 *  `inputs[]` 里的下标，有的写**控件序号**（把 `model`/`negative` 这类纯连接口排除
 *  在外，`target_slot` 于是会超出 `inputs[]` 的长度）。边界连线的 handle id 必须落在
 *  **真的挂载了 Handle 的那一行**上，否则 React Flow 找不到锚点、整条边被丢弃并打
 *  error#008 —— 用户看到的是「这个暴露口从来没连上」。
 *
 *  所以不猜口径，而是把「ComfyUI 实际关联的那个槽位」记下来交给
 *  `parseSubgraphSlots` 解析：`-10` 哨兵边的目标槽位就是内层消费节点的输入槽，
 *  槽位名与「哪一行真的有边」于是永远同源。 */

export function boundarySlotsByNode(
  boundaryLinkInfoById: Record<number, BoundaryLinkInfo>,
): Record<string, number[]> {
  const byNode: Record<string, Set<number>> = {};
  for (const info of Object.values(boundaryLinkInfoById)) {
    (byNode[info.innerNodeId] ??= new Set()).add(info.innerSlot);
  }
  const out: Record<string, number[]> = {};
  for (const [nodeId, slots] of Object.entries(byNode))
    out[nodeId] = [...slots].sort((a, b) => a - b);
  return out;
}

export interface SubgraphLinkEntry {
  src: string;
  slot: number;
  type: string;
  targetId: string;
  targetSlot: number;
}

export interface BoundaryLinkInfo {
  kind: "input" | "output";
  pinId: string;
  /** Inner-node side: source for output-boundary links, target for
   *  input-boundary links. */
  innerNodeId: string;
  innerSlot: number;
  innerSlotName?: string;
}

/**
 * Build a link-id → {src, slot, type, targetId, targetSlot} lookup so we
 * can resolve the raw-format link objects back into API-format
 * [srcId, srcSlot] tuples for each target node's input.
 *
 * Important: `sub.links` is an *array of objects* in newer ComfyUI
 * versions (not a flat tuple array as in older builds):
 *   { id, origin_id, origin_slot, target_id, target_slot, type }
 * Origin ids of -10 / -20 are sentinel "input/output" nodes the
 * subgraph uses to mark cross-boundary wires; we keep them out of the
 * API graph so the canvas shows them as disconnected internal ports.
 *
 * We additionally record every sentinel-bearing link in
 * `boundaryLinkInfoById` so the route response can hand the canvas
 * an exact mapping of boundary_pin_id ↔ inner_node_handle.  This
 * replaces the previous v3 strategy of flagging inner nodes as
 * "endpoints" based on whether they consume/produce boundary wires
 * — which produced nested-node-id collisions and missing middle
 * cards whenever every inner node happened to sit on the boundary
 * (e.g. a small NOISE subgraph whose 10 RandomNoise nodes each
 * had their own noise_seed input and NOISE output going through
 * the wrapper).  The clean approach is to treat the boundary
 * PINS (definitions.subgraphs[u].inputs / .outputs) as separate
 * first-class entities — see also `boundaryPins` below. */
export function parseSubgraphLinks(sub: RawSubgraphDef): {
  linkById: Record<number, SubgraphLinkEntry>;
  boundaryLinkInfoById: Record<number, BoundaryLinkInfo>;
} {
  const linkById: Record<number, SubgraphLinkEntry> = {};
  const boundaryLinkInfoById: Record<number, BoundaryLinkInfo> = {};

  for (const lk of Array.isArray(sub.links) ? sub.links : []) {
    const parsed = SubgraphLinkSchema.safeParse(lk);
    if (!parsed.success) continue;
    const rec = parsed.data;
    const id = Number(rec.id);
    if (!Number.isFinite(id)) continue;
    const originId = Number(rec.origin_id);
    const originSlot = Number(rec.origin_slot) || 0;
    const targetId = Number(rec.target_id);
    const targetSlot = Number(rec.target_slot) || 0;
    const type = toStringValue(rec.type ?? "*");
    linkById[id] = {
      src: Number.isFinite(originId) ? String(originId) : "?",
      slot: originSlot,
      type,
      targetId: Number.isFinite(targetId) ? String(targetId) : "?",
      targetSlot,
    };
    /* If one end is a sentinel, mark this link for boundary tracking. */
    if (originId === -10 && Number.isFinite(targetId)) {
      boundaryLinkInfoById[id] = {
        kind: "input",
        pinId: `__pin_tbd__:${id}`, // resolved below after we walk boundary pins
        innerNodeId: String(targetId),
        innerSlot: targetSlot,
      };
    } else if (targetId === -20 && Number.isFinite(originId)) {
      boundaryLinkInfoById[id] = {
        kind: "output",
        pinId: `__pin_tbd__:${id}`,
        innerNodeId: String(originId),
        innerSlot: originSlot,
      };
    }
  }

  return { linkById, boundaryLinkInfoById };
}

/** 一个输入槽位在「槽位下标」与「raw 数组位置」两套坐标系里的落点。 */
interface InputSlotRef {
  /** 槽位下标 —— `names[slot]` 读到的就是它的槽位名。 */
  slot: number;
  /** 该槽位在原始 `inputs[]` 里的位置。 */
  index: number;
}

/** 把 raw 节点的 `inputs[]` 解析成「槽位下标 → 槽位」。
 *
 *  槽位下标的口径按**节点上有没有被哨兵边关联的槽位**择优，不做全局猜测：
 *  · 有（`boundarySlots`）→ 下标就是 raw 槽位数组的位置。哨兵边记下的关联就是
 *    事实（`target_slot: 2` 指向的正是 `inputs[2]`），而节点自带的 `idx` 在部分
 *    导出路径上给 widget 槽从 0 连续编号、不跳过纯连接槽，照抄会整体错位；
 *  · 没有 → 沿用 `idx`（缺席时按数组顺序），保持既有行为。
 *
 *  判据按节点取，所以同一子图里两种口径可以并存。 */
function resolveInputSlots(
  inputs: readonly RawNodeInput[],
  boundarySlots: readonly number[] | undefined,
): InputSlotRef[] {
  if (!boundarySlots || boundarySlots.length === 0) {
    return inputs
      .map((entry, index) => ({ index, slot: entry?.idx ?? index }))
      .sort((a, b) => a.slot - b.slot);
  }
  /* 哨兵边口径：**整张表按数组位置重建**（槽位下标 = 数组下标）。
   *
   *  不能只留被关联的那几个槽位 —— 槽位表是「下标 → 槽位名」的查表结构，缺项会
   *  让别的下标读到 undefined（边界值走的就是这张表）。整表重建才能保证「哨兵边
   *  指向的下标」与「真实渲染的那一行」对得上。 */
  return inputs.map((_, index) => ({ index, slot: index }));
}

/** 按槽位下标取槽位名（缺槽读成空串 = 「没解析出槽位名」）。 */
function slotNameAt(
  slots: readonly InputSlotRef[],
  inputs: readonly RawNodeInput[],
  index: number,
): string {
  const ref = slots.find((item) => item.slot === index);
  const name = ref ? inputs[ref.index]?.name : undefined;
  return typeof name === "string" ? name : "";
}

/**
 * Pre-pass: collect per-node input/output slot-name lookups (positional
 * index → slot name).  These are needed to translate a sentinel link's
 * `target_slot` / `origin_slot` integer into the inner node's slot
 * *name* (which becomes the React Flow edge's targetHandle /
 * sourceHandle).  Modern ComfyUI puts an `idx` on each slot entry;
 * older versions fall back to array order (idx=0,1,2,...). */
export function parseSubgraphSlots(
  sub: RawSubgraphDef,
  /** 被哨兵边**实际关联**的输入槽位（`boundarySlotsByNode(…)` 的产物）——
   *  ComfyUI 写下的关联是事实，能直接解开「下标口径不一致」的歧义。 */
  boundarySlotsByNodeId?: Record<string, number[]>,
): {
  inputNameByNodeSlot: Record<string, string[]>;
  outputNameByNodeSlot: Record<string, string[]>;
  inputWidgetValueByNodeSlot: Record<string, unknown[]>;
} {
  const inputNameByNodeSlot: Record<string, string[]> = {};
  const outputNameByNodeSlot: Record<string, string[]> = {};
  /** Per-node lookup of a raw input/output index → widget value (for
   *  inputs that *also* have boundary wires, e.g. CLIPTextEncode's text). */
  const inputWidgetValueByNodeSlot: Record<string, unknown[]> = {};

  const innerNodes: RawNode[] = Array.isArray(sub.nodes) ? sub.nodes : [];
  for (const rn of innerNodes) {
    if (!rn?.id) continue;
    const nodeId = String(rn.id);
    if (Array.isArray(rn.inputs)) {
      const rawInputs: RawNodeInput[] = rn.inputs;
      const slots = resolveInputSlots(
        rawInputs,
        boundarySlotsByNodeId?.[nodeId],
      );
      const widgets = Array.isArray(rn.widgets_values) ? rn.widgets_values : [];
      inputNameByNodeSlot[nodeId] = slots.map(({ slot }) =>
        slotNameAt(slots, rawInputs, slot),
      );
      // Snapshot widget values aligned with slot order so the boundary
      // pass can also surface a default `value` (CLIPTextEncode's `text`
      // sits here when the wrapper exposes the prompt as an input).
      inputWidgetValueByNodeSlot[nodeId] = slots.map(({ slot, index }) => {
        const slotInput = rawInputs[index];
        if (!slotNameAt(slots, rawInputs, slot)) return undefined;
        if (!slotInput?.widget) return undefined;
        return widgets[slot];
      });
    }
    if (Array.isArray(rn.outputs)) {
      const sorted = [...rn.outputs].sort(
        (a, b) => (a?.idx ?? 0) - (b?.idx ?? 0),
      );
      outputNameByNodeSlot[nodeId] = sorted.map((x) =>
        typeof x?.name === "string" ? x.name : "",
      );
    }
  }

  return {
    inputNameByNodeSlot,
    outputNameByNodeSlot,
    inputWidgetValueByNodeSlot,
  };
}

export interface SubgraphGraphResult {
  graph: Record<string, ApiWorkflowNode>;
  rawInputsById: Record<string, RawInputEntry[]>;
  rawOutputsById: Record<string, RawOutputEntry[]>;
  rawNodeMeta: RawNodeMeta[];
  sizeById: Record<string, [number, number]>;
  nodes: DetailNodeView[];
  inputEndpointNodes: Set<string>;
  outputEndpointNodes: Set<string>;
  boundaryInputByNode: Record<
    string,
    { name: string; type: string; value: unknown }
  >;
  boundaryOutputByNode: Record<string, { name: string; type: string }>;
  connectsToByNode: Record<string, string>;
  connectsFromByNode: Record<string, string>;
  /** Per-node slot-name lookups (positional index → slot name), surfaced
   *  for the caller to assemble boundaryLinks. */
  inputNameByNodeSlot: Record<string, string[]>;
  outputNameByNodeSlot: Record<string, string[]>;
  /** 子图暴露口 → 作者写在**外层 wrapper** 上的业务名（`label`）。
   *
   *  勾选点落在外层封装卡片上时，落库的 `name` 是 wrapper 本层的槽位名；
   *  ComfyUI 在某些路径上把 `properties.proxyWidgets` 隔离掉
   *  （`proxyWidgetErrorQuarantine`），顶层富化于是查不到内部「真实的作者名」，
   *  只剩 ComfyUI 通用翻译（`seed` → `localized: "随机种"`）——作者写的
   *  `Seed` 就丢在这一层（ISSUE #349：切成随机值/固定值后名字退回 `value_1`）。
   *  内层视图的 wrapper 边界记录（`-10` 边的源节点）与本层槽位名一对就能
   *  把作者名捞回来，作为「按 alias 回退取名」的来源下发给顶层富化。
   *
   *  **键是 `节点id::槽位名`，不是裸槽位名**：一个子图里多个同类节点共享
   *  同一个内部槽位名（四个 `PrimitiveInt` 的入参都叫 `value`），只按槽位名
   *  记账会被后写的暴露口覆盖 —— 于是 `Seed` 节点显示成最后一个 `FPS` 的口名
   *  （ISSUE #394）。 */
  proxyAuthorLabels: Record<string, string>;
}

/**
 * Walk each inner node and produce an API-style graph entry plus the
 * `nodes` array (consumed by the canvas as a flat list of ComfyGraphNode
 * entries).  Boundary endpoint nodes are stamped with
 * `is_input_endpoint` / `is_output_endpoint` so the client
 * can draw INPUTS / OUTPUTS wfGroup rectangles without re-walking the
 * link table.
 */
export function buildSubgraphGraph(
  sub: RawSubgraphDef,
  linkById: Record<number, SubgraphLinkEntry>,
  /** 被哨兵边实际关联的输入槽位（`boundarySlotsByNode(…)` 的产物）——槽位表
   *  按它解析，边界 handle id 才会落在真的挂载了 Handle 的那一行上。 */
  boundarySlotsByNodeId?: Record<string, number[]>,
): SubgraphGraphResult {
  const innerNodes: RawNode[] = Array.isArray(sub.nodes) ? sub.nodes : [];
  const graph: Record<string, ApiWorkflowNode> = {};
  const rawInputsById: Record<string, RawInputEntry[]> = {};

  const rawOutputsById: Record<string, RawOutputEntry[]> = {};
  /* Exact ComfyUI box size ([w, h]) per inner node — forwarded so the
   *  inner-canvas nodes match their imported config dimensions.  Pulled
   *  from the raw inner-node JSON (sub.nodes), since the synthetic `graph`
   *  map below only keeps class_type + inputs. */
  const sizeById: Record<string, [number, number]> = {};
  const rawNodeMeta: RawNodeMeta[] = [];
  /* Boundary node-id collectors — populated as we walk nodes + links so
   * the client can mark "this node is on the inputs/outputs boundary of
   * the subgraph" without re-doing the link scan.  A node is considered
   * an INPUT endpoint when one of its inputs is fed by the sentinel
   * `-10` source (subgraph exposed input → inner consumer); likewise an
   * OUTPUT endpoint is one whose output is the sentinel `-20` target
   * (inner producer → subgraph exposed output).
   *
   * We keep populating these for diagnostic reasons but no
   * longer depend on them in the client.  The boundary PINS themselves
   * (defined in `sub.inputs` and `sub.outputs`) carry their own ids and
   * positions; emitting them via the new top-level `boundaryPins` field
   * is the right way to render the inner-canvas IO rails.  We also keep
   * `boundaryInputByNode` / `boundaryOutputByNode` for the legacy
   * `boundary_input` / `boundary_output` debug fields, but the client
   * ignores them now. */
  const inputEndpointNodes = new Set<string>();
  const outputEndpointNodes = new Set<string>();
  const boundaryInputByNode: Record<
    string,
    { name: string; type: string; value: unknown }
  > = {};
  const boundaryOutputByNode: Record<string, { name: string; type: string }> =
    {};
  const connectsToByNode: Record<string, string> = {};
  const connectsFromByNode: Record<string, string> = {};

  const { inputNameByNodeSlot, outputNameByNodeSlot } = parseSubgraphSlots(
    sub,
    boundarySlotsByNodeId,
  );

  /* 子图暴露口 → 作者名（见 SubgraphGraphResult.proxyAuthorLabels 的说明）。
   *  wrapper 的暴露口在内层表现为「源为 -10 哨兵的入边」，边本身登记着作者
   *  写在外层卡片的 `label`（`sub.inputs[].label`），源端槽位名就是 wrapper
   *  本层的槽位名（`value_1`）。两者一对，就能在 proxyWidgets 缺失时仍把作者
   *  名（`Seed`）交回上层富化。 */
  const proxyAuthorLabels: Record<string, string> = {};
  for (const pinRaw of Array.isArray(sub.inputs) ? sub.inputs : []) {
    const pin = asRecord(pinRaw);
    if (!pin) continue;
    const authorLabel = typeof pin.label === "string" ? pin.label.trim() : "";
    if (!authorLabel) continue;
    const linkIds = Array.isArray(pin.linkIds)
      ? pin.linkIds
      : Array.isArray(pin.links)
        ? pin.links
        : pin.link === undefined
          ? []
          : [pin.link];
    /* 哨兵边源端是外层 wrapper，`-10` 入边的 target 才是内层消费节点：
     *  作者名只有外层 `pin.label` 一处，槽位名取自那个内层节点的暴露槽位
     *  （wrapper 本层槽位名与它同名）——两者一对，别名之外就有作者名可用。 */
    for (const lid of linkIds) {
      const lk = linkById[Number(lid)];
      /* 只在「源端是外层 wrapper 的哨兵边」上回收作者名。 */
      if (lk?.src !== "-10") continue;
      const slotNames: string[] | undefined = inputNameByNodeSlot[lk.targetId];
      const slotName = slotNames?.[lk.targetSlot];
      if (slotName)
        proxyAuthorLabels[`${lk.targetId}::${slotName}`] = authorLabel;
    }
  }

  for (const rn of innerNodes) {
    if (!rn?.id) continue;
    const nodeId = String(rn.id);
    const classType: string = rn.type ?? "?";
    /* Capture the raw litegraph box size so the client can paint the node
     *  at its exact ComfyUI dimensions (see `sizeById` declaration above). */
    const rnSize =
      Array.isArray(rn.size) && rn.size.length >= 2 ? rn.size : undefined;
    if (rnSize)
      sizeById[nodeId] = [Number(rnSize[0]) || 0, Number(rnSize[1]) || 0];

    /* Per-input metadata.  We tag a connection as "internal" (originates
     * from another node inside the subgraph) vs "boundary" (originates
     * from the input sentinel node -10, meaning the value comes from
     * the parent wrapper).  Boundary connections are still recorded as
     * isConnection for UI labelling but skipped when writing inputMap
     * so the value isn't bound to a sentinel source. */
    const rawInputs: RawInputEntry[] = [];
    const inputMap: Record<string, unknown> = {};
    if (Array.isArray(rn.inputs)) {
      const rnWidgets = Array.isArray(rn.widgets_values)
        ? rn.widgets_values
        : [];
      /* Sentinel-aware pairing: ComfyUI inserts a `control_after_generate`
       *  slot into `widgets_values` right after a seed-type INT widget, so
       *  a naive index match would shift every later widget by one.  Use the
       *  shared helper (mirrors `resolveWidgetOrder`) to map widget-name →
       *  value.  This is what makes inner-node widgets (KSampler seed/steps/
       *  cfg/sampler/scheduler/denoise, CLIPTextEncode's prompt, …) show
       *  their real values instead of blank/offset rows. */
      const wvMap = pairWidgetValues(rn.inputs, rnWidgets);
      for (const inp of rn.inputs) {
        if (!inp || typeof inp.name !== "string") continue;
        const isConn = inp.link != null;
        const widgetName =
          inp.widget && typeof inp.widget.name === "string"
            ? inp.widget.name
            : undefined;
        const widgetValue = widgetName ? wvMap[widgetName] : undefined;
        const entry: RawInputEntry = {
          name: inp.name,
          label: typeof inp.label === "string" ? inp.label : undefined,
          localized:
            typeof inp.localized_name === "string"
              ? inp.localized_name
              : undefined,
          type:
            typeof inp.type === "string" ? inp.type : isConn ? "*" : "STRING",
          /* Mark boundary wires (origin_id = -10/-20) as "isBoundary" so
           *  the canvas can render them as a wrapper-exposed input (still
           *  a connection, but no real source node inside the subgraph). */
          isConnection: isConn,
          isBoundary: false, // set later if needed
        };
        if (widgetName) entry.widget = { name: widgetName };
        if (widgetValue !== undefined) entry.widgetValue = widgetValue;
        /* parity: stamp `multiline` on STRING inputs the helper flags,
         *  so short prompt inputs don't degrade to one-line chips.
         *
         *  这里是**同步**构建，读不到 object_info 的 `{"multiline": true}`
         *  声明（声明只能异步查）—— 因此只盖「值很长」那条数据判据，
         *  声明由调用方 `buildSubgraphDetail` 在构建之后补盖一次。
         *
         *  removed the IMAGE-input `imageRef` propagation
         *  for the same reason as the parent route — downstream IMAGE
         *  consumers would only re-display the un-scaled / un-encoded
         *  upstream image, which is misleading.  Only the LoadImage
         *  source node gets a preview (synthetic entry pushed below). */
        if (
          typeof inp.type === "string" &&
          inp.type === "STRING" &&
          widgetValue !== undefined
        ) {
          if (inferIsMultiline(undefined, widgetValue)) entry.multiline = true;
        }
        rawInputs.push(entry);
        if (isConn) {
          const lk = linkById[Number(inp.link)];
          if (lk && lk.src !== "-10" && lk.src !== "-20") {
            inputMap[inp.name] = [lk.src, lk.slot];
          } else if (lk && (lk.src === "-10" || lk.src === "-20")) {
            /* Boundary wire (subgraph's exposed input/output) — fall back
             *  to the widget value if one is declared.  This is the case
             *  for `text` on CLIPTextEncode: in raw JSON the field is
             *  both a widget AND has a `link` pointing to the boundary
             *  sentinel; we want the widget's default value (the actual
             *  prompt text), not a connection tuple. */
            const last = rawInputs[rawInputs.length - 1];
            if (last) last.isBoundary = true;
            /* Mark this node as an INPUT endpoint: the
             *  sentinel `-10` source means the value comes from the
             *  parent wrapper, so this node is the boundary consumer
             *  on the INPUTS side.  Output sentinel `-20` is rare on
             *  inputs in practice but we still group it as "input"
             *  since it falls into the boundary connection branch. */
            if (lk.src === "-10") inputEndpointNodes.add(nodeId);
            /* Stash the boundary port details for the canvas to render
             *  a compact wfIoPort label.  Only the first boundary input
             *  per node is recorded (most endpoints have exactly one). */
            if (lk.src === "-10" && !boundaryInputByNode[nodeId]) {
              boundaryInputByNode[nodeId] = {
                name: inp.name,
                type: typeof inp.type === "string" ? inp.type : "*",
                value: widgetValue,
              };
            }
            if (widgetValue !== undefined) {
              inputMap[inp.name] = widgetValue;
            }
          } else {
            /* Non-sentinel input connection — record the source middle
             *  node id as `connects_from` (used by the OUTPUT endpoint
             *  positioning helper).  We only keep the FIRST non-sentinel
             *  source to keep positioning deterministic. */
            // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- 需保留 first-truthy 语义（空串也视为未设置）
            if (!connectsFromByNode[nodeId])
              connectsFromByNode[nodeId] = lk?.src ?? "";
          }
        } else if (widgetValue !== undefined) {
          // Fold the corresponding widget value into inputs[] (API form).
          inputMap[inp.name] = widgetValue;
        }
      }
    }

    /* 作者在 ComfyUI properties 里改过名的节点（`title` 字段）必须留到视图层：
     *  画布标题栏按 `friendlyNodeTitle(classType, title)` 取名，作者名优先于
     *  classType 的静态中文名（ISSUE #394：`PrimitiveInt` + `title: "Seed"`
     *  在子图内部一直显示成 "Primitive Int"）。这里与顶层路
     *  （workflow-detail / workflow-detail-raw）的取值链逐字一致。 */
    const rawTitle = typeof rn.title === "string" ? rn.title.trim() : "";
    graph[nodeId] = {
      class_type: classType,
      inputs: inputMap,
      ...(rawTitle ? { _meta: { title: rawTitle } } : {}),
    };

    /* Per-output metadata. */
    const rawOutputs: RawOutputEntry[] = [];
    if (Array.isArray(rn.outputs)) {
      for (const o of rn.outputs) {
        if (!o || typeof o.name !== "string") continue;
        /* Mark OUTPUT endpoint nodes: if any link from this
         *  output aims at the sentinel `-20` target (the subgraph's
         *  exposed output), then this node is an output producer — it
         *  feeds the parent wrapper's exposed output.  The client uses
         *  this flag to draw an OUTPUTS wfGroup around the cluster. */
        let isBoundaryOut = false;
        if (Array.isArray(o.links)) {
          for (const lnkId of o.links) {
            const target = linkById[Number(lnkId)]?.targetId;
            if (target === "-20") {
              outputEndpointNodes.add(nodeId);
              isBoundaryOut = true;
              /* Stash the boundary output port for the canvas to render
               *  a compact wfIoPort label on the LEFT edge.  Only the
               *  first -20-bearing output is recorded. */
              boundaryOutputByNode[nodeId] ??= {
                name: o.name,
                type: typeof o.type === "string" ? o.type : "*",
              };
              break;
            }
            /* Non-sentinel target → record first as `connects_to` (used
             *  by the INPUT endpoint positioning helper). */
            if (
              target &&
              target !== "-10" &&
              target !== "-20" &&
              !connectsToByNode[nodeId]
            ) {
              connectsToByNode[nodeId] = target;
            }
          }
        }
        rawOutputs.push({
          name: o.name,
          localized:
            typeof o.localized_name === "string" ? o.localized_name : undefined,
          type: typeof o.type === "string" ? o.type : "*",
          links: Array.isArray(o.links)
            ? o.links.map((n) => Number(n) || 0)
            : [],
          isBoundary: isBoundaryOut,
        });
      }
    }

    if (rn.type !== "Note" && rn.type !== "MarkdownNote") {
      /* LoadImage family: synthesise a `preview: true` image entry so the
       * canvas paints the uploaded thumbnail (or 「需要上传图片」 placeholder
       * when empty) on the LoadImage node itself.  ComfyUI shows the
       * thumbnail there, not on downstream consumers — per
       * we no longer propagate imageRef downstream because the un-scaled /
       * un-encoded back-reference rendering was misleading.
       *
       * ALWAYS push for LoadImage-family, regardless of
       * whether an image is loaded.  The dedicated `preview: true` flag
       * is checked by the renderer's connEntries / widgetEntries filters
       * so this entry never lands in the port row or widget control list
       * — it's consumed exclusively by <WorkflowImagePreview>. */
      if (LOAD_IMAGE_NODE_TYPES.has(classType)) {
        if (!rawInputs.some((rawInput) => rawInput.preview)) {
          const wv0 = rn.widgets_values?.[0];
          const fname = typeof wv0 === "string" ? wv0.trim() : "";
          rawInputs.push({
            name: "__loadimage_preview__",
            label: "image",
            localized: "图像",
            type: "IMAGE",
            isConnection: false,
            isBoundary: false,
            preview: true,
            ...(fname
              ? {
                  imageRef: {
                    filename: fname,
                    subfolder: "",
                    type: "input" as const,
                  },
                }
              : {}),
          });
        }
      }
      rawInputsById[nodeId] = rawInputs;
      rawOutputsById[nodeId] = rawOutputs;
      rawNodeMeta.push({
        id: nodeId,
        widgets_values: Array.isArray(rn.widgets_values)
          ? rn.widgets_values
          : [],
        outputs: rawOutputs,
        flags:
          typeof rn.flags === "object" && rn.flags !== null ? rn.flags : {},
        mode: typeof rn.mode === "number" ? rn.mode : 0,
      });
    }
  }

  /* Build the `nodes` array (consumed by the canvas as a flat list of
   *  ComfyGraphNode entries).  We also stamp each node with
   *  `is_input_endpoint` / `is_output_endpoint` so the
   *  client can draw INPUTS / OUTPUTS wfGroup rectangles around the
   *  two clusters without re-walking the link table. */
  const nodes: DetailNodeView[] = Object.entries(graph).map(([nodeId, n]) => {
    // Same class_type / type fallback as the parent route — newer ComfyUI
    // exports put the class name in `class_type`, but older / rgthree-comfy
    // exports use `type` only.  Without this fallback subgraph wrappers
    // come back with classType="?" and `is_subgraph: false`, so the
    // inner canvas paints them as full WorkflowNodes instead of compact
    // WorkflowSubgraphNode chips.  (graph entries are built above with a
    // string class_type, so it is always present here.)
    const classType: string = n.class_type;
    const isUuidClass = /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(classType);
    const isInEp = inputEndpointNodes.has(nodeId);
    const isOutEp = outputEndpointNodes.has(nodeId);
    return {
      id: nodeId,
      class_type: classType,
      title: n._meta?.title ?? (isUuidClass ? "" : classType) ?? nodeId,
      is_subgraph: isUuidClass,
      raw_inputs: rawInputsById[nodeId] ?? [],
      is_input_endpoint: isInEp,
      is_output_endpoint: isOutEp,
      /* Exact ComfyUI box size ([w, h]) for this inner node.  Undefined
       *  when the subgraph definition carries no per-node size (rare). */
      size: sizeById[nodeId],
      /* Boundary port details for wfIoPort rendering (v3).
       *  The client renders IO endpoint nodes as compact label-only
       *  items on the LEFT (input) / RIGHT (output) of the inner canvas.
       *  Without these fields the canvas can't show the port name and
       *  default value (e.g. "noise_seed  41"). */
      boundary_input: isInEp ? (boundaryInputByNode[nodeId] ?? null) : null,
      boundary_output: isOutEp ? (boundaryOutputByNode[nodeId] ?? null) : null,
      /* First non-sentinel middle node this endpoint actually wires to
       *  internally — used by the client to position the wfIoPort
       *  adjacent to its target/source middle node.  Undefined for pure
       *  passthrough endpoints (RandomNoise-style), which fall back to
       *  the saved position. */
      connects_to: connectsToByNode[nodeId] ?? null,
      connects_from: connectsFromByNode[nodeId] ?? null,
    };
  });

  return {
    graph,
    rawInputsById,
    rawOutputsById,
    rawNodeMeta,
    sizeById,
    nodes,
    inputEndpointNodes,
    outputEndpointNodes,
    boundaryInputByNode,
    boundaryOutputByNode,
    connectsToByNode,
    connectsFromByNode,
    /* Slot-name lookups are derived in the same walk as boundary IO, so
     *  they are already final by the time we assemble the result. */
    inputNameByNodeSlot,
    outputNameByNodeSlot,
    proxyAuthorLabels,
  };
}

export interface BoundaryPin {
  id: string;
  name: string;
  type: string;
  /** ComfyUI-i18n label (zh-CN etc.).  Usually equals `type`/`name`
   *  for proxy pins — kept for completeness. */
  localized?: string;
  /** Business-facing label set by the author in the node editor
   *  (e.g. `FRAMES`, `IMAGE_FINAL`, `MODEL_HIGH_1st`).  Use this
   *  first when rendering so the inner IO rail matches what the
   *  parent-card outputs strip shows. */
  label?: string;
  pos: [number, number];
  linkIds: number[];
}

/**
 * Parse the subgraph's exposed IO pins (`sub.inputs` / `sub.outputs`).
 *
 * Each pin is a first-class entity with its own UUID (`id`),
 * slot name (`name`), type, optional human label, saved position, and one
 * or more `linkIds` (the cross-boundary wire(s) feeding into / out of an
 * inner node).  Also builds the inverse `pinIdByLinkId` map used to
 * resolve the sentinel-link table into `boundaryLinks`.
 */
export function parseSubgraphPins(sub: RawSubgraphDef): {
  boundaryPins: { inputs: BoundaryPin[]; outputs: BoundaryPin[] };
  pinIdByLinkId: Record<number, { pinId: string; kind: "input" | "output" }>;
} {
  const boundaryPins: { inputs: BoundaryPin[]; outputs: BoundaryPin[] } = {
    inputs: [],
    outputs: [],
  };
  const pinIdByLinkId: Record<
    number,
    { pinId: string; kind: "input" | "output" }
  > = {};
  const rawSubInputs: unknown[] = Array.isArray(sub.inputs) ? sub.inputs : [];
  const rawSubOutputs: unknown[] = Array.isArray(sub.outputs)
    ? sub.outputs
    : [];

  const normalizePin = (p: unknown): BoundaryPin | null => {
    const parsed = SubgraphPinSchema.safeParse(p);
    if (!parsed.success) return null;
    const rec = parsed.data;
    const id = rec.id;
    const posRaw: unknown[] = Array.isArray(rec.pos) ? rec.pos : [0, 0];
    const pos: [number, number] = [
      Number(posRaw[0]) || 0,
      Number(posRaw[1]) || 0,
    ];
    const linkIdsRaw: unknown[] = Array.isArray(rec.linkIds)
      ? rec.linkIds
      : rec.link !== undefined
        ? [rec.link]
        : Array.isArray(rec.links)
          ? rec.links
          : [];
    return {
      id,
      name: typeof rec.name === "string" ? rec.name : "",
      type: typeof rec.type === "string" ? rec.type : "*",
      localized:
        typeof rec.localized_name === "string" ? rec.localized_name : undefined,
      label: typeof rec.label === "string" ? rec.label : undefined,
      pos,
      linkIds: linkIdsRaw.map((n) => Number(n) || 0).filter((n) => n > 0),
    };
  };
  for (const p of rawSubInputs) {
    const np = normalizePin(p);
    if (np) {
      boundaryPins.inputs.push(np);
      for (const lid of np.linkIds) {
        pinIdByLinkId[lid] = { pinId: np.id, kind: "input" };
      }
    }
  }
  for (const p of rawSubOutputs) {
    const np = normalizePin(p);
    if (np) {
      boundaryPins.outputs.push(np);
      for (const lid of np.linkIds) {
        pinIdByLinkId[lid] = { pinId: np.id, kind: "output" };
      }
    }
  }

  return { boundaryPins, pinIdByLinkId };
}

/** Sentinel-bearing wire resolved to a boundary pin ↔ inner-node slot
 *  pair (client renders a React Flow edge from the pin's handle to the
 *  inner node's matching input/output handle). */
export interface BoundaryLink {
  linkId: number;
  kind: "input" | "output";
  pinId: string;
  innerNodeId: string;
  innerSlotName: string;
}

/**
 * Resolve the sentinel-link table collected up-front into a list of
 * `boundaryLinks` for the client.  Each entry maps one boundary-bearing
 * wire to the inner node's slot name on its end, so the React Flow edge
 * can targetHandle/sourceHandle correctly.
 */
export function buildBoundaryLinks(
  boundaryLinkInfoById: Record<number, BoundaryLinkInfo>,
  pinIdByLinkId: Record<number, { pinId: string; kind: "input" | "output" }>,
  inputNameByNodeSlot: Record<string, string[]>,
  /** 输出侧槽位表 —— 输出边界连线由别处组装，本函数只处理输入侧，保留参数以
   *  与调用方口径一致（不参与计算）。 */
  _outputNameByNodeSlot: Record<string, string[]>,
): BoundaryLink[] {
  const boundaryLinks: BoundaryLink[] = [];
  for (const [linkIdStr, info] of Object.entries(boundaryLinkInfoById)) {
    const linkId = Number(linkIdStr);
    const pinInfo = pinIdByLinkId[linkId];
    /* 暴露口没有登记这条边（或哨兵边没有对应的暴露口）→ 不产出边界连线。
     * 产出也会在客户端落成一条指向不存在 handle 的边（React Flow 丢弃整条边
     * 并打 error#008），不如在这里就不产出。 */
    if (!pinInfo || info.kind !== "input") continue;
    const innerSlotName =
      inputNameByNodeSlot[info.innerNodeId]?.[info.innerSlot] ?? "";
    /* 解析不出槽位名 → 整条边丢掉：handle id 只在这里产出，空槽位名到了画布上
     * 会退化成字面量 `"in"`，而那个 handle 并不存在（error#008 的成因）。
     * 丢掉的那条在下方 `reportDroppedBoundaryLinks` 里点名上报。 */
    if (!innerSlotName) continue;
    boundaryLinks.push({
      linkId,
      kind: info.kind,
      pinId: pinInfo.pinId,
      innerNodeId: info.innerNodeId,
      innerSlotName,
    });
  }
  return boundaryLinks;
}

/** 上报「想画但画不出来」的边界连线。
 *
 *  `buildBoundaryLinks` 会丢掉解析不出槽位名的哨兵边 —— 丢掉是对的（产出只会
 *  在画布上落一条指向不存在 handle 的边），但**不能悄无声息**：这条边的视觉表现
 *  是「这个暴露口从来没连上」，与「本来就没连」逐字相同，用户/排障者无从区分。
 *
 *  这里按「有哨兵边、却没能产出连线」的差集点名上报，带上足够对号的信息
 *  （暴露口 id、内层节点、槽位下标、该节点解析出的槽位表），一条边只报一次。 */
export function reportDroppedBoundaryLinks(
  sub: RawSubgraphDef,
  boundaryLinkInfoById: Record<number, BoundaryLinkInfo>,
  pinIdByLinkId: Record<number, { pinId: string; kind: "input" | "output" }>,
  produced: readonly BoundaryLink[],
): { linkId: number; pinId: string; innerNodeId: string; innerSlot: number }[] {
  const producedIds = new Set(produced.map((link) => link.linkId));
  const dropped: {
    linkId: number;
    pinId: string;
    innerNodeId: string;
    innerSlot: number;
  }[] = [];
  for (const [linkIdStr, info] of Object.entries(boundaryLinkInfoById)) {
    const linkId = Number(linkIdStr);
    if (producedIds.has(linkId)) continue;
    const pinInfo = pinIdByLinkId[linkId];
    /* 没有对应暴露口的哨兵边不是「丢线」——它从来就不该在画布上有一条连线。 */
    if (!pinInfo || info.kind !== "input") continue;
    dropped.push({
      linkId,
      pinId: pinInfo.pinId,
      innerNodeId: info.innerNodeId,
      innerSlot: info.innerSlot,
    });
  }
  if (dropped.length === 0) return dropped;
  const nodeIds = [...new Set(dropped.map((item) => item.innerNodeId))];
  const subgraphName =
    typeof sub.name === "string" && sub.name
      ? sub.name
      : typeof sub.id === "string"
        ? sub.id
        : "?";
  logger.warn(
    `[workflow] 子图 ${subgraphName} ` +
      `有 ${dropped.length} 条边界连线解析不出内层落点，已跳过绘制（不会画成指向不存在 handle 的边）：` +
      ` ${JSON.stringify(dropped)}；涉及节点 ${nodeIds.join(", ")}`,
  );
  return dropped;
}

/**
 * Inner group frames, note annotations and effective positions.
 *
 * Positions: raw.pos per node, layered with user-dragged positions from
 * `tplPositions` (the canvas editor's subgraph-view drag handler PATCHes
 * with merge:true, putting them in the same shared column).  User-dragged
 * positions win; stale keys not present in the subgraph are ignored; raw
 * positions are only seeded for nodes in this subgraph so neighbouring
 * subgraphs' positions can't leak in.
 *
 * `hostId` is the host-chain prefix the drag handler writes with
 * (`runtimeNodeId`, e.g. `4` or `4:5`).  The shared `positions` column keeps
 * subgraph inner nodes under `host:inner` keys, but this view's node ids are
 * the BARE inner ids — reading only bare keys silently discarded every drag
 * made inside a subgraph, so reopening always showed raw positions.  Both
 * spellings are accepted here (bare, for legacy/imported data).
 */
export function runtimeInnerId(key: string, hostId: string): string {
  if (!hostId) return "";
  const prefix = `${hostId}:`;
  if (!key.startsWith(prefix)) return "";
  const inner = key.slice(prefix.length);
  /* 只剥本层宿主链：`4:5:1670` 相对 `4` 属于更深一层，不是本视图的键。 */
  return inner && !inner.includes(":") ? inner : "";
}

export function extractSubgraphAnnotations(
  sub: RawSubgraphDef,
  tplPositions: Record<string, [number, number]>,
  hostId = "",
): {
  groups: {
    id: string;
    title: string;
    bounding: [number, number, number, number];
    color: string;
  }[];
  notes: {
    id: string;
    title: string;
    text: string;
    pos: [number, number];
    size: [number, number];
    color: string;
  }[];
  positions: Record<string, [number, number]>;
} {
  /* Inner group frames. */
  const groups: {
    id: string;
    title: string;
    bounding: [number, number, number, number];
    color: string;
  }[] = [];
  if (Array.isArray(sub.groups)) {
    sub.groups.forEach((g: unknown, idx: number) => {
      const rec = asRecord(g);
      if (!rec) return;

      const bounds: unknown[] =
        Array.isArray(rec.bounding) && rec.bounding.length >= 4
          ? rec.bounding
          : [0, 0, 0, 0];

      groups.push({
        id: toStringValue(rec.id ?? `g-${idx}`),
        title: typeof rec.title === "string" ? rec.title : "",
        bounding: [
          Number(bounds[0]) || 0,
          Number(bounds[1]) || 0,
          Number(bounds[2]) || 0,
          Number(bounds[3]) || 0,
        ],
        color: typeof rec.color === "string" ? rec.color : "#3b3b3b",
      });
    });
  }

  /* Inner note annotations. */
  const notes: {
    id: string;
    title: string;
    text: string;
    pos: [number, number];
    size: [number, number];
    color: string;
  }[] = [];
  const innerNodes: RawNode[] = Array.isArray(sub.nodes) ? sub.nodes : [];
  for (const n of innerNodes) {
    if (!n || (n.type !== "Note" && n.type !== "MarkdownNote")) continue;
    const pos = Array.isArray(n.pos) && n.pos.length >= 2 ? n.pos : [0, 0];
    const size =
      Array.isArray(n.size) && n.size.length >= 2 ? n.size : [220, 120];
    const wv = Array.isArray(n.widgets_values) ? n.widgets_values[0] : "";
    const text = typeof wv === "string" ? wv : toStringValue(wv ?? "");
    const title = typeof n.title === "string" ? n.title : "";
    notes.push({
      id: String(n.id),
      title,
      text,
      pos: [Number(pos[0]) || 0, Number(pos[1]) || 0],
      size: [Number(size[0]) || 220, Number(size[1]) || 120],
      color: typeof n.color === "string" ? n.color : "#3a3a3a",
    });
  }

  /* Positions: user-dragged overrides win over the raw (original) coords.
   *  Both `host:inner` and bare-inner key spellings are read — see the
   *  `hostId` note above. */
  const innerNodeIdSet = new Set(
    innerNodes.filter((rn) => rn?.id != null).map((rn) => String(rn.id)),
  );
  const draggedByInnerId: Record<string, [number, number]> = {};
  for (const [key, pos] of Object.entries(tplPositions)) {
    if (!Array.isArray(pos) || pos.length < 2) continue;
    const innerId = innerNodeIdSet.has(key) ? key : runtimeInnerId(key, hostId);
    if (!innerId || !innerNodeIdSet.has(innerId)) continue;
    draggedByInnerId[innerId] = [Number(pos[0]) || 0, Number(pos[1]) || 0];
  }
  const positions: Record<string, [number, number]> = {};
  for (const rn of innerNodes) {
    if (!rn?.id) continue;
    const id = String(rn.id);
    /* 用 `!== undefined` 而不是真值判断：坐标为 `[0,0]` 的对象仍然为真，
     *  但一旦写成 `[0, 0]` 的裸数组比较、或改成取单值时，0 会被当成「没有
     *  拖拽」，原始坐标又把用户拖到原点的节点盖回去。 */
    const dragged = draggedByInnerId[id];
    if (dragged !== undefined) {
      positions[id] = dragged;
      continue;
    }
    if (Array.isArray(rn.pos) && rn.pos.length >= 2) {
      positions[id] = [Number(rn.pos[0]) || 0, Number(rn.pos[1]) || 0];
    }
  }

  return { groups, notes, positions };
}
