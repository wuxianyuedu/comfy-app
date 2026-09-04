/**
 * WorkflowLibrary 的纯类型与派生规则（规范 17 §17.2 第①层）。
 *
 * 从 WorkflowLibraryHelpers.tsx 抽出：无 React、无副作用，可直接单测。
 * 视图 / hook 一律从这里取类型与派生，不再各自重算一遍。
 */

import type { WorkflowPreview as WorkflowPreviewT } from "@/lib/comfyui/workflow";
import type { WorkflowIOMap } from "@/components/studio/shared/workflow-io";
import { getWorkflowType, normalizeTaskType } from "@/lib/workflow-types";

export interface WorkflowRow {
  id: string;
  name: string;
  taskType: string;
  /** A workflow may declare multiple modes at once.  When
   *  absent or empty, the UI falls back to `[taskType]` for display
   *  (backward compatibility for older rows).  Both `modes` and
   *  `defaultMode` are returned by GET /api/workflows (persisted to
   *  prisma.WorkflowTemplate.modes / .defaultMode). */
  modes?: string[];
  /** Canonical default mode code; must be present in `modes`. Kept in sync
   *  with `taskType` for the legacy single-value filter. */
  defaultMode?: string | null;
  createdAt: string;
  paramMap?: Record<string, string> | null;
  preview?: WorkflowPreviewT;
  /** User-curated external IO, returned by GET /api/workflows.
   *  Used to render the library card when no graph preview is available. */
  workflowIO?: WorkflowIOMap;
  /** Model tag names attached to this workflow (user-level
   *  global tag library, e.g. ["z-image","wan2.2"]).  Returned by
   *  GET /api/workflows.  Drives the library card chips + model filter. */
  modelTags?: string[];
  /** Independent booleans.  `hasApi` controls whether the
   *  workflow is actually executable; `hasRaw` is informational and lets
   *  the UI offer source-view / download-merged-bundle for RAW imports. */
  hasApi?: boolean;
  hasRaw?: boolean;
  /** Where the executable graph came from.
   *   - "user": the user explicitly exported API Format from ComfyUI
   *   - "derived": auto-derived from rawJson via convertRawToApi
   *   - null: no API at all (only RAW was imported, graph was empty)
   *  The card and the source modal both use this to honestly label
   *  the API badge so users aren't surprised that "我只导入了 raw"
   *  still shows an API badge. */
  apiOrigin?: "user" | "derived" | null;
  /** Convenience union of the two flags: true ⇔ has an executable graph. */
  usable?: boolean;
  /** "raw" if the user originally imported the UI/raw format (positions
   *  preserved).  "api" otherwise.  This is kept as a legacy hint — UI
   *  should prefer `hasApi/hasRaw` since this single tag can't distinguish
   *  "both" from "only RAW". */
  format?: "raw" | "api";
  /** Absolute path of the on-disk file the workflow was imported from.
   *  Set by any import that touched a real file (the source-local ⤓ 载入
   *  card, or future ad-hoc imports).  When set, the server tracks the
   *  file and re-imports it whenever it changes on disk. */
  sourcePath?: string | null;
  /** Which configured LOCAL_WORKFLOWS_PATH entry (verbatim
   *  raw path) this file lives under.  The server stamps this on every
   *  already-imported local workflow.  Same value for all rows from the
   *  same configured root — used by the card to label "📂 from which
   *  directory". undefined when the file isn't matched against any root
   *  (e.g. an older import done before LOCAL_WORKFLOWS_PATH was set). */
  sourceRoot?: string | null;
  /** Classification: "local" = tied to an on-disk file; "online" = pasted /
   *  API-only import. Derived from `sourcePath` presence. */
  source?: "local" | "online";
  /** Manual-sync support.  `diskDirty = (diskMtimeSec >
   *  sourceMtimeSec)` means the on-disk file changed since the last
   *  reimport; the card then surfaces a "↻ 同步" action that POSTs to
   *  /api/workflows/[id]/resync.  All four fields are null/false for
   *  online rows (no sourcePath). */
  diskDirty?: boolean;
  diskMissing?: boolean;
  diskMtimeSec?: number | null;
  sourceMtimeSec?: number | null;
  /** The server detected that the source file
   *  was renamed on disk and automatically re-linked the row to the
   *  new path.  `diskRenamedTo` is a human-readable "old.json → new.json"
   *  summary; the UI flashes a one-shot toast so the user knows the
   *  link silently moved.  null for everything else. */
  diskRenamed?: boolean;
  diskRenamedTo?: string | null;
}

/** Resolve the three independent UI booleans + apiOrigin when the server
 *  only sent the legacy single `format` tag.  Treats `format:"raw"` as
 *  "definitely has RAW, has API" — defaults `hasApi=true` because older
 *  imports always went through the raw→api converter.  New callers should
 *  pass `hasApi/hasRaw/apiOrigin` directly. */
export function deriveFormatFlags(row: WorkflowRow): {
  hasApi: boolean;
  hasRaw: boolean;
  apiOrigin: "user" | "derived" | null;
  usable: boolean;
} {
  if (typeof row.hasApi === "boolean" || typeof row.hasRaw === "boolean") {
    const hasApi = row.hasApi ?? true;
    const hasRaw = row.hasRaw ?? row.format === "raw";
    const apiOrigin: "user" | "derived" | null =
      row.apiOrigin ?? (hasApi ? (hasRaw ? "derived" : "user") : null);
    // 一个工作流只保留一种格式。可用性仅取决于是否有可执行 graph。
    const usable = hasApi;
    return { hasApi, hasRaw, apiOrigin, usable };
  }
  return {
    hasApi: true,
    hasRaw: row.format === "raw",
    apiOrigin: row.format === "raw" ? "derived" : "user",
    usable: true,
  };
}

