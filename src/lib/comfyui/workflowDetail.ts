/**
 * Workflow detail / subgraph detail builders — ported from the legacy
 * REST routes (src/app/api/workflows/[id]/route.ts GET and
 * src/app/api/workflows/[id]/subgraph/route.ts GET) into shared lib
 * functions so the tRPC router can serve the exact same derived shapes
 * through `workflow.detailFull` / `workflow.subgraph`.
 *
 * Cache keys keep the legacy namespaces (`wf:` / `sg:`) so existing
 * server-side cache entries remain valid.
 */
import { TRPCError } from "@trpc/server";
import { workflowTemplateRepository } from "@/lib/core/repository";
import { detectParamMap } from "@/lib/comfyui/workflow";
import {
  extractPositions,
  fallbackRawToApi,
  fetchObjectInfo,
  pairWidgetValues,
  type RawWorkflow,
} from "@/lib/comfyui/raw";
import { cacheJson, cacheDel, cachePeek } from "@/lib/server-cache";
import { inferIsMultiline } from "@/lib/comfyui/types";
import { parseModesJson } from "@/lib/workflow-types";
import { localModelFileNames } from "@/lib/models";
import { modelFoldersForField } from "@/lib/model-types";

/** Shape returned by the legacy `GET /api/workflows/:id` (and the subgraph
 *  variant) — mirrors the client-side `WorkflowDetail` interface in
 *  components/updream/wf-types.ts.  Some fields only appear on the
 *  subgraph variant. */
export interface WorkflowDetailFull {
  id: string;
  name: string;
  taskType: string;
  /** Full set of mode codes the workflow can run as (parsed from the
   *  JSON-string column).  Subgraph variant omits it. */
  modes?: string[];
  defaultMode?: string | null;
  graph: Record<string, any>;
  /** Original RAW (UI-format) JSON as imported; null for API-only. */
  rawJson?: unknown;
  nodes: any[];
  /** RAW view packet (nodes/positions/graph) re-derived from rawJson. */
  rawView?: {
    nodes: any[];
    positions: Record<string, [number, number]> | null;
    graph: Record<string, any>;
  } | null;
  paramMap: Record<string, string>;
  workflowIO: Record<string, any>;
  positions: Record<string, [number, number]> | null;
  groups: any[] | null;
  notes: any[] | null;
  rawNodes: any[] | null;
  format: string;
  hasApi?: boolean;
  hasRaw?: boolean;
  usable?: boolean;
  apiOrigin?: "user" | "derived" | null;
  sourcePath?: string | null;
  sourceChanged?: boolean;
  sourceMissing?: boolean;
  source?: "local" | "online";
  /** Subgraph variant: id of the top-level workflow. */
  parentId?: string;
  /** Subgraph variant: requested subgraph UUID. */
  subgraphUid?: string;
  /** Subgraph variant: boundary pin entities. */
  boundaryPins?: {
    inputs: any[];
    outputs: any[];
  };
  /** Subgraph variant: sentinel wire ↔ pin/slot pairs. */
  boundaryLinks?: any[];
}


