// `runWithConcurrency` 单测：有界并发池的节奏与语义。
//
// 钉死契约：并发峰值不超 limit、全部条目都被处理、limit 夹取（0 → 串行 /
// 超出条数不空转）、worker 抛错 = 失败短路——池停止派发后续条目、等在途
// 任务落定后以首个错误 reject（多条聚合 AggregateError，不吞 rejection）。
// （旧语义「其余 runner 仍跑完各自队列」是 ISSUE #4342 的病根，已改。）
import { describe, expect, it } from "vitest";

import { runWithConcurrency } from "./async-pool";

describe("runWithConcurrency", () => {
  it("并发峰值不超 limit，且全部条目都被处理", async () => {
    let inFlight = 0;
    let peak = 0;
    const processed: Array<number> = [];

    await runWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      // sleep-ok: mock 内部延迟：拿「每个条目慢一拍」暴露并发峰值（判据是 peak === 2），换成条件轮询会把要量的并发语义拆掉。
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      processed.push(item);
    });

    expect(peak).toBe(2);
    expect(processed.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("limit=1 退化为串行：严格按序执行", async () => {
    const processed: Array<number> = [];
    await runWithConcurrency([3, 1, 2], 1, async (item) => {
      // sleep-ok: mock 内部延迟：同上，limit=1 时用「慢」暴露严格串行的顺序语义。
      await new Promise((resolve) => setTimeout(resolve, 5));
      processed.push(item);
    });
    expect(processed).toEqual([3, 1, 2]);
  });

  it("limit 被夹取：0 按串行处理，超出条数的 limit 不空转", async () => {
    const counts: Array<number> = [];
    await runWithConcurrency([1, 2], 0, (item) => {
      counts.push(item);
      return Promise.resolve();
    });
    expect(counts).toEqual([1, 2]);

    let calls = 0;
    await runWithConcurrency([1, 2], 99, () => {
      calls += 1;
      return Promise.resolve();
    });
    expect(calls).toBe(2);
  });

  it("worker 抛错：池停止派发后续条目，等在途任务落定后以该错误 reject（#4342）", async () => {
    const processed: Array<number> = [];
    await expect(
      runWithConcurrency([1, 2, 3, 4], 2, async (item) => {
        if (item === 1) {
          // 让一步：runner2 先把 2 领走、进入在途，再炸——才能验证
          // 「已开跑的照常落定、后续不再派发」这条完整的短路语义。
          await Promise.resolve();
          throw new Error("第一条炸了");
        }
        processed.push(item);
      }),
    ).rejects.toThrow("第一条炸了");
    /* 短路短的是「后续派发」：runner2 手里的 2 已开跑、照常落定；微任务时序下
     * 它可能再多领一条（2 或 2,3），但 4 以后一定不再派发——队列尾不再被消费
     * 就是硬判据。旧实现会陪跑完整条队列、且调用方的 busy 标记提前清除。 */
    expect(processed).toContain(2);
    expect(processed).not.toContain(4);
    expect(processed.length).toBeLessThanOrEqual(2);
  });

  it("多条失败聚合成 AggregateError，rejection 不再被吞（#4342）", async () => {
    const processed: Array<string> = [];
    await expect(
      runWithConcurrency(["a", "b", "c", "d", "e", "f"], 2, (item) => {
        processed.push(item);
        if (item === "a" || item === "b") {
          return Promise.reject(new Error(`fail ${item}`));
        }
        return Promise.resolve();
      }),
    ).rejects.toBeInstanceOf(AggregateError);
    // 宽 2：a、b 已开跑并失败；短路后 c 以后不再派发。
    expect(processed).toEqual(["a", "b"]);
  });

  it("在途任务跑完才落定：短路不制造悬空的在途任务", async () => {
    let settled = false;
    await expect(
      runWithConcurrency(["slow", "x"], 1, async (item) => {
        if (item === "slow") {
          // sleep-ok: mock 内部延迟：在途任务要「真的还没落定」才能验证
          // 池会等它，立即 resolve 的假任务验证不了这一条。
          await new Promise((resolve) => setTimeout(resolve, 20));
          settled = true;
          throw new Error("慢任务失败");
        }
        throw new Error("短路后不应再派发");
      }),
    ).rejects.toThrow("慢任务失败");
    expect(settled).toBe(true);
  });

  it("空列表：直接 resolve，worker 不被调用", async () => {
    let calls = 0;
    await runWithConcurrency([], 4, () => {
      calls += 1;
      return Promise.resolve();
    });
    expect(calls).toBe(0);
  });
});
