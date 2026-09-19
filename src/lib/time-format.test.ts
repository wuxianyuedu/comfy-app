import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatClock, timeAgo } from "./time-format";

describe("timeAgo", () => {
  const NOW = new Date("2026-09-19T12:00:00Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const minsAgo = (n: number) => new Date(NOW - n * 60_000).toISOString();

  it("档位：刚刚 / 分钟 / 小时 / 天", () => {
    expect(timeAgo(minsAgo(0))).toBe("刚刚");
    expect(timeAgo(minsAgo(3))).toBe("3 分钟前");
    expect(timeAgo(minsAgo(90))).toBe("1 小时前");
    expect(timeAgo(minsAgo(60 * 30))).toBe("1 天前");
  });

  it("suffix 附在每一档（工作区/作品库的「修改」）", () => {
    expect(timeAgo(minsAgo(0), { suffix: "修改" })).toBe("刚刚修改");
    expect(timeAgo(minsAgo(5), { suffix: "修改" })).toBe("5 分钟前修改");
  });

  it("maxDays 之外返回 null（画布侧栏退化成日期）", () => {
    expect(timeAgo(minsAgo(60 * 24 * 10), { maxDays: 30 })).toBe("10 天前");
    expect(timeAgo(minsAgo(60 * 24 * 40), { maxDays: 30 })).toBeNull();
  });

  it("未来时间归到「刚刚」，不出现负数", () => {
    expect(timeAgo(minsAgo(-5))).toBe("刚刚");
  });

  it("毫秒数与不可解析串：前者可用，后者 null", () => {
    expect(timeAgo(NOW - 120_000)).toBe("2 分钟前");
    expect(timeAgo("not-a-date")).toBeNull();
  });
});

describe("formatClock", () => {
  it("固定 24 小时制 HH:mm:ss", () => {
    /* 用本地时间构造，避免时区让断言不稳定。 */
    const d = new Date(2026, 8, 19, 8, 5, 3);
    expect(formatClock(d.getTime())).toBe("08:05:03");
  });

  it("millis 档带毫秒", () => {
    const d = new Date(2026, 8, 19, 8, 5, 3, 250);
    expect(formatClock(d.getTime(), { millis: true })).toBe("08:05:03.250");
  });

  it("接受 ISO 串（与 timeAgo 同口径）", () => {
    const d = new Date(2026, 8, 19, 8, 5, 3);
    expect(formatClock(d.toISOString())).toBe("08:05:03");
  });
});
