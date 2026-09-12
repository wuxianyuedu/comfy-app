/**
 * Workflow detail / subgraph detail builders — ported from the legacy
 * REST routes (src/app/api/workflows/[id]/route.ts GET and
 * src/app/api/workflows/[id]/subgraph/route.ts GET) into shared lib
 * functions so the tRPC router can serve the exact same derived shapes
 * through `workflow.detailFull` / `workflow.subgraph`.
 *
 * Cache keys keep the legacy namespaces (`wf:` / `sg:`) so existing
 * server-side cache entries remain valid.
 *
 * batch 4: the heavy per-format parsing was extracted into sibling
 * modules — workflow-detail-combo.ts (COMBO resolvers), workflow-detail-raw.ts
 * (RAW input/output/view parsing), workflow-detail-io.ts (workflowIO
 * enrichment) and workflow-subgraph-parse.ts (subgraph link/graph/pin
 * parsing).  This file keeps only the orchestration + caching layers.
 */
import { TRPCError } from "@trpc/server";
import { workflowTemplateRepository } from "@/lib/core/repository";
import { detectParamMap } from "@/lib/comfyui/workflow";
import {
  asRawWorkflow,
  asRecord,
  extractPositions,
  toStringValue,
  type ApiWorkflowNode,
} from "@/lib/comfyui/raw";
import { cacheJson, cacheDel, cacheDelPrefix, cachePeek } from "@/lib/server-cache";
import { parseModesJson } from "@/lib/workflow-types";
import { createComboResolver } from "@/lib/comfyui/workflow-detail-combo";
import {
  buildRawInputs,
  buildRawNodeMeta,
  buildNodeTypeMap,
  buildInnerNodeInputs,
  buildRawView,
  type DetailNodeView,
  type RawNodeMeta,
  type RawViewPacket,
} from "@/lib/comfyui/workflow-detail-raw";
import {
  enrichWorkflowIO,
  type WorkflowIOEntry,
  type WorkflowIORawEntry,
} from "@/lib/comfyui/workflow-detail-io";
import {
  parseSubgraphLinks,
  buildSubgraphGraph,
  parseSubgraphPins,
  buildBoundaryLinks,
  extractSubgraphAnnotations,
  type BoundaryLink,
  type BoundaryPin,
} from "@/lib/comfyui/workflow-subgraph-parse";

/** workflowIO 条目（enrichWorkflowIO 的返回形状 + kind 收窄为客户端契约的
 *  联合类型）。`kind` 是 IO-edit 模式写入的三桶语义标记（param/widget/
 *  output），PATCH 原样落库、GET 原样回显；JSON 序列化边界处按此类型收窄，
 *  与客户端 WorkflowDetail.workflowIO（components/studio/workflow-types.ts
 *  的 WorkflowIOParam）保持 tRPC 推断兼容。 */
export interface WorkflowDetailIOEntry extends WorkflowIOEntry {
  kind: "param" | "widget" | "output";
}

/** ComfyUI group frames 的下发形状（镜像客户端 WorkflowGroup，bypass 恒写入）。 */
export interface WorkflowDetailGroup {
  id: string;
  title: string;
  bounding: [number, number, number, number];
  color: string;
  bypass: boolean;
}

/** Note / MarkdownNote 注记的下发形状（镜像客户端 WorkflowNote）。 */
export interface WorkflowDetailNote {
  id: string;
  title: string;
  text: string;
  pos: [number, number];
  size: [number, number];
  color: string;
}

/** Shape returned by the legacy `GET /api/workflows/:id` (and the subgraph
 *  variant) — mirrors the client-side `WorkflowDetail` interface in
 *  components/studio/wf-types.ts.  Some fields only appear on the
 *  subgraph variant. */
