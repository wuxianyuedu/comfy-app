import { type NextRequest, NextResponse } from "next/server";

import { readUsageTestPrologue } from "~/lib/llm/usage-test.server";
import { requireRequestUser } from "~/server/auth/request-user";
import { unauthorizedResponse } from "~/server/lib/error-response";
import { rejectCrossOriginWrite } from "~/server/lib/same-origin";
import { rejectOverRateLimit } from "~/server/lib/rest-rate-limit";

/** prologue 的成功形态（`ok:true` 才带 name / rec / up / modelExtra）。 */
type UsageTestPrologueOk = Extract<Awaited<ReturnType<typeof readUsageTestPrologue>>, { ok: true }>;

/**
 * 两个用量测试路由（提交 `./route` 与「继续等待」`./query`）共用的**入口段**
 * （§12.12：同一段样板收成一份，两路由只剩各自的动作）：鉴权 → 同源闸 →
 * 限流 → 读 body 并解析连接参数。任一闸不过即返回可直接透传的响应；
 * 全过返回 prologue（调用方按各自动作继续）。
 */
export async function usageTestEntry(
  req: NextRequest,
  rateLimitName: string,
): Promise<Response | UsageTestPrologueOk> {
  if (!(await requireRequestUser())) {
    return unauthorizedResponse();
  }
  /* 同源闸（#4723）：写端点统一入口，判据见 ~/server/lib/same-origin。 */
  const crossOrigin = rejectCrossOriginWrite(req);
  if (crossOrigin !== null) {
    return crossOrigin;
  }
  /* 限流（#4725）：会花钱/外联/拉进程的端点挂滑动窗口（默认 10s/20 次）。 */
  const limited = rejectOverRateLimit(req, rateLimitName);
  if (limited !== null) {
    return limited;
  }
  /* 读 body / 取条目名 / 解析连接参数与「继续等待」路由同一份实现（§12.12）。 */
  const prologue = await readUsageTestPrologue(req);
  if (!prologue.ok) {
    return NextResponse.json({ ok: false, detail: prologue.detail });
  }
  return prologue;
}
