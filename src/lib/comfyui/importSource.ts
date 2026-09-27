// 以本地文件为源的工作流导入。
//
// 工作流可以直接从磁盘文件导入（用户把同机上 ComfyUI 导出的 .json 绝对路径
// 交给服务端）。我们记下路径、内容校验和与 mtime，于是每次详情 GET 时服务端
// 都能发现文件在磁盘上变了并重新导入 —— 在 ComfyUI 里改完工作流、保存同一份
// 文件，下一次刷新就会反映出来，不必手动再导一次。
//
// 本模块把「读本地文件 → 解析 → 规整成字段」这条流水线集中在一处，
// 让 POST（首次导入）与 GET（实时重新导入）两条路径共用
// identical logic.
//
// **只接受 ComfyUI 的原始工作流格式（RAW）**：原件逐字落 `rawJson` 列，入库
// 不做任何格式互转。API 格式不是本应用支持的导入形态 —— 把 RAW 转成 API 图由
// comfy-cli 在执行时按节点类定义做权威转换（无 ComfyUI 可达时按类名猜控件顺序，
// 猜错就是一份能打开、跑起来结果不对的图，历史 ISSUE #632 已证伪这条路）。

import "server-only";
import { errorText } from "~/lib/error-message";
import { promises as fs } from "fs";
import { createHash } from "crypto";
import { z } from "zod";
import { logger } from "~/lib/core/logger";
import { asRawWorkflow, extractPositions } from "~/lib/comfyui/raw";
import {
  normalizeTaskType,
  VALID_TASK_TYPE_CODES,
} from "~/lib/workflow/workflow-types";

/* ── 外部工作流 JSON 的形状契约（导入边界，规范 §5.5）──────────────────────
 * 本 schema 回答**落到库里的东西是什么形状**：RAW 原件必须有非空 `nodes[]`
 * （且每个节点带 `type`）。
 *
 * 用 `.loose()`（保留未知键）而不是剥键：RAW 原件要**逐字落库**（groups /
 * definitions / extra / 各节点私有字段都得原样留着），任何剥键都会让「重新下载
 * 源文件」拿到一份被改过的 JSON。 */
const RawWorkflowSchema = z.looseObject({
  nodes: z.array(z.looseObject({ type: z.string() })).min(1),
});

export interface ParsedWorkflow {
  /** 工作流(RAW)格式原件（逐字落库；格式不认识时为 null）。 */
  rawJson: unknown;
  /** 节点坐标：RAW 自带 `pos` 时原样取出；没有则 null（由客户端自动布局兜底）。 */
  positions: Record<string, [number, number]> | null;
  taskType: string;
  warnings: string[];
  format: "raw";
}

/* 读一个本地文件，返回它的文本与 mtime（毫秒）。
 * 路径缺失或不可读时抛出带可读说明的错误。 */
export async function readLocalFile(
  absPath: string,
): Promise<{ text: string; mtimeMs: number }> {
  let stat;
  try {
    stat = await fs.stat(absPath);
  } catch (e: unknown) {
    /* 只取 `code` 判「文件不存在」这一档；文案一律由 `errorText` 产出
     *（它带网络层翻译，`String(e)` 那一路会把非 Error 抛值渲染成
     * `[object Object]`）。 */
    const err = (typeof e === "object" && e !== null ? e : {}) as {
      code?: string;
    };
    if (err.code === "ENOENT") {
      throw new Error("本地文件不存在");
    }
    throw new Error(errorText(e, "无法读取本地文件"));
  }
  const text = await fs.readFile(absPath, "utf-8");
  return { text, mtimeMs: stat.mtimeMs };
}

/* 轻量、快速的内容哈希，只用于判断「内容变没变」。 */
export function checksum(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 16);
}

/**
 * 把 ComfyUI 的原始 JSON 内容解析成数据库存的那套规整字段。
 * 与 POST /api/workflows 的流水线保持一致，让「首次导入」与「实时重新导入」
 * behave identically.
 */
