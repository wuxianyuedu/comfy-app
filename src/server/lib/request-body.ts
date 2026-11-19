// ── REST Route Handler 的请求体入口（唯一形态）（规范 16 §16.2.4.44）──────────
// 按形态扫描撞出的账：`src/app/api/**` 的 POST 路由里「读 JSON 体 → 判是不是对象 → 400」写了十来
// 遍且各判各的：5 个文件逐字相同 12 行；`custom-nodes` / `llm/test` 用 `.catch(() => ({}))` 把畸形
// JSON 静默当空对象（同一坏请求一答「请求格式错误」、一答「字段缺失」）；`logs/*` 又是 `{ ok: false }`
// 信封 —— 差异无报错无告警。收：读体 + 收窄 + 400 信封（§10.9）；不收：字段级校验与鉴权位置。

import "server-only";

import { NextResponse } from "next/server";

import { ValidationError } from "~/lib/core/errors";
import { isPlainRecord } from "~/lib/is-record";
import { errorResponse } from "~/server/lib/error-response";

/**
 * 读 JSON 体并收窄成对象；**格式不对时直接给出 400 响应**（调用处：`if (body instanceof
 * NextResponse) return body;`）。返回 `NextResponse` 而不是抛：调用处要**原样**返回，`try/catch` 会把
 * 「格式错误」与「业务失败」混进同一条控制流。**畸形 JSON 不再当空对象**，回一句明确的「请求格式错误」。
 */
export async function readJsonRecord(
  req: Request,
): Promise<Record<string, unknown> | NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(new ValidationError("请求格式错误：正文不是合法 JSON"));
  }
  /* 用 `isPlainRecord` 而不是 `isRecord`：后者的判据是「是不是对象」，
   * 而 **JSON 数组也算对象**（`typeof [] === "object"`）—— 数组体进了
   * 调用处会在 `body.xxx` 上静默拿到 `undefined`，回一句与病因无关的话。
   * 这里要的是「一个 JSON 对象」，所以数组是格式错误。 */
  if (!isPlainRecord(body)) {
    return errorResponse(new ValidationError("请求体必须是对象"));
  }
  return body;
}

/** `readJsonRecord` 的结果是不是「已备好的错误响应」。 */
export function isErrorResponse(
  value: Record<string, unknown> | NextResponse,
): value is NextResponse {
  return value instanceof NextResponse;
}

/**
 * 「必填字符串字段」的取法（`strField` 同一口径，见 `~/lib/workshop/media-source.server`）——
 * **不含**在这里：字段级校验是各端点的域判据。这行是**有意的提醒**：留一个空段比留一个含糊的通用
 * `requireString` 安全 —— 后者会诱导所有人把字段错误文案收成一句，丢掉「哪个字段错了」。
 */
