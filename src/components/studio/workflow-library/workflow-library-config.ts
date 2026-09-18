/**
 * WorkflowLibrary 的纯类型与派生规则（规范 17 §17.2 第①层）。
 *
 * 从 WorkflowLibraryHelpers.tsx 抽出：无 React、无副作用，可直接单测。
 * 视图 / hook 一律从这里取类型与派生，不再各自重算一遍。
 */

import type { WorkflowPreview as WorkflowPreviewT } from "~/lib/comfyui/workflow";
import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";
import {
  getWorkflowType,
  normalizeTaskType,
} from "~/lib/workflow/workflow-types";

/** 服务端 list 返回的本地工作流根目录摘要（只取前端判据用得到的字段）。 */
export interface LocalWorkflowRoot {
  absPath: string;
  exists: boolean;
  /** 该根下扫到的工作流文件数 */
  count: number;
  /** 读取该根时的错误（权限 / 不是目录等），服务端在无法访问时给出 */
  error?: string;
}

/** 列表为空时的「为什么是空」判据（本地工作流目录侧）。
 *  本地侧没有可疑之处（根在、也有文件）时返回 null，空态用默认引导文案。
 *  取服务端一直在返回、前端此前丢弃的 localRoots——没有它，空态只能笼统地说
 *  「还没有工作流」，用户看到的是「工作流全没了」。 */
export function deriveLocalRootsHint(
  roots: readonly LocalWorkflowRoot[] | null | undefined,
): string | null {
  if (!roots || roots.length === 0) {
    return "没有解析到本地工作流目录：到「设置 → 创作后端」配置 ComfyUI 安装路径，或用上层目录 .env 里的 LOCAL_WORKFLOWS_PATH 指定目录。";
  }
  const paths = roots.map((root) => root.absPath).join("、");
  if (roots.every((root) => !root.exists)) {
    return `本地工作流目录不可访问：${paths}。到「设置 → 创作后端」核对 ComfyUI 安装路径是否仍指向正确的实例。`;
  }
  if (roots.every((root) => root.count === 0)) {
    return `本地工作流目录里没有工作流文件（.json / .workflow）：${paths}。`;
  }
  return null;
}

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
  /** 两列各自有没有内容 —— **只用于如实标注**，不判可执行性（raw 与 api
   *  地位同等，见下 `usable`）。 */
  hasApi?: boolean;
  hasRaw?: boolean;
  /** API 列从哪来（服务端富化下发）。
   *   - "user"：用户自己导出的 API 格式
   *   - "derived"：早年导入 RAW 时转出来存下的
   *   - null：没有 API 列（只有 RAW 的工作流就是这样，**它照样能跑**）
   *  与可执行性无关，只用来在源文件页签 / 卡片来源徽标上说清这一列是哪来的。 */
  apiSource?: string | null;
  /** 这条工作流有没有可执行内容 —— **raw 或 api 任有一列有内容即可**。
   *  RAW 由 comfy-cli 直接执行（它按节点类定义做权威转换），所以
   *  「只有 rawJson、没有 graph」是完整可用的工作流，不是残缺态。 */
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

/** 解析「这条工作流可执行吗、两列各有什么」。
 *
 *  **可用性判据 = 有可执行的列之一**（`usable`，服务端富化时已按同一份口径算好）。
 *  服务端没带 `usable` 的老路径（早期 `format` 单标记）按 `format` 反推：两种格式
 *  都可执行，所以只要有一行就是可执行的 —— 「有没有内容」在列表里本来就等价于
 *  「列表里出现了这一行」。 */
export function deriveFormatFlags(row: WorkflowRow): {
  hasApi: boolean;
  hasRaw: boolean;
  apiSource: string | null;
  usable: boolean;
} {
  if (
    typeof row.hasApi === "boolean" ||
    typeof row.hasRaw === "boolean" ||
    typeof row.usable === "boolean"
  ) {
    const hasRaw = row.hasRaw ?? row.format === "raw";
    const hasApi = row.hasApi ?? !hasRaw;
    return {
      hasApi,
      hasRaw,
      apiSource: row.apiSource ?? null,
      usable: row.usable ?? (hasApi || hasRaw),
    };
  }
  return {
    hasApi: row.format !== "raw",
    hasRaw: row.format === "raw",
    apiSource: null,
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

/* ── detectWorkflowFormat：实现已抽到 ~/lib/workflow-format 供服务端复用 ──
 * Implementation lives in ~/lib/workflow-format so the server-side
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

/** 模式码 → 中文标签（标准任务类型）；未知码原样显示，兼容历史自定义值。 */
export function modeLabel(code: string): string {
  return getWorkflowType(code)?.label ?? code;
}
