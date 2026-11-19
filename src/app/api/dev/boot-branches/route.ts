import { NextResponse } from "next/server";

import { failedFunctionalBootBranches } from "~/lib/shell/boot-branches.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/dev/boot-branches —— 本进程的后台启动分支里**仍失败**的功能分支
 * （ISSUE #4257）。消息中心在新进程就绪后取它，把「dispatch / reaper /
 * film-resume 静默失效」变成可见提示；没有失败 = 空数组。
 */
export function GET() {
  return NextResponse.json({ branches: failedFunctionalBootBranches() });
}
