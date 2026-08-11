import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getServerUser } from "@/lib/auth-server";
import { detectParamMap } from "@/lib/comfyui/workflow";
import { extractPositions, type RawWorkflow } from "@/lib/comfyui/raw";
import { cacheJson, cacheDel, cachePeek } from "@/lib/server-cache";
import { inferIsMultiline } from "@/lib/comfyui/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DETAIL_CACHE_HEADERS = {
  // Brief client/CDN cache: repeat opens within 10s are instant;
  // up to 30s of stale is served while revalidating in the background.
  // 2026-08-06 R3: shortened to 10/30s so any field-mapping change in
  // this route auto-expires within at most 30s — paired with the
  // client's `cache: "no-store"` and `_r3` bust parameter below, we
  // now have a server cache that can never lock a stale schema for
  // long.  Clients that DO want to re-use a fresh hit (cache:"force-
  // cache") will see at most 10s of staleness.
  "Cache-Control": "private, max-age=10, stale-while-revalidate=30",
} as const;

// Get a single imported workflow with its full graph (for the node preview /
// parameter-mapping editor) plus its role-node mapping.  Returns positions
// when the workflow was imported in raw UI format (so the editor can lay the
// canvas out exactly as the user arranged it in ComfyUI).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getServerUser();
  const cacheKey = `wf:${user.id}:${id}`;

  /* 2026-08-06 R3: ?_bust=1 query flag forces the in-memory LRU to be
   *  bypassed (deleted + re-built) so the 顶栏 🔄 强制重载按钮 can pull
   *  a guaranteed-fresh serialisation from Prisma.  Without this, even
   *  cache:"no-store" on the client would still pull a 60s-stale
   *  pre-serialised JSON blob from server memory.  The flag is
   *  deliberately a private client-only token — never logged. */
  const url = new URL(req.url);
  if (url.searchParams.has("_bust")) {
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
  const meta = await prisma.workflowTemplate.findFirst({
    where: { id, userId: user.id },
    select: { id: true, sourcePath: true, sourceMtime: true, sourceChecksum: true },
  });
  if (meta?.sourcePath) {
    sourcePath = meta.sourcePath;
    const { reimportFromSource } = await import("@/lib/comfyui/importSource");
    const re = await reimportFromSource({
      sourcePath: meta.sourcePath,
      sourceMtime: meta.sourceMtime,
      sourceChecksum: meta.sourceChecksum,
    });
    if (re.missing) {
      sourceMissing = true;
      cacheDel(cacheKey); // rebuild so the missing flag reaches the client
    } else if (re.update) {
      await prisma.workflowTemplate.update({
        where: { id },
        data: {
          graph: re.update.graph as any,
          rawJson: re.update.rawJson as any,
          positions: re.update.positions as any,
          paramMap: re.update.paramMap as any,
          taskType: re.update.taskType,
          sourceChecksum: re.update.sourceChecksum,
          sourceMtime: re.update.sourceMtime,
        },
      });
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
    return new NextResponse(cached, {
      status: 200,
      headers: { "Content-Type": "application/json", ...DETAIL_CACHE_HEADERS },
    });
  }

  const tpl = await prisma.workflowTemplate.findFirst({
    where: { id, userId: user.id },
    select: {
      id: true,
      name: true,
      taskType: true,
      graph: true,
      paramMap: true,
      workflowIO: true,
      rawJson: true,
      positions: true,
    },
  });
  if (!tpl) return NextResponse.json({ error: "未找到该工作流" }, { status: 404 });

  /* The transform below is pure (depends only on tpl.graph / tpl.rawJson /
   * tpl.positions which never change between writes), so we cache the already
   * serialized JSON string by user+id.  Repeated opens return it verbatim.
   *
   * 2026-08-06 R3: TTL shortened from 60_000ms → 30_000ms so it locks at
   * most 30s of staleness even if client cache:"no-store" is bypassed. */
  const detailJson = await cacheJson(cacheKey, 30_000, () => {
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
          widgetCounter += 1;
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
  const paramMap = (tpl.paramMap as Record<string, string>) ?? detectParamMap(graph);
  // User-curated exposure selection: which node params/widgets/outputs are
  // exposed as the workflow's external inputs/outputs.  (ioKey is
  // `${nodeId}::${kind}::${name}`; see the canvas editor's IO-edit mode.)
  const workflowIORaw = (tpl.workflowIO as Record<string, { direction: "input" | "output"; kind: string; nodeId: string; name: string; label?: string }>) ?? {};

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
    }
  > = {};
  for (const [ioKey, v] of Object.entries(workflowIORaw)) {
    if (!v || typeof v !== "object") continue;
    let type = "*";
    let defaultValue: unknown = undefined;
    let label = v.label;

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
    }

    workflowIO[ioKey] = {
      direction: v.direction,
      kind: v.kind,
      nodeId: String(v.nodeId),
      name: v.name,
      label: label ?? v.name,
      type,
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      nodeTitle: nodeTitleById[canonicalNodeId] ?? nodeTitleById[String(v.nodeId)],
      ...(type === "STRING" &&
      (MULTILINE_HINT.test(v.name) ||
        MULTILINE_HINT.test(String(label ?? "")) ||
        (typeof defaultValue === "string" && defaultValue.length > 40))
        ? { multiline: true }
        : {}),
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
  const detailApiOrigin: "user" | "derived" | null = detailHasApi
    ? detailHasRaw
      ? "derived"
      : "user"
    : null;
  return JSON.stringify({
    id: tpl.id,
    name: tpl.name,
    taskType: tpl.taskType,
    graph,
    /** The original RAW (UI-format) JSON as imported — forwarded so the
     *  client can show / re-download the source in its native form.  Null
     *  for API-only imports (no rawJson on disk). */
    rawJson: raw,
    nodes,
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

  return new NextResponse(detailJson, {
    status: 200,
    headers: { "Content-Type": "application/json", ...DETAIL_CACHE_HEADERS },
  });
}

// Persist editor state for a workflow: the role-node mapping (`paramMap`),
// saved node positions (`positions`), and note annotation positions (`notes`).
// Every field is optional; only the fields present in the request body are
// written.  A cache entry is invalidated after any successful write so the
// next detail GET re-serializes fresh data.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getServerUser();
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }
  const tpl = await prisma.workflowTemplate.findFirst({ where: { id, userId: user.id } });
  if (!tpl) return NextResponse.json({ error: "未找到该工作流" }, { status: 404 });

  const updateData: Record<string, unknown> = {};

  // 1) Role-node mapping (which node is the positive prompt, etc.).
  if (body.paramMap && typeof body.paramMap === "object") {
    updateData.paramMap = body.paramMap;
  }

  // 1b) Workflow IO exposure selection (subgraph input/output editing mode).
  if (body.workflowIO && typeof body.workflowIO === "object") {
    updateData.workflowIO = body.workflowIO;
  }

  // 2) Saved node positions (real graph nodes), keyed by node id.
  //
  //  Default mode is REPLACE — the client sends the full snapshot.  When
  //  `body.merge === true` (used by the canvas editor while inside a
  //  subgraph view), the body entries are MERGED into the existing
  //  `tpl.positions` instead of replacing them.  This prevents a single
  //  inner-subgraph drag from wiping the top-level workflow's positional
  //  data (or the inverse) — both namespaces live in the same column.
  if (body.positions && typeof body.positions === "object") {
    const incoming = body.positions as Record<string, [number, number]>;
    if (body.merge === true) {
      const cur = (tpl.positions as Record<string, [number, number]>) ?? {};
      updateData.positions = { ...cur, ...incoming };
    } else {
      updateData.positions = incoming;
    }
  }

  // 3) Group bypass toggles (rgthree Fast Groups Bypasser integration)
  //    → rawJson.groups[i].flags.bypass.  Body shape: { groups: [{id, bypass}] }.
  // 4) Note annotation positions → written back into rawJson.nodes[i].pos.
  //    Note ids arrive as the editor's `note:<rawId>`; strip the prefix.
  // Both blocks mutate the same rawJson buffer; the final result is written
  // once so a single PATCH can carry both kinds of edit without losing
  // either (e.g. a bypass toggle + a note drag in the same round-trip).
  const wantsGroups = Array.isArray(body.groups) && body.groups.length > 0;
  const wantsNotes = Array.isArray(body.notes) && body.notes.length > 0;
  if (wantsGroups || wantsNotes) {
    const raw = (tpl.rawJson ?? {}) as any;
    if (wantsGroups && Array.isArray(raw.groups)) {
      for (const upd of body.groups as { id?: unknown; bypass?: unknown }[]) {
        const gid = String(upd.id ?? "");
        if (!gid) continue;
        const grp = raw.groups.find((g: any) => String(g?.id) === gid);
        if (!grp) continue;
        if (!grp.flags || typeof grp.flags !== "object") grp.flags = {};
        grp.flags.bypass = !!upd.bypass;
      }
    }
    if (wantsNotes) {
      if (!Array.isArray(raw.nodes)) raw.nodes = [];
      for (const note of body.notes as { id?: unknown; pos?: unknown }[]) {
        const noteId = String(note.id ?? "").replace(/^note:/, "");
        const pos = note.pos as unknown;
        if (!noteId || !Array.isArray(pos) || pos.length < 2) continue;
        const node = raw.nodes.find(
          (n: any) =>
            String(n?.id) === noteId &&
            (n?.type === "Note" || n?.type === "MarkdownNote")
        );
        if (node) {
          node.pos = [Number(pos[0]) || 0, Number(pos[1]) || 0];
        }
      }
    }
    updateData.rawJson = raw;
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "没有需要保存的字段" }, { status: 400 });
  }

  await prisma.workflowTemplate.update({ where: { id }, data: updateData });
  cacheDel(`wf:${user.id}:${id}`);
  return NextResponse.json({ ok: true });
}

// Delete an imported workflow (only the owner can delete it).
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getServerUser();
  const tpl = await prisma.workflowTemplate.findFirst({ where: { id, userId: user.id } });
  if (!tpl) return NextResponse.json({ error: "未找到该工作流" }, { status: 404 });
  await prisma.workflowTemplate.delete({ where: { id } });
  cacheDel(`wf:${user.id}:${id}`);
  return NextResponse.json({ ok: true });
}
