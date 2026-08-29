/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
/**
 * Subgraph (inner workflow) parsing helpers — extracted from
 * workflow-detail.ts (T12 batch 4).
 *
 * These pure functions turn a `definitions.subgraphs[uid]` definition into
 * the API graph, node metadata, boundary pins and annotations the subgraph
 * detail builder serves.  All are free of I/O (positions overlay is passed
 * in), so the caller can cache the serialized result.
 */
import { pairWidgetValues } from "@/lib/comfyui/raw";
import { inferIsMultiline } from "@/lib/comfyui/types";

/* IMAGE-input thumbnail preview (2026-08-10 R27, narrowed in R28).
 * Mirrors the parent route.  We surface the LoadImage upstream filename as
 * a synthetic `preview`-marked entry on the LoadImage node itself; we do
 * NOT propagate `imageRef` to downstream IMAGE inputs (ImageScale /
 * CLIPVisionEncode / …) since those would only show the un-scaled /
 * un-encoded upstream image — meaningless, per 2026-08-10 user feedback.
 * Empty LoadImage uploads (widgets_values[0] missing/empty) still push
 * the synthetic entry so the body can show a 「需要上传图片」 placeholder. */
const LOAD_IMAGE_NODE_TYPES = new Set([
  "LoadImage", "LoadImageMasked", "ComfyUI LoadImage", "ComfyUI-LoadImage",
  "Load Image", "ImageLoader", "ComfyUI-ImageLoader",
]);

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
 * 2026-08-06: We additionally record every sentinel-bearing link in
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
export function parseSubgraphLinks(sub: any): {
  linkById: Record<number, SubgraphLinkEntry>;
  boundaryLinkInfoById: Record<number, BoundaryLinkInfo>;
} {
  const linkById: Record<number, SubgraphLinkEntry> = {};
  const boundaryLinkInfoById: Record<number, BoundaryLinkInfo> = {};

  for (const lk of Array.isArray(sub.links) ? sub.links : []) {
    if (!lk || typeof lk !== "object") continue;
    const id = Number((lk).id);
    if (!Number.isFinite(id)) continue;
    const originId = Number((lk).origin_id);
    const originSlot = Number((lk).origin_slot) || 0;
    const targetId = Number((lk).target_id);
    const targetSlot = Number((lk).target_slot) || 0;
    const type = String((lk).type ?? "*");
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

/**
 * Pre-pass: collect per-node input/output slot-name lookups (positional
 * index → slot name).  These are needed to translate a sentinel link's
 * `target_slot` / `origin_slot` integer into the inner node's slot
 * *name* (which becomes the React Flow edge's targetHandle /
 * sourceHandle).  Modern ComfyUI puts an `idx` on each slot entry;
 * older versions fall back to array order (idx=0,1,2,...). */
export function parseSubgraphSlots(sub: any): {
  inputNameByNodeSlot: Record<string, string[]>;
  outputNameByNodeSlot: Record<string, string[]>;
  inputWidgetValueByNodeSlot: Record<string, any[]>;
} {
  const inputNameByNodeSlot: Record<string, string[]> = {};
  const outputNameByNodeSlot: Record<string, string[]> = {};
  /** Per-node lookup of a raw input/output index → widget value (for
   *  inputs that *also* have boundary wires, e.g. CLIPTextEncode's text). */
  const inputWidgetValueByNodeSlot: Record<string, any[]> = {};

  const innerNodes = Array.isArray(sub.nodes) ? sub.nodes : [];
  for (const rn of innerNodes) {
    if (!rn?.id) continue;
    const nodeId = String(rn.id);
    if (Array.isArray(rn.inputs)) {
      const sorted = [...rn.inputs].sort(
        (a: any, b: any) => (a?.idx ?? 0) - (b?.idx ?? 0)
      );
      inputNameByNodeSlot[nodeId] = sorted.map(
        (x: any) => (typeof x?.name === "string" ? x.name : "")
      );
      // Snapshot widget values aligned with slot order so the boundary
      // pass can also surface a default `value` (CLIPTextEncode's `text`
      // sits here when the wrapper exposes the prompt as an input).
      inputWidgetValueByNodeSlot[nodeId] = sorted.map((x: any, i: number) => {
        if (!x || typeof x.name !== "string") return undefined;
        if (!x.widget) return undefined;
        const wv = Array.isArray(rn.widgets_values) ? rn.widgets_values : [];
        return wv[i];
      });
    }
    if (Array.isArray(rn.outputs)) {
      const sorted = [...rn.outputs].sort(
        (a: any, b: any) => (a?.idx ?? 0) - (b?.idx ?? 0)
      );
      outputNameByNodeSlot[nodeId] = sorted.map(
        (x: any) => (typeof x?.name === "string" ? x.name : "")
      );
    }
  }

  return { inputNameByNodeSlot, outputNameByNodeSlot, inputWidgetValueByNodeSlot };
}

export interface SubgraphGraphResult {
  graph: Record<string, any>;
  rawInputsById: Record<string, any[]>;
  rawOutputsById: Record<string, any[]>;
  rawNodeMeta: { id: string; widgets_values: any[]; outputs: any[]; flags: Record<string, any>; mode: number }[];
  sizeById: Record<string, [number, number]>;
  nodes: any[];
  inputEndpointNodes: Set<string>;
  outputEndpointNodes: Set<string>;
  boundaryInputByNode: Record<string, { name: string; type: string; value: any }>;
  boundaryOutputByNode: Record<string, { name: string; type: string }>;
  connectsToByNode: Record<string, string>;
  connectsFromByNode: Record<string, string>;
  /** Per-node slot-name lookups (positional index → slot name), surfaced
   *  for the caller to assemble boundaryLinks. */
  inputNameByNodeSlot: Record<string, string[]>;
  outputNameByNodeSlot: Record<string, string[]>;
}

/**
 * Walk each inner node and produce an API-style graph entry plus the
 * `nodes` array (consumed by the canvas as a flat list of ComfyGraphNode
 * entries).  Boundary endpoint nodes are stamped with
 * `is_input_endpoint` / `is_output_endpoint` (2026-08-05) so the client
 * can draw INPUTS / OUTPUTS wfGroup rectangles without re-walking the
 * link table.
 */
export function buildSubgraphGraph(
  sub: any,
  linkById: Record<number, SubgraphLinkEntry>
): SubgraphGraphResult {
  const innerNodes = Array.isArray(sub.nodes) ? sub.nodes : [];
  const graph: Record<string, any> = {};
  const rawInputsById: Record<string, any[]> = {};

  const rawOutputsById: Record<string, any[]> = {};
  /* Exact ComfyUI box size ([w, h]) per inner node — forwarded so the
   *  inner-canvas nodes match their imported config dimensions.  Pulled
   *  from the raw inner-node JSON (sub.nodes), since the synthetic `graph`
   *  map below only keeps class_type + inputs. */
  const sizeById: Record<string, [number, number]> = {};
  const rawNodeMeta: { id: string; widgets_values: any[]; outputs: any[]; flags: Record<string, any>; mode: number }[] = [];
  /* Boundary node-id collectors — populated as we walk nodes + links so
   * the client can mark "this node is on the inputs/outputs boundary of
   * the subgraph" without re-doing the link scan.  A node is considered
   * an INPUT endpoint when one of its inputs is fed by the sentinel
   * `-10` source (subgraph exposed input → inner consumer); likewise an
   * OUTPUT endpoint is one whose output is the sentinel `-20` target
   * (inner producer → subgraph exposed output).
   *
   * 2026-08-06: We keep populating these for diagnostic reasons but no
   * longer depend on them in the client.  The boundary PINS themselves
   * (defined in `sub.inputs` and `sub.outputs`) carry their own ids and
   * positions; emitting them via the new top-level `boundaryPins` field
   * is the right way to render the inner-canvas IO rails.  We also keep
   * `boundaryInputByNode` / `boundaryOutputByNode` for the legacy
   * `boundary_input` / `boundary_output` debug fields, but the client
   * ignores them now. */
  const inputEndpointNodes = new Set<string>();
  const outputEndpointNodes = new Set<string>();
  const boundaryInputByNode: Record<string, { name: string; type: string; value: any }> = {};
  const boundaryOutputByNode: Record<string, { name: string; type: string }> = {};
  const connectsToByNode: Record<string, string> = {};
  const connectsFromByNode: Record<string, string> = {};

  const { inputNameByNodeSlot, outputNameByNodeSlot } = parseSubgraphSlots(sub);

  for (const rn of innerNodes) {
    if (!rn?.id) continue;
    const nodeId = String(rn.id);
    const classType: string = rn.type ?? "?";
    /* Capture the raw litegraph box size so the client can paint the node
     *  at its exact ComfyUI dimensions (see `sizeById` declaration above). */
    const rnSize = Array.isArray((rn).size) && (rn).size.length >= 2 ? (rn).size : undefined;
    if (rnSize) sizeById[nodeId] = [Number(rnSize[0]) || 0, Number(rnSize[1]) || 0];

    /* Per-input metadata.  We tag a connection as "internal" (originates
     * from another node inside the subgraph) vs "boundary" (originates
     * from the input sentinel node -10, meaning the value comes from
     * the parent wrapper).  Boundary connections are still recorded as
     * isConnection for UI labelling but skipped when writing inputMap
     * so the value isn't bound to a sentinel source. */
    const rawInputs: any[] = [];
    const inputMap: Record<string, any> = {};
    if (Array.isArray(rn.inputs)) {
      const rnWidgets = Array.isArray((rn).widgets_values) ? (rn).widgets_values : [];
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
        const widgetName = inp.widget && typeof inp.widget.name === "string" ? inp.widget.name : undefined;
        const widgetValue = widgetName ? wvMap[widgetName] : undefined;
        const entry: {
          name: string;
          imageRef?: { filename: string; subfolder: string; type: string };
          preview?: boolean;
          label?: string;
          localized?: string;
          type: string;
          isConnection: boolean;
          isBoundary: boolean;
          widget?: { name: string };
          widgetValue?: unknown;
          multiline?: boolean;
        } = {
          name: inp.name,
          label: typeof inp.label === "string" ? inp.label : undefined,
          localized: typeof inp.localized_name === "string" ? inp.localized_name : undefined,
          type: typeof inp.type === "string" ? inp.type : isConn ? "*" : "STRING",
          /* Mark boundary wires (origin_id = -10/-20) as "isBoundary" so
           *  the canvas can render them as a wrapper-exposed input (still
           *  a connection, but no real source node inside the subgraph). */
          isConnection: isConn,
          isBoundary: false, // set later if needed
        };
        if (widgetName) entry.widget = { name: widgetName };
        if (widgetValue !== undefined) entry.widgetValue = widgetValue;
        /* R18 parity: stamp `multiline` on STRING inputs the helper flags,
         *  so short prompt inputs don't degrade to one-line chips.
         *
         *  2026-08-10 R28: removed the IMAGE-input `imageRef` propagation
         *  for the same reason as the parent route — downstream IMAGE
         *  consumers would only re-display the un-scaled / un-encoded
         *  upstream image, which is misleading.  Only the LoadImage
         *  source node gets a preview (synthetic entry pushed below). */
        if (typeof inp.type === "string" && inp.type === "STRING" && widgetValue !== undefined) {
          if (inferIsMultiline(rn.type, inp.name, widgetValue)) entry.multiline = true;
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
            /* Mark this node as an INPUT endpoint (2026-08-05): the
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
            if (!connectsFromByNode[nodeId]) connectsFromByNode[nodeId] = lk?.src ?? "";
          }
        } else if (widgetValue !== undefined) {
          // Fold the corresponding widget value into inputs[] (API form).
          inputMap[inp.name] = widgetValue;
        }
      }
    }

    graph[nodeId] = { class_type: classType, inputs: inputMap };

    /* Per-output metadata. */
    const rawOutputs: any[] = [];
    if (Array.isArray(rn.outputs)) {
      for (const o of rn.outputs) {
        if (!o || typeof o.name !== "string") continue;
        /* Mark OUTPUT endpoint nodes (2026-08-05): if any link from this
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
            if (target && target !== "-10" && target !== "-20" && !connectsToByNode[nodeId]) {
              connectsToByNode[nodeId] = target;
            }
          }
        }
        rawOutputs.push({
          name: o.name,
          localized: typeof o.localized_name === "string" ? o.localized_name : undefined,
          type: typeof o.type === "string" ? o.type : "*",
          links: Array.isArray(o.links) ? o.links.map((n: any) => Number(n) || 0) : [],
          isBoundary: isBoundaryOut,
        });
      }
    }

    if (rn.type !== "Note" && rn.type !== "MarkdownNote") {
      /* LoadImage family: synthesise a `preview: true` image entry so the
       * canvas paints the uploaded thumbnail (or 「需要上传图片」 placeholder
       * when empty) on the LoadImage node itself.  ComfyUI shows the
       * thumbnail there, not on downstream consumers — per 2026-08-10 R28
       * we no longer propagate imageRef downstream because the un-scaled /
       * un-encoded back-reference rendering was misleading.
       *
       * 2026-08-10 R28: ALWAYS push for LoadImage-family, regardless of
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
              ? { imageRef: { filename: fname, subfolder: "", type: "input" as const } }
              : {}),
          });
        }
      }
      rawInputsById[nodeId] = rawInputs;
      rawOutputsById[nodeId] = rawOutputs;
      rawNodeMeta.push({
        id: nodeId,
        widgets_values: Array.isArray(rn.widgets_values) ? rn.widgets_values : [],
        outputs: rawOutputs,
        flags: rn && typeof rn.flags === "object" && rn.flags !== null ? (rn.flags as Record<string, any>) : {},
        mode: typeof (rn).mode === "number" ? (rn).mode : 0,
      });
    }
  }

  /* Build the `nodes` array (consumed by the canvas as a flat list of
   *  ComfyGraphNode entries).  We also stamp each node with
   *  `is_input_endpoint` / `is_output_endpoint` (2026-08-05) so the
   *  client can draw INPUTS / OUTPUTS wfGroup rectangles around the
   *  two clusters without re-walking the link table. */
  const nodes = Object.entries(graph).map(([nodeId, n]) => {
    // Same class_type / type fallback as the parent route — newer ComfyUI
    // exports put the class name in `class_type`, but older / rgthree-comfy
    // exports use `type` only.  Without this fallback subgraph wrappers
    // come back with classType="?" and `is_subgraph: false`, so the
    // inner canvas paints them as full WorkflowNodes instead of compact
    // WorkflowSubgraphNode chips.
    const classType: string =
      (n?.class_type as string) || (n?.type as string) || "?";
    const isUuidClass = /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(classType);
    const isInEp = inputEndpointNodes.has(nodeId);
    const isOutEp = outputEndpointNodes.has(nodeId);
    return {
      id: nodeId,
      class_type: classType,
      title: n?._meta?.title ?? (isUuidClass ? "" : classType) ?? nodeId,
      is_subgraph: isUuidClass,
      raw_inputs: rawInputsById[nodeId] ?? [],
      is_input_endpoint: isInEp,
      is_output_endpoint: isOutEp,
      /* Exact ComfyUI box size ([w, h]) for this inner node.  Undefined
       *  when the subgraph definition carries no per-node size (rare). */
      size: sizeById[nodeId],
      /* Boundary port details for wfIoPort rendering (2026-08-05 v3).
       *  The client renders IO endpoint nodes as compact label-only
       *  items on the LEFT (input) / RIGHT (output) of the inner canvas.
       *  Without these fields the canvas can't show the port name and
       *  default value (e.g. "noise_seed  41"). */
      boundary_input: isInEp ? boundaryInputByNode[nodeId] ?? null : null,
      boundary_output: isOutEp ? boundaryOutputByNode[nodeId] ?? null : null,
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
 * 2026-08-06: Each pin is a first-class entity with its own UUID (`id`),
 * slot name (`name`), type, optional human label, saved position, and one
 * or more `linkIds` (the cross-boundary wire(s) feeding into / out of an
 * inner node).  Also builds the inverse `pinIdByLinkId` map used to
 * resolve the sentinel-link table into `boundaryLinks`.
 */
export function parseSubgraphPins(sub: any): {
  boundaryPins: { inputs: BoundaryPin[]; outputs: BoundaryPin[] };
  pinIdByLinkId: Record<number, { pinId: string; kind: "input" | "output" }>;
} {
  const boundaryPins: { inputs: BoundaryPin[]; outputs: BoundaryPin[] } = {
    inputs: [],
    outputs: [],
  };
  const pinIdByLinkId: Record<number, { pinId: string; kind: "input" | "output" }> = {};
  const rawSubInputs = Array.isArray(sub.inputs) ? sub.inputs : [];
  const rawSubOutputs = Array.isArray(sub.outputs) ? sub.outputs : [];

  const normalizePin = (p: any): BoundaryPin | null => {
    if (!p || typeof p !== "object") return null;
    const id = typeof (p).id === "string" ? (p).id : "";
    if (!id) return null;
    const posRaw = Array.isArray((p).pos) ? (p).pos : [0, 0];
    const pos: [number, number] = [
      Number(posRaw[0]) || 0,
      Number(posRaw[1]) || 0,
    ];
    const linkIdsRaw = Array.isArray((p).linkIds)
      ? (p).linkIds
      : (p).link !== undefined
      ? [(p).link]
      : Array.isArray((p).links)
      ? (p).links
      : [];
    return {
      id,
      name: typeof (p).name === "string" ? (p).name : "",
      type: typeof (p).type === "string" ? (p).type : "*",
      localized: typeof (p).localized_name === "string" ? (p).localized_name : undefined,
      label: typeof (p).label === "string" ? (p).label : undefined,
      pos,
      linkIds: linkIdsRaw.map((n: any) => Number(n) || 0).filter((n: number) => n > 0),
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
  outputNameByNodeSlot: Record<string, string[]>
): {
  linkId: number;
  kind: "input" | "output";
  pinId: string;
  innerNodeId: string;
  innerSlotName: string;
}[] {
  const boundaryLinks: {
    linkId: number;
    kind: "input" | "output";
    pinId: string;
    innerNodeId: string;
    innerSlotName: string;
  }[] = [];
  for (const [linkIdStr, info] of Object.entries(boundaryLinkInfoById)) {
    const linkId = Number(linkIdStr);
    const pinInfo = pinIdByLinkId[linkId];
    if (!pinInfo) continue; // orphan sentinel link — skip
    const slotNames =
      info.kind === "input"
        ? inputNameByNodeSlot[info.innerNodeId]
        : outputNameByNodeSlot[info.innerNodeId];
    const innerSlotName = slotNames?.[info.innerSlot] ?? "";
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

/**
 * Inner group frames, note annotations and effective positions.
 *
 * Positions: raw.pos per node, layered with user-dragged positions from
 * `tplPositions` (the canvas editor's subgraph-view drag handler PATCHes
 * with merge:true, putting them in the same shared column).  User-dragged
 * positions win; stale keys not present in the subgraph are ignored; raw
 * positions are only seeded for nodes in this subgraph so neighbouring
 * subgraphs' positions can't leak in.
 */
export function extractSubgraphAnnotations(
  sub: any,
  tplPositions: Record<string, [number, number]>
): {
  groups: { id: string; title: string; bounding: [number, number, number, number]; color: string }[];
  notes: { id: string; title: string; text: string; pos: [number, number]; size: [number, number]; color: string }[];
  positions: Record<string, [number, number]>;
} {
  /* Inner group frames. */
  const groups: { id: string; title: string; bounding: [number, number, number, number]; color: string }[] = [];
  if (Array.isArray(sub.groups)) {
    sub.groups.forEach((g: any, idx: number) => {

      if (!g) return;

      const bounds = Array.isArray(g.bounding) && g.bounding.length >= 4 ? g.bounding : [0, 0, 0, 0];

      groups.push({

        id: String(g.id ?? `g-${idx}`),

        title: typeof g.title === "string" ? g.title : "",

        bounding: [Number(bounds[0]) || 0, Number(bounds[1]) || 0, Number(bounds[2]) || 0, Number(bounds[3]) || 0],

        color: typeof g.color === "string" ? g.color : "#3b3b3b",

      });

    });
  }

  /* Inner note annotations. */
  const notes: { id: string; title: string; text: string; pos: [number, number]; size: [number, number]; color: string }[] = [];
  const innerNodes = Array.isArray(sub.nodes) ? sub.nodes : [];
  for (const n of innerNodes) {
    if (!n || (n.type !== "Note" && n.type !== "MarkdownNote")) continue;
    const pos = Array.isArray(n.pos) && n.pos.length >= 2 ? n.pos : [0, 0];
    const size = Array.isArray(n.size) && n.size.length >= 2 ? n.size : [220, 120];
    const wv = Array.isArray(n.widgets_values) ? n.widgets_values[0] : "";
    const text = typeof wv === "string" ? wv : String(wv ?? "");
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

  /* Positions: raw.pos per node, layered with user-dragged positions
   *  from `tpl.positions`. */
  const positions: Record<string, [number, number]> = {};
  const innerNodeIdSet = new Set(innerNodes.filter((rn: any) => rn?.id != null).map((rn: any) => String(rn.id)));
  for (const [id, pos] of Object.entries(tplPositions)) {
    if (innerNodeIdSet.has(id) && Array.isArray(pos) && pos.length >= 2) {
      positions[id] = [Number(pos[0]) || 0, Number(pos[1]) || 0];
    }
  }
  for (const rn of innerNodes) {
    if (!rn?.id) continue;
    const id = String(rn.id);
    if (positions[id]) continue; // user drag wins
    if (Array.isArray(rn.pos) && rn.pos.length >= 2) {
      positions[id] = [Number(rn.pos[0]) || 0, Number(rn.pos[1]) || 0];
    }
  }

  return { groups, notes, positions };
}
