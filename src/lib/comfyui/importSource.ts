// Local-file-backed workflow import.
//
// Workflows can be imported directly from an on-disk file (the user gives the
// server an absolute path to a ComfyUI-exported .json on the same machine).
// We remember the path + a content checksum + mtime so that, on every detail
// GET, the server can detect that the file changed on disk and re-import it —
// so editing the workflow in ComfyUI and saving the same file is reflected on
// the next refresh without a manual re-import.
//
// This module centralises the "read a local file → parse/convert → normalised
// fields" pipeline so both the POST (first import) and GET (live re-import)
// paths share identical logic.

import { promises as fs } from "fs";
import { createHash } from "crypto";
import {
  detectFormat,
  convertRawToApi,
  fallbackRawToApi,
  type ConversionResult,
} from "@/lib/comfyui/raw";
import {
  normalizeTaskType,
  VALID_TASK_TYPE_CODES,
} from "@/lib/workflow-types";
import { detectParamMap } from "@/lib/comfyui/workflow";

export interface ParsedWorkflow {
  apiGraph: Record<string, any>;
  rawJson: unknown | null;
  positions: Record<string, [number, number]> | null;
  taskType: string;
  paramMap: Record<string, string> | null;
  warnings: string[];
  format: "api" | "raw";
}

/** Read a local file and return its text + mtime in ms. Throws a friendly
 *  error when the path is missing / unreadable. */
export async function readLocalFile(
  absPath: string
): Promise<{ text: string; mtimeMs: number }> {
  let stat;
  try {
    stat = await fs.stat(absPath);
  } catch (e: any) {
    if (e?.code === "ENOENT") {
      throw new Error(`本地文件不存在：${absPath}`);
    }
    throw new Error(`无法读取本地文件 ${absPath}：${e?.message ?? e}`);
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
  } = {}
): Promise<ParsedWorkflow> {
  let candidate: unknown;
  try {
    candidate = JSON.parse(content);
  } catch {
    throw new Error("JSON 解析失败，请检查文件内容是否为有效的 ComfyUI 工作流 JSON");
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("不是有效的工作流 JSON（根节点应为对象）");
  }

  const detected = opts.explicitFormat ?? detectFormat(candidate);
  if (!detected) {
    throw new Error(
      "无法识别的工作流格式：未找到 API 节点 (class_type) 或 raw 节点 (type + pos)。"
    );
  }

  let apiGraph: Record<string, any>;
  let positions: Record<string, [number, number]> | null = null;
  let rawJson: unknown = null;
  const warnings: string[] = [];

  if (detected === "api") {
    const g = candidate as Record<string, any>;
    const looksLikeGraph = Object.values(g).some(
      (n) => n && typeof n === "object" && "class_type" in (n as any)
    );
    if (!looksLikeGraph) {
      throw new Error("不是有效的 ComfyUI API 工作流（未找到节点 class_type）");
    }
    apiGraph = g;
  } else {
    rawJson = candidate;
    let result: ConversionResult;
    try {
      result = await convertRawToApi(candidate as any);
    } catch (e: any) {
      console.warn("[importSource] /object_info convert failed, using fallback:", e?.message);
      result = fallbackRawToApi(candidate as any);
    }
    apiGraph = result.graph;
    positions =
      Object.keys(result.positions).length > 0 ? result.positions : null;
    warnings.push(...result.warnings);
    if (Object.keys(apiGraph).length === 0) {
      throw new Error("原始工作流转换失败：未能解析出任何节点");
    }
  }

  /* R-ardot87 (2026-08-16): 不再自动推断 taskType —— 旧逻辑用
   * `inferWorkflowTypeFromGraph(apiGraph)` 兜底，但识别准确率不高（例如把
   * VAEEncode+LoadImage 一律判为 I2I，忽略 Inpaint 等子分支），用户更愿意
   * 手动挑。现在未传 preferredTaskType 时直接留空，由用户在 UI 里选。
   * 重导入路径走 `existingTaskType` 把旧 taskType 透传过来保留。 */
  let taskType = opts.preferredTaskType ?? "";
  if (taskType) {
    taskType = normalizeTaskType(taskType);
  }
  if (taskType && !VALID_TASK_TYPE_CODES.has(taskType)) {
    console.log(`[importSource] Unknown taskType "${taskType}", allowing as custom type`);
  }

  const paramMap = detectParamMap(apiGraph);

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
  } = {}
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
    graph: Record<string, any>;
    rawJson: unknown | null;
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
 * R-ardot87 (2026-08-16): taskType 不再自动推断。重导入时若磁盘版本没带
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
  } catch (e: any) {
    if (e?.code === "ENOENT") return { missing: true };
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
