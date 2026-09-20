// ── 工坊生成执行日志：持久化条目的纯规则 ─────────────────────────────
// 角色/分镜的模型提取、AI 拆镜、定妆照生成的执行日志原来只活在 React 会话里，
// 刷新 / 重启就没了。这里定义落盘的统一条目形状与归一化规则（服务端追加与
// 读取共用，纯函数可直接单测）；文件布局见 log-paths.ts 的 WORKSHOP_LOG_DIR。

import { formatDate } from "~/lib/time-format";

/** 产生执行日志的工坊环节。 */
export const GENERATION_LOG_STAGES = [
  "character",
  "storyboard",
  "portrait",
] as const;
export type GenerationLogStage = (typeof GENERATION_LOG_STAGES)[number];

export const GENERATION_LOG_STAGE_LABELS: Record<GenerationLogStage, string> = {
  character: "角色卡",
  storyboard: "分镜",
  portrait: "定妆照",
};

/** 落盘条目（与界面的 ExtractLogEntry / PortraitLogEntry 保持字段兼容：
 *  summary 是单行摘要，detail 是可选的多行正文）。 */
export interface GenerationLogEntry {
  /** 产生时刻（ms）；非法输入归一为落盘时刻 */
  ts: number;
  /** 环节内的小类（提取日志的 init/request/output/…，定妆照的 info/success/error） */
  kind: string;
  /** 单行摘要 */
  summary: string;
  /** 可选多行正文（模型输入 / 输出原文） */
  detail?: string;
}

/** 单行正文 / 摘要的落盘上限：超长截断，防单条日志撑爆文件与读取。 */
export const MAX_LOG_SUMMARY_CHARS = 600;
export const MAX_LOG_DETAIL_CHARS = 12000;

function isGenerationLogStage(v: unknown): v is GenerationLogStage {
  return (
    typeof v === "string" &&
    (GENERATION_LOG_STAGES as readonly string[]).includes(v)
  );
}

/** 任意输入 → 可落盘条目；形状不合法（无摘要）返回 null，坏数据不炸文件。 */
export function normalizeGenerationLogEntry(
  raw: unknown,
): GenerationLogEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  const summary =
    typeof rec.summary === "string"
      ? rec.summary.trim().slice(0, MAX_LOG_SUMMARY_CHARS)
      : "";
  if (!summary) return null;
  const ts =
    typeof rec.ts === "number" && Number.isFinite(rec.ts)
      ? rec.ts
      : typeof rec.ts === "string" && rec.ts
        ? Date.parse(rec.ts)
        : NaN;
  const detail =
    typeof rec.detail === "string" && rec.detail
      ? rec.detail.slice(0, MAX_LOG_DETAIL_CHARS)
      : undefined;
  return {
    ts: Number.isFinite(ts) ? ts : Date.now(),
    kind:
      typeof rec.kind === "string" && rec.kind ? rec.kind.slice(0, 24) : "info",
    summary,
    ...(detail ? { detail } : {}),
  };
}

/** 解析一行 JSONL（容错：坏行返回 null）。 */
export function parseGenerationLogLine(
  line: string,
): GenerationLogEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return normalizeGenerationLogEntry(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

/** 校验请求里的 stage；非法返回 null。 */
export function parseGenerationLogStage(v: unknown): GenerationLogStage | null {
  return isGenerationLogStage(v) ? v : null;
}

/** 按天的日志文件名（自然轮转：跨天写新文件，读取按文件名倒序回溯）。 */
export function generationLogFileName(day: Date): string {
  /* 日期口径走 `~/lib/time-format` 的 `formatDate`（此前与历史日期桶、
   * 消息中心各拼一遍，且都恰好用半角连字符 —— 那是同一件事的三种写法）。 */
  return `generation-${formatDate(day)}.log`;
}
