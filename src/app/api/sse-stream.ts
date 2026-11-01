/**
 * 服务端推流（SSE）的公共边缘：帧头、心跳、关闭收尾。
 *
 * 为什么需要这一层：`/api/comfy/liveness` 与 `/api/comfy/queue/events` 是同一套
 * 「事件为主、轮询兜底」的两条通道，此前各自把帧头、`: hb` 心跳、`closed` 收尾
 * 抄了整份 —— 逐行重合 90%，被 §12.12 的硬闸判成孪生对。两份协议的差异只有一句：
 * 「连上时先发什么帧」。
 *
 * 这条边缘**只做传输层**（帧形态 / 心跳 / 关闭），不含任何一侧的业务语义：
 * 帧内容与订阅源都由调用方注入。
 */

/** SSE 帧头：反代（若有）按 `X-Accel-Buffering` 关缓冲，否则帧会攒到连接关闭才到客户端。 */
const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

/** 心跳间隔：远小于常见代理的 30–60s 空闲超时（超时被掐即客户端重连、界面刷屏）。 */
const HEARTBEAT_MS = 15_000;

/** 一条 SSE 流的写端：调用方只关心「发什么帧」，不关心「还能不能发」。 */
export type SseChannel = {
  /** 挂上退订函数：收尾时（关流 / 浏览器断开）由边缘替调用方调一次。 */
  onClose: (unsubscribe: () => void) => void;
  /** 发一帧 `data: <json>`。流已关则静默丢弃（不抛给调用方）。 */
  send: (payload: unknown) => void;
};

/**
 * 建一条 SSE 响应。`onOpen` 在流起来时被调用一次：发首帧、挂订阅源都在它里面。
 *
 * 收尾（清心跳、退订、关流）**只跑一次**：`send` 的入队抛错、心跳的入队抛错、
 * 流自身的 `cancel`（浏览器断开）三条路径都收进同一个收尾函数 —— 只清一条，
 * 剩下的那条会让 15s 心跳在流关闭之后继续跑。
 *
 * @param onOpen 流起来之后要做的事（首帧 + 订阅），拿到写端与收尾
 * @returns 可直接作为路由返回值的 `Response`（帧头已写全）
 */
export function createSseResponse(onOpen: (channel: SseChannel) => void): Response {
  const encoder = new TextEncoder();
  /** 收尾函数：`cancel` 在流对象之外才知道，故用一格引用先兜住。 */
  let cleanup: () => void = () => undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let unsubscribe: () => void = () => undefined;

      const finish = (): void => {
        if (closed) {
          return;
        }
        closed = true;
        if (heartbeat !== null) {
          clearInterval(heartbeat);
        }
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* 流已经关了 —— 忽略 */
        }
      };
      cleanup = finish;

      const enqueue = (text: string): void => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          finish();
        }
      };

      /* 注释行对 `EventSource.onmessage` 不可见，却能刷新内核的 TCP 空闲计时器。 */
      heartbeat = setInterval(() => {
        if (!closed) {
          enqueue(`: hb ${Date.now()}\n\n`);
        }
      }, HEARTBEAT_MS);

      onOpen({
        send: (payload) => {
          if (!closed) {
            enqueue(`data: ${JSON.stringify(payload)}\n\n`);
          }
        },
        onClose: (fn) => {
          unsubscribe = fn;
        },
      });
    },
    cancel() {
      /* 浏览器断开：`ReadableStream` 只认 `cancel`，不调 `start` 的返回值。 */
      cleanup();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
