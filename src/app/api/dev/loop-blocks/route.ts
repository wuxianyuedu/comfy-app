import { NextResponse } from "next/server";

import { eventLoopWatchRunning, latestEventLoopBlocks } from "~/lib/log/event-loop-watch.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 端点：GET /api/dev/loop-blocks —— 回应用服务进程最近几次**事件循环阻塞**记录
 * （ISSUE #3369）。进程没死、无异常的「短暂无响应」不会留下任何结束记录
 * （run/app-service-exit.json 只由「进程结束那一刻的旁证人」写），而这段读数由
 * 进程内的心跳观测（event-loop-watch.server）记着——消息中心在「应用服务已恢复」
 * 那一刻读它，把恢复消息里「多半是短暂无响应」的猜测换成事实。
 *
 * 与 `/api/dev/last-exit` 同一族的读不到语义：没记录（观测未启动 / 从未阻塞）回
 * 空数组而不是 404——「没阻塞过」是正常状态，404 会被显示成接口挂了（§10.3.1）。
 */
export function GET() {
  return NextResponse.json(
    { running: eventLoopWatchRunning(), blocks: latestEventLoopBlocks() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
