/**
 * 懒加载分块空闲预热的行为判据：① 等空闲才开始（否则与首屏抢连接预算，同源 6 条的教训）；② **串行**，至多一条在途
 *（并发是 `ERR_INSUFFICIENT_RESOURCES` 事故同款成因）；③ 单个 loader 失败不挡后面的、不抛未处理拒绝（真失败由
 *  `lazy-chunk-recovery` 兜底）；④ 重复启动只排一次。空闲回调 stub 成可控队列，另有一条退化路径（无 `requestIdleCallback`）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** 微任务 + 定时器都结清：drainOne 的续排挂在 loader 的 `.finally` 上。 */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** 可控的空闲回调队列（stub 掉 `requestIdleCallback`）。 */
let idleQueue: Array<() => void> = [];

beforeEach(() => {
  idleQueue = [];
  vi.stubGlobal("requestIdleCallback", (cb: () => void) => {
    idleQueue.push(cb);
    return idleQueue.length;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** 把排队里的空闲回调挨个跑完（每跑一个都等一轮结清，串行链才续得上）。 */
async function drainIdle(): Promise<void> {
  while (idleQueue.length > 0) {
    idleQueue.shift()?.();
    // oxlint-disable-next-line no-await-in-loop -- 用例逐轮 await 以保持断言顺序与桩状态
    await flush();
  }
}

/** 模块级注册表与幂等闸是状态，逐例换一份新模块实例。 */
async function freshModule() {
  vi.resetModules();
  return import("./lazy-view-prefetch");
}

describe("lazy-view-prefetch — 懒加载分块的空闲预热", () => {
  it("空闲后才逐个要 loader，顺序即登记顺序", async () => {
    const mod = await freshModule();
    const order: Array<string> = [];
    for (const name of ["settings", "queue", "mode-contract"]) {
      mod.registerLazyViewLoader(() => {
        order.push(name);
        return Promise.resolve();
      });
    }

    mod.startLazyViewPrefetch();
    /* 启动本身不发起请求：要等空闲回调，否则和首屏数据抢连接预算。 */
    expect(order).toEqual([]);

    await drainIdle();
    expect(order).toEqual(["settings", "queue", "mode-contract"]);
  });

  it("串行：任意时刻至多一条在途", async () => {
    const mod = await freshModule();
    let inFlight = 0;
    let maxInFlight = 0;
    const tracked = () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return Promise.resolve().then(() => {
        inFlight -= 1;
      });
    };
    mod.registerLazyViewLoader(tracked);
    mod.registerLazyViewLoader(tracked);
    mod.registerLazyViewLoader(tracked);

    mod.startLazyViewPrefetch();
    await drainIdle();

    expect(maxInFlight).toBe(1);
  });

  it("一个 loader 失败不挡住后面的，也不留未处理拒绝", async () => {
    const mod = await freshModule();
    const seen: Array<string> = [];
    mod.registerLazyViewLoader(() => Promise.reject(new Error("分块没了")));
    mod.registerLazyViewLoader(() => {
      seen.push("after");
      return Promise.resolve();
    });

    mod.startLazyViewPrefetch();
    await drainIdle();

    expect(seen).toEqual(["after"]);
  });

  it("重复启动只排一次（幂等）", async () => {
    const mod = await freshModule();
    const calls: Array<number> = [];
    mod.registerLazyViewLoader(() => {
      calls.push(1);
      return Promise.resolve();
    });

    mod.startLazyViewPrefetch();
    mod.startLazyViewPrefetch();
    expect(idleQueue).toHaveLength(1);

    await drainIdle();
    expect(calls).toEqual([1]);
  });

  it("宿主没有 requestIdleCallback 时退化成定时器", async () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    vi.useFakeTimers();
    const mod = await freshModule();
    const calls: Array<number> = [];
    mod.registerLazyViewLoader(() => {
      calls.push(1);
      return Promise.resolve();
    });

    mod.startLazyViewPrefetch();
    expect(calls).toEqual([]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual([1]);
  });
});
