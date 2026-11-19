// `fetchLoopBlockForOffline` 的判据：读不到（HTTP 失败 / 坏形状）一律 null 不抛；
// 只认与断开窗口重叠的记录，且取**最近**一条（服务端按时间序，倒着找第一个命中）。

import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchLoopBlockForOffline } from "./app-service-loop-blocks";

afterEach(() => {
  vi.unstubAllGlobals();
});

const OFFLINE = 100_000;
const RECOVERED = 119_000;

function block(overrides: Partial<Record<string, number>> = {}) {
  return { driftMs: 17_000, startedAt: OFFLINE - 1000, endedAt: RECOVERED - 1000, ...overrides };
}

function stubBody(body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))),
  );
}

describe("fetchLoopBlockForOffline", () => {
  it("读到与窗口重叠的记录：原样带回三个字段", async () => {
    stubBody({ running: true, blocks: [block()] });
    const got = await fetchLoopBlockForOffline(OFFLINE, RECOVERED);
    expect(got).toEqual(block());
  });

  it("多条命中取最近一条（endedAt 最大）", async () => {
    stubBody({
      running: true,
      blocks: [block({ driftMs: 4000, startedAt: 90_000, endedAt: 95_000 }), block()],
    });
    const got = await fetchLoopBlockForOffline(OFFLINE, RECOVERED);
    expect(got?.driftMs).toBe(17_000);
  });

  it("窗口不重叠（阻塞更早 / 在恢复之后才观测到）不带回", async () => {
    stubBody({
      running: true,
      blocks: [
        block({ startedAt: 50_000, endedAt: 60_000 }), // 断开之前就恢复了
        block({ startedAt: RECOVERED + 1000, endedAt: RECOVERED + 5000 }), // 恢复之后才观测到
      ],
    });
    expect(await fetchLoopBlockForOffline(OFFLINE, RECOVERED)).toBeNull();
  });

  it("404 / 非 2xx：null，不抛", async () => {
    stubBody({}, 404);
    expect(await fetchLoopBlockForOffline(OFFLINE, RECOVERED)).toBeNull();
  });

  it("网络异常：null，不抛", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );
    expect(await fetchLoopBlockForOffline(OFFLINE, RECOVERED)).toBeNull();
  });

  it("坏形状（blocks 不是数组 / 元素缺字段）归到「没有可用的读数」", async () => {
    stubBody({ running: true, blocks: "nope" });
    expect(await fetchLoopBlockForOffline(OFFLINE, RECOVERED)).toBeNull();
    stubBody({ running: true, blocks: [{ driftMs: "x", startedAt: 1, endedAt: 2 }] });
    expect(await fetchLoopBlockForOffline(OFFLINE, RECOVERED)).toBeNull();
  });
});
