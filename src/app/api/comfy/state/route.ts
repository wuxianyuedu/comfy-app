import { NextResponse } from "next/server";

import {
  getComfyStateChange,
  waitForComfyStateChange,
} from "~/lib/comfyui/state-watch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 端点：GET /api/comfy/state —— 「ComfyUI 运行态变了」的长轮询通道。
 *
 * 「状态变化靠推送、不靠 5s 一拍」这条要落地，浏览器就必须在**变化发生的那一刻**
 * 拿到通知；而这条通知的来源在服务端（启动动作、子进程退出、配置写入都发生在那
 * 里）。这里用**长轮询**而不是 `EventSource`（SSE）：
 *
 *   · 同一条通道要同时服务浏览器与**桌面壳**，长轮询只是个普通 `fetch`；
 *   · `since` 就在查询串里，断线重连 / 系统睡醒重来都只是再发一次请求，
 *     不像 SSE 要额外处理断线补发；
 *   · 事件稀疏（分钟级一次）时，长轮询的连接成本与 SSE 同级；事件密集时
 *     每轮立刻返回，也不会积压。
 *
 * 帧形态：
 *   · `200 {"seq":N,"at":<ms>,"kind":"start|ready|stop|exit|config","detail":"…"}`
 *     —— 一次变化（`seq` 大于调用方给的 `since`）；
 *   · `204`（空体）—— 窗口内什么都没发生：客户端拿它当「该再发一轮了」，不是错误；
 *   · `?since=<n>` 缺省 = 「给我当前快照」（见 `readSince`）。
 *
 * **这条通道不替状态结论**：它只说「变了，重新来问一次」，真正的四态仍由
 * `setting.comfyStatus` 给出 —— 把状态本身塞进这条流，就等于把「事件驱动」
 * 做成「另一条轮询」（同 `liveness` 路由的口径）。
 */
export async function GET(request: Request): Promise<Response> {
  const change = await waitForComfyStateChange(
    readSince(request),
    LONG_POLL_MS,
  );
  if (change === null) {
    /* 什么都不发：204 是「这一轮没有变化」，客户端据此再发一轮。 */
    return new NextResponse(null, { status: 204 });
  }
  return NextResponse.json(change);
}

/** 长轮询窗口（毫秒）。 */
const LONG_POLL_MS = 25_000;

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
