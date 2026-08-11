import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getServerUser } from "@/lib/auth-server";
import { cacheJson, cachePeek } from "@/lib/server-cache";
import { inferIsMultiline } from "@/lib/comfyui/types";
import { pairWidgetValues } from "@/lib/comfyui/raw";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUBGRAPH_CACHE_HEADERS = {
  "Cache-Control": "private, max-age=120",
} as const;

/* Look up a subgraph embedded inside a workflow's rawJson.definitions.subgraphs
 * by its UUID, then return it in the same WorkflowDetail shape the top-level
 * /api/workflows/[id] returns, so the canvas editor can swap `detail` and
 * render the inner graph without any special casing.
 *
 * The subgraph definition shape (from ComfyUI's raw JSON):
 *   {
 *     id: <UUID>,         // matches the wrapper node's class_type
 *     name: "Text to Image(...)",
 *     nodes: [...],       // inner graph nodes, same shape as raw.nodes[i]
 *     links: [...],       // inner link table
 *     groups: [...],      // inner group frames
 *     inputs:  [{ name, type, localized_name?, label? }, ...],   // exposed
 *     outputs: [{ name, type, localized_name?, label? }, ...],
 *     widgets: [{ name, type, value }, ...],
 *   }
 *
 * We build a synthetic API-style `graph` for the inner nodes by:
 *   1. reading the link table to resolve each [srcId, slot] connection
 *      referenced from a target node's input.link (ComfyUI's raw format
 *      uses link ids, not direct [src, slot] tuples),
 *   2. folding the widgets_values into inputs by widget.name (raw format
 *      separates inputs[] and widgets_values[] while API format mixes
 *      them). */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getServerUser();
  const uid = req.nextUrl.searchParams.get("uid");
  if (!uid) {
    return NextResponse.json({ error: "缺少子工作流 uid" }, { status: 400 });
  }
  const cacheKey = `sg:${user.id}:${id}:${uid}`;

  /* Hot path: return the pre-serialized subgraph detail verbatim, skipping
   * the Prisma read + transform.  (Never cached: 400/404 cases below.) */
  const cached = cachePeek<string>(cacheKey);
  if (cached !== undefined && typeof cached === "string") {
    return new NextResponse(cached, {
      status: 200,
      headers: { "Content-Type": "application/json", ...SUBGRAPH_CACHE_HEADERS },
    });
  }

  const tpl = await prisma.workflowTemplate.findFirst({
    where: { id, userId: user.id },
    select: { id: true, name: true, taskType: true, graph: true, rawJson: true, positions: true, paramMap: true },
  });
  if (!tpl) return NextResponse.json({ error: "未找到该工作流" }, { status: 404 });

  const raw = (tpl.rawJson ?? null) as any;
  if (!raw || !raw.definitions || !raw.definitions.subgraphs) {
    return NextResponse.json({ error: "该工作流没有内嵌子工作流" }, { status: 404 });
  }
  // Subgraph definitions may be keyed by either the UUID or a numeric id;
  // ComfyUI uses the UUID as the key for newer workflows.
  const subgraphs = raw.definitions.subgraphs;
  let sub = subgraphs[uid];
  if (!sub) {
    // Try matching by .id field
    const matchUid = Object.keys(subgraphs).find((k) => subgraphs[k]?.id === uid);
    if (matchUid) sub = subgraphs[matchUid];
  }
  if (!sub) {
    return NextResponse.json({ error: `未找到子工作流 ${uid.slice(0, 8)}` }, { status: 404 });
  }

  /* The subgraph transform depends only on tpl.rawJson (immutable between
   * writes), so we cache the already-serialized JSON string by user+id+uid.
   * TTL is longer than the top-level detail because subgraphs change even
   * less often. */
  const detailJson = await cacheJson(cacheKey, 120_000, () => {
  /* Build a link-id → {src, slot, type, targetId, targetSlot} lookup so we
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
  const linkById: Record<number, { src: string; slot: number; type: string; targetId: string; targetSlot: number }> = {};
  const boundaryLinkInfoById: Record<number, {
    kind: "input" | "output";
    pinId: string;
    /** Inner-node side: source for output-boundary links, target for
     *  input-boundary links. */
    innerNodeId: string;
    innerSlot: number;
    innerSlotName?: string;
  }> = {};
  /* Pre-resolve which inner slot name (if any) lines up with a given
   *  input/output index — used to attach a `targetHandle` / `sourceHandle`
   *  name to the resulting React Flow edge so it lands on the right
   *  WfNode handle. */
  const inputSlotNameByNode: Record<string, string[]> = {};
  const outputSlotNameByNode: Record<string, string[]> = {};
  const innerRawInputsByNode: Record<string, any[]> = {};
  const innerRawOutputsByNode: Record<string, any[]> = {};

  for (const lk of Array.isArray(sub.links) ? sub.links : []) {
    if (!lk || typeof lk !== "object") continue;
    const id = Number((lk as any).id);
    if (!Number.isFinite(id)) continue;
    const originId = Number((lk as any).origin_id);
    const originSlot = Number((lk as any).origin_slot) || 0;
    const targetId = Number((lk as any).target_id);
    const targetSlot = Number((lk as any).target_slot) || 0;
    const type = String((lk as any).type ?? "*");
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

  /* Walk each inner node and produce an API-style graph entry. */
  const graph: Record<string, any> = {};
  const rawInputsById: Record<string, any[]> = {};
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
  const innerNodeById: Record<string, { type: string; widgets_values: any[] }> = {};
  for (const nd of Array.isArray((sub as any).nodes) ? (sub as any).nodes : []) {
    if (!nd || nd.id == null) continue;
    innerNodeById[String(nd.id)] = {
      type: typeof nd.type === "string" ? nd.type : "?",
      widgets_values: Array.isArray(nd.widgets_values) ? nd.widgets_values : [],
    };
  }
  function resolveImageRef(link: any): { filename: string; subfolder: string; type: string } | null {
    if (link == null) return null;
    const lk = linkById[Number(link)];
    if (!lk || lk.src === "-10" || lk.src === "-20") return null;
    const src = innerNodeById[lk.src];
    if (!src || !LOAD_IMAGE_NODE_TYPES.has(src.type)) return null;
    const fname = src.widgets_values?.[0];
    if (typeof fname !== "string" || fname.length === 0) return null;
    return { filename: fname, subfolder: "", type: "input" };
  }

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

  /* Per-node slot-name lookups.  Modern ComfyUI pins an `idx` on each
   * input/output; missing values use array order.  We sort by `idx`
   * once here so the boundaryLink pass can resolve a sentinel link's
   * `target_slot` / `origin_slot` integer into the actual slot *name*
   * (the inner RandomNoise has `noise_seed` at target_slot 0 because
   * it's the only input). */
  const inputNameByNodeSlot: Record<string, string[]> = {};
  const outputNameByNodeSlot: Record<string, string[]> = {};
  /** Per-node lookup of a raw input/output index → widget value (for
   *  inputs that *also* have boundary wires, e.g. CLIPTextEncode's text). */
  const inputWidgetValueByNodeSlot: Record<string, (any | undefined)[]> = {};
  /** Inverse: linkId → boundary_pin_id resolved after we walk the
   *  subgraph's input/output definitions. */
  const pinIdByLinkId: Record<number, { pinId: string; kind: "input" | "output" }> = {};
  /* Boundary ↔ inner-node wiring to surface to the client.  Each entry
   * maps one sentinel-bearing link to the inner node + slot it lands on
   * (or leaves from). */
  const boundaryLinks: {
    linkId: number;
    kind: "input" | "output";
    pinId: string;
    innerNodeId: string;
    innerSlotName: string;
  }[] = [];

  const innerNodes = Array.isArray(sub.nodes) ? sub.nodes : [];
  /* Pre-pass: collect per-node input/output slot-name lookups (positional
   * index → slot name).  These are needed to translate a sentinel link's
   * `target_slot` / `origin_slot` integer into the inner node's slot
   * *name* (which becomes the React Flow edge's targetHandle /
   * sourceHandle).  Modern ComfyUI puts an `idx` on each slot entry;
   * older versions fall back to array order (idx=0,1,2,...). */
  for (const rn of innerNodes) {
    if (!rn || !rn.id) continue;
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
  for (const rn of innerNodes) {
    if (!rn || !rn.id) continue;
    const nodeId = String(rn.id);
    const classType: string = rn.type ?? "?";
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(classType);
    /* Capture the raw litegraph box size so the client can paint the node
     *  at its exact ComfyUI dimensions (see `sizeById` declaration above). */
    const rnSize = Array.isArray((rn as any).size) && (rn as any).size.length >= 2 ? (rn as any).size : undefined;
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
      const rnWidgets = Array.isArray((rn as any).widgets_values) ? (rn as any).widgets_values : [];
      /* Sentinel-aware pairing: ComfyUI inserts a `control_after_generate`
       *  slot into `widgets_values` right after a seed-type INT widget, so
       *  a naive index match would shift every later widget by one.  Use the
       *  shared helper (mirrors `resolveWidgetOrder`) to map widget-name →
       *  value.  This is what makes inner-node widgets (KSampler seed/steps/
       *  cfg/sampler/scheduler/denoise, CLIPTextEncode's prompt, …) show
       *  their real values instead of blank/offset rows. */
      const wvMap = pairWidgetValues(rn.inputs as any, rnWidgets);
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
            if (!connectsFromByNode[nodeId]) connectsFromByNode[nodeId] = lk.src;
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
              if (!boundaryOutputByNode[nodeId]) {
                boundaryOutputByNode[nodeId] = {
                  name: o.name,
                  type: typeof o.type === "string" ? o.type : "*",
                };
              }
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
       * — it's consumed exclusively by <WfImagePreview>. */
      if (LOAD_IMAGE_NODE_TYPES.has(classType)) {
        if (!rawInputs.some((e) => e.preview)) {
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
        mode: typeof (rn as any).mode === "number" ? (rn as any).mode : 0,
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
    // inner canvas paints them as full WfNodes instead of compact
    // WfSubgraphNode chips.
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

  /* Inner group frames. */
  const groups: { id: string; title: string; bounding: [number, number, number, number]; color: string }[] = [];
  if (Array.isArray(sub.groups)) {
    sub.groups.forEach((g: any, idx: number) => {
      if (!g) return;
      const b = Array.isArray(g.bounding) && g.bounding.length >= 4 ? g.bounding : [0, 0, 0, 0];
      groups.push({
        id: String(g.id ?? `g-${idx}`),
        title: typeof g.title === "string" ? g.title : "",
        bounding: [Number(b[0]) || 0, Number(b[1]) || 0, Number(b[2]) || 0, Number(b[3]) || 0],
        color: typeof g.color === "string" ? g.color : "#3b3b3b",
      });
    });
  }

  /* Inner note annotations. */
  const notes: { id: string; title: string; text: string; pos: [number, number]; size: [number, number]; color: string }[] = [];
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
   *  from `tpl.positions`.
   *
   *  rawJson.definitions.subgraphs[uid].nodes[i].pos carries the
   *  ComfyUI-side coordinates for each inner node.  These are the
   *  authoritative "as imported" positions.  The top-level
   *  `tpl.positions` column also stores positions for inner nodes
   *  (because the canvas editor's subgraph-view drag handler PATCHes
   *  with merge:true, putting them in the same shared column), and
   *  those should override the raw values for any node the user has
   *  explicitly dragged.
   *
   *  Stale keys in `tpl.positions` (e.g. top-level graph node ids that
   *  aren't part of this subgraph) are simply ignored — we only
   *  overlay keys whose id exists in `innerNodes`.  Symmetrically, we
   *  only seed raw-positions for nodes present in this subgraph, so
   *  neighbouring subgraphs' positions can't leak in. */
  const positions: Record<string, [number, number]> = {};
  const innerNodeIdSet = new Set(innerNodes.filter((rn: any) => rn && rn.id != null).map((rn: any) => String(rn.id)));
  const tplPositions = (tpl.positions as Record<string, [number, number]>) ?? {};
  for (const [id, pos] of Object.entries(tplPositions)) {
    if (innerNodeIdSet.has(id) && Array.isArray(pos) && pos.length >= 2) {
      positions[id] = [Number(pos[0]) || 0, Number(pos[1]) || 0];
    }
  }
  for (const rn of innerNodes) {
    if (!rn || !rn.id) continue;
    const id = String(rn.id);
    if (positions[id]) continue; // user drag wins
    if (Array.isArray(rn.pos) && rn.pos.length >= 2) {
      positions[id] = [Number(rn.pos[0]) || 0, Number(rn.pos[1]) || 0];
    }
  }

  /* ── Boundary pins (2026-08-06) ──
   *
   *  Each subgraph exposes a list of IO pins via `sub.inputs` /
   *  `sub.outputs`.  Each entry has its own UUID (`id`), slot name
   *  (`name`), type, optional human label, saved position, and one
   *  or more `linkIds` (the cross-boundary wire(s) feeding into /
   *  out of an inner node).  In the previous (wrong) v3 design we
   *  treated every inner node that consumed / produced a boundary
   *  wire as the "endpoint" — but the boundary pins are first-class
   *  entities in their own right, with their own IDs and positions.
   *  For the user's NOISE subgraph this fix is the difference
   *  between "no middle cards, all nodes collapse onto one column"
   *  and the desired "ten full RandomNoise cards in the centre,
   *  with 10 input-pin labels on the left and 10 output-pin labels
   *  on the right" (the reference Image 3).
   */
  type BoundaryPin = {
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
  };
  const boundaryPins: { inputs: BoundaryPin[]; outputs: BoundaryPin[] } = {
    inputs: [],
    outputs: [],
  };
  const rawSubInputs = Array.isArray(sub.inputs) ? sub.inputs : [];
  const rawSubOutputs = Array.isArray(sub.outputs) ? sub.outputs : [];

  const normalizePin = (p: any): BoundaryPin | null => {
    if (!p || typeof p !== "object") return null;
    const id = typeof (p as any).id === "string" ? (p as any).id : "";
    if (!id) return null;
    const posRaw = Array.isArray((p as any).pos) ? (p as any).pos : [0, 0];
    const pos: [number, number] = [
      Number(posRaw[0]) || 0,
      Number(posRaw[1]) || 0,
    ];
    const linkIdsRaw = Array.isArray((p as any).linkIds)
      ? (p as any).linkIds
      : (p as any).link !== undefined
      ? [(p as any).link]
      : Array.isArray((p as any).links)
      ? (p as any).links
      : [];
    return {
      id,
      name: typeof (p as any).name === "string" ? (p as any).name : "",
      type: typeof (p as any).type === "string" ? (p as any).type : "*",
      localized: typeof (p as any).localized_name === "string" ? (p as any).localized_name : undefined,
      label: typeof (p as any).label === "string" ? (p as any).label : undefined,
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

  /* Now resolve the sentinel-link table we collected up-front into a
   *  list of `boundaryLinks` for the client.  Each entry maps one
   *  boundary-bearing wire to the inner node's slot name on its end,
   *  so the React Flow edge can targetHandle/sourceHandle correctly. */
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

  return JSON.stringify({
    id: `${tpl.id}#subgraph:${uid}`,
    name: typeof sub.name === "string" && sub.name ? sub.name : "子工作流",
    taskType: tpl.taskType,
    graph,
    nodes,
    paramMap: tpl.paramMap ?? {},
    positions,
    groups,
    notes,
    rawNodes: rawNodeMeta,
    format: "raw-subgraph",
    /* Pass the parent workflow id and the subgraph uid so the client
     *  can keep the breadcrumb accurate if it wants to re-fetch. */
    parentId: tpl.id,
    subgraphUid: uid,
    /* 2026-08-06 boundary rail data — the client renders each pin
     *  as its own wfIoPort node (label-only) in a clean LEFT /
     *  RIGHT column, and uses `boundaryLinks` to emit React Flow
     *  edges from the pin's handle to the inner node's matching
     *  input/output handle.  See `sub.inputs` / `sub.outputs` for
     *  the source-of-truth structure: each pin has its own UUID
     *  (`id`), `name`, `type`, `label`, `pos` (saved [x, y]) and
     *  `linkIds` (the cross-boundary wire(s) entering/leaving inner
     *  nodes). */
    boundaryPins,
    boundaryLinks,
  });
  });

  return new NextResponse(detailJson, {
    status: 200,
    headers: { "Content-Type": "application/json", ...SUBGRAPH_CACHE_HEADERS },
  });
}
