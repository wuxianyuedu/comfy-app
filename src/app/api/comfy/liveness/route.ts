import {
  getLivenessSnapshot,
  subscribeComfyExit,
} from "~/lib/comfyui/liveness-signal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 端点：GET /api/comfy/liveness —— ComfyUI **进程退出事件**的推送通道（ISSUE #1351）。
 *
 * 「真正的崩溃靠事件，不靠轮询」这条要落地，浏览器就必须能**立刻**知道服务端
 * 那个子进程死了。子进程句柄在服务端（Next 进程 / sidecar），浏览器拿不到
 * `child.on("exit")`，所以这里用 SSE 把它推出去。
 *
 * 帧形态（与 `/api/tasks/[id]/stream` 同款，前端一律 EventSource 消费）：
 *   · `data: {"seq":N,"at":<ms>,"reason":"…","userStopped":false}` —— 一次退出事件；
 *   · 连上时**先补发一次当前快照**（`seq` 为 0 时不发事件帧）：客户端可能在崩溃
 *     **之后**才连上来（用户刚打开页面），它必须能立刻知道「上一拍已经崩过」，
 *     而不是干等下一轮；
 *   · `: hb` 注释行每 15s 一次 —— 长时间没有字节流动时，操作系统 / 代理会在
 *     看似空闲 30~60s 后悄悄掐掉 socket，客户端随后自动重连、把界面刷屏成
 *     「已订阅 / 重连中」。注释行对 EventSource 的 `onmessage` 不可见，却能
 *     刷新内核的 TCP 空闲计时器（口径与 tasks 流一致：15s 远小于常见代理超时）。
 *
 * **这条通道只推送「进程退出」**，不做存活轮询 —— 存活的主力是它 + HTTP 复核，
 * 兜底是客户端的低频轮询（分阶段频率见 `~/lib/comfyui/liveness`）。把探活也塞
 * 进这条流，就又把「事件」做成了「另一条轮询」。
 */
export async function GET(): Promise<Response> {
  const encoder = new TextEncoder();
  /** 流关闭的收尾：清心跳、退订、关流。**只跑一次**（两条路径都会调它）。 */
  type Cleanup = () => void;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let unsubscribe: Cleanup = () => undefined;

      const cleanup: Cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat !== null) clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* 流已经关了 —— 忽略 */
        }
      };

      const send = (obj: unknown): void => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(obj)}\n\n`),
          );
        } catch {
          cleanup();
        }
      };

      /* 补发当前快照：`seq === 0` 表示本进程一次退出都没记过，此时没有可发的
       * 事件（发一个 `seq:0` 的假事件会让客户端把「无事发生」当成一次崩溃）。 */
      const snap = getLivenessSnapshot();
      if (snap.seq > 0 && snap.last !== null) send(snap.last);

      unsubscribe = subscribeComfyExit(send);
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: hb ${Date.now()}\n\n`));
        } catch {
          cleanup();
        }
      }, 15_000);

      return cleanup;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // 反向代理（若有）按此关闭缓冲，否则帧会攒到连接关闭才到客户端。
      "X-Accel-Buffering": "no",
    },
  });
}
