// content-write-lock 的判决面（ISSUE #3864）：同项目串行、异项目并行、异常透传不堵路。
// 等待一律用 deferred 手动放行（§11.14：测试里不写裸定时器），微任务拍点即可断言。

import { describe, expect, it } from "vitest";

import { withProductionContentLock } from "./content-write-lock";

describe("withProductionContentLock（ISSUE #3864）", () => {
  it("同一项目的写者串行化：前一个落定前，后一个不进入", async () => {
    const order: Array<string> = [];
    let releaseA!: () => void;
    const aGate = new Promise<void>((r) => {
      releaseA = r;
    });
    const a = withProductionContentLock("p1", async () => {
      order.push("a-start");
      await aGate;
      order.push("a-end");
    });
    const b = withProductionContentLock("p1", () => {
      order.push("b-start");
    });
    // a 还没放行 ⇒ b 必须还在锁外排队（一个微任务拍点足够让 a 进入、b 未进）。
    await Promise.resolve();
    expect(order).toEqual(["a-start"]);
    releaseA();
    await Promise.all([a, b]);
    expect(order).toEqual(["a-start", "a-end", "b-start"]);
  });

  it("不同项目互不阻塞", async () => {
    const order: Array<string> = [];
    let release1!: () => void;
    const p1Gate = new Promise<void>((r) => {
      release1 = r;
    });
    const p1 = withProductionContentLock("p1", async () => {
      await p1Gate;
      order.push("p1");
    });
    const p2 = withProductionContentLock("p2", () => {
      order.push("p2");
    });
    await Promise.resolve();
    // p1 还挂着 ⇒ p2 已经跑完：不同 key 不互相等。
    expect(order).toEqual(["p2"]);
    release1();
    await Promise.all([p1, p2]);
    expect(order).toEqual(["p2", "p1"]);
  });

  it("锁内抛错原样透传，且不堵后续写者", async () => {
    await expect(
      withProductionContentLock("p3", () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(withProductionContentLock("p3", () => "ok")).resolves.toBe("ok");
  });
});
