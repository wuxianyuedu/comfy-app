import { NextResponse } from "next/server";

import { getServerBootId, getServerRunId } from "~/lib/shell/dev-server-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 端点：GET /api/dev/server-id —— 回 bootId（「真正重启」的权威信号，区分网络抖动与真重启）
 * 与本次启动 runId（launcher 产出，消息中心按「每一次启动」分组；须与 bootId 同一次探测回来，
 * 否则刚恢复时会拿旧 runId 盖错组）。拿不到 runId 给 null（没走 launcher），不编值。
 */
export function GET() {
  return NextResponse.json({
    bootId: getServerBootId(),
    runId: getServerRunId(),
  });
}
