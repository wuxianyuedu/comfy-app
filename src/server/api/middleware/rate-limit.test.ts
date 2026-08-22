import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checkRateLimit,
  resetRateLimitBuckets,
} from "~/server/api/middleware/rate-limit";

describe("checkRateLimit（滑动窗口限流）", () => {
  beforeEach(() => resetRateLimitBuckets());

  it("窗口内未超限时连续放行", () => {
    expect(checkRateLimit("u1", 3, 10_000)).toBe(true);
    expect(checkRateLimit("u1", 3, 10_000)).toBe(true);
    expect(checkRateLimit("u1", 3, 10_000)).toBe(true);
  });

  it("超过 max 后拒绝后续请求", () => {
    for (let i = 0; i < 3; i++) checkRateLimit("u2", 3, 10_000);
    expect(checkRateLimit("u2", 3, 10_000)).toBe(false);
  });

  it("不同 key 相互独立", () => {
    for (let i = 0; i < 3; i++) checkRateLimit("u3", 3, 10_000);
    expect(checkRateLimit("u4", 3, 10_000)).toBe(true);
  });

  it("窗口滑动后（过期时间戳被剔除）重新放行", () => {
    vi.useFakeTimers();
    try {
      const now = Date.now();
      vi.setSystemTime(now);
      for (let i = 0; i < 3; i++) checkRateLimit("u5", 3, 10_000);
      expect(checkRateLimit("u5", 3, 10_000)).toBe(false);
      // 快进超过窗口
      vi.setSystemTime(now + 10_001);
      expect(checkRateLimit("u5", 3, 10_000)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reset 后桶被清空", () => {
    for (let i = 0; i < 3; i++) checkRateLimit("u6", 3, 10_000);
    resetRateLimitBuckets();
    expect(checkRateLimit("u6", 3, 10_000)).toBe(true);
  });
});