export async function buildWorkflowDetailFull(
  userId: string,
  id: string,
  opts: { bust?: boolean } = {}
): Promise<WorkflowDetailFull> {
  const cacheKey = `wf:${userId}:${id}`;

  /* 2026-08-12 — COMBO option resolver.
   * ComfyUI COMBO widgets (unet_name / clip_name / vae_name / ckpt_name …)
   * carry NO candidate list in the raw JSON — the only authoritative source
   * is /api/object_info.  We fetch it once per request (fetchObjectInfo
   * itself caches for 5 min + degrades to null when ComfyUI is unreachable)
   * and resolve `classType + field` → candidate array so the project-canvas
   * form and the subgraph wrapper node can render a real <select> instead of
   * a free-text box.  Missing / unreachable → undefined → graceful fallback
   * to a plain text control. */
  let _comboObjectInfo: Awaited<ReturnType<typeof fetchObjectInfo>> | undefined;
  const ensureObjectInfo = async () => {
    if (_comboObjectInfo === undefined) _comboObjectInfo = await fetchObjectInfo();
    return _comboObjectInfo;
  };
  const comboOptionsFromSpec = (spec: unknown): string[] | undefined => {
    if (!Array.isArray(spec)) return undefined;
    const head = spec[0];
    if (!Array.isArray(head)) return undefined;
    const opts = head.filter((x: unknown) => typeof x === "string") as string[];
    return opts.length ? opts : undefined;
  };
  /**
   * Resolve COMBO candidate options for a wrapper widget field.
   *
   * R-ardot40 P4: union the node-declared `object_info` candidates with the
   * locally-synced model files that map to this field (e.g. `ckpt_name` →
   * CHECKPOINT files).  ComfyUI's own COMBO list is only ever the default set
   * shipped in object_info; real on-disk models the user installed are NOT
   * listed there, so without the union the canvas dropdown silently misses
   * every local model.  Both sources are returned verbatim (extension kept)
   * and de-duplicated + sorted; if neither yields anything we return
   * `undefined` so the consumer falls back to a plain text control.
   */
  const comboOptionsForClassField = async (
    classType: string | undefined,
    field: string
  ): Promise<string[] | undefined> => {
    const [specOpts, localOpts] = await Promise.all([
      (async () => {
        if (!classType) return undefined;
        const oi = await ensureObjectInfo();
        if (!oi) return undefined;
        const def = oi[classType];
        if (!def || !def.input) return undefined;
        const spec =
          (def.input.required && def.input.required[field]) ||
          (def.input.optional && def.input.optional[field]);
        return comboOptionsFromSpec(spec);
      })(),
      localModelFileNames(modelFoldersForField(field)),
    ]);

    const merged = new Set<string>();
    if (specOpts) for (const o of specOpts) merged.add(o);
    for (const o of localOpts) merged.add(o);
    const out = Array.from(merged);
    return out.length ? out.sort((a, b) => a.localeCompare(b)) : undefined;
  };

  /**
   * Fallback COMBO resolver used when the class-based lookup yields nothing —
   * e.g. a `comfy-core` subgraph node (v0.7.0) whose `properties.proxyWidgets`
   * is absent or quarantined, so we never learn the internal node's class and
   * `comboOptionsForClassField(wrapperClass, field)` can't find the field.
   *
   * Scans EVERY `object_info` class that declares `field` as a COMBO and unions
   * their candidate lists.  For uniquely-named fields (e.g. `resolution_preset`,
   * declared by exactly one class) this recovers the full option list; for
   * shared model fields (e.g. `unet_name`) it unions all known defaults, which
   * is harmless because the local-model union below already covers the
   * realistic on-disk set.  object_info is fetched once and cached, so the
   * scan is cheap on repeated calls.
   */
  const comboOptionsForFieldName = async (
    field: string
  ): Promise<string[] | undefined> => {
    const oi = await ensureObjectInfo();
    if (!oi) return undefined;
    const merged = new Set<string>();
    let found = false;
    for (const def of Object.values(oi)) {
      const inp = (def as any)?.input;
      if (!inp) continue;
      const spec =
        (inp.required && (inp.required as Record<string, unknown>)[field]) ||
        (inp.optional && (inp.optional as Record<string, unknown>)[field]);
      const opts = comboOptionsFromSpec(spec);
      if (opts) {
        found = true;
        for (const o of opts) merged.add(o);
      }
    }
    if (!found) return undefined;
    for (const o of await localModelFileNames(modelFoldersForField(field))) merged.add(o);
    const out = Array.from(merged);
    return out.length ? out.sort((a, b) => a.localeCompare(b)) : undefined;
  };

  /* 2026-08-06 R3: ?_bust=1 query flag forces the in-memory LRU to be
   *  bypassed (deleted + re-built) so the 顶栏 🔄 强制重载按钮 can pull
   *  a guaranteed-fresh serialisation from Prisma.  Without this, even
   *  cache:"no-store" on the client would still pull a 60s-stale
   *  pre-serialised JSON blob from server memory.  The flag is
   *  deliberately a private client-only token — never logged. */
  if (opts.bust) {
    cacheDel(cacheKey);
  }

  /* ── Local-file workflows: detect on-disk changes & auto re-import ──
   *  If this workflow was imported from a local file (sourcePath set), we stat
   *  the file up-front (cheap) so we can re-import it before serving a stale
   *  cached blob.  This is what lets the user edit the file in ComfyUI and see
   *  the latest on refresh — with OR without the 🔄 force-reload button.
   *  `meta` is a lightweight select so we don't drag the (large) rawJson blob
   *  twice; the full read below still happens when the cache misses. */
  let sourceChanged = false;
  let sourceMissing = false;
  let sourcePath: string | null = null;
  const meta = await workflowTemplateRepository.findByIdForUserSelect(
    userId,
    id,
    {
      id: true,
      sourcePath: true,
      sourceMtime: true,
      sourceChecksum: true,
      taskType: true,
    }
  );
  if (meta?.sourcePath) {
    sourcePath = meta.sourcePath;
    const { reimportFromSource } = await import("@/lib/comfyui/importSource");
    const re = await reimportFromSource({
      sourcePath: meta.sourcePath,
      sourceMtime: meta.sourceMtime,
      sourceChecksum: meta.sourceChecksum,
      /* R-ardot87 (2026-08-16): 透传已存在的 taskType 让 reimport 时保留
       * 用户在 UI 里手动设置的值（不再被自动推断覆盖）。 */
      existingTaskType: meta.taskType ?? null,
    });
    if (re.missing) {
      sourceMissing = true;
      cacheDel(cacheKey); // rebuild so the missing flag reaches the client
    } else if (re.update) {
      await workflowTemplateRepository.update(id, {
        graph: re.update.graph as any,
        rawJson: re.update.rawJson as any,
        positions: re.update.positions as any,
        paramMap: re.update.paramMap as any,
        taskType: re.update.taskType,
        sourceChecksum: re.update.sourceChecksum,
        sourceMtime: re.update.sourceMtime,
      } as any);
      sourceChanged = true;
      cacheDel(cacheKey); // force a fresh re-serialisation below
    }
  }

  /* Hot path: if the pre-serialized detail is already cached we return it
   * directly — skipping the Prisma read of the (large) rawJson blob AND the
   * per-request JSON.stringify.  This is what gets repeat opens to <50ms.
   * (The cache entry is invalidated on PATCH/DELETE; a 404 is never cached.) */
  const cached = cachePeek<string>(cacheKey);
  if (cached !== undefined && typeof cached === "string") {
    return JSON.parse(cached);
  }

  const tpl = await workflowTemplateRepository.findByIdForUserSelect(
    userId,
    id,
    {
      id: true,
      name: true,
      taskType: true,
      modes: true,
      defaultMode: true,
      graph: true,
      paramMap: true,
      workflowIO: true,
      rawJson: true,
      positions: true,
      apiSource: true,
    }
  );
  if (!tpl) throw new TRPCError({ code: "NOT_FOUND", message: "未找到该工作流" });

  /* The transform below is pure (depends only on tpl.graph / tpl.rawJson /
   * tpl.positions which never change between writes), so we cache the already
   * serialized JSON string by user+id.  Repeated opens return it verbatim.
   *
   * 2026-08-06 R3: TTL shortened from 60_000ms → 30_000ms so it locks at
   * most 30s of staleness even if client cache:"no-store" is bypassed. */
  const detailJson = await cacheJson(cacheKey, 30_000, async () => {
  const graph = tpl.graph as Record<string, any>;
  const raw = (tpl.rawJson ?? null) as any;

  /* Resolve effective node positions.
   *
   * `tpl.positions` is the DB column tracking what the user has manually
   * dragged.  `rawJson.nodes[i].pos` carries the original ComfyUI
   * coordinates (x, y) from the imported workflow — these are the
   * positions the user sees in their ComfyUI client and expect to see
   * here too.  The two sources are layered: rawJson is the default
   * background (every node has a position from import), tpl.positions is
   * the foreground overlay (only nodes the user has explicitly dragged
   * end up here).  Object-spread order does the merge correctly:
   * `{ ...background, ...foreground }` → foreground wins per key.
   *
   * Why this matters:
   *   1) Imported workflows where the user has only dragged a couple of
   *      nodes have a sparse `tpl.positions` (e.g. just 2 of 114).  If
   *      we returned tpl.positions as-is, the canvas would render the
   *      2 saved nodes at their dragged spots and stack the remaining
   *      112 at the (padX, padY) default — visually broken and
   *      inconsistent with ComfyUI.  Merging fills the gaps from
   *      rawJson so every node lands where ComfyUI placed it.
   *   2) API-only imports (no rawJson) → background is {} → foreground
   *      wins → client falls back to Kahn auto-layout.  Same behaviour
   *      as before for that case.
   *   3) Stale keys that don't correspond to any graph node (e.g. the
   *      `grp:bpin:inputs` that a subgraph-view PATCH with merge:true
   *      leaked in earlier) are harmless: the renderer only looks up
   *      positions by graph node id, so an unknown key is silently
   *      ignored. */
  const positionsFromRaw =
    raw && Array.isArray(raw.nodes) ? extractPositions(raw as RawWorkflow) : {};
  const tplPositions = (tpl.positions as Record<string, [number, number]>) ?? {};
  const effectivePositions: Record<string, [number, number]> = {
    ...positionsFromRaw,
    ...tplPositions,
  };
  /* If neither source has anything, the client should run Kahn on the
   * whole graph rather than treat an empty object as "use these (none)
   * positions".  Return null so the client-side sparse guard kicks in
   * and falls through cleanly. */
  const positions = Object.keys(effectivePositions).length > 0 ? effectivePositions : null;

/* IMAGE-input thumbnail preview (2026-08-10 R27, narrowed in R28).  ComfyUI's
 * LoadImage node keeps the uploaded filename in `widgets_values[0]`; we
 * surface that as an inline preview by stamping a synthetic `preview`-marked
 * entry onto the LoadImage node itself.  We DO NOT propagate `imageRef` to
 * downstream IMAGE inputs (ImageScale / CLIPVisionEncode / …) because those
 * renderings would always show the unscaled / un-encoded upstream image
 * (just a duplicate of the LoadImage preview), which is meaningless per
 * 2026-08-10 user feedback — only the source LoadImage node should paint
 * the thumbnail.  Downstream nodes only see the IMAGE-typed port cylinder
 * on their left edge, which is the ComfyUI-parity shape.  Empty LoadImage
 * uploads (widgets_values[0] missing/empty) still push the synthetic entry
 * — without `imageRef` — so the renderer can show a 「需要上传图片」 placeholder
 * in the body, matching ComfyUI's empty state. */
  const LOAD_IMAGE_NODE_TYPES = new Set([
    "LoadImage", "LoadImageMasked", "ComfyUI LoadImage", "ComfyUI-LoadImage",
    "Load Image", "ImageLoader", "ComfyUI-ImageLoader",
  ]);
  const nodeMetaById: Record<string, { type: string; widgets_values: any[] }> = {};
  if (raw && Array.isArray(raw.nodes)) {
    for (const nd of raw.nodes) {
      if (!nd || nd.id == null) continue;
      nodeMetaById[String(nd.id)] = {
        type: typeof nd.type === "string" ? nd.type : "?",
        widgets_values: Array.isArray((nd as any).widgets_values) ? (nd as any).widgets_values : [],
      };
    }
  }
  const linkSourceById: Record<string, string> = {};
  if (raw && Array.isArray((raw as any).links)) {
    for (const lk of (raw as any).links) {
      if (!Array.isArray(lk) || lk.length < 2) continue;
      linkSourceById[String(lk[0])] = String(lk[1]);
    }
  }
  function resolveImageRef(link: any): { filename: string; subfolder: string; type: string } | null {
    if (link == null) return null;
    const srcId = linkSourceById[String(link)];
    if (!srcId) return null;
    const src = nodeMetaById[srcId];
    if (!src || !LOAD_IMAGE_NODE_TYPES.has(src.type)) return null;
    const fname = src.widgets_values?.[0];
    if (typeof fname !== "string" || fname.length === 0) return null;
    return { filename: fname, subfolder: "", type: "input" };
  }

  /* Build a `rawInputs` lookup for every graph node.  In raw UI format, each
   * node carries an `inputs` array on the disk record where every entry has
   *   { name, localized_name, label?, type, link }
   * `localized_name` is the zh-CN display label (ComfyUI saves it per node)
   * and `type` is the ComfyUI data-type string used for both connections and
   * widget values.  When the workflow was imported as API JSON only, this
   * map is empty. */
  const rawInputsById: Record<string, {
    name: string;
    label?: string;
    localized?: string;
    type: string;
    isConnection: boolean;
    /** ComfyUI wrapper-node widget marker (only set on inputs that expose
     *  an internal widget value back to the author).  When present the
     *  parent paint can render a `VALUE` cell to the right of the label
     *  without reaching for rawJson again.  Subgraph proxy pins that are
     *  plain connections leave this `undefined`. */
    widget?: { name: string };
    /** The current value of the widget this input exposes, drawn from
     *  `widgets_values[k]` where `k` is the running count of widgets
     *  seen before this row in the inputs[] array.  Undefined when the
     *  input is a pure connection (no widget).  Type-as-strings keep the
     *  JSON round-trip lossless; the canvas decides how to colour it
     *  (bool=green/red, number=amber, string=indigo) via `valueCellColor`. */
    widgetValue?: unknown;
    /** 2026-08-10 R18: server-stamped `multiline` flag — TRUE when this
     *  STRING input should render as a textarea, regardless of value
     *  length.  Sourced from `inferIsMultiline(classType, name, value)`
     *  which combines a static table (ComfyUI's own known-multiline
     *  inputs) with a name heuristic + length heuristic.  API-format
     *  rawJson does not preserve the original `widgets[i].config
     *  .multiline` flag, so we backfill here.  Affects widgetEntries
     *  rendering (WfNode / WfSubgraphNode); the workflowIO enrichment
     *  below has its own parallel stamp via MULTILINE_HINT. */
    multiline?: boolean;
  }[]> = {};
  /* ComfyUI/litegraph node `size` ([w, h]) — forwarded so the canvas can
   *  paint each node box at its exact ComfyUI dimensions (the user expects
   *  the card to match the imported config, including oversized boxes with
   *  internal whitespace).  Raw API-format `tpl.graph` drops `size`, so we
   *  pull it back from `raw.nodes` (which still carries it) keyed by id. */
  const sizeById: Record<string, [number, number]> = {};
  if (raw && Array.isArray(raw.nodes)) {
    for (const rn of raw.nodes) {
      if (!rn) continue;
      /* Capture `size` for EVERY raw node, independent of whether the node
       *  carries an `inputs` array.  Some litegraph exports (and certain
       *  test fixtures) omit `inputs` on nodes that still have a `size`,
       *  so gating size on `inputs` would wrongly drop it.  (The
       *  rawInputsById pass below still needs `inputs`, hence the separate
       *  guard below.) */
      const rnSize =
        Array.isArray((rn as any).size) && (rn as any).size.length >= 2 ? (rn as any).size : undefined;
      if (rnSize) {
        sizeById[String((rn as any).id)] = [Number(rnSize[0]) || 0, Number(rnSize[1]) || 0];
      }
      if (!Array.isArray((rn as any).inputs)) continue;
      const list: {
        name: string;
        label?: string;
        localized?: string;
        type: string;
        isConnection: boolean;
        widget?: { name: string };
        widgetValue?: unknown;
        multiline?: boolean;
        imageRef?: { filename: string; subfolder: string; type: string };
        preview?: boolean;
      }[] = [];
      const rnWidgets = Array.isArray((rn as any).widgets_values)
        ? (rn as any).widgets_values
        : [];
      let widgetCounter = 0;
      for (const inp of (rn as any).inputs) {
        if (!inp || typeof inp.name !== "string") continue;
        const isConn = inp.link != null;
        /* ComfyUI bakes the widget handle as `{ widget: { name: "…" } }`
         *  on inputs that are "exposed widget proxies" — the value lives
         *  in `widgets_values` at the position of widgets seen so far in
         *  inputs[] order.  Without this counter, the API would only
         *  expose the flat widgets_values array and force every consumer
         *  to re-pair the indices (which was the previous source of the
         *  "<input name still showing no value>" regression). */
        const widgetName = inp.widget && typeof inp.widget.name === "string" ? inp.widget.name : undefined;
        let widgetValue: unknown = undefined;
        if (widgetName && widgetCounter < rnWidgets.length) {
          widgetValue = rnWidgets[widgetCounter];
          /* seed / noise_seed widgets carry an implicit `control_after_generate`
           * partner slot immediately after their own value inside widgets_values[].
           * Advance the counter by 2 for those so every downstream widget value
           * stays correctly aligned — otherwise steps / cfg / sampler_name … all
           * shift one slot to the right (R94 fix).  This mirrors the 2-slot bundle
           * handling already present in the subgraph `lookupFieldValue` helper. */
          const isSeedBundle =
            widgetName === "seed" ||
            widgetName === "noise_seed" ||
            inp.name === "seed" ||
            inp.name === "noise_seed";
          widgetCounter += isSeedBundle ? 2 : 1;
        }
        const entry: {
          name: string;
          imageRef?: { filename: string; subfolder: string; type: string };
          preview?: boolean;
          label?: string;
          localized?: string;
          type: string;
          isConnection: boolean;
          widget?: { name: string };
          widgetValue?: unknown;
          multiline?: boolean;
        } = {
          name: inp.name,
          label: typeof inp.label === "string" ? inp.label : undefined,
          localized: typeof inp.localized_name === "string" ? inp.localized_name : undefined,
          type: typeof inp.type === "string" ? inp.type : (isConn ? "*" : "STRING"),
          isConnection: isConn,
        };
        if (widgetName) entry.widget = { name: widgetName };
        if (widgetValue !== undefined) entry.widgetValue = widgetValue;
        /* 2026-08-10 R18: stamp `multiline` on every STRING input that
         *  the upstream `inferIsMultiline` helper flags.  The helper
         *  intentionally never stamps `multiline: false` (an opt-in
         *  only flag); the renderer treats absence as "no opinion"
         *  and falls back to its own heuristics.  Without this stamp
         *  WfNode / WfSubgraphNode widgetEntries rendering silently
         *  degrades short prompt inputs (e.g. CLIPTextEncode's `text`
         *  holding `embedding:EasyNegative`) to one-line chips.
         *
         *  2026-08-10 R28: removed the IMAGE-input `imageRef` propagation
         *  here.  The old `entry.type === "IMAGE" && isConn → resolveImageRef`
         *  branch stamped downstream IMAGE inputs (ImageScale, CLIPVisionEncode,
         *  …) with a back-reference to the LoadImage filename, which the
         *  canvas dutifully rendered — but those nodes produce
         *  scaled / re-encoded output and showing the *original* image there
         *  is misleading (per user feedback).  Only the LoadImage source node
         *  sees a preview now (via the synthetic entry pushed below). */
        if (typeof inp.type === "string" && inp.type === "STRING") {
          if (inferIsMultiline(typeof rn.type === "string" ? rn.type : undefined, inp.name, widgetValue)) {
            entry.multiline = true;
          }
        }
        list.push(entry);
      }
      rawInputsById[String(rn.id)] = list;

      /* LoadImage-family nodes carry the uploaded filename in widgets_values[0]
       * but have NO IMAGE input (they *produce* IMAGE).  We synthesize one
       * preview entry — `preview: true` marker — so the canvas can paint the
       * uploaded thumbnail (or a 「需要上传图片」 placeholder when empty) on
       * the LoadImage node itself, which is exactly where ComfyUI paints it.
       *
       * 2026-08-10 R28: ALWAYS push for LoadImage-family, regardless of
       * whether an image is loaded.  The empty-image branch (widgets_values[0]
       * missing / empty) returns `imageRef: undefined` and the frontend
       * renders a placeholder.  This way the node always has its preview
       * area in the body — collapsing the body hides both, which is the
       * correct ComfyUI-parity shape.  The dedicated `preview: true` flag
       * is checked by the renderer's connEntries / widgetEntries filters
       * so this entry never lands in the port row or widget control list. */
      if (LOAD_IMAGE_NODE_TYPES.has(typeof (rn as any).type === "string" ? (rn as any).type : "")) {
        if (!list.some((e) => e.preview)) {
          const wv0 = (rn as any).widgets_values?.[0];
          const fname = typeof wv0 === "string" ? wv0.trim() : "";
          list.push({
            name: "__loadimage_preview__",
            label: "image",
            localized: "图像",
            type: "IMAGE",
            isConnection: false,
            preview: true,
            ...(fname
              ? { imageRef: { filename: fname, subfolder: "", type: "input" as const } }
              : {}),
          });
        }
      }
    }
  }

  /* 2026-08-12 R73: Subgraph wrapper widget value lookup.
   *
   * ComfyUI's exported subgraph workflows carry a `properties.proxyWidgets`
   * array on each wrapper node that maps wrapper.inputs[i] to an internal
   * node + widget field: `proxyWidgets[i] = [internalNodeId, fieldName]`.
   * The wrapper's own `widgets_values[]` is empty — the actual values
   * live in the corresponding internal nodes' `widgets_values[]`, indexed
   * by walking the internal node's `inputs[]` array to find the slot
   * for `fieldName` (counting widget slots seen so far, since
   * ComfyUI/LiteGraph stores widget values as a flat array in input
   * order).
   *
   * Special case: KSampler / KSamplerAdvanced bundle `seed` and
   * `control_after_generate` into TWO consecutive widget slots — the
   * `seed` input occupies slot 0, `control_after_generate` slots into
   * slot 1, so any slot counter that hits a seed widget advances by 2.
   *
   * The base parser (above) already stamps `widget: { name }` on inputs
   * that carry the widget marker (ComfyUI's exported wrappers always do),
   * `isConnection` from `inp.link`, and attempts `widgetValue` from
   * `rn.widgets_values[widgetCounter]` — but for wrapper nodes the latter
   * is empty, leaving every widget row blank until this enrichment runs. */
  if (raw && raw.definitions && raw.definitions.subgraphs) {
    const subs = raw.definitions.subgraphs as Record<string, any>;
    /* Index internal nodes per subgraph def by id for O(1) lookup.  We
     * pre-build this once per subgraph def rather than per wrapper to
     * keep cost flat regardless of how many wrappers the workflow has. */
    const internalByIdByKey = new Map<string, Map<string, any>>();
    for (const subKey of Object.keys(subs)) {
      const subDef = subs[subKey];
      const m = new Map<string, any>();
      if (Array.isArray(subDef?.nodes)) {
        for (const inN of subDef.nodes) {
          if (inN && inN.id != null) m.set(String(inN.id), inN);
        }
      }
      internalByIdByKey.set(subKey, m);
    }
    /* Find the subgraph def that belongs to a wrapper's UUID classType.
     *  Tries direct key match first, then a fallback scan by `id` field
     *  (ComfyUI may key the def by either the UUID or an arbitrary key). */
    const resolveSubDef = (classType: string): { key: string; def: any } | null => {
      if (subs[classType]) return { key: classType, def: subs[classType] };
      for (const k of Object.keys(subs)) {
        if (subs[k]?.id === classType) return { key: k, def: subs[k] };
      }
      return null;
    };
    /* Look up a widget field's current value on an internal node by
     * walking inputs[] to find the matching slot, then indexing
     * widgets_values[].  Handles the seed+control_after_generate
     * 2-slot bundle by advancing the slot counter twice wherever a
     * seed/ noise_seed widget is encountered (those inputs always
     * carry an implicit `control_after_generate` partner slot). */
    const lookupFieldValue = (internalNode: any, fieldName: string): unknown => {
      if (!internalNode || !Array.isArray(internalNode.inputs)) return undefined;
      const inputs = internalNode.inputs;
      const wv: unknown[] = Array.isArray(internalNode.widgets_values)
        ? internalNode.widgets_values
        : [];
      /* control_after_generate always sits in the slot AFTER seed. */
      if (fieldName === "control_after_generate") {
        const seedIdx = inputs.findIndex(
          (i: any) => i && (i.name === "seed" || i.name === "noise_seed")
        );
        if (seedIdx < 0) return undefined;
        let slot = 0;
        for (let k = 0; k <= seedIdx; k++) {
          if (inputs[k]?.widget) slot++;
        }
        return slot < wv.length ? wv[slot] : undefined;
      }
      /* Generic: count widget slots before the target input. */
      const inputIdx = inputs.findIndex(
        (i: any) => i && i.name === fieldName
      );
      if (inputIdx < 0) return undefined;
      let slot = 0;
      for (let k = 0; k < inputIdx; k++) {
        const inp = inputs[k];
        if (inp?.widget) {
          slot++;
          /* seed bundle consumes an extra slot for control_after_generate */
          if (inp.name === "seed" || inp.name === "noise_seed") slot++;
        }
      }
      return slot < wv.length ? wv[slot] : undefined;
    };

    /* Precompute (subDefKey, proxyWidgets, internalById) per wrapper so
     * the inner map stays cheap when the workflow has many wrappers. */
    const wrapperNodeIds: string[] = [];
    for (const nodeId of Object.keys(rawInputsById)) {
      const rn = (raw as any)?.nodes?.find?.((n: any) => String(n?.id) === nodeId);
      if (!rn) continue;
      const classType = typeof rn.type === "string" ? rn.type : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(classType)) continue;
      wrapperNodeIds.push(nodeId);
    }

    for (const nodeId of wrapperNodeIds) {
      const rn = (raw as any).nodes.find((n: any) => String(n?.id) === nodeId);
      const classType = typeof rn.type === "string" ? rn.type : "";
      const resolved = resolveSubDef(classType);
      if (!resolved) continue;
      const internalById = internalByIdByKey.get(resolved.key);
      if (!internalById) continue;
      const proxyWidgets: Array<[string, string]> = Array.isArray(rn.properties?.proxyWidgets)
        ? (rn.properties.proxyWidgets as any[])
            .filter((p): p is [unknown, unknown] => Array.isArray(p) && p.length === 2)
            .map((p) => [String(p[0]), String(p[1])])
        : [];
      if (proxyWidgets.length === 0) continue;

      const subNodeType =
        typeof resolved.def?.name === "string" && resolved.def.name.trim()
          ? resolved.def.name
          : classType;

      const existingList = rawInputsById[nodeId] || [];
      /* `proxyWidgets` is indexed by *widget-input order* (the i-th exposed
       *  widget slot), NOT by the raw input-array index — ComfyUI skips
       *  pure-connection ports when it builds the array.  So we must walk
       *  the widget slots with their own counter (`widgetSlot`) rather than
       *  reuse the map's `idx` (which counts every input, ports included).
       *  Reusing `idx` shifts the mapping whenever a wrapper has leading or
       *  trailing non-widget ports: every wrapped value lands on the wrong
       *  row, and the trailing widget inputs fall off the end of the array
       *  and render as blank placeholder cells.  (This is exactly the
       *  "子图 wrapper 只显示占位" symptom for wrappers like
       *  image_qwen_image_edit_2511_int8's node 170, which has 3 leading
       *  IMAGE ports before its 8 widget inputs.) */
      let widgetSlot = 0;
      const updatedList = existingList.map((entry) => {
        /* Only enrich inputs that ALREADY have a widget marker (i.e.
         *  they're exposed widget slots, not pure-connection ports).
         *  Pure ports correctly stay in connInputs on the client side. */
        if (!entry.widget) return entry;
        const proxy = proxyWidgets[widgetSlot];
        widgetSlot += 1;
        if (!proxy) return entry;
        const [internalNodeId, fieldName] = proxy;
        const internalNode = internalById.get(internalNodeId);
        const updated: any = { ...entry };
        if (updated.widgetValue === undefined) {
          const v = lookupFieldValue(internalNode, fieldName);
          if (v !== undefined) updated.widgetValue = v;
        }
        /* Adopt the internal node's slot type as authoritative if our
         *  wrapper entry didn't carry one (defensive — usually already
         *  present from the raw JSON). */
        if (internalNode && Array.isArray(internalNode.inputs)) {
          const inp = internalNode.inputs.find(
            (i: any) => i && i.name === fieldName
          );
          if (inp?.type) updated.type = inp.type;
          if (!updated.label && inp?.localized_name) {
            updated.label = inp.localized_name;
          }
          /* Stash the proxy target (internal node class + field) so the
           *  async COMBO-option pass below can resolve candidate lists from
           *  /api/object_info for any COMBO widget on this wrapper. */
          (updated as any).__comboClass = internalNode.type;
          (updated as any).__comboField = fieldName;
        }
        /* Re-stamp multiline if we just learned the value (the base
         *  parser ran before this pass and may have skipped it). */
        if (
          updated.type === "STRING" &&
          !updated.multiline &&
          inferIsMultiline(subNodeType, entry.name, updated.widgetValue)
        ) {
          updated.multiline = true;
        }
        return updated;
      });
      /* Resolve COMBO candidate lists from /api/object_info (single fetch
       *  per request, cached).  Only wrapper widget inputs that are COMBOs
       *  get a `comboOptions` array; everything else is left untouched.  If
       *  ComfyUI is unreachable the temp fields are just dropped and the
       *  consumer falls back to a plain text control. */
      for (const e of updatedList) {
        const ec = e as any;
        if (ec.type === "COMBO" && ec.__comboClass) {
          const opts = await comboOptionsForClassField(ec.__comboClass, ec.__comboField);
          if (opts) ec.comboOptions = opts;
        }
        delete ec.__comboClass;
        delete ec.__comboField;
      }
      rawInputsById[nodeId] = updatedList;
    }
  }

  /* Sparse raw-node metadata — only enough for the canvas editor to render
   * the OUTPUT port strip and to feed Subgraph UI nodes (which need
   * widget_values to label their fields).  We don't ship the full raw graph
   * here; the saved graph + positions are already on detail. */
  const rawNodeMeta: { id: string; widgets_values: any[]; outputs: { name: string; localized?: string; label?: string; type: string; links: number[] }[]; flags: Record<string, any>; properties: Record<string, any>; mode: number }[] = [];
  if (raw && Array.isArray(raw.nodes)) {
    for (const rn of raw.nodes) {
      if (!rn || rn.type === "Note" || rn.type === "MarkdownNote") continue;
      const outputs: { name: string; localized?: string; label?: string; type: string; links: number[] }[] = [];
      if (Array.isArray((rn as any).outputs)) {
        for (const o of (rn as any).outputs) {
          if (!o || typeof o.name !== "string") continue;
          outputs.push({
            name: o.name,
            localized: typeof o.localized_name === "string" ? o.localized_name : undefined,
            /* Business label (e.g. `FRAMES` / `IMAGE_FINAL`).  Forwarded
             *  so the parent's WfSubgraphNode outputs strip and the
             *  inner WfIoPortNode display stay in lock-step — without
             *  this both fall back to `name` (often equals `type` for
             *  proxy-pin ComfyUI exports, producing visually empty
             *  rows like `INT (INT)`). */
            label: typeof o.label === "string" ? o.label : undefined,
            type: typeof o.type === "string" ? o.type : "*",
            links: Array.isArray(o.links) ? o.links.map((n: any) => Number(n) || 0) : [],
          });
        }
      }
      // Forward `flags` so the editor can honour per-node flags such as
      //  `flags.collapsed === true` (a ComfyUI LiteGraph state used by
      //  SetNode / Fast Groups Muter / rgthree Compact etc.).  Only
      //  plain-object flags are kept; everything else is dropped to
      //  avoid leaking class-instances into the JSON payload.
      const flags =
        rn && typeof (rn as any).flags === "object" && (rn as any).flags !== null
          ? ((rn as any).flags as Record<string, any>)
          : {};
      rawNodeMeta.push({
        id: String(rn.id),
        widgets_values: Array.isArray((rn as any).widgets_values) ? (rn as any).widgets_values : [],
        outputs,
        flags,
        /* Custom-node `properties` (2026-08-09).  Forwarded so the canvas
         *  can replicate runtime UI driven by properties — the most
         *  prominent example is rgthree's `Fast Groups Bypasser` which
         *  reads `matchTitle` / `matchColors` / `sort` from this dict
         *  to derive its body of toggle rows at render time (the static
         *  `inputs` array is empty, so without forwarding `properties`
         *  the WfNode would have no way to know what toggles to draw). */
        properties:
          rn && typeof (rn as any).properties === "object" && (rn as any).properties !== null
            ? ((rn as any).properties as Record<string, any>)
            : {},
        mode: typeof (rn as any).mode === "number" ? (rn as any).mode : 0,
      });
    }
  }

  const nodes = Object.entries(graph).map(([nodeId, n]) => {
    // ComfyUI exports vary: newer snapshots use `class_type`, older / some
    // rgthree-comfy exports use `type` only.  Fall back to `type` so the
    // subgraph-wrapper check below picks up UUID class names that live in
    // either field — without this fallback every node renders as a plain
    // WfNode and subgraph wrappers dump their 10+ IO rows inline instead
    // of being recognised as `is_subgraph: true` for the compact WfSubgraphNode.
    const classType: string =
      (n?.class_type as string) || (n?.type as string) || "?";
    const isUuidClass = /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(classType);
    /* Subgraph wrapper nodes (class_type === UUID) get their display name
     *  from raw.definitions.subgraphs[uid].name.  Same lookup as the
     *  subgraph route's `sub` resolver (subgraphs may be keyed by either
     *  the UUID or by their inner `.id` field).  Falls back to the
     *  existing empty-string sentinel when the name is missing — the
     *  client-side friendlyNodeTitle() then renders "子工作流" as a
     *  last-resort label, identical to the pre-fix behaviour. */
    let resolvedTitle: string | undefined;
    if (isUuidClass && raw && raw.definitions && raw.definitions.subgraphs) {
      const subs = raw.definitions.subgraphs as Record<string, any>;
      let def = subs[classType];
      if (!def) {
        const matchKey = Object.keys(subs).find((k) => subs[k]?.id === classType);
        if (matchKey) def = subs[matchKey];
      }
      if (def && typeof def.name === "string" && def.name.trim()) {
        resolvedTitle = def.name.trim();
      }
    }
    return {
      id: nodeId,
      class_type: classType,
      title:
        resolvedTitle ??
        n?._meta?.title ??
        (isUuidClass ? "" : classType) ??
        nodeId,
      is_subgraph: isUuidClass,
      raw_inputs: rawInputsById[nodeId] ?? [],
      /* Exact ComfyUI box size ([w, h]) for this node.  Undefined for
       *  API-only imports that carry no rawJson size — the client then
       *  falls back to its content-driven min/max-width layout. */
      size: sizeById[nodeId],
    };
  });
  /* 2026-08-13 R82: raw 视图专用数据包。
   * 存库的 `graph`（即 `detail.nodes` 的来源）在某些工作流里被「拆平」成了
   * `N:xx` 节点（例如某工作流的 flat form，而其 `_t2i` 兄弟保留 wrapper）。
   * 这种情况下画布 RAW 布局会显示 17 个被炸开的节点，而用户期望的是 5 个
   * 原始 ComfyUI 节点（含 wrapper 紫色整卡）。这里直接从 rawJson 再派生一份
   * `rawView`（保留 subgraph wrapper），让 RAW 布局与 wrapper-form 兄弟、与
   * ComfyUI 自身画布一致。fallbackRawToApi 走离线启发式、不发网络请求。 */
  let rawView: { nodes: any[]; positions: Record<string, [number, number]>; graph: any } | null = null;
  if (raw && Array.isArray((raw as any).nodes)) {
    const rawConv = fallbackRawToApi(raw as RawWorkflow);
    const rawGraph = (rawConv.graph ?? {}) as Record<string, any>;
    const rawViewNodes = Object.entries(rawGraph).map(([nodeId, n]) => {
      const classType: string =
        (n?.class_type as string) || (n?.type as string) || "?";
      const isUuidClass = /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(classType);
      let resolvedTitle: string | undefined;
      if (isUuidClass && raw && raw.definitions && raw.definitions.subgraphs) {
        const subs = raw.definitions.subgraphs as Record<string, any>;
        let def = subs[classType];
        if (!def) {
          const matchKey = Object.keys(subs).find((k) => subs[k]?.id === classType);
          if (matchKey) def = subs[matchKey];
        }
        if (def && typeof def.name === "string" && def.name.trim()) {
          resolvedTitle = def.name.trim();
        }
      }
      return {
        id: nodeId,
        class_type: classType,
        title:
          resolvedTitle ??
          (n as any)?._meta?.title ??
          (isUuidClass ? "" : classType) ??
          nodeId,
        is_subgraph: isUuidClass,
        raw_inputs: rawInputsById[nodeId] ?? [],
        size: sizeById[nodeId],
      };
    });
    const rawViewPositions =
      (rawConv.positions as Record<string, [number, number]>) ??
      extractPositions(raw as RawWorkflow);
    rawView = { nodes: rawViewNodes, positions: rawViewPositions, graph: rawGraph };
  }

  const paramMap = (tpl.paramMap as Record<string, string>) ?? detectParamMap(graph);
  // User-curated exposure selection: which node params/widgets/outputs are
  // exposed as the workflow's external inputs/outputs.  (ioKey is
  // `${nodeId}::${kind}::${name}`; see the canvas editor's IO-edit mode.)
  const workflowIORaw = (tpl.workflowIO as Record<string, { direction: "input" | "output"; kind: string; nodeId: string; name: string; label?: string; displayOrder?: number; value?: unknown }>) ?? {};

  /* ── workflowIO ENRICHMENT (2026-08-09) ──
   * The stored selection only records WHICH pin was exposed
   * (`direction` / `kind` / `nodeId` / `name`).  `kind` is a *semantic*
   * bucket ("param" | "widget" | "output") — it is NOT the ComfyUI data
   * type, so a consumer that wants to render a control (textarea vs
   * number vs switch vs image-upload) had no way to decide.
   *
   * Rather than force every client to re-join `nodes[].raw_inputs[]` and
   * `rawNodes[].outputs[]` by (nodeId, name), we do the join once here and
   * ship a self-describing record:
   *   type          ComfyUI data type — "STRING" | "INT" | "FLOAT" |
   *                 "BOOLEAN" | "IMAGE" | "LATENT" | …  ("*" when unknown)
   *   defaultValue  current widget value (or the literal in the API graph),
   *                 so a dynamic form can pre-fill instead of showing blanks
   *   label         best display label (label > localized > name)
   *   nodeTitle     owning node's title, used to disambiguate same-named
   *                 pins across nodes ("seed" on 3 samplers)
   *   multiline     STRING inputs that ComfyUI marks as multiline-ish
   *                 (prompt-sized) → render a textarea, not a one-liner
   * Consumers: DynamicWorkflowForm (CreatePanel + canvas workflow node)
   * and the canvas auto-spawn logic (first output's `type` decides whether
   * the downstream node is an image or a video node). */
  const nodeTitleById: Record<string, string> = {};
  for (const n of nodes) nodeTitleById[n.id] = n.title || n.class_type;

  /* Map node id → ComfyUI class type so a direct (non-wrapper) COMBO input can
   *  have its candidate list resolved from /api/object_info by (classType, field).
   *  Wrapper COMBOs already carry `comboOptions` from the R73-B pass above and
   *  bypass this lookup. */
  const nodeTypeById: Record<string, string> = {};
  if (raw && Array.isArray((raw as any).nodes)) {
    for (const n of (raw as any).nodes) {
      if (n && n.id != null) nodeTypeById[String(n.id)] = typeof n.type === "string" ? n.type : "";
    }
  }

  const MULTILINE_HINT = /(prompt|text|caption|描述|提示)/i;
  const workflowIO: Record<
    string,
    {
      direction: "input" | "output";
      kind: string;
      nodeId: string;
      name: string;
      label?: string;
      type: string;
      defaultValue?: unknown;
      nodeTitle?: string;
      multiline?: boolean;
      /** COMBO candidate list (unet_name / clip_name / …) resolved from
       *  /api/object_info.  Absent for non-COMBO pins or when ComfyUI is
       *  unreachable — consumers fall back to a plain text control. */
      options?: string[];
      /** 2026-08-17 R94: author override of the default value, round-tripped
       *  from the stored `workflowIORaw` so a custom default survives reload. */
      value?: unknown;
    }
  > = {};
  for (const [ioKey, v] of Object.entries(workflowIORaw)) {
    if (!v || typeof v !== "object") continue;
    let type = "*";
    let defaultValue: unknown = undefined;
    let label = v.label;
    /* COMBO candidate list — resolved below once we know the final `type`. */
    let options: string[] | undefined;

    // Helper (2026-08-09): resolve a stored `v.nodeId` against keys that may
    // be stored in EITHER of two ID families —
    //   • React Flow short ids (e.g. "9b9009e4") — what toggleIO writes
    //   • ComfyUI UUIDs (e.g. "9b9009e4-2d3d-445f-9be5-6063f465757e") — the
    //     rawJson / graph key shape
    // Without this leniency the lookup falls through to type="*" + undefined
    // defaultValue, which silently degrades every dynamic form to single-line
    // text inputs (no textarea for prompts, no switch / number / file widget),
    // because the enrichment never reaches MULTILINE_HINT or the long-string
    // fallback.  See controlForEntry() in src/components/updream/shared/workflow-io.ts.
    // Returns the CANONICAL key in whatever shape the data lives in.
    const full = String(v.nodeId);
    const canonicalNodeId = (() => {
      for (const dict of [rawInputsById, Object.fromEntries(rawNodeMeta.map((m) => [m.id, true])), graph as Record<string, any>]) {
        if (!dict) continue;
        if (Object.prototype.hasOwnProperty.call(dict, full)) return full;
      }
      /* Fallback: match `9b9009e4` against `9b9009e4-2d3d-…`.  Requires a
       * word-boundary char (`-`) right after the prefix so `9b9009e4` never
       * collides with `9b9009e44`. */
      for (const dict of [rawInputsById, Object.fromEntries(rawNodeMeta.map((m) => [m.id, true])), graph as Record<string, any>]) {
        if (!dict) continue;
        const hit = Object.keys(dict).find((k) => k.length > full.length && k.startsWith(full) && k.charAt(full.length) === "-");
        if (hit) return hit;
      }
      return full;
    })();

    if (v.direction === "output") {
      const meta = rawNodeMeta.find((m) => m.id === canonicalNodeId);
      const out = meta?.outputs.find((o) => o.name === v.name);
      if (out) {
        type = out.type || "*";
        label = label ?? out.label ?? out.localized ?? out.name;
      }
    } else {
      const ri = (rawInputsById[canonicalNodeId] ?? []).find((r) => r.name === v.name);
      if (ri) {
        type = ri.type || "*";
        label = label ?? ri.label ?? ri.localized ?? ri.name;
        if (ri.widgetValue !== undefined) defaultValue = ri.widgetValue;
      }
      /* API-only imports carry no rawJson → rawInputsById is empty.  Fall
       * back to the literal sitting in the API graph and infer the type
       * from its JS runtime type (good enough to pick a control). */
      if (defaultValue === undefined) {
        const gv = (graph as Record<string, any>)[canonicalNodeId]?.inputs?.[v.name];
        if (gv !== undefined && !Array.isArray(gv)) defaultValue = gv;
      }
      if (type === "*" && defaultValue !== undefined) {
        if (typeof defaultValue === "boolean") type = "BOOLEAN";
        else if (typeof defaultValue === "number")
          type = Number.isInteger(defaultValue) ? "INT" : "FLOAT";
        else if (typeof defaultValue === "string") type = "STRING";
      }
      /* COMBO candidate list: a wrapper COMBO already carries `comboOptions`
       *  from the R73-B pass; a direct (non-wrapper) COMBO node resolves via
       *  its class type.  ComfyUI unreachable → options stays undefined → the
       *  form falls back to a plain text control. */
      if (type === "COMBO") {
        if (ri && (ri as any).comboOptions) {
          options = (ri as any).comboOptions;
        } else {
          const byClass = await comboOptionsForClassField(nodeTypeById[canonicalNodeId], v.name);
          /* R-ardot73-C: wrapper nodes (esp. `comfy-core` subgraphs whose
           *  `properties.proxyWidgets` is absent/quarantined) can't resolve the
           *  internal class, so the class lookup above returns nothing.  Fall
           *  back to a field-name scan across object_info to recover the option
           *  list for uniquely-named COMBOs (e.g. `resolution_preset`). */
          options = byClass ?? (await comboOptionsForFieldName(v.name));
        }
      }
    }

    workflowIO[ioKey] = {
      direction: v.direction,
      kind: v.kind,
      nodeId: String(v.nodeId),
      name: v.name,
      label: label ?? v.name,
      type,
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      ...(options ? { options } : {}),
      nodeTitle: nodeTitleById[canonicalNodeId] ?? nodeTitleById[String(v.nodeId)],
      ...(type === "STRING" &&
      (MULTILINE_HINT.test(v.name) ||
        MULTILINE_HINT.test(String(label ?? "")) ||
        (typeof defaultValue === "string" && defaultValue.length > 40))
        ? { multiline: true }
        : {}),
      /* R-ardot35 (2026-08-15): pass the user-defined displayOrder
       *  through.  It was authored on a previous session via the IO-edit
       *  preview's drag-to-reorder gesture, persisted via PATCH, and now
       *  read back here so consumers can sort by it.  Coerce to number
       *  (PATCH might serialize a string for whatever reason) and only
       *  forward finite integers so a corrupted value can't poison the
       *  sort comparator downstream. */
      ...(typeof v.displayOrder === "number" && Number.isFinite(v.displayOrder)
        ? { displayOrder: v.displayOrder }
        : {}),
      /* R94 (2026-08-17): preserve any author override of the default value.
       *  `value` is stored verbatim via PATCH (the whole workflowIO object is
       *  persisted as-is) and must survive this GET rebuild so a custom
       *  default isn't silently dropped on reload. */
      ...(v.value !== undefined ? { value: v.value } : {}),
    };
  }

  /* ── Groups (ComfyUI frame rectangles) ──
   * Raw UI format stores them in `raw.groups[]`, each shaped roughly as:
   *   { title, bounding: [x, y, w, h], color }   (color is a hex string)
   * We forward them so the editor can render faithful background frames that
   * can be nested (a child group's bounding box sits inside its parent's). */
  const groups: { id: string; title: string; bounding: [number, number, number, number]; color: string; bypass: boolean }[] = [];
  if (raw && Array.isArray(raw.groups)) {
    raw.groups.forEach((g: any, idx: number) => {
      if (!g) return;
      const b = Array.isArray(g.bounding) && g.bounding.length >= 4 ? g.bounding : [0, 0, 0, 0];
      groups.push({
        id: String(g.id ?? `g-${idx}`),
        title: typeof g.title === "string" ? g.title : "",
        bounding: [Number(b[0]) || 0, Number(b[1]) || 0, Number(b[2]) || 0, Number(b[3]) || 0],
        color: typeof g.color === "string" ? g.color : "#3b3b3b",
        /* Group bypass state (2026-08-09).  Forwarded so rgthree's
         *  `Fast Groups Bypasser` runtime UI can reflect — and toggle —
         *  the `flags.bypass` of every matched group via PATCH.  Stored
         *  on the group's `flags` object in rawJson, same place
         *  ComfyUI's own frontend reads it. */
        bypass: !!(g.flags && (g.flags as any).bypass),
      });
    });
  }

  /* ── Notes (Note / MarkdownNote annotation nodes) ──
   * Their text lives in widgets_values[0]; position/size in pos/size. */
  const notes: { id: string; title: string; text: string; pos: [number, number]; size: [number, number]; color: string }[] = [];
  if (raw && Array.isArray(raw.nodes)) {
    raw.nodes.forEach((n: any) => {
      if (!n || (n.type !== "Note" && n.type !== "MarkdownNote")) return;
      const pos = Array.isArray(n.pos) && n.pos.length >= 2 ? n.pos : [0, 0];
      const size = Array.isArray(n.size) && n.size.length >= 2 ? n.size : [220, 120];
      const wv = Array.isArray(n.widgets_values) ? n.widgets_values[0] : "";
      const text = typeof wv === "string" ? wv : String(wv ?? "");
      // ComfyUI's Note node may carry an explicit `title` field (newer
      // versions); if absent we leave the title empty so the client can
      // fall back to extracting one from the first markdown heading line.
      const title = typeof n.title === "string" ? n.title : "";
      notes.push({
        id: String(n.id),
        title,
        text,
        pos: [Number(pos[0]) || 0, Number(pos[1]) || 0],
        size: [Number(size[0]) || 220, Number(size[1]) || 120],
        color: typeof n.color === "string" ? n.color : "#3a3a3a",
      });
    });
  }

  /* Independent booleans — pre-2026-08-09 the API conflated "has rawJson"
   *  with "raw format" (i.e. `format:"raw"` could mean either both API+RAW
   *  OR only RAW-without-API).  These flags let the UI render the correct
   *  badge / disable the 使用 button when API is missing.  `apiOrigin` is
   *  computed alongside so the UI can honestly label whether the graph
   *  came from a user-initiated API export or was auto-derived from raw. */
  const detailHasApi = !!graph && Object.keys(graph).length > 0;
  const detailHasRaw = !!raw;
  /* 2026-08-12 R76: apiSource === "user" overrides the hasRaw heuristic —
   *  when the user has explicitly drag-upgraded this workflow with a real
   *  API JSON, it counts as user-imported even if rawJson is also kept
   *  (rawJson is retained for viewing, graph is the real execution source). */
  const detailApiOrigin: "user" | "derived" | null = detailHasApi
    ? tpl.apiSource === "user"
      ? "user"
      : detailHasRaw
        ? "derived"
        : "user"
    : null;
  return JSON.stringify({
    id: tpl.id,
    name: tpl.name,
    taskType: tpl.taskType,
    /** 2026-08-13: multi-mode support. `modes` is the full set of mode codes
     *  this workflow can run as (JSON-string column parsed here); `defaultMode`
     *  is the canonical default (kept in sync with `taskType` on write). */
    modes: parseModesJson(tpl.modes),
    defaultMode: tpl.defaultMode ?? null,
    graph,
    /** The original RAW (UI-format) JSON as imported — forwarded so the
     *  client can show / re-download the source in its native form.  Null
     *  for API-only imports (no rawJson on disk). */
    rawJson: raw,
    nodes,
    /** 2026-08-13 R82: RAW 视图专用节点/位置/图（保留 subgraph wrapper）。
     *  flat form 等工作流的存库 graph 被拆平成 N:xx，RAW 布局若只用 `nodes`
     *  会显示炸开的 17 节点；rawView 从 rawJson 重新派生，RAW 视图据此渲染
     *  原始的 5 节点（含 wrapper 紫色整卡），与 wrapper-form 兄弟一致。
     *  null 表示该工作流无 rawJson（API-only 导入）。 */
    rawView,
    paramMap,
    workflowIO,
    positions,
    groups,
    notes,
    rawNodes: rawNodeMeta,
    format: detailHasRaw ? "raw" : "api",
    hasApi: detailHasApi,
    hasRaw: detailHasRaw,
    usable: detailHasApi,
    apiOrigin: detailApiOrigin,
    sourcePath,
    sourceChanged,
    sourceMissing,
    /** Classification: "local" when tied to an on-disk file, else "online". */
    source: sourcePath ? "local" : "online",
  });
  });

  return JSON.parse(detailJson);
}


export async function buildSubgraphDetail(
  userId: string,
  id: string,
  uid: string
): Promise<WorkflowDetailFull> {
  const cacheKey = `sg:${userId}:${id}:${uid}`;

  /* Hot path: return the pre-serialized subgraph detail verbatim, skipping
   * the Prisma read + transform.  (Never cached: 400/404 cases below.) */
  const cached = cachePeek<string>(cacheKey);
  if (cached !== undefined && typeof cached === "string") {
    return JSON.parse(cached);
  }

  const tpl = await workflowTemplateRepository.findByIdForUserSelect(userId, id, {
    id: true,
    name: true,
    taskType: true,
    graph: true,
    rawJson: true,
    positions: true,
    paramMap: true,
  });
  if (!tpl) throw new TRPCError({ code: "NOT_FOUND", message: "未找到该工作流" });

  const raw = (tpl.rawJson ?? null) as any;
  if (!raw || !raw.definitions || !raw.definitions.subgraphs) {
    throw new TRPCError({ code: "NOT_FOUND", message: "该工作流没有内嵌子工作流" });
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
    throw new TRPCError({ code: "NOT_FOUND", message: `未找到子工作流 ${uid.slice(0, 8)}` });
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

  return JSON.parse(detailJson);
}
