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

import {
  nextPollDelayMs,
  resetComfyStateClientForTest,
  subscribeComfyStateChanges,
} from "./comfy-state-client";

const fetches: Array<string> = [];

/** 装一个「按脚本逐次回答」的 fetch 替身。 */
function stubFetch(answers: Array<{ body?: unknown; status: number }>): () => number {
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
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
    // oxlint-disable-next-line no-await-in-loop -- 用例逐轮 await 以保持断言顺序与桩状态
    await Promise.resolve();
    // oxlint-disable-next-line no-await-in-loop -- 用例逐轮 await 以保持断言顺序与桩状态
    await Promise.resolve();
    // oxlint-disable-next-line no-await-in-loop -- 用例逐轮 await 以保持断言顺序与桩状态
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
      vi.fn(() => {
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

/* ── 失败退避（#4234）────────────────────────────────────────
 * 长轮询的「等」在服务端，健康路径立即重发；但失败（后端不可达）毫秒级重发
 * 会变成失败请求热循环。钉两件事：退避决策表本身、失败期的请求密度有界。 */
describe("nextPollDelayMs（#4234 的退避决策）", () => {
  it("健康（≤0）返回 0：长轮询「立即重发」语义不变", () => {
    expect(nextPollDelayMs(0)).toBe(0);
    expect(nextPollDelayMs(-3)).toBe(0);
  });

  it("rand=1 时走满退避表：500→1000→2000→4000→8000→15000 封顶", () => {
    const seq = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => nextPollDelayMs(s, () => 1));
    expect(seq).toEqual([500, 1000, 2000, 4000, 8000, 15_000, 15_000, 15_000]);
  });

  it("rand=0 时取抖动下沿（equal：一半起跳）", () => {
    expect(nextPollDelayMs(1, () => 0)).toBe(250);
    expect(nextPollDelayMs(7, () => 0)).toBe(7500);
  });
});

describe("失败期的请求密度（#4234）", () => {
  it("后端持续不可达：60s 里只有退避表那么几拍，不再是毫秒级热循环", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(() => Promise.reject(new TypeError("fetch failed")));
      vi.stubGlobal("fetch", fetchMock);
      const off = subscribeComfyStateChanges(() => undefined);

      await vi.advanceTimersByTimeAsync(60_000);

      /* 退避表（抖动随机）在 60s 里落在 7~12 拍；旧形态（失败即 0 立即重发）
       * 在同一窗口是数万拍。上限取最坏快抖动的累计值再留一拍余量。 */
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(13);
      off();
    } finally {
      vi.useRealTimers();
    }
  });

  it("回到健康后立即重发（退避不吞掉恢复）", async () => {
    vi.useFakeTimers();
    let fail = true;
    const fetchMock = vi.fn(() =>
      fail
        ? Promise.reject(new TypeError("fetch failed"))
        : Promise.resolve(new Response(null, { status: 204 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const off = subscribeComfyStateChanges(() => undefined);
    await vi.advanceTimersByTimeAsync(2000);
    const failedCount = fetchMock.mock.calls.length;
    expect(failedCount).toBeGreaterThanOrEqual(2);
    off(); /* 失败链停在退避里，直接退场 */

    /* 换真定时器起一条新链：成功一拍后健康路径是 0ms 立即重发（真实现里
     * 这一「等」在服务端 25s，0 延迟不是忙等），settle 的有界等待抓得住它。 */
    vi.useRealTimers();
    fail = false;
    const off2 = subscribeComfyStateChanges(() => undefined);
    await settle(2);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(failedCount + 1);
    off2();
  });
});
