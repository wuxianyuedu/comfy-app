// content-write-lock 的判决面（ISSUE #3864）：同项目串行、异项目并行、异常透传不堵路。

import { describe, expect, it } from "vitest";

import { withProductionContentLock } from "./content-write-lock";

describe("withProductionContentLock（ISSUE #3864）", () => {
  it("同一项目的写者串行化：前一个落定前，后一个不进入", async () => {
    const order: Array<string> = [];
    const slow = withProductionContentLock("p1", async () => {
      order.push("a-start");
      await new Promise((r) => setTimeout(r, 30));
      order.push("a-end");
    });
    const fast = withProductionContentLock("p1", () => {
      order.push("b-start");
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(["a-start", "a-end", "b-start"]);
  });

  it("不同项目互不阻塞", async () => {
    const order: Array<string> = [];
    const slow = withProductionContentLock("p1", async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push("p1");
    });
    const other = withProductionContentLock("p2", () => {
      order.push("p2");
    });
    await Promise.all([slow, other]);
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
