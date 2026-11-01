import { subscribeQueueChanged } from "~/lib/comfyui/queue-signal.server";
import { createSseResponse } from "~/app/api/sse-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 端点：GET /api/comfy/queue/events —— ComfyUI **队列/运行变化**的推送通道（ISSUE #1351 同族）。
 *
 * 帧形态（与 `/api/comfy/liveness` 同款 SSE；前端用 EventSource 消费）：
 *   · 连上时**先推一帧** `{"changed":true,"at":…}` —— 客户端可能在「队列早就变了」
 *     之后才连上来，它必须能立刻拉一次当前态；
 *   · 之后只在 `queue-signal.server` 的 diff 循环检出变化时推一帧；
 *   · `: hb` 注释行每 15s 一次保活（口径同 liveness：远小于常见代理超时）。
 *
 * 帧头 / 心跳 / 关闭收尾三条在 `~/app/api/sse-stream`（与 `/api/comfy/liveness`
 * 共用同一份，两处各抄一遍曾是 §12.12 的孪生对）。
 *
 * 这一格的真相始终由客户端收到事件后去 `/api/comfy/queue` 拉真值（store 内部 `pollOnce`），
 * 所以帧里不带负载——队列状态很小，但「事件只负责说『变了』、真值走既有 GET」
 * 让单一数据源（`queue-status.server`）不被拆两份。
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
