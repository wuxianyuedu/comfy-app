/**
 * WorkflowLibrary 的纯类型与派生规则（规范 17 §17.2 第①层）。
 *
 * 从 WorkflowLibraryHelpers.tsx 抽出：无 React、无副作用，可直接单测。
 * 视图 / hook 一律从这里取类型与派生，不再各自重算一遍。
 */

import type { WorkflowPreview as WorkflowPreviewT } from "~/lib/comfyui/workflow";
import { matchesNeedle, normalizeNeedle } from "~/lib/list-filter";
import type { WorkflowIOMap } from "~/components/studio/workflow-io";
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
  /** 一条工作流可以同时声明多个模式。为空或缺省时，
   *  UI 退回用 `[taskType]` 展示（兼容老数据）。`modes` 与
   *  `defaultMode` 由 GET /api/workflows 下发，落库在
   *  prisma.WorkflowTemplate 的 modes /
   *  .defaultMode 两个字段。 */
  modes?: string[];
  /** 规范默认模式码；必须出现在 `modes` 里。
   *  与 `taskType` 保持同步，供旧版单值筛选用。 */
  defaultMode?: string | null;
  createdAt: string;
  paramMap?: Record<string, string> | null;
  preview?: WorkflowPreviewT;
  /** 用户维护的对外 IO，由 GET /api/workflows 下发。
   *  没有图谱预览时用它在库里渲染卡片。 */
  workflowIO?: WorkflowIOMap;
  /** 挂在这条工作流上的模型标签名（来自用户级全局标签库，
   *  例如 ["z-image","wan2.2"]）。由 GET /api/workflows 下发。
   *  驱动库卡片的标签与模型筛选。 */
  modelTags?: string[];
  /** RAW 原件列有没有内容 —— **只用于如实标注**，不判可执行性（见下 `usable`）。 */
  hasRaw?: boolean;
  /** 这条工作流有没有可执行内容 —— **RAW 原件有内容即可**。
   *  RAW 由 comfy-cli 直接执行（它按节点类定义做权威转换）。 */
  usable?: boolean;
  /** 导入来源在磁盘上的绝对路径。
   *  任何碰到真实文件的导入都会写它（来源本地的 ⤓ 载入
   *  卡片，或后续临时导入）。写入后服务端跟踪该文件，
   *  磁盘上一有变化就重新导入。 */
  sourcePath?: string | null;
  /** 这个文件落在哪个已配置的 LOCAL_WORKFLOWS_PATH（原样
   *  路径）下。服务端给每条已导入的本地工作流都盖上这个戳。
   *  同一个配置根下的所有行取同一个值 —— 卡片用它标注「📂 来自
   *  哪个目录」。文件没匹配上任何根时为 undefined
   *  （例如在设置
   *  LOCAL_WORKFLOWS_PATH 之前完成的旧导入）。 */
  sourceRoot?: string | null;
  /** 分类："local" = 绑定磁盘上的文件；"online" = 粘贴导入。
   *  由有没有 `sourcePath` 推导。 */
  source?: "local" | "online";
  /** 手动同步支持。`diskDirty = (diskMtimeSec >
   *  sourceMtimeSec)` 表示磁盘上的文件在上次导入之后被改过；
   *  卡片据此显示「↻ 同步」动作，POST 到
   *  /api/workflows/[id]/resync。在线行（没有 sourcePath）
   *  这四项都为 null/false。 */
  diskDirty?: boolean;
  diskMissing?: boolean;
  diskMtimeSec?: number | null;
  sourceMtimeSec?: number | null;
  /** 服务端检测到来源文件
   *  在磁盘上被改名，已自动把该行重新指到新路径。
   *  `diskRenamedTo` 是给人读的 "old.json → new.json"
   *  摘要；UI 弹一次性的提示，让用户知道
   *  这条链接悄悄挪了位置。其余情况为 null。 */
  diskRenamed?: boolean;
  diskRenamedTo?: string | null;
}

/** 解析「这条工作流可执行吗、RAW 原件在不在」。
 *
 *  **可用性判据 = RAW 原件有内容**（`usable`，服务端富化时已按同一份口径算好）。
 *  服务端没带 `hasRaw` / `usable` 的老路径（早期导入兼容）按「列表里出现了这一行
 *  = 有内容」处理 —— 库里的每一行都是从 RAW 原件导入的。 */
export function deriveFormatFlags(row: WorkflowRow): {
  hasRaw: boolean;
  usable: boolean;
} {
  const hasRaw = row.hasRaw ?? true;
  return { hasRaw, usable: row.usable ?? hasRaw };
}

/* 把四个手动同步字段聚合成 UI 用的布尔量。
 *  在线行（没有 sourcePath）得到 `dirty=false, missing=false,
 *  canResync=false`；磁盘上已缺失的行仍是 dirty=false，但会置上
 *  missing，好让卡片显示「📁 文件已不存在」而不是同步按钮。
 *  按钮。 */
export function deriveSyncFlags(row: WorkflowRow): {
  dirty: boolean;
  missing: boolean;
  canResync: boolean;
} {
  const dirty = !!row.diskDirty;
  const missing = !!row.diskMissing;
  return { dirty, missing, canResync: dirty };
}

/** ComfyUI 的默认文件名以 "date_slug" 前缀开头，且只含
 *  小写字母 / 下划线 / 数字。见到这种名字时换一种样式渲染
 *  （等宽字体 + 更亮的颜色），
 *  扫一眼就能读出来。 */
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
  const needle = normalizeNeedle(filters.search);
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
    /* 本域只搜名称（不搜路径 / 标签）—— 归一化与命中判决走出口。 */
    return matchesNeedle(needle, workflow.name);
  });
}

/** 待载入行：切到「在线工作流」时不该出现本地待载入项。 */
export function filterPending(
  pending: PendingRow[],
  filters: { source: SourceFilter; search: string },
): PendingRow[] {
  if (filters.source === "online") return [];
  const needle = normalizeNeedle(filters.search);
  if (!needle) return pending;
  return pending.filter((row) => matchesNeedle(needle, row.name));
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
