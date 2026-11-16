// ── REST Route Handler 的错误出口（唯一形态）────────────────────────────────
// 此前 15 个 route / 18 处各自手写同一段 401 字面量（`{ error: { code: "auth.required", message: "未登录或会话已失效" } }`），
// 与 `lib/core/errors.ts` 的 AuthError 默认值逐字相同却复制 18 份：改文案要改 18 处，新 route 会照抄（ISSUE #573）。
// 这里只做框架适配：信封形状由核心层 `toErrorEnvelope` 决定（唯一事实源），本文件包成 NextResponse 并附 HTTP 状态；
// 核心层因此保持零框架依赖，`scripts/*.mjs` 这类纯 Node 宿主也能安全 import。
import "server-only";

import { NextResponse } from "next/server";

import { AuthError, toErrorEnvelope, normalizeError } from "~/lib/core/errors";
import { logger } from "~/server/lib/logger";

/**
 * 把任意异常映射为 REST 错误响应。
 * - `AppError` 子类 → 用其 `code` 与 `httpStatus`；
 * - 其余异常 → 归一化为 500 / `"internal"`，**不泄露堆栈与内部细节**。
 *
 * 这里也是 REST 失败路径的**日志漏斗点**（#4092）：绝大多数 route 自身不写日志，
 * 若本函数只回信封不落日志，5xx 就成了「客户端看得见、服务端无迹可查」的静默失败。
 * 按状态分级：≥500 → `logger.error`（带原始 err，堆栈只进日志）；4xx → `logger.debug`
 * （预期内的客户端错误，不进告警面，免得噪声淹没真故障）。
 */
export function errorResponse(err: unknown): NextResponse {
  const appErr = normalizeError(err);
  if (appErr.httpStatus >= 500) {
    logger.error(
      {
        err,
        code: appErr.code,
        httpStatus: appErr.httpStatus,
        stack: err instanceof Error ? err.stack : undefined,
      },
      "rest_error",
    );
  } else {
    logger.debug({ code: appErr.code, httpStatus: appErr.httpStatus }, "rest_error_client");
  }
  return NextResponse.json(toErrorEnvelope(appErr), {
    status: appErr.httpStatus,
  });
}

/** 401 结构化信封（= `AuthError` 的默认 code / message）。 */
export function unauthorizedResponse(): NextResponse {
  return errorResponse(new AuthError());
}
