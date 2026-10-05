/**
 * `GET /api/comfy/liveness` —— 进程退出事件的推送通道（ISSUE #1351）。
 *
 * 这条通道是「真正的崩溃靠事件，不靠轮询」的服务端落点，钉三件事：
 *   1. 帧形态是 SSE（`text/event-stream` + `no-cache`）；
 *   2. 连上时**补发当前快照** —— 客户端可能在崩溃之后才连上来；但 `seq === 0`
 *      时**不发**（一个「无事发生」的假事件会让下游白做一次崩溃复核）；
 *   3. 事件一到就推、不被缓冲（否则帧会攒到连接关闭才到客户端）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const snapshot = vi.fn();
const subscribers: Array<(s: unknown) => void> = [];
vi.mock("~/lib/comfyui/liveness-signal", () => ({
  getLivenessSnapshot: (): unknown => snapshot() as unknown,
  subscribeComfyExit: (l: (s: unknown) => void) => {
    subscribers.push(l);
    return () => {
      const i = subscribers.indexOf(l);
      if (i >= 0) subscribers.splice(i, 1);
    };
  },
}));

import { GET } from "./route";

beforeEach(() => {
  snapshot.mockReset();
  subscribers.length = 0;
  snapshot.mockReturnValue({ seq: 0, last: null });
});

/** 读一帧（一次 `read()` 拿到的就是当前已入队的那一片）。 */
async function readOnce(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  return new TextDecoder().decode(value);
}

describe("GET /api/comfy/liveness", () => {
  it("是 SSE：Content-Type / no-cache / 关闭反代缓冲", async () => {
    const res = await GET();
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(res.headers.get("Cache-Control")).toContain("no-cache");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");
    await res.body!.cancel();
  });

  it("连上即补发当前快照：崩溃之后才连上来的客户端也能立刻知道", async () => {
    const seen = {
      seq: 7,
      at: 1_000,
      reason: "异常退出（exit 1）",
      userStopped: false,
    };
    snapshot.mockReturnValue({ seq: 7, last: seen });
    const res = await GET();
    expect(await readOnce(res)).toBe(`data: ${JSON.stringify(seen)}\n\n`);
    await res.body!.cancel();
  });

  it("seq 为 0 时不补发假事件（「无事发生」不该被下游当成一次崩溃）", async () => {
    snapshot.mockReturnValue({ seq: 0, last: null });
    const res = await GET();
    const reader = res.body!.getReader();
    /* 没有任何帧可读 —— `read()` 会一直挂着。用「已有订阅者」当「流已起来」的
       证据（补发那一句在它之前），比给 `read()` 设超时确定得多。 */
    await expect.poll(() => subscribers.length).toBe(1);
    reader.releaseLock();
    await res.body!.cancel();
  });

  it("事件一到就推出去", async () => {
    const res = await GET();
    await expect.poll(() => subscribers.length).toBe(1);
    const reader = res.body!.getReader();
    const signal = {
      seq: 1,
      at: 2_000,
      reason: "被信号终止（SIGKILL）",
      userStopped: false,
    };
    subscribers[0]!(signal);
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toBe(
      `data: ${JSON.stringify(signal)}\n\n`,
    );
    reader.releaseLock();
    await res.body!.cancel();
  });
});