export interface WorkflowDetailFull {
  id: string;
  name: string;
  taskType: string;
  /** Full set of mode codes the workflow can run as (parsed from the
   *  JSON-string column).  Subgraph variant omits it. */
  modes?: string[];
  defaultMode?: string | null;
  graph: Record<string, ApiWorkflowNode>;
  /** Original RAW (UI-format) JSON as imported; null for API-only. */
  rawJson?: unknown;
  nodes: DetailNodeView[];
  /** RAW view packet (nodes/positions/graph) re-derived from rawJson. */
  rawView?: RawViewPacket | null;
  paramMap: Record<string, string>;
  workflowIO: Record<string, WorkflowDetailIOEntry>;
  positions: Record<string, [number, number]> | null;
  groups: WorkflowDetailGroup[];
  notes: WorkflowDetailNote[];
  rawNodes: RawNodeMeta[];
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
    inputs: BoundaryPin[];
    outputs: BoundaryPin[];
  };
  /** Subgraph variant: sentinel wire ↔ pin/slot pairs. */
  boundaryLinks?: BoundaryLink[];
}


/** 丢弃某个工作流已缓存的详情（顶层 + 它的全部子图视图）。
 *
 *  PATCH 之后必须调用：服务端详情缓存 TTL 30s，不主动清的话客户端就算重新
 *  拉 `detailFull` 也会拿回改动前的富化 IO，界面看起来像「改了没生效」。 */
export function invalidateWorkflowDetailCache(userId: string, id: string): void {
  cacheDel(`wf:${userId}:${id}`);
  cacheDelPrefix(`sg:${userId}:${id}:`);
}

