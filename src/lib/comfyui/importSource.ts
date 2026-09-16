// Local-file-backed workflow import.
//
// Workflows can be imported directly from an on-disk file (the user gives the
// server an absolute path to a ComfyUI-exported .json on the same machine).
// We remember the path + a content checksum + mtime so that, on every detail
// GET, the server can detect that the file changed on disk and re-import it —
// so editing the workflow in ComfyUI and saving the same file is reflected on
// the next refresh without a manual re-import.
//
// This module centralises the "read a local file → parse → normalised fields"
// pipeline so both the POST (first import) and GET (live re-import) paths share
// identical logic.
//
// **两种格式地位同等，入库不做格式互转**：API 格式落 `graph`、工作流(RAW)
// 格式落 `rawJson`，两列各自最多一份、各自可空。执行侧两条路都认（见
// `resolveExecutionInput`），所以 RAW 不需要（也不该）在导入时被转成 API 图
// —— 无 ComfyUI 可达时的启发式转换结果本身就是错的，存下来只会让画布与运行
// 都跑一份错图。

import "server-only";
import { promises as fs } from "fs";
import { createHash } from "crypto";
import { logger } from "~/lib/core/logger";
import {
  asRawWorkflow,
  detectFormat,
  extractPositions,
} from "~/lib/comfyui/raw";
import { normalizeTaskType, VALID_TASK_TYPE_CODES } from "~/lib/workflow-types";
import { detectParamMap } from "~/lib/comfyui/workflow";

export interface ParsedWorkflow {
  /** API 格式导入件（检测为 `api` 时才有，否则空对象）。 */
  apiGraph: Record<string, unknown>;
  /** 工作流(RAW)格式导入件（检测为 `raw` 时才有，否则 null）。 */
  rawJson: unknown;
  /** 节点坐标：RAW 自带 `pos` 时原样取出；API 格式没有坐标（null，由客户端
   *  自动布局兜底）。它**不是**「转换出来的 API 图」的副产品，两种格式各自成立。 */
  positions: Record<string, [number, number]> | null;
  taskType: string;
  paramMap: Record<string, string> | null;
  warnings: string[];
  format: "api" | "raw";
}

/** Read a local file and return its text + mtime in ms. Throws a friendly
 *  error when the path is missing / unreadable. */
export async function readLocalFile(
  absPath: string,
): Promise<{ text: string; mtimeMs: number }> {
  let stat;
  try {
    stat = await fs.stat(absPath);
  } catch (e: unknown) {
    const err = (typeof e === "object" && e !== null ? e : {}) as {
      code?: string;
      message?: string;
    };
    if (err.code === "ENOENT") {
      throw new Error(`本地文件不存在：${absPath}`);
    }
    throw new Error(`无法读取本地文件 ${absPath}：${err.message ?? String(e)}`);
  }
  const text = await fs.readFile(absPath, "utf-8");
  return { text, mtimeMs: stat.mtimeMs };
}

/** Fast, short content hash used purely for change detection. */
export function checksum(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 16);
}

/**
 * Parse raw ComfyUI JSON content into the normalised fields the DB stores.
 * Mirrors the pipeline in POST /api/workflows so first-import and live-reimport
 * behave identically.
 */
export async function parseWorkflowContent(
  content: string,
  opts: {
    explicitFormat?: "api" | "raw" | null;
    preferredTaskType?: string;
    defaultName?: string;
  } = {},
): Promise<ParsedWorkflow> {
  let candidate: unknown;
  try {
    candidate = JSON.parse(content);
  } catch {
    throw new Error(
      "JSON 解析失败，请检查文件内容是否为有效的 ComfyUI 工作流 JSON",
    );
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("不是有效的工作流 JSON（根节点应为对象）");
  }

  const detected = opts.explicitFormat ?? detectFormat(candidate);
  if (!detected) {
    throw new Error(
      "无法识别的工作流格式：未找到 API 节点 (class_type) 或 raw 节点 (type + pos)。",
    );
  }

  let apiGraph: Record<string, unknown> = {};
  let positions: Record<string, [number, number]> | null = null;
  let rawJson: unknown = null;
  const warnings: string[] = [];

  if (detected === "api") {
    const graph = candidate as Record<string, unknown>;

    const looksLikeGraph = Object.values(graph).some(
      (node) => node && typeof node === "object" && "class_type" in node,
    );

    if (!looksLikeGraph) {
      throw new Error("不是有效的 ComfyUI API 工作流（未找到节点 class_type）");
    }

    apiGraph = graph;
  } else {
    /* 工作流(RAW)格式：**原件入库，不转 API 图**。
     *
     * 历史做法是导入时把 raw 转成 API 图存进 `graph`（转换失败再回落启发式），
     * 存错图的代价由用户承担：无 ComfyUI 可达时启发式按类名猜控件顺序，猜错
     * 就是一份能打开、跑起来结果不对的图。执行侧本来就有 comfy-cli 直接吃 raw
     * 的路（它按节点类定义做权威转换），入库再转一次是多余且有害的一步。 */
    rawJson = candidate;
    const rawView = asRawWorkflow(candidate);
    const extracted = rawView ? extractPositions(rawView) : {};
    positions = Object.keys(extracted).length > 0 ? extracted : null;
  }

  /* 不再自动推断 taskType —— 旧逻辑用
   * `inferWorkflowTypeFromGraph(apiGraph)` 兜底，但识别准确率不高（例如把
   * VAEEncode+LoadImage 一律判为 I2I，忽略 Inpaint 等子分支），用户更愿意
   * 手动挑。现在未传 preferredTaskType 时直接留空，由用户在 UI 里选。
   * 重导入路径走 `existingTaskType` 把旧 taskType 透传过来保留。 */
  let taskType = opts.preferredTaskType ?? "";
  if (taskType) {
    taskType = normalizeTaskType(taskType);
  }
  if (taskType && !VALID_TASK_TYPE_CODES.has(taskType)) {
    logger.info(
      `[importSource] Unknown taskType "${taskType}", allowing as custom type`,
    );
  }

  /* RAW 导入没有 API 图可判落点 → 留空，由画布 / 工作流编辑器按 RAW 视图
   *  （`rawInputsById`）判。角色节点映射（positiveNode / negativeNode…）此时
   *  没有意义，硬判会给出指向不存在节点的映射，反而让运行期取不到值。 */
  const paramMap =
    Object.keys(apiGraph).length > 0 ? detectParamMap(apiGraph) : null;

  return {
    apiGraph,
    rawJson,
    positions,
    taskType,
    paramMap,
    warnings,
    format: detected,
  };
}