/* Aggregate the four manual-sync fields into UI booleans.
 *  Online rows (no sourcePath) get `dirty=false, missing=false,
 *  canResync=false`; missing-on-disk rows stay dirty=false but flag
 *  missing so the card can show "📁 文件已不存在" instead of a sync
 *  button. */
export function deriveSyncFlags(row: WorkflowRow): {
  dirty: boolean;
  missing: boolean;
  canResync: boolean;
} {
  const dirty = !!row.diskDirty;
  const missing = !!row.diskMissing;
  return { dirty, missing, canResync: dirty };
}

/* ── detectWorkflowFormat：实现已抽到 @/lib/workflow-format 供服务端复用 ──
 * Implementation lives in @/lib/workflow-format so the server-side
 * PATCH endpoint can validate the same JSON shape (drag-to-upgrade). */

/** ComfyUI default filenames start with a "date_slug" prefix and contain only
 *  lowercase letters / underscores / digits.  When we see such a name we
 *  render it in a slightly different style (code font + brighter color) so
 *  it's easier to read at a glance. */
export function isTechnicalName(name: string): boolean {
  if (!name) return false;
  if (name.length > 38) return false; // already a descriptive name
  return /^[a-z0-9_]+$/.test(name);
}

export function ago(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚导入";
  if (m < 60) return `${m} 分钟前导入`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前导入`;
  return `${Math.floor(h / 24)} 天前导入`;
}

/* ── 列表筛选 / 计数的纯派生（从 WorkflowLibrary 视图里抽出）─────
 * 原先是组件内 4 个 useMemo（filteredWorkflows / pendingRows / sourceCounts /
 * typeCounts）。搬到这里后：规则可单测，视图只剩「取数据 → 渲染」。 */

export type SourceFilter = "all" | "local" | "online";
export type TypeFilter = "all" | "image" | "video" | "audio";

/** 本地待载入项（磁盘扫描到但还没入库的工作流）。 */
export interface PendingRow {
  id: string;
  name: string;
  sourcePath: string;
  pendingSize?: number;
  pendingMtime?: number;
}

/** `source` 字段是服务端可选回填的，缺失时按有无 sourcePath 判定。 */
function sourceOf(workflow: WorkflowRow): "local" | "online" {
  return workflow.source ?? (workflow.sourcePath ? "local" : "online");
}

function categoryOf(
  workflow: Pick<WorkflowRow, "taskType">,
): string | undefined {
  return getWorkflowType(normalizeTaskType(workflow.taskType ?? ""))?.category;
}

/** 三级筛选：来源 → 类型 → 模型标签，最后是名称子串（不区分大小写）。 */
export function filterWorkflows(
  workflows: WorkflowRow[],
  filters: {
    source: SourceFilter;
    type: TypeFilter;
    model: string;
    search: string;
  },
): WorkflowRow[] {
  const needle = filters.search.trim().toLowerCase();
  return workflows.filter((workflow) => {
    if (filters.source !== "all" && sourceOf(workflow) !== filters.source) {
      return false;
    }
    if (filters.type !== "all" && categoryOf(workflow) !== filters.type) {
      return false;
    }
    if (
      filters.model !== "all" &&
      !workflow.modelTags?.includes(filters.model)
    ) {
      return false;
    }
    if (needle && !workflow.name.toLowerCase().includes(needle)) return false;
    return true;
  });
}

/** 待载入行：切到「在线工作流」时不该出现本地待载入项。 */
export function filterPending(
  pending: PendingRow[],
  filters: { source: SourceFilter; search: string },
): PendingRow[] {
  if (filters.source === "online") return [];
  const needle = filters.search.trim().toLowerCase();
  if (!needle) return pending;
  return pending.filter((row) => row.name.toLowerCase().includes(needle));
}

export interface SourceCounts {
  all: number;
  local: number;
  online: number;
}

export interface TypeCounts {
  all: number;
  image: number;
  video: number;
  audio: number;
}

/** 来源页签计数。待载入项全部计入 local（它们本来就来自磁盘）。 */
export function countBySource(
  workflows: WorkflowRow[],
  pending: PendingRow[],
): SourceCounts {
  return {
    all: workflows.length + pending.length,
    local:
      workflows.filter((workflow) => sourceOf(workflow) === "local").length +
      pending.length,
    online: workflows.filter((workflow) => sourceOf(workflow) === "online")
      .length,
  };
}

/** 类型页签计数。待载入项没有 taskType，计入 all 但不进具体分类。 */
export function countByType(
  workflows: WorkflowRow[],
  pending: PendingRow[],
): TypeCounts {
  const counts: TypeCounts = {
    all: workflows.length + pending.length,
    image: 0,
    video: 0,
    audio: 0,
  };
  for (const workflow of workflows) {
    const category = categoryOf(workflow);
    if (category === "image" || category === "video" || category === "audio") {
      counts[category] += 1;
    }
  }
  return counts;
}
