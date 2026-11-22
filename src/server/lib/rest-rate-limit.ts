import { NextResponse } from "next/server";

import { checkRateLimit } from "~/server/api/middleware/rate-limit";

/**
 * REST 端点的限流挂载（#4725，#3904 的子项）：`checkRateLimit` 是纯函数、
 * 零 tRPC 依赖（见该模块头注释），这里给它一个 REST 侧的薄出口——给「会花钱、
 * 会外联、会拉进程」的端点一处挂上滑动窗口，与 tRPC `rateLimitedProcedure`
 * 同一份桶与默认预算（10s / 20 次）。
 *
 * 键口径与 tRPC 对齐：tRPC 用 `ctx.user.id`（登录态唯一键）；REST 侧没有
 * procedure 上下文，取 `x-forwarded-for` 首段（直连回退 `"local"`）——本机
 * 单用户部署下就是同一个桶，多副本时换 Redis 实现的也是这一层。
 *
 * @returns 放行返回 `null`；超限返回可直接透传的 429 响应。
 */
export function rejectOverRateLimit(
  request: Request,
  name: string,
  max = 20,
  windowMs = 10_000,
): Response | null {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const firstHop = forwarded.split(",")[0]?.trim();
  const ip = firstHop !== undefined && firstHop !== "" ? firstHop : "local";
  if (checkRateLimit(`rest:${name}:${ip}`, max, windowMs)) {
    return null;
  }
  return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
}
