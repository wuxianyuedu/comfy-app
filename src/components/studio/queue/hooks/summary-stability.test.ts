/** 队列 summary 轮询的引用稳定（#5158）：四个计数没变时沿用旧对象，
 *  不让每 ~2.2 秒的 COUNT 轮询击穿统计卡与整张队列视图的 memo。 */
import { describe, expect, it } from "vitest";

import { sameStats } from "./use-queue-monitor";

describe("sameStats", () => {
  it("四个计数都相同判等价（即使每轮是新对象）", () => {
    const prev = { failedToday: 18, queued: 468, running: 0, succeededToday: 377 };
    const next = { ...prev };
    expect(next).not.toBe(prev);
    expect(sameStats(prev, next)).toBe(true);
  });

  it("任一个计数变了就不等价", () => {
    const prev = { failedToday: 18, queued: 468, running: 0, succeededToday: 377 };
    expect(sameStats(prev, { ...prev, failedToday: prev.failedToday + 1 })).toBe(false);
    expect(sameStats(prev, { ...prev, queued: prev.queued + 1 })).toBe(false);
    expect(sameStats(prev, { ...prev, running: prev.running + 1 })).toBe(false);
    expect(sameStats(prev, { ...prev, succeededToday: prev.succeededToday + 1 })).toBe(false);
  });

  it("没有上一份读数时不等价（首帧必须落库）", () => {
    expect(sameStats(null, { failedToday: 0, queued: 0, running: 0, succeededToday: 0 })).toBe(
      false,
    );
  });
});
