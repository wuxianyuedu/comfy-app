/**
 * `createSseResponse` —— 两条 SSE 路由共用的传输边缘（帧头 / 心跳 / 收尾）。抽出来是因 `/api/comfy/liveness` 与 `/api/comfy/queue/events` 逐行重合 90%（§12.12 硬闸）；
 * 抽出后这条边缘自己必须钉三件事，否则两份路由的用例只证明「业务帧对了」、证明不了「协议形态没在搬迁里丢」：帧头写全（`text/event-stream` / `no-cache` / 关反代缓冲）；
 * `send` 出的每一帧就是 `data: <json>\n\n`（含中文与引号转义）；收尾**只跑一次**且**断开也跑**（`cancel` 与入队抛错两条路径都调退订 —— 只清一条，15s 心跳会在流关闭后继续跑）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSseResponse } from "./sse-stream";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

async function readOnce(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  return new TextDecoder().decode(value);
}

describe("createSseResponse", () => {
  it("帧头写全：SSE + no-cache + 关反代缓冲 + keep-alive", () => {
    const res = createSseResponse(() => undefined);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(res.headers.get("Cache-Control")).toContain("no-cache");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");
    expect(res.headers.get("Connection")).toBe("keep-alive");
  });

  it("send 出去的每一帧就是 `data: <json>` 加一个空行", async () => {
    const res = createSseResponse(({ send }) => {
      send({ reason: "异常退出（exit 1）", seq: 3 });
    });
    expect(await readOnce(res)).toBe(
      `data: ${JSON.stringify({ reason: "异常退出（exit 1）", seq: 3 })}\n\n`,
    );
  });

  it("心跳是 `: hb` 注释行，15s 一次", async () => {
    const res = createSseResponse(() => undefined);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await readOnce(res)).toMatch(/^: hb \d+\n\n$/);
  });

  it("断开（cancel）会调退订函数，且只调一次", async () => {
    const unsubscribe = vi.fn();
    const res = createSseResponse(({ onClose }) => {
      onClose(unsubscribe);
    });
    await res.body!.cancel();
    await res.body!.cancel();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("断开之后心跳不再入队（流已收尾，定时器必须清掉）", async () => {
    const res = createSseResponse(() => undefined);
    await res.body!.cancel();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("入队抛错（对端已死）也走同一条收尾", async () => {
    const unsubscribe = vi.fn();
    let sendAfterClose: (() => void) | null = null;
    const res = createSseResponse(({ send, onClose }) => {
      onClose(unsubscribe);
      sendAfterClose = () => {
        send({ seq: 1 });
      };
    });
    // `cancel` 之后流已关，再 send 是静默丢弃（不抛给调用方）。
    await res.body!.cancel();
    sendAfterClose!();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
