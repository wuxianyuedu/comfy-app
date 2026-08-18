import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getServerUser } from "@/lib/auth-server";
import { detectParamMap, buildWorkflowPreview } from "@/lib/comfyui/workflow";
import {
  detectFormat,
  convertRawToApi,
  fallbackRawToApi,
  type ConversionResult,
} from "@/lib/comfyui/raw";
import {
  normalizeTaskType,
  VALID_TASK_TYPE_CODES,
  getWorkflowType,
  parseModesJson,
} from "@/lib/workflow-types";
import { readEnvVar } from "@/lib/envfile";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  scanLocalWorkflowRoots,
  scanLocalWorkflowChecksums,
  type LocalWorkflowFile,
} from "@/lib/comfyui/localWorkflows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 2026-08-10 R8: read the user-configured LOCAL_WORKFLOWS_PATH (.env) and
 *  split it into a normalised list (one absolute directory per line, OR
 *  comma-separated). Mirrors how CUSTOM_NODES_PATH is parsed elsewhere. */
function getLocalWorkflowRoots(): string[] {
  const raw = readEnvVar("LOCAL_WORKFLOWS_PATH") || "";
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Stable, deterministic placeholder id for files that exist on disk but
 *  haven't been imported yet. The id is a 12-char sha1 of the absolute
 *  path — same path always maps to the same placeholder id, so React's
 *  reconciliation doesn't churn when the list refreshes. */
function pendingId(absPath: string): string {
  return "pending-" + createHash("sha1").update(absPath).digest("hex").slice(0, 12);
}

/** Normalise an absolute path the same way `localWorkflows.pathKey` does:
 *  backslashes → forward slashes, lowercased. Used to determine which
 *  configured LOCAL_WORKFLOWS_PATH root a given `sourcePath` (an
 *  already-imported local workflow) lives under. */
function pathKey(p: string): string {
  if (!p) return "";
  try {
    return path.resolve(p).toLowerCase().replace(/\\/g, "/").replace(/\/+$/, "");
  } catch {
    return p.toLowerCase().replace(/\\/g, "/").replace(/\/+$/, "");
  }
}

/** Find the configured root whose `absPath` is a path-prefix of `filePath`.
 *  Returns the root's `rawPath` (verbatim) so the UI can show the user the
 *  exact directory they typed. Longest-prefix wins when roots overlap. */
function findRootFor(
  filePath: string,
  roots: Array<{ rawPath: string; absPath: string }>
): string | undefined {
  if (!filePath || roots.length === 0) return undefined;
  const target = pathKey(filePath);
  if (!target) return undefined;
  let best: { len: number; raw: string } | undefined;
  for (const r of roots) {
    const rk = pathKey(r.absPath);
    if (!rk) continue;
    const exact = target === rk;
    const child = target.startsWith(rk + "/");
    if (!exact && !child) continue;
    if (!best || rk.length > best.len) {
      best = { len: rk.length, raw: r.rawPath };
    }
  }
  return best?.raw;
}

// List the current user's imported ComfyUI workflows.
// Supports ?type=T2I (or any valid code) to filter by workflow type.
// Supports ?category=image|video|audio to filter by category.
export async function GET(req: NextRequest) {
  try {
    return await getWorkflows(req);
  } catch (e: any) {
    /** 2026-08-13 R-hotfix: never let the handler return 0-byte body.
     *  An empty body crashes the client's `r.json()` and pops a red
     *  "Unhandled Runtime Error" overlay on /updream/.  Always serialise
     *  the failure as JSON so the client can parse + display it. */
    console.error("[api/workflows] GET failed:", e?.message ?? e);
    console.error(e?.stack);
    return NextResponse.json(
      { error: e?.message ?? "服务器内部错误", workflows: [], localPending: [], localRoots: null },
      { status: 500 }
    );
  }
}

async function getWorkflows(req: NextRequest) {
  const user = await getServerUser();
  const url = new URL(req.url);

  // Build where clause based on filters
  const where: Record<string, unknown> = { userId: user.id };

  const typeParam = url.searchParams.get("type");
  if (typeParam) {
    const normalized = normalizeTaskType(typeParam);
    where.taskType = normalized;
  }

  const categoryParam = url.searchParams.get("category");
  if (categoryParam && !typeParam) {
    // If category is specified but not type, collect all codes for that category
    const { getWorkflowTypesByCategory } = await import("@/lib/workflow-types");
    const typesInCat = getWorkflowTypesByCategory(categoryParam as any);
    if (typesInCat.length > 0) {
      where.taskType = { in: typesInCat.map((t) => t.code) };
    }
  }

  // 2026-08-15: filter by model tag name (user-level global tag library).
  // A workflow matches if it has ANY of the comma-separated tag names.
  const modelParam = url.searchParams.get("model");
  if (modelParam) {
    const names = modelParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length > 0) {
      where.modelTags = { some: { name: { in: names } } };
    }
  }

  const list = await prisma.workflowTemplate.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      taskType: true,
      createdAt: true,
      paramMap: true,
      graph: true,
      rawJson: true,
      sourcePath: true,
      /** 2026-08-15: model tag names attached to this workflow. */
      modelTags: { select: { name: true } },
      /** 2026-08-10 R16: select sourceMtime/sourceChecksum so the list can
       *  compute isDirty (`diskMtimeSec > sourceMtime`) and surface a "↻
       *  同步" action when the on-disk file has changed since the last
       *  reimport. The list still doesn't auto-sync (manual-sync mode); the
       *  endpoint POST /api/workflows/[id]/resync is the user-visible
       *  write trigger. */
      sourceMtime: true,
      sourceChecksum: true,
      /** 2026-08-09: expose the user-curated IO on list rows too, so the
       *  library card can show the workflow's inputs/outputs (when no
       *  graph preview is available) instead of a blank gradient.
       *  Raw shape is fine — the client renders with its own helper. */
      workflowIO: true,
      /** 2026-08-12 R76: marker that distinguishes "user-imported API +
       *  kept RAW" from "RAW-derived API". Forwarded so the list can
       *  compute apiOrigin correctly (overrides the hasRaw heuristic). */
      apiSource: true,
      /** 2026-08-13: multi-mode support — both columns are strings in SQLite
       *  (modes is a JSON-string column); parsed before shipping to client. */
      modes: true,
      defaultMode: true,
    },
  });

  // ── Local-on-disk roots (2026-08-10 R8, label-source R11, sync-state R16) ─
  // Walk every directory listed in LOCAL_WORKFLOWS_PATH. The scan runs FIRST
  // (before `enriched.map`) so the row enrichment can stamp each already-
  // imported local file with `diskDirty / diskMtimeSec / sourceMtimeSec` /
  // `diskMissing`, and the `localPending` builder below can rely on
  // `localAllFiles` + the same root metadata. Read-only by iron rule
  // (localWorkflows.ts); the directory is never written to.
  const localRoots = getLocalWorkflowRoots();
  let localRootsSummary:
    | Array<{
        rawPath: string;
        absPath: string;
        exists: boolean;
        count: number;
        error?: string;
      }>
    | null = null;
  let localRootsList: Array<{ rawPath: string; absPath: string; exists: boolean }> = [];
  let localAllFiles: LocalWorkflowFile[] = [];
  if (localRoots.length > 0) {
    const { roots, allFiles } = scanLocalWorkflowRoots(localRoots);
    localRootsSummary = roots.map((r) => ({
      rawPath: r.rawPath,
      absPath: r.absPath,
      exists: r.exists,
      count: r.files.length,
      error: r.error,
    }));
    localRootsList = roots.map((r) => ({
      rawPath: r.rawPath,
      absPath: r.absPath,
      exists: r.exists,
    }));
    localAllFiles = allFiles;
  }

  // ── Disk-mtime index by absolute path (2026-08-10 R16) ──────────────────
  // Used by `enriched.map` below to compute `diskDirty` / `diskMissing`
  // for already-imported local rows.  Manual-sync mode only — the list
  // never auto-resyncs; the user-visible write trigger is
  // POST /api/workflows/[id]/resync.  Keyed by the same `pathKey`
  // normalisation used elsewhere, so Windows volume-letter case +
  // slash direction don't mismatch.
  const diskMtimeByPath = new Map<string, number>();
  for (const f of localAllFiles) {
    if (!f.absPath) continue;
    diskMtimeByPath.set(pathKey(f.absPath), f.mtimeMs);
  }

  // ── Content-addressed relink (R-ardot105, 2026-08-17) ─────────────────
  // When a user renames a local JSON on disk, the DB still points at the
  // OLD absolute path; without help, the row surfaces as `diskMissing`
  // and the library refuses to operate it.  We compute the SHA-1 slice
  // for every readable `.json` / `.workflow` in the configured roots and
  // match missing rows by `sourceChecksum` — content is identical after
  // a rename, so the match is unambiguous.  On a hit we update the row
  // in-place (new `sourcePath` + fresh `sourceMtime`) and remember the
  // move so the UI can flash a "已自动重新链接 → 新文件名" toast.  If
  // multiple files share the same checksum (rare but possible), we pick
  // the one with the most recent mtime.
  //
  // No-op when no LOCAL_WORKFLOWS_PATH is configured or every scan
  // fails — `diskMissing` then stays as-is and the manual "重新链接"
  // button is the user's escape hatch.
  const renamedFromTo = new Map<string, string>(); // id → "old.json" → "new.json"
  if (localAllFiles.length > 0) {
    const checksumEntries = await scanLocalWorkflowChecksums(localRoots);
    // Build checksum → {absPath, mtimeMs}; on collision, keep the newer file.
    const checksumIndex = new Map<string, { absPath: string; mtimeMs: number }>();
    for (const e of checksumEntries) {
      if (!e.checksum) continue;
      const cur = checksumIndex.get(e.checksum);
      if (!cur || e.mtimeMs > cur.mtimeMs) {
        checksumIndex.set(e.checksum, { absPath: e.absPath, mtimeMs: e.mtimeMs });
      }
    }
    for (const w of list) {
      if (!w.sourcePath || !w.sourceChecksum) continue;
      if (diskMtimeByPath.has(pathKey(w.sourcePath))) continue; // still there
      const hit = checksumIndex.get(w.sourceChecksum);
      if (!hit) continue;
      // Persist the relink + remember the move for the UI toast.
      const oldName = w.sourcePath.split(/[\\/]/).pop() ?? w.sourcePath;
      const newName = hit.absPath.split(/[\\/]/).pop() ?? hit.absPath;
      try {
        await prisma.workflowTemplate.update({
          where: { id: w.id },
          data: {
            sourcePath: hit.absPath,
            sourceMtime: Math.floor(hit.mtimeMs / 1000),
          },
        });
        // Mirror the DB write into the in-memory `list` row so the
        // downstream `enriched.map` (and the `existingByPath` set that
        // suppresses the rename-shifted pending card) sees the new
        // path immediately.
        w.sourcePath = hit.absPath;
        w.sourceMtime = Math.floor(hit.mtimeMs / 1000);
        diskMtimeByPath.set(pathKey(hit.absPath), hit.mtimeMs);
        renamedFromTo.set(w.id, `${oldName} → ${newName}`);
      } catch (e: any) {
        console.warn(
          `[api/workflows] R-ardot105 relink failed for ${w.id}: ${e?.message ?? e}`
        );
      }
    }
  }

  // Enrich with type metadata (label, category, description) and a compact
  // node-graph preview so the library card can show what the workflow looks
  // like without re-fetching the full graph.
  const enriched = list.map((w) => {
    const def = getWorkflowType(normalizeTaskType(w.taskType));
    // API（graph）只在用户从 ComfyUI「导出(API Format)」导入时存在；
    // 仅导入 RAW 格式时 graph 由 raw→api 在线转换得到，仅有 RAW 时则完全为空。
    // 真正能跑通的只有「graph 非空」的工作流。
    const graphObj = (w.graph as Record<string, any> | null) ?? null;
    const hasApi = !!graphObj && Object.keys(graphObj).length > 0;
    const hasRaw = !!w.rawJson;
    /* apiOrigin disambiguates where the executable graph came from (so the
     *  UI can label it honestly — see the modal/banner notes):
     *   "user"    = imported as API Format from ComfyUI, OR the user has
     *               explicitly drag-upgraded this workflow by dragging a
     *               real API JSON onto it (apiSource === "user");
     *   "derived" = generated from rawJson via convertRawToApi (and the
     *               user has NOT dragged a real API JSON onto it);
     *   null      = no API at all (graph empty, only RAW was imported).
     *  2026-08-12 R76: when apiSource === "user", the workflow counts as
     *  user-imported even if rawJson is also present (user wants RAW
     *  retained for viewing while having the real API source for execution). */
    const apiOrigin: "user" | "derived" | null = hasApi
      ? w.apiSource === "user"
        ? "user"
        : hasRaw
          ? "derived"
          : "user"
      : null;

    // ── 2026-08-10 R16: dirty / missing flag for local rows ────────────
    // Only meaningful when `sourcePath` is set; for online workflows all
    // four fields collapse to `null / false`.  Compare in seconds because
    // `sourceMtime` is stored as a 32-bit INT (ms would overflow).
    let diskMtimeSec: number | null = null;
    let diskDirty = false;
    let diskMissing = false;
    if (w.sourcePath) {
      const diskMs = diskMtimeByPath.get(pathKey(w.sourcePath));
      if (diskMs == null) {
        diskMissing = true; // file no longer present in any local root
      } else {
        diskMtimeSec = Math.floor(diskMs / 1000);
        if (
          typeof w.sourceMtime === "number" &&
          diskMtimeSec > w.sourceMtime
        ) {
          diskDirty = true;
        }
      }
    }
    // ── R-ardot105 (2026-08-17): the rename-relink pass ran just before
    // this map; rows that hit a checksum match have already been
    // re-written in DB and mirrored into the in-memory `list` row, so
    // `diskMissing` is now `false` and `diskMtimeSec` reflects the NEW
    // path.  We just need to surface `diskRenamed: true` (plus the
    // `oldName → newName` summary) so the UI can flash a toast.
    const renamed = renamedFromTo.get(w.id) ?? null;
    const diskRenamed = renamed !== null;
    return {
      id: w.id,
      name: w.name,
      taskType: w.taskType,
      /** 2026-08-13: multi-mode support. `modes` is the full set of mode
       *  codes this workflow can run as; `defaultMode` is the one shown on
       *  the card's main chip (and kept in sync with `taskType` for the
       *  legacy single-value filter).  Empty array → client falls back to
       *  `[taskType]`. */
      modes: parseModesJson(w.modes),
      defaultMode: w.defaultMode ?? null,
      createdAt: w.createdAt,
      paramMap: w.paramMap,
      sourcePath: w.sourcePath,
      /** Classification: a workflow tied to an on-disk file is "local";
       *  everything else (pasted JSON, API-only) is "online". */
      source: w.sourcePath ? "local" : "online",
      typeLabel: def?.label ?? w.taskType,
      typeCategory: def?.category ?? "image",
      typeDescription: def?.description ?? "",
      isGenerative: def?.isGenerative ?? true,
      /** Independent flags. UI should use these instead of inferring from
       *  `format`, which conflates "has RAW" with "missing API". */
      hasApi,
      hasRaw,
      /** Where the API graph came from.  null when no graph exists. */
      apiOrigin,
      /** True iff `hasApi` — i.e. there's an executable /prompt graph.
       *  RAW-only workflows are NOT usable until re-exported from ComfyUI. */
      usable: hasApi,
      /** Legacy field retained for any old caller: prefer `hasApi/hasRaw`. */
      format: hasRaw ? ("raw" as const) : ("api" as const),
      preview: buildWorkflowPreview(graphObj ?? {}),
      /** User-curated external IO — see IO-edit mode in the workflow
       *  canvas editor.  Empty `{}` until the user exposes at least one
       *  pin.  Forwarded so library cards can fall back to IO chips
       *  when there is no graph preview yet. */
      workflowIO: (w.workflowIO as Record<string, any>) ?? {},
      /** 2026-08-15: model tag names attached to this workflow (e.g.
       *  ["z-image","wan2.2"]).  Forwarded so the library card can show
       *  chips and the canvas node selector can filter by model. */
      modelTags: ((w.modelTags as Array<{ name: string }>) ?? []).map((t) => t.name),
      /** 2026-08-10 R16: disk vs DB mtime comparison so the UI can
       *  surface a "↻ 同步" button when the on-disk file changed
       *  since the last reimport.  All four fields are null/false
       *  for online rows (no `sourcePath`). */
      sourceMtimeSec: typeof w.sourceMtime === "number" ? w.sourceMtime : null,
      diskMtimeSec,
      diskDirty,
      diskMissing,
      /** R-ardot105 (2026-08-17): this workflow was just automatically
       *  relinked to a renamed file (format "old.json → new.json").
       *  UI flashes a one-shot toast and the row's `diskMissing` is
       *  already `false` from the same pass.  null for everything else. */
      diskRenamed,
      diskRenamedTo: renamed,
    };
  });

  // ── Local-pending placeholder builder (2026-08-10 R8, label-source R11) ─
  // Files that exist on disk under LOCAL_WORKFLOWS_PATH but are not yet in
  // the DB. Renders as 「⤓ 未载入」 cards in the library. Each row carries
  // `sourceRoot` (verbatim raw path of the LOCAL_WORKFLOWS_PATH entry) so
  // the UI can show the user exactly which configured directory the file
  // came from — a `f.rootRawPath` already stamped by the scanner.
  let localPending: any[] = [];
  if (localRoots.length > 0) {
    // Existing imported local files (by `sourcePath`) get filtered out so
    // the library doesn't show their pending twin.
    const existingByPath = new Set<string>();
    for (const w of enriched) {
      if (!w.sourcePath) continue;
      existingByPath.add(pathKey(w.sourcePath));
    }
    for (const f of localAllFiles) {
      if (!f.absPath) continue;
      const key = pathKey(f.absPath);
      if (existingByPath.has(key)) continue;
      const friendly =
        f.name.replace(/\.(json|workflow)$/i, "").trim() || "未命名工作流";
      localPending.push({
        id: pendingId(f.absPath),
        name: friendly,
        taskType: "",
        /** Not yet imported → no mode config yet. */
        modes: [],
        defaultMode: null,
        createdAt: new Date(f.mtimeMs).toISOString(),
        paramMap: {},
        sourcePath: f.absPath,
        /** The configured LOCAL_WORKFLOWS_PATH raw path this pending file
         *  sits under. undefined if the scan cannot match it to any root
         *  (rare — only happens if the user edits the env between scan &
         *  request). */
        sourceRoot: f.rootRawPath,
        /** Pending = on-disk file not yet imported into DB. Distinct from
         *  source:'local' (which IS in the DB but tracks a file). */
        source: "local-pending",
        typeLabel: "本地工作流（未载入）",
        typeCategory: "image",
        typeDescription: "",
        isGenerative: false,
        hasApi: false,
        hasRaw: false,
        apiOrigin: null,
        usable: false,
        format: "api",
        preview: { nodes: [], edges: [], w: 0, h: 0 },
        workflowIO: {},
        /** Local-pending files aren't imported yet → no tags. */
        modelTags: [],
        pending: true,
        pendingSize: f.size,
        pendingMtime: f.mtimeMs,
      });
    }
  }

  // Stamp `sourceRoot` on already-imported local rows so the card can
  // label "📂 from which directory" without re-running the prefix match
  // on the client.
  const enrichedWithRoot = enriched.map((w) => ({
    ...w,
    sourceRoot:
      w.sourcePath && localRootsList.length
        ? findRootFor(w.sourcePath, localRootsList)
        : undefined,
  }));

  return NextResponse.json({
    workflows: enrichedWithRoot,
    /** Files on disk under LOCAL_WORKFLOWS_PATH that aren't in the DB yet.
     *  The UI renders these as 「⤓ 未载入」 cards inside 本地工作流 tab. */
    localPending,
    /** Per-root stats; useful for the CustomNodesSettings dialog preview
     *  without forcing the UI to scan twice. */
    localRoots: localRootsSummary,
  });
}

