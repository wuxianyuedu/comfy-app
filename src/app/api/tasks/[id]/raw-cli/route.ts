import { type NextRequest, NextResponse } from "next/server";
import { requireRequestUser } from "~/server/auth/request-user";
import { getRawCli } from "~/lib/comfyui/runner-state";
import { unauthorizedResponse } from "~/server/lib/error-response";

export const runtime = "nodejs";

/* 返回某次执行累积的 comfy-cli 完整原始输出（按行、不截断）。
 *
 * 面板里的 `[comfy-cli 原始]`/`stdout`/`stderr` 出于防刷屏是截断的，这里给
 * 排障用的「查看完整输出」入口提供完整原文。无记录时返回空数组（旧任务 /
 * 服务端重启后内存缓冲已清空），前端据此显示空态。 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await requireRequestUser();
  if (!user) {
    return unauthorizedResponse();
  }
  const { id } = await ctx.params;
  return NextResponse.json({ lines: getRawCli(id) });
}
