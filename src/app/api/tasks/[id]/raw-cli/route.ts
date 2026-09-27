import { type NextRequest, NextResponse } from "next/server";
import { requireRequestUser } from "~/server/auth/request-user";
import { taskRepository } from "~/lib/core/repository-task";
import { unauthorizedResponse } from "~/server/lib/error-response";

export const runtime = "nodejs";

/* 返回某次执行累积的 comfy-cli 完整原始输出（按行、不截断）。
 *
 * 面板里的 `[comfy-cli 原始]`/`stdout`/`stderr` 出于防刷屏是截断的，这里给
 * 排障用的「查看完整输出」入口提供完整原文。
 *
 * 读的是**库里那一列**而不是本进程内存（P3 §5 ADR §14 D1 的 4-B2）：原文由
 * 执行侧在收口时整包落库，于是 host 执行的任务也看得到——此前它是「谁执行谁
 * 看得见」，Next 点进去永远是空态，而排障最想看的恰恰是这些任务。
 * 没有记录时返回空数组（旧行、或这一轮一行都没吐出），前端据此显示空态。 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }
  const { id } = await ctx.params;
  const lines = await taskRepository.findRawCli(id);
  return NextResponse.json({ lines: lines ?? [] });
}
