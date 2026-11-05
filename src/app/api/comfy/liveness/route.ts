import { getLivenessSnapshot, subscribeComfyExit } from "~/lib/comfyui/liveness-signal";
import { createSseResponse } from "~/app/api/sse-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 端点：GET /api/comfy/liveness —— ComfyUI 进程退出事件推送通道（ISSUE #1351）：子进程句柄在
 * 服务端，用 SSE 推出去；连上先补发当前快照（`seq` 为 0 不发事件帧）。帧头/心跳/收尾在
 * `~/app/api/sse-stream`。只推送「进程退出」，不做存活轮询（否则又做成另一条轮询）。
 */
export function GET(): Response {
  return createSseResponse(({ send, onClose }) => {
    /* 补发当前快照：`seq === 0` 表示本进程一次退出都没记过，此时没有可发的
     * 事件（发一个 `seq:0` 的假事件会让客户端把「无事发生」当成一次崩溃）。 */
    const snap = getLivenessSnapshot();
    if (snap.seq > 0 && snap.last !== null) {
      send(snap.last);
    }
    onClose(subscribeComfyExit(send));
  });
}
