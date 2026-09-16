// ── REST Route Handler 的错误出口（唯一形态）────────────────────────────────
// 此前 15 个 route / 18 处各自手写同一段字面量：
//   NextResponse.json({ error: { code: "auth.required", message: "未登录或会话已失效" } },
//                     { status: 401 })
// 与 `lib/core/errors.ts` 的 AuthError 默认值逐字相同，却复制 18 份——改文案
// 要改 18 处，且新 route 会照着再抄一份（ISSUE #573 的「本应复用却自己实现」）。
//
// 这里只做「框架适配」：信封形状由核心层的 toErrorEnvelope 决定（唯一事实
// 源），本文件负责把它包成 NextResponse 并附上 HTTP 状态。核心层因此保持
// 零框架依赖，`scripts/*.mjs` 这类纯 Node 宿主也能安全 import。
import "server-only";

import { NextResponse } from "next/server";

import { AuthError, toErrorEnvelope, normalizeError } from "~/lib/core/errors";

/**
 * 把任意异常映射为 REST 错误响应。
 *
 * - `AppError` 子类 → 用其 `code` 与 `httpStatus`；
 * - 其余异常 → 归一化为 500 / `"internal"`，**不泄露堆栈与内部细节**。
 */
export function errorResponse(err: unknown): NextResponse {
  const appErr = normalizeError(err);
  return NextResponse.json(toErrorEnvelope(appErr), {
    status: appErr.httpStatus,
  });
}

/** 401 结构化信封（= `AuthError` 的默认 code / message）。 */
export function unauthorizedResponse(): NextResponse {
  return errorResponse(new AuthError());
}
