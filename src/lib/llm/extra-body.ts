/**
 * 模型级「额外请求体字段」透传的唯一判定 / 解析出口（ISSUE #3626）。
 *
 * 每个远端模型可配一格 `remoteModel.extraBody`（raw JSON 对象文本）：透传进
 * 请求 body，且**覆盖**运行时的默认组装。用途是把厂商特有的字段原样带上
 * （`extra_body.response_format` / `response_format` 这类 OpenAI 兼容扩展）。
 *
 * 命名必须与上游文档逐字一致是这一格存在的理由：存的就是上游看到的那份 JSON，
 * 不做任何键名收束 / 归一化 —— 收束了就再也对不上文档，「透传」就变成了
 * 「按我们猜的形状改写」。
 *
 * 保存侧（`validateModelForm` / zod refine）与读侧（请求组装 / 适配器）共用
 * 这一份判据，不让客户端放行、服务端又拦下另一种行为（§12.18）。
 *
 * @module lib/llm/extra-body
 */

import { isPlainRecord } from "~/lib/is-record";

/** 文本上限：JSON 对象文本按 2 万字符封顶（zod refine 同一口径）。 */
export const EXTRA_BODY_TEXT_MAX = 20_000;

/** 写入侧判据（zod refine / `validateModelForm` 共用）：
 *  空串 / 纯空白 = 合法（未配置）；其余必须解析成 JSON 对象 ——
 *  数组 / 标量 / 非法 JSON 一律不许落库（否则运行时只能静默丢掉，用户不知道为什么没生效）。 */
export function isExtraBodyJsonObject(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "") {
    return true;
  }
  try {
    return isPlainRecord(JSON.parse(trimmed));
  } catch {
    return false;
  }
}

/** 读侧：空 / 坏 JSON / 解析出非对象 → `null`（一律按「未配置」处理）。
 *  绝不抛 —— 坏行（历史数据、手写坏 JSON）不许让整次请求挂掉；
 *  运行期还有写入侧这一道闸，坏行理论上到不了运行期。 */
export function parseExtraBodyObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isPlainRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
