// @vitest-environment jsdom
/**
 * 「运行态变了」那条通道的客户端一半。
 *
 * 钉四件事：
 *   · 没有订阅者时不发请求（这条通道是替轮的，不该在没人看时永远占着连接）；
 *   · 订阅后按 `since` 发长轮询，204 当「没有变化」继续下一轮；
 *   · 按 `seq` 去重（服务端每轮都会把当前快照发一遍，不去重会重复触发重问）；
 *   · 坏帧 / 网络异常不把整条链拖死。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetComfyStateClientForTest, subscribeComfyStateChanges } from "./comfy-state-client";

const fetches: Array<string> = [];

/** 装一个「按脚本逐次回答」的 fetch 替身。 */
function stubFetch(answers: Array<{ body?: unknown; status: number }>): () => number {
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      fetches.push(String(url));
      const answer = answers[Math.min(i, answers.length - 1)]!;
      i += 1;
      if (answer.status === 204) {
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return () => i;
}

/** 让在途的那一拍跑完（长轮询链是「请求完成 → 立刻再发」）。 */
async function settle(times = 1): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function change(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    seq: 1,
    at: 1000,
    kind: "ready",
    detail: "ComfyUI 已就绪",
    ...over,
  };
}

beforeEach(() => {
  fetches.length = 0;
  resetComfyStateClientForTest();
});

afterEach(() => {
  resetComfyStateClientForTest();
  vi.unstubAllGlobals();
});

describe("subscribeComfyStateChanges", () => {
  it("没有订阅者时不发请求（没人看就不占连接）", async () => {
    stubFetch([{ status: 204 }]);
    await settle(2);
    expect(fetches).toEqual([]);
  });

  it("订阅后立刻发一轮：首帧带 `since=0`", async () => {
    stubFetch([{ status: 204 }]);
    const off = subscribeComfyStateChanges(() => undefined);
    await settle(1);
    expect(fetches[0]).toContain("/api/comfy/state?since=0");
    off();
  });

  it("204 当「没有变化」继续下一轮，且 `since` 不前进", async () => {
    stubFetch([{ status: 204 }, { status: 204 }, { status: 204 }]);
    const off = subscribeComfyStateChanges(() => undefined);
    await settle(3);
    expect(fetches.length).toBeGreaterThanOrEqual(3);
    expect(new Set(fetches)).toEqual(new Set(["/api/comfy/state?since=0"]));
    off();
  });

  it("拿到变化 → 通知订阅者，且下一轮带上新的 since", async () => {
    stubFetch([{ status: 200, body: change() }, { status: 204 }]);
    const seen: Array<number> = [];
    const off = subscribeComfyStateChanges((c) => seen.push(c.seq));
    await settle(2);
    expect(seen).toEqual([1]);
    expect(fetches.some((u) => u.includes("since=1"))).toBe(true);
    off();
  });

  it("同一个 seq 再发一遍不再通知（重连补发不算新事件）", async () => {
    stubFetch([{ status: 200, body: change() }, { status: 200, body: change() }, { status: 204 }]);
    const seen: Array<number> = [];
    const off = subscribeComfyStateChanges((c) => seen.push(c.seq));
    await settle(3);
    expect(seen).toEqual([1]);
    off();
  });

  it("坏帧不把链拖死：解析不了就继续下一轮", async () => {
    stubFetch([{ status: 200, body: { nope: true } }, { status: 204 }]);
    const seen: Array<number> = [];
    const off = subscribeComfyStateChanges((c) => seen.push(c.seq));
    await settle(3);
    expect(seen).toEqual([]);
    expect(fetches.length).toBeGreaterThanOrEqual(2);
    off();
  });

  it("网络异常静默降级到下一轮（这条通道只负责「更快」，坏了不打扰界面）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const seen: Array<number> = [];
    const off = subscribeComfyStateChanges((c) => seen.push(c.seq));
    await settle(2);
    expect(seen).toEqual([]);
    off();
  });

  it("最后一个订阅者退订后停表", async () => {
    stubFetch([{ status: 204 }]);
    const off = subscribeComfyStateChanges(() => undefined);
    await settle(1);
    const before = fetches.length;
    off();
    await settle(2);
    expect(fetches.length).toBe(before);
  });

  it("多个订阅者共用一条链（同一次变化人人有份）", async () => {
    stubFetch([{ status: 200, body: change() }, { status: 204 }]);
    const a: Array<number> = [];
    const b: Array<number> = [];
    const offA = subscribeComfyStateChanges((c) => a.push(c.seq));
    const offB = subscribeComfyStateChanges((c) => b.push(c.seq));
    await settle(2);
    expect(a).toEqual([1]);
    expect(b).toEqual([1]);
    expect(fetches.filter((u) => u.includes("since=0")).length).toBe(1);
    offA();
    offB();
  });
});
