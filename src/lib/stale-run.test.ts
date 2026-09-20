/**
 * 「这一轮已经作废」的唯一出口（规范 16 §16.2.4.34）。
 *
 * 用例钉的是那段 `let cancelled = false` 样板**各判各的**三件事：
 * 判据（`isStale`）、按轮次提交（`commit`）、清理（`dispose`）——
 * 其中最容易写错的是「`finally` 里的清 loading 要不要过守卫」。
 */
import { describe, expect, it } from "vitest";

import { beginStaleRun } from "./stale-run";

describe("beginStaleRun", () => {
  it("未作废时提交生效，作废后整段跳过", () => {
    const guard = beginStaleRun();
    const writes: string[] = [];
    guard.commit(() => writes.push("a"));
    guard.dispose();
    guard.commit(() => writes.push("b"));
    expect(writes).toEqual(["a"]);
    expect(guard.isStale()).toBe(true);
  });

  it("`commit` 是一段原子写入（两个 setState 一起跳，不必各抄一遍守卫）", () => {
    const guard = beginStaleRun();
    const writes: string[] = [];
    guard.commit(() => {
      writes.push("rows");
      writes.push("loading=false");
    });
    expect(writes).toEqual(["rows", "loading=false"]);
  });

  it("「A 轮的 finally 不该覆盖 B 轮的 loading」——作废后 settle 不落地", () => {
    /* 这正是那段样板最容易写错的一处：A 轮的 `finally` 若不看守卫，
     * 它会在 B 轮已经开始后才落地，把「B 轮正在加载」错报成「加载完了」。 */
    const a = beginStaleRun();
    const b = beginStaleRun();
    let loading = true;
    a.dispose(); // 依赖变化 → 清理先跑
    b.commit(() => {
      loading = true;
    });
    a.commit(() => {
      loading = false;
    });
    expect(loading).toBe(true);
  });

  it("失败分支同样过守卫（卸载后到达的失败不写界面）", () => {
    const guard = beginStaleRun();
    let message: string | null = null;
    guard.dispose();
    guard.commit(() => {
      message = "读取失败";
    });
    expect(message).toBeNull();
  });

  it("重复 dispose 是幂等的", () => {
    const guard = beginStaleRun();
    guard.dispose();
    guard.dispose();
    expect(guard.isStale()).toBe(true);
  });

  it("`isStale()` 是判据形态 —— 给需要 `return` 早退的调用点用", () => {
    const guard = beginStaleRun();
    const seen: string[] = [];
    const step = () => {
      if (guard.isStale()) return;
      seen.push("继续");
    };
    step();
    guard.dispose();
    step();
    expect(seen).toEqual(["继续"]);
  });
});