export async function buildWorkflowDetailFull(
  userId: string,
  id: string,
  opts: { bust?: boolean } = {}
): Promise<WorkflowDetailFull> {
  const cacheKey = `wf:${userId}:${id}`;

  /* COMBO option resolver. ComfyUI COMBO widgets
   * (unet_name / clip_name / vae_name / ckpt_name …) carry NO candidate
   * list in the raw JSON — the only authoritative source is
   * /api/object_info.  The resolver fetches it once per request
   * (fetchObjectInfo itself caches for 5 min + degrades to null when
   * ComfyUI is unreachable) and resolves `classType + field` → candidate
   * array so the project-canvas form and the subgraph wrapper node can
   * render a real <select> instead of a free-text box.  Missing /
   * unreachable → undefined → graceful fallback to a plain text control.
   * Implementation lives in workflow-detail-combo.ts. */
  const { comboOptionsForClassField, comboOptionsForFieldName } =
    createComboResolver();

  /* ?_bust=1 query flag forces the in-memory LRU to be
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
      /* 透传已存在的 taskType 让 reimport 时保留
       * 用户在 UI 里手动设置的值（不再被自动推断覆盖）。 */
      existingTaskType: meta.taskType ?? null,
    });
    if (re.missing) {
      sourceMissing = true;
      cacheDel(cacheKey); // rebuild so the missing flag reaches the client
    } else if (re.update) {
      await workflowTemplateRepository.update(id, {
        graph: re.update.graph,
        rawJson: re.update.rawJson,
        positions: re.update.positions,
        paramMap: re.update.paramMap,
        taskType: re.update.taskType,
        sourceChecksum: re.update.sourceChecksum,
        sourceMtime: re.update.sourceMtime,
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
    return JSON.parse(cached) as WorkflowDetailFull;
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
   * TTL shortened from 60_000ms → 30_000ms so it locks at
   * most 30s of staleness even if client cache:"no-store" is bypassed. */
  const detailJson = await cacheJson(cacheKey, 30_000, async () => {
  /* 存库 graph 恒为 API 格式对象（Json 列）；rawJson 收窄为 RawWorkflow 视图
   * （根不是普通对象时为 null，下游均有守卫，路径与旧 any 代码等价）。 */
  const graph = tpl.graph as Record<string, ApiWorkflowNode>;
  const raw = asRawWorkflow(tpl.rawJson);

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
    raw && Array.isArray(raw.nodes) ? extractPositions(raw) : {};
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

  /* Per-node input metadata + exact ComfyUI box sizes (see
   * workflow-detail-raw.ts buildRawInputs for the full semantics —
   * base parser, seed 2-slot bundle, proxyWidgets enrichment and
   * COMBO resolution). */
  const { rawInputsById, sizeById } = await buildRawInputs(
    raw,
    comboOptionsForClassField
  );

  /* Sparse raw-node metadata — only enough for the canvas editor to render
   * the OUTPUT port strip and to feed Subgraph UI nodes (which need
   * widget_values to label their fields).  We don't ship the full raw graph
   * here; the saved graph + positions are already on detail. */
  const rawNodeMeta = buildRawNodeMeta(raw);

  const nodes: DetailNodeView[] = Object.entries(graph).map(([nodeId, n]) => {
    // ComfyUI exports vary: newer snapshots use `class_type`, older / some
    // rgthree-comfy exports use `type` only.  Fall back to `type` so the
    // subgraph-wrapper check below picks up UUID class names that live in
    // either field — without this fallback every node renders as a plain
    // WorkflowNode and subgraph wrappers dump their 10+ IO rows inline instead
    // of being recognised as `is_subgraph: true` for the compact WorkflowSubgraphNode.
    // （与旧 `n?.class_type || (n?.type as string) || "?"` 逐值等价：
    //  `a || b` ≡ `a ? a : b`，空串同样回退。）
    const classType: string = n.class_type
      ? n.class_type
      : n.type
        ? (n.type as string)
        : "?";
    const isUuidClass = /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(classType);
    /* Subgraph wrapper nodes (class_type === UUID) get their display name
     *  from raw.definitions.subgraphs[uid].name.  Same lookup as the
     *  subgraph route's `sub` resolver (subgraphs may be keyed by either
     *  the UUID or by their inner `.id` field).  Falls back to the
     *  existing empty-string sentinel when the name is missing — the
     *  client-side friendlyNodeTitle() then renders "子工作流" as a
     *  last-resort label, identical to the pre-fix behaviour. */
    let resolvedTitle: string | undefined;
    if (isUuidClass && raw?.definitions?.subgraphs) {
      const subs = raw.definitions.subgraphs;
      let def = subs[classType];
      if (!def) {
        const matchKey = Object.keys(subs).find((key) => subs[key]?.id === classType);
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
        n._meta?.title ??
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

  /* raw 视图专用数据包。
   * 存库的 `graph`（即 `detail.nodes` 的来源）在某些工作流里被「拆平」成了
   * `N:xx` 节点（例如某工作流的 flat form，而其 `_t2i` 兄弟保留 wrapper）。
   * 这种情况下画布 RAW 布局会显示 17 个被炸开的节点，而用户期望的是 5 个
   * 原始 ComfyUI 节点（含 wrapper 紫色整卡）。这里直接从 rawJson 再派生一份
   * `rawView`（保留 subgraph wrapper），让 RAW 布局与 wrapper-form 兄弟、与
   * ComfyUI 自身画布一致。fallbackRawToApi 走离线启发式、不发网络请求。 */
  const rawView = buildRawView(raw, rawInputsById, sizeById);

  const paramMap = (tpl.paramMap as Record<string, string>) ?? detectParamMap(graph);
  // User-curated exposure selection: which node params/widgets/outputs are
  // exposed as the workflow's external inputs/outputs.  (ioKey is
  // `${nodeId}::${kind}::${name}`; see the canvas editor's IO-edit mode.)
  const workflowIORaw = (asRecord(tpl.workflowIO) ?? {}) as Record<string, WorkflowIORawEntry>;

  const nodeTitleById: Record<string, string> = {};
  for (const n of nodes) nodeTitleById[n.id] = n.title ?? n.class_type;

  /* ── workflowIO ENRICHMENT ──
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
   * the downstream node is an image or a video node).
   * Implementation lives in workflow-detail-io.ts. */
  const workflowIO = await enrichWorkflowIO({
    workflowIORaw,
    rawInputsById,
    /* 子图内部节点索引：下钻到子工作流里勾选的参数，nodeId 指向内部节点，
     *  顶层 rawInputsById 查不到 —— 没有它类型/显示名都会退化（ISSUE #349）。 */
    innerInputsById: buildInnerNodeInputs(raw),
    rawNodeMeta,
    graph,
    nodeTitleById,
    nodeTypeById: buildNodeTypeMap(raw),
    comboOptionsForClassField,
    comboOptionsForFieldName,
  });

  /* ── Groups (ComfyUI frame rectangles) ──
   * Raw UI format stores them in `raw.groups[]`, each shaped roughly as:
   *   { title, bounding: [x, y, w, h], color }   (color is a hex string)
   * We forward them so the editor can render faithful background frames that
   * can be nested (a child group's bounding box sits inside its parent's). */
  const groups: WorkflowDetailGroup[] = [];
  if (raw && Array.isArray(raw.groups)) {
    raw.groups.forEach((g: unknown, idx: number) => {
      const rec = asRecord(g);
      if (!rec) return;
      const bounds: unknown[] =
        Array.isArray(rec.bounding) && rec.bounding.length >= 4 ? rec.bounding : [0, 0, 0, 0];
      groups.push({
        id: toStringValue(rec.id ?? `g-${idx}`),
        title: typeof rec.title === "string" ? rec.title : "",
        bounding: [Number(bounds[0]) || 0, Number(bounds[1]) || 0, Number(bounds[2]) || 0, Number(bounds[3]) || 0],
        color: typeof rec.color === "string" ? rec.color : "#3b3b3b",
        /* Group bypass state. Forwarded so rgthree's
         *  `Fast Groups Bypasser` runtime UI can reflect — and toggle —
         *  the `flags.bypass` of every matched group via PATCH.  Stored
         *  on the group's `flags` object in rawJson, same place
         *  ComfyUI's own frontend reads it. */
        bypass: !!(asRecord(rec.flags)?.bypass),
      });
    });
  }

  /* ── Notes (Note / MarkdownNote annotation nodes) ──
   * Their text lives in widgets_values[0]; position/size in pos/size. */
  const notes: WorkflowDetailNote[] = [];
  if (raw && Array.isArray(raw.nodes)) {
    raw.nodes.forEach((n) => {
      if (!n || (n.type !== "Note" && n.type !== "MarkdownNote")) return;
      const pos = Array.isArray(n.pos) && n.pos.length >= 2 ? n.pos : [0, 0];
      const size = Array.isArray(n.size) && n.size.length >= 2 ? n.size : [220, 120];
      const wv = Array.isArray(n.widgets_values) ? n.widgets_values[0] : "";
      const text = typeof wv === "string" ? wv : toStringValue(wv ?? "");
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

  /* Independent booleans — pre-the API conflated "has rawJson"
   *  with "raw format" (i.e. `format:"raw"` could mean either both API+RAW
   *  OR only RAW-without-API).  These flags let the UI render the correct
   *  badge / disable the 使用 button when API is missing.  `apiOrigin` is
   *  computed alongside so the UI can honestly label whether the graph
   *  came from a user-initiated API export or was auto-derived from raw. */
  const detailHasApi = !!graph && Object.keys(graph).length > 0;
  const detailHasRaw = !!raw;
  /* apiSource === "user" overrides the hasRaw heuristic
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
    /** multi-mode support. `modes` is the full set of mode codes
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
    /** RAW 视图专用节点/位置/图（保留 subgraph wrapper）。
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

  return JSON.parse(detailJson) as WorkflowDetailFull;
}


export async function buildSubgraphDetail(
  userId: string,
  id: string,
  uid: string,
  /** 宿主链前缀（`4` / `4:5`）。拖拽落库时子图内部节点用的是 `宿主:内部`
   *  拼接键，读回时必须按同一个口径还原，否则子图里拖过的位置在下次打开
   *  时全部退回原始坐标。 */
  hostId = ""
): Promise<WorkflowDetailFull> {
  const cacheKey = `sg:${userId}:${id}:${uid}:${hostId}`;

  /* Hot path: return the pre-serialized subgraph detail verbatim, skipping
   * the Prisma read + transform.  (Never cached: 400/404 cases below.) */
  const cached = cachePeek<string>(cacheKey);
  if (cached !== undefined && typeof cached === "string") {
    return JSON.parse(cached) as WorkflowDetailFull;
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

  const raw = asRawWorkflow(tpl.rawJson);
  if (!raw?.definitions?.subgraphs) {
    throw new TRPCError({ code: "NOT_FOUND", message: "该工作流没有内嵌子工作流" });
  }

  // Subgraph definitions may be keyed by either the UUID or a numeric id;
  // ComfyUI uses the UUID as the key for newer workflows.
  const subgraphs = raw.definitions.subgraphs;
  let sub = subgraphs[uid];
  if (!sub) {
    // Try matching by .id field
    const matchUid = Object.keys(subgraphs).find((key) => subgraphs[key]?.id === uid);
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
    /* Sentinal-link indexing + inner-node graph transform + boundary rails
     * all live in workflow-subgraph-parse.ts (see module docs there). */
    const { linkById, boundaryLinkInfoById } = parseSubgraphLinks(sub);
    const sg = buildSubgraphGraph(sub, linkById);
    /* 子图暴露口的作者名（proxyWidgets 被隔离时长名字的来源），随节点下发给
     *  客户端「就地派生富化」用 —— 顶层富化在这里也在场，直接按
     *  `节点id::widget::槽位名` 预先打进内层节点的 raw_inputs（见下）。
     *  查表键必须带节点 id：内部槽位名在同一子图里会重名（四个 `PrimitiveInt`
     *  的入参都叫 `value`），只按槽位名查会把最后一个暴露口的作者名安到所有
     *  同名字段上（ISSUE #394：`Seed` 节点显示成 `FPS`）。 */
    for (const n of sg.nodes) {
      for (const inp of n.raw_inputs ?? []) {
        const authorLabel = sg.proxyAuthorLabels[`${n.id}::${inp.name}`];
        if (!authorLabel) continue;
        /* 只对「本层槽位名与作者名不同」的暴露口打标；`field` 用槽位名本身，
         *  让富化按本层名字回查得中（顶层 `innerInputsById` 的键就是槽位名）。 */
        if (inp.name === authorLabel) continue;
        inp.label = authorLabel;
        inp.proxyField ??= { nodeId: "", field: inp.name, label: authorLabel };
      }
    }
    const { boundaryPins, pinIdByLinkId } = parseSubgraphPins(sub);
    const boundaryLinks = buildBoundaryLinks(
      boundaryLinkInfoById,
      pinIdByLinkId,
      sg.inputNameByNodeSlot,
      sg.outputNameByNodeSlot
    );
    const ann = extractSubgraphAnnotations(
      sub,
      (tpl.positions as Record<string, [number, number]>) ?? {},
      hostId
    );

    return JSON.stringify({
      id: `${tpl.id}#subgraph:${uid}`,
      name: typeof sub.name === "string" && sub.name ? sub.name : "子工作流",
      taskType: tpl.taskType,
      graph: sg.graph,
      nodes: sg.nodes,
      paramMap: tpl.paramMap ?? {},
      positions: ann.positions,
      groups: ann.groups,
      notes: ann.notes,
      rawNodes: sg.rawNodeMeta,
      format: "raw-subgraph",
      /* Pass the parent workflow id and the subgraph uid so the client
       *  can keep the breadcrumb accurate if it wants to re-fetch. */
      parentId: tpl.id,
      subgraphUid: uid,
      /* boundary rail data — the client renders each pin
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

  return JSON.parse(detailJson) as WorkflowDetailFull;
}
