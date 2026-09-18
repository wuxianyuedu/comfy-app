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
// **两种格式地位同等，入库不做格式互转**：API 格式落 `graph`、工作流(RAW)
// 格式落 `rawJson`，两列各自最多一份、各自可空。执行侧两条路都认（见
// `resolveExecutionInput`），所以 RAW 不需要（也不该）在导入时被转成 API 图
// —— 无 ComfyUI 可达时的启发式转换结果本身就是错的，存下来只会让画布与运行
// 都跑一份错图。

import "server-only";
import { promises as fs } from "fs";
import { createHash } from "crypto";
import { z } from "zod";
import { logger } from "~/lib/core/logger";
import {
  asRawWorkflow,
  detectFormat,
  extractPositions,
} from "~/lib/comfyui/raw";
import {
  normalizeTaskType,
  VALID_TASK_TYPE_CODES,
} from "~/lib/workflow/workflow-types";
import { detectParamMap } from "~/lib/comfyui/workflow";

/* ── 外部工作流 JSON 的形状契约（导入边界，规范 §5.5）──────────────────────
 * 「这是哪种格式」仍由 `detectFormat` 判 —— 它是「两列地位同等」这条判据的
 * 唯一定义处，不在这里再写一遍。本组 schema 只回答**落到库里的东西是什么形状**：
 * 判据说是 API，就必须真的有一批带 `class_type` 的节点；说是 RAW，就必须真的有
 * 非空 `nodes[]`（且每个节点带 `type`）。
 *
 * 用 `.loose()`（保留未知键）而不是剥键：RAW 原件要**逐字落库**（groups /
 * definitions / extra / 各节点私有字段都得原样留着），任何剥键都会让「重新下载
 * 源文件」拿到一份被改过的 JSON。 */
const ApiGraphSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (graph) =>
      Object.values(graph).some(
        (node) =>
          node !== null &&
          typeof node === "object" &&
          typeof (node as { class_type?: unknown }).class_type === "string",
      ),
    { message: "不是有效的 ComfyUI API 工作流（未找到节点 class_type）" },
  );
const RawWorkflowSchema = z.looseObject({
  nodes: z.array(z.looseObject({ type: z.string() })).min(1),
});

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

/* 读一个本地文件，返回它的文本与 mtime（毫秒）。
 * 路径缺失或不可读时抛出带可读说明的错误。 */
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
    const parsed = ApiGraphSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new Error("不是有效的 ComfyUI API 工作流（未找到节点 class_type）");
    }
    apiGraph = parsed.data;
  } else {
    /* 工作流(RAW)格式：**原件入库，不转 API 图**。
     *
     * 历史做法是导入时把 raw 转成 API 图存进 `graph`（转换失败再回落启发式），
     * 存错图的代价由用户承担：无 ComfyUI 可达时启发式按类名猜控件顺序，猜错
     * 就是一份能打开、跑起来结果不对的图。执行侧本来就有 comfy-cli 直接吃 raw
     * 的路（它按节点类定义做权威转换），入库再转一次是多余且有害的一步。 */
    const parsed = RawWorkflowSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new Error(
        "不是有效的工作流(RAW) JSON：缺少节点数组 nodes[]（或节点缺少 type 字段）",
      );
    }
    rawJson = parsed.data;
    const rawView = asRawWorkflow(parsed.data);
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
  /** 文件 mtime，单位是秒（epoch）—— 它存在 SQLite 的 32 位 INT 列里，
   *  因此要保持在 2.1e9 以下，不能用毫秒（会溢出 INT）。 */
  sourceMtime: number;
}

/* 从本地路径做一次性导入：读文件，返回全部规整字段，
 * 以及要写进 WorkflowTemplate 行的追踪元数据。 */
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
  /* 文件已从磁盘上消失 —— 调用方应给出「源文件缺失」的提示 */
  missing?: boolean;
  /* 文件还在，但 mtime 与上次导入一致（快路径，不重新解析） */
  unchanged?: boolean;
  /* 文件变了 → 重新解析出的字段，要写回数据库 */
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
 * 重新读取此前导入过的工作流的源文件，判断有没有变化、变化了什么。
 * `tpl` 必须带 `sourcePath` 与 `sourceMtime`。返回三种之一：
 *   - { missing: true }   文件已不存在
 *   - { unchanged: true } mtime 一致（快路径，不重新解析）
 *   - { update: {...} }   文件变了 → 要落库的规整字段
 *
 * 注意：返回 `update` 时，graph / rawJson / positions / paramMap 都会被覆盖
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
