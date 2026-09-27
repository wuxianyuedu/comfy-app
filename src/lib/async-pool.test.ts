// `runWithConcurrency` 单测：有界并发池的节奏与语义。
//
// 钉死四条契约：并发峰值不超 limit、全部条目都被处理、limit 夹取（0 → 串行 /
// 超出条数不空转）、worker 抛错短路整个池但其余 runner 仍跑完各自队列。
import { describe, expect, it } from "vitest";

import { runWithConcurrency } from "./async-pool";

describe("runWithConcurrency", () => {
  it("并发峰值不超 limit，且全部条目都被处理", async () => {
    let inFlight = 0;
    let peak = 0;
    const processed: number[] = [];

    await runWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      processed.push(item);
    });

    expect(peak).toBe(2);
    expect(processed.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("limit=1 退化为串行：严格按序执行", async () => {
    const processed: number[] = [];
    await runWithConcurrency([3, 1, 2], 1, async (item) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      processed.push(item);
    });
    expect(processed).toEqual([3, 1, 2]);
  });

  it("limit 被夹取：0 按串行处理，超出条数的 limit 不空转", async () => {
    const counts: number[] = [];
    await runWithConcurrency([1, 2], 0, async (item) => {
      counts.push(item);
    });
    expect(counts).toEqual([1, 2]);

    let calls = 0;
    await runWithConcurrency([1, 2], 99, async () => {
      calls += 1;
    });
    expect(calls).toBe(2);
  });

  it("worker 抛错：整个池立即 reject，其余 runner 仍跑完各自队列", async () => {
    const processed: number[] = [];
    await expect(
      runWithConcurrency([1, 2, 3, 4], 2, async (item) => {
        if (item === 1) throw new Error("第一条炸了");
        processed.push(item);
      }),
    ).rejects.toThrow("第一条炸了");
    /* runner2 的队列（2、4）不因 runner1 的抛错而丢 —— 只是调用方不再等待它。 */
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(processed).toContain(2);
    expect(processed).toContain(4);
  });

  it("空列表：直接 resolve，worker 不被调用", async () => {
    let calls = 0;
    await runWithConcurrency([], 4, async () => {
      calls += 1;
    });
    expect(calls).toBe(0);
  });
});