// Import a ComfyUI workflow exported in either "API format" or the on-disk
// "raw UI format". The body may be:
//
//   { name?, graph: <api-graph> }                       → API
//   { name?, graph: <raw-graph> }                       → raw (auto-detected)
//   { name?, raw: <raw-graph> }                         → raw (explicit)
//   { name?, format: "api" | "raw", graph: <...> }      → explicit
//
// For raw imports, we convert raw → API using ComfyUI's /object_info for
// accurate widget mapping; the converted API graph is what ComfyUI's /prompt
// endpoint executes. Positions from raw are extracted and stored alongside
// so the editor can lay the canvas out exactly like the user arranged it.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "请求体必须是 JSON 对象" },
      { status: 400 }
    );
  }

  const explicitFormat = body.format === "raw" || body.format === "api" ? body.format : null;
  const candidate = body.raw ?? body.graph;

  // ── Local-file import ────────────────────────────────────────────────────
  // If the caller passes an absolute `sourcePath`, the server reads that file
  // directly and tracks it so future refreshes can auto re-import when the file
  // changes on disk (see importSource.reimportFromSource + GET [id] handler).
  const sourcePath = typeof body.sourcePath === "string" ? body.sourcePath.trim() : "";
  if (sourcePath) {
    const { importFromLocalPath } = await import("@/lib/comfyui/importSource");
    let imported;
    try {
      imported = await importFromLocalPath(sourcePath, {
        explicitFormat,
        preferredTaskType: typeof body.taskType === "string" ? body.taskType : undefined,
        defaultName: typeof body.name === "string" ? body.name : undefined,
      });
    } catch (e: any) {
      return NextResponse.json(
        { error: e?.message ?? "本地文件读取失败" },
        { status: 400 }
      );
    }
    const fallbackName =
      sourcePath.split(/[\\/]/).pop()?.replace(/\.(json|workflow)$/i, "").trim() ||
      "未命名工作流";
    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : fallbackName;
    const user = await getServerUser();
    const tpl = await prisma.workflowTemplate.create({
      data: {
        userId: user.id,
        name,
        taskType: imported.taskType,
        graph: imported.apiGraph as any,
        paramMap: imported.paramMap as any,
        rawJson: imported.rawJson as any,
        positions: imported.positions as any,
        sourcePath: imported.sourcePath,
        sourceChecksum: imported.sourceChecksum,
        sourceMtime: imported.sourceMtime,
      },
    });
    return NextResponse.json({
      id: tpl.id,
      name: tpl.name,
      taskType: tpl.taskType,
      paramMap: tpl.paramMap,
      format: imported.format,
      sourcePath: imported.sourcePath,
      source: imported.sourcePath ? "local" : "online",
      warnings: imported.warnings.length ? imported.warnings : undefined,
      hasPositions: !!imported.positions,
    });
  }

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return NextResponse.json(
      {
        error:
          "缺少工作流 JSON。请粘贴 ComfyUI「导出(API格式)」或「导出(工作流格式)」的 JSON",
      },
      { status: 400 }
    );
  }

  const detected = explicitFormat ?? detectFormat(candidate);
  if (!detected) {
    return NextResponse.json(
      {
        error:
          "无法识别的工作流格式：未找到 API 节点 (class_type) 或 raw 节点 (type + pos)。",
      },
      { status: 400 }
    );
  }

  let apiGraph: Record<string, any>;
  let positions: Record<string, [number, number]> | null = null;
  let rawJson: unknown = null;
  const warnings: string[] = [];

  if (detected === "api") {
    // Sanity check: API-format graph must have class_type somewhere.
    const g = candidate as Record<string, any>;
    const looksLikeGraph = Object.values(g).some(
      (n) => n && typeof n === "object" && "class_type" in (n as any)
    );
    if (!looksLikeGraph) {
      return NextResponse.json(
        { error: "不是有效的 ComfyUI API 工作流（未找到节点 class_type）" },
        { status: 400 }
      );
    }
    apiGraph = g;
  } else {
    // Raw: convert to API + extract positions.
    rawJson = candidate;
    let result: ConversionResult;
    try {
      result = await convertRawToApi(candidate as any);
    } catch (e: any) {
      console.warn("[workflow] /object_info convert failed, using fallback:", e?.message);
      result = fallbackRawToApi(candidate as any);
    }
    apiGraph = result.graph;
    positions = Object.keys(result.positions).length > 0 ? result.positions : null;
    warnings.push(...result.warnings);

    if (Object.keys(apiGraph).length === 0) {
      return NextResponse.json(
        { error: "原始工作流转换失败：未能解析出任何节点" },
        { status: 400 }
      );
    }
  }

  const name = String(body.name ?? "未命名工作流").slice(0, 80);
  /* R-ardot87 (2026-08-16): 工作流初始导入不再自动推断类型。旧逻辑在
   * `body.taskType` 为空时调 `inferWorkflowTypeFromGraph(apiGraph)` 兜底，
   * 但识别准确率不高（VAEEncode+LoadImage 一律判 I2I 而忽略 Inpaint 子分支
   * 等），用户更愿意手动挑。现在未传 taskType 时直接留空，由 UI 让用户选。
   * `inferWorkflowTypeFromGraph` 仍可作为 helper 留给后续显式调用使用。 */
  let taskType = String(body.taskType ?? "");
  if (taskType) {
    // Normalize legacy values (TXT2IMG → T2I, etc.)
    taskType = normalizeTaskType(taskType);
  }

  // Validate against known types (warn but don't block custom/unknown types)
  if (taskType && !VALID_TASK_TYPE_CODES.has(taskType)) {
    console.log(`[workflow] Unknown taskType "${taskType}", allowing as custom type`);
  }

  // Auto-detect role nodes so the workflow is usable immediately.
  const paramMap = detectParamMap(apiGraph);

  const user = await getServerUser();
  const tpl = await prisma.workflowTemplate.create({
    data: {
      userId: user.id,
      name,
      taskType,
      graph: apiGraph as any,
      paramMap,
      rawJson: rawJson as any,
      positions: positions as any,
    },
  });
  return NextResponse.json({
    id: tpl.id,
    name: tpl.name,
    taskType: tpl.taskType,
    paramMap: tpl.paramMap,
    format: rawJson ? "raw" : "api",
    warnings: warnings.length ? warnings : undefined,
    hasPositions: !!positions,
  });
}
