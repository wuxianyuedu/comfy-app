/**
 * `GET /api/comfy/queue/events` —— ComfyUI 队列/运行变化事件推送通道的契约测试（ISSUE #1351 同族）。
 * 钉三件事（与 liveness 路由同口径）：SSE 帧形态（`text/event-stream` + `no-cache` + 关反代缓冲）；
 * 连上先推一帧（客户端可能在「队列早就变了」之后才连上）；事件即到即推、不被缓冲。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const subscribers: Array<() => void> = [];
vi.mock("~/lib/comfyui/queue-signal.server", () => ({
  subscribeQueueChanged: (l: () => void) => {
    subscribers.push(l);
    return () => {
      const i = subscribers.indexOf(l);
      if (i !== -1) {
        subscribers.splice(i, 1);
      }
    };
  },
}));

import { GET } from "./route";

beforeEach(() => {
  subscribers.length = 0;
});

async function readOnce(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  return new TextDecoder().decode(value);
}

function frameOf(chunk: string): Record<string, unknown> {
  // 形如 `data: {"changed":true,"at":123}\n\n`
  const line = chunk.split("\n").find((l) => l.startsWith("data: "));
  /* SAFETY: 类型断言已复核 */
  return JSON.parse(line!.slice("data: ".length)) as Record<string, unknown>;
}

describe("GET /api/comfy/queue/events", () => {
  it("是 SSE：Content-Type / no-cache / 关闭反代缓冲", async () => {
    const res = GET();
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(res.headers.get("Cache-Control")).toContain("no-cache");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");
    await res.body!.cancel();
  });

  it("连上即推一帧：客户端立刻去拉当前态", async () => {
    const res = GET();
    const frame = frameOf(await readOnce(res));
    expect(frame).toMatchObject({ changed: true });
    expect(typeof frame.at).toBe("number");
    await res.body!.cancel();
  });

  it("队列变化一到就推出去", async () => {
    const res = GET();
    await expect.poll(() => subscribers.length).toBe(1);
    await readOnce(res); // 先吃掉连上的那一帧
    subscribers[0]!(); // 模拟一次「队列变了」
    const frame = frameOf(await readOnce(res));
    expect(frame).toMatchObject({ changed: true });
    await res.body!.cancel();
  });
});
