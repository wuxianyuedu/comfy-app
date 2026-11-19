import { NextResponse } from "next/server";

import { getComfyStateChange, waitForComfyStateChange } from "~/lib/comfyui/state-watch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 长轮询窗口（毫秒）。 */
const LONG_POLL_MS = 25_000;

/**
 * 端点：GET /api/comfy/state —— 「ComfyUI 运行态变了」的长轮询通道：不用 SSE 是因为同一条通道要服务浏览器与桌面壳，
 * 普通 `fetch` 即可、`since` 在查询串里断线重连只再发一次请求。帧：200 `{seq,at,kind,detail}` / 204 窗口内无变化（该再发一轮）/
 * `?since=<n>` 缺省=当前快照。它只说「变了，重新来问一次」，真正的四态仍由 `setting.comfyStatus` 给出。
 */
export async function GET(request: Request): Promise<Response> {
  const change = await waitForComfyStateChange(readSince(request), LONG_POLL_MS);
  if (change === null) {
    /* 什么都不发：204 是「这一轮没有变化」，客户端据此再发一轮。 */
    return new NextResponse(null, { status: 204 });
  }
  return NextResponse.json(change);
}

/** 读 `?since=`：不是非负整数一律当 0（首帧 / 坏参数都落到「先给我快照」）。 */
function readSince(request: Request): number {
  const raw = new URL(request.url).searchParams.get("since");
  if (raw === null) {
    /* 不带 `since` 的首次调用：用「当前纪元减一」，让下面的等待**立刻**命中
     * 「最近一次变化」。这与状态链路给不出历史有关 —— 我们只能告诉调用方
     * 「刚变过一次」，不能重放更早的序列。 */
    return getComfyStateChange().seq - 1;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