export interface ImportedFromFile extends ParsedWorkflow {
  sourcePath: string;
  sourceChecksum: string;
  /** File mtime in SECONDS (epoch) — stored in a 32-bit SQLite INT column,
   *  so we keep it under 2.1e9 rather than using ms (which overflows INT). */
  sourceMtime: number;
}

/** One-shot import from a local path. Reads the file and returns all normalised
 *  fields plus the tracking metadata to persist on the WorkflowTemplate row. */
export async function importFromLocalPath(
  absPath: string,
  opts: {
    explicitFormat?: "api" | "raw" | null;
    preferredTaskType?: string;
    defaultName?: string;
  } = {},
): Promise<ImportedFromFile> {
  const { text, mtimeMs } = await readLocalFile(absPath);
  const parsed = await parseWorkflowContent(text, opts);
  return {
    ...parsed,
    sourcePath: absPath,
    sourceChecksum: checksum(text),
    sourceMtime: Math.floor(mtimeMs / 1000),
  };
}

export interface ReimportResult {
  /** file is gone on disk — caller should surface a "missing" warning */
  missing?: boolean;
  /** file exists but mtime matches the last import (fast path, no re-parse) */
  unchanged?: boolean;
  /** file changed → re-parsed fields to persist back to the DB */
  update?: {
    graph: Record<string, unknown>;
    rawJson: unknown;
    positions: Record<string, [number, number]> | null;
    paramMap: Record<string, string> | null;
    taskType: string;
    sourceChecksum: string;
    sourceMtime: number;
  };
}

/**
 * Re-read a previously-imported workflow's source file and decide what (if
 * anything) changed.  `tpl` must carry `sourcePath` + `sourceMtime`.  Returns:
 *   - { missing: true }   if the file no longer exists
 *   - { unchanged: true } if mtime matches (fast path, no re-parse)
 *   - { update: {...} }   if the file changed → normalised fields to persist
 *
 * Note: when `update` is returned we overwrite graph/rawJson/positions/paramMap
 * from the file — the file is the source of truth once it changes, so the
 * editor reflects the latest on-disk workflow.  Re-parsing is idempotent on
 * identical content, so a mtime tick without content change is harmless.
 *
 * taskType 不再自动推断。重导入时若磁盘版本没带
 * taskType（旧逻辑会重新推断并覆盖用户已手动设置的值），传 `existingTaskType`
 * 透传过来 —— 用户的显式选择优先级最高。 */
export async function reimportFromSource(tpl: {
  sourcePath: string;
  sourceMtime?: number | null;
  sourceChecksum?: string | null;
  /** 已存在的 taskType（用户在 UI 里手动设过的）。透传给 parseWorkflowContent
   *  作为 preferredTaskType，避免重导入时把空值回写覆盖。 */
  existingTaskType?: string | null;
}): Promise<ReimportResult> {
  let stat;
  try {
    stat = await fs.stat(tpl.sourcePath);
  } catch (e: unknown) {
    const err = e as { code?: string } | null;
    if (err?.code === "ENOENT") return { missing: true };
    return { missing: true };
  }

  const mtimeSec = Math.floor(stat.mtimeMs / 1000);
  // Fast path: mtime (seconds) unchanged → content almost certainly unchanged.
  if (tpl.sourceMtime != null && mtimeSec === tpl.sourceMtime) {
    return { unchanged: true };
  }

  // mtime changed (or we had no mtime recorded) → read + re-parse.
  const text = await fs.readFile(tpl.sourcePath, "utf-8");
  const parsed = await parseWorkflowContent(text, {
    preferredTaskType: tpl.existingTaskType ?? "",
  });
  return {
    update: {
      graph: parsed.apiGraph,
      rawJson: parsed.rawJson,
      positions: parsed.positions,
      paramMap: parsed.paramMap,
      taskType: parsed.taskType,
      sourceChecksum: checksum(text),
      sourceMtime: mtimeSec,
    },
  };
}
