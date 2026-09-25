import { describe, expect, it } from "vitest";
import { randomSeed } from "./random-seed";

describe("randomSeed", () => {
  it("产出的是 [0, Number.MAX_SAFE_INTEGER) 内的非负安全整数", () => {
    for (let i = 0; i < 200; i += 1) {
      const s = randomSeed();
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(Number.MAX_SAFE_INTEGER);
      expect(Number.isSafeInteger(s)).toBe(true);
    }
  });

  it("多次调用不会恒等于同一个值（同提示词换图的前提）", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 50; i += 1) seen.add(randomSeed());
    // 2^53 值域里 50 次全撞同一个数在实践中不可能发生。
    expect(seen.size).toBeGreaterThan(1);
  });
});