export async function parseWorkflowContent(
  content: string,
  opts: {
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

  /* 工作流(RAW)格式：**原件入库，不转 API 图**。
   *
   * 历史做法是导入时把 raw 转成 API 图存进 `graph`（转换失败再回落启发式），
   * 存错图的代价由用户承担：无 ComfyUI 可达时启发式按类名猜控件顺序，猜错
   * 就是一份能打开、跑起来结果不对的图。执行侧本来就有 comfy-cli 直接吃 raw
   * 的路（它按节点类定义做权威转换），入库再转一次是多余且有害的一步。 */
  const parsed = RawWorkflowSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(
      "不是有效的工作流(RAW) JSON：缺少节点数组 nodes[]（或节点缺少 type 字段）。" +
        "请用 ComfyUI 的「导出(工作流格式)」，API 格式不受支持。",
    );
  }
  const rawJson: unknown = parsed.data;
  const rawView = asRawWorkflow(parsed.data);
  const extracted = rawView ? extractPositions(rawView) : {};
  const positions: Record<string, [number, number]> | null =
    Object.keys(extracted).length > 0 ? extracted : null;
  const warnings: string[] = [];

  /* 不再自动推断 taskType —— 旧逻辑用
   * `inferWorkflowTypeFromGraph(graph)` 兜底，但识别准确率不高（例如把
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

  return { rawJson, positions, taskType, warnings, format: "raw" };
}

export interface ImportedFromFile extends ParsedWorkflow {
  sourcePath: string;
  sourceChecksum: string;
  /** 文件 mtime，单位是秒（epoch）—— 它存在 SQLite 的 32 位 INT 列里，
   *  因此要保持在 2.1e9 以下，不能用毫秒（会溢出 INT）。 */
  sourceMtime: number;
}

/* 从本地路径做一次性导入：读文件，返回全部规整字段，
 * 以及要写进 WorkflowTemplate 行的追踪元数据。 */
export async function importFromLocalPath(
  absPath: string,
  opts: {
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
  /* 文件已从磁盘上消失 —— 调用方应给出「源文件缺失」的提示 */
  missing?: boolean;
  /* 文件还在，但 mtime 与上次导入一致（快路径，不重新解析） */
  unchanged?: boolean;
  /* 文件变了 → 重新解析出的字段，要写回数据库 */
  update?: {
    rawJson: unknown;
    positions: Record<string, [number, number]> | null;
    paramMap: Record<string, string> | null;
    taskType: string;
    sourceChecksum: string;
    sourceMtime: number;
  };
}

/**
 * 重新读取此前导入过的工作流的源文件，判断有没有变化、变化了什么。
 * `tpl` 必须带 `sourcePath` 与 `sourceMtime`。返回三种之一：
 *   - { missing: true }   文件已不存在
 *   - { unchanged: true } mtime 一致（快路径，不重新解析）
 *   - { update: {...} }   文件变了 → 要落库的规整字段
 *
 * 注意：返回 `update` 时，rawJson / positions / paramMap 都会被覆盖
 * 都来自该文件 —— 文件一变它就是唯一事实源，编辑器因此反映最新的磁盘版本。
 * 对相同内容重复解析是幂等的，所以 mtime 动了但内容没变也无害。
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
  // 快路径：mtime（秒）没变 → 内容几乎可以肯定也没变。
  if (tpl.sourceMtime != null && mtimeSec === tpl.sourceMtime) {
    return { unchanged: true };
  }

  // mtime 变了（或此前没记 mtime）→ 读文件并重新解析。
  const text = await fs.readFile(tpl.sourcePath, "utf-8");
  const parsed = await parseWorkflowContent(text, {
    preferredTaskType: tpl.existingTaskType ?? "",
  });
  return {
    update: {
      rawJson: parsed.rawJson,
      positions: parsed.positions,
      paramMap: null,
      taskType: parsed.taskType,
      sourceChecksum: checksum(text),
      sourceMtime: mtimeSec,
    },
  };
}
