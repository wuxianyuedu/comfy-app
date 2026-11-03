import { subscribeQueueChanged } from "~/lib/comfyui/queue-signal.server";
import { createSseResponse } from "~/app/api/sse-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 端点：GET /api/comfy/queue/events —— ComfyUI 队列/运行变化推送通道（ISSUE #1351 同族，SSE）。
 * 连上先推一帧 `{"changed":true,"at":…}`（客户端可能在变化之后才连上），之后只在 `queue-signal.server` diff 检出变化时推；
 * `: hb` 每 15s 保活，帧头/心跳/关闭收尾共用 `~/app/api/sse-stream`；帧不带负载，真值由客户端去 `/api/comfy/queue` 拉。
 */
export async function GET(): Promise<Response> {
  return createSseResponse(({ send, onClose }) => {
    const notify = (): void => {
      send({ changed: true, at: Date.now() });
    };
    // 连上先推一帧，让客户端立刻拉一次当前状态（即使还没发生任何变化）。
    notify();
    onClose(subscribeQueueChanged(notify));
  });
}
