import { type NextRequest, NextResponse } from "next/server";
import { requireRequestUser } from "~/server/auth/request-user";
import { NotFoundError } from "~/lib/core/errors";
import { taskRepository } from "~/lib/core/repository-task";
import { errorResponse, unauthorizedResponse } from "~/server/lib/error-response";

export const runtime = "nodejs";

/* 返回某次执行累积的 comfy-cli 完整原始输出（按行、不截断），供排障「查看完整输出」入口
 *（面板里的 `[comfy-cli 原始]`/stdout/stderr 防刷屏已截断）。
 * 读库里那一列而非本进程内存（P3 §5 ADR §14 D1 的 4-B2）：原文执行侧收口时整包落库，
 * host 执行的任务也看得到。无记录返回空数组，前端据此显示空态。 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }
  const { id } = await ctx.params;
  /* 归属校验（越权修复，与 tRPC task.detail 同判据）：comfy-cli 原始输出含完整
   * 提示词、参数与内部路径，不得凭他人 taskId 读取。不命中按 NOT_FOUND 处理，
   * 不区分「不存在」与「不是你的」，避免借状态码探得他人任务 id 的存在性。 */
  const owned = await taskRepository.findByIdForUser(user.id, id);
  if (!owned) {
    return errorResponse(new NotFoundError("任务不存在"));
  }
  const lines = await taskRepository.findRawCli(id);
  return NextResponse.json({ lines: lines ?? [] });
}
