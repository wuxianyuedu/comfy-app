/**
 * `~/lib/retry-policy` 的退避算法与抖动（ISSUE #3888）。
 *
 * 这一族是**纯函数**：不 sleep、不循环。锁住三件事 —— 既有形状一字不变
 * （fixed / exponential / maxMs 封顶 / maxAttempt 防溢出夹取）、抖动只在显式
 * 开启时改变取值、抖动不许越过封顶。
 */
import { describe, expect, it } from "vitest";

import { backoffDelayMs, SQLITE_PRAGMA_BOOT, WS_RECONNECT } from "../src/lib/retry-policy";

describe("backoffDelayMs：既有形状（不加抖动时一字不变）", () => {
  it("fixed：恒等 baseMs，与 attempt 无关", () => {
    for (const attempt of [0, 1, 5, 50]) {
      expect(backoffDelayMs({ shape: "fixed", baseMs: 250, attempt })).toBe(250);
    }
  });

  it("exponential：基数 × 2^attempt，maxMs 封顶，maxAttempt 夹住指数", () => {
    expect(backoffDelayMs({ shape: "exponential", baseMs: 1000, attempt: 0 })).toBe(1000);
    expect(backoffDelayMs({ shape: "exponential", baseMs: 1000, maxMs: 15_000, attempt: 2 })).toBe(
      4000,
    );
    expect(backoffDelayMs({ shape: "exponential", baseMs: 1000, maxMs: 15_000, attempt: 4 })).toBe(
      15_000,
    );
    /* WS_RECONNECT：2 ** 8 = 256 → 256s 远超 15s 封顶；夹取之后再多涨也不变。 */
    expect(backoffDelayMs({ ...WS_RECONNECT, attempt: 8 })).toBe(15_000);
    expect(backoffDelayMs({ ...WS_RECONNECT, attempt: 100 })).toBe(15_000);
  });

  it("负 attempt 按 0 处理（防御：别把 2 ** -1 算成小数）", () => {
    expect(backoffDelayMs({ shape: "exponential", baseMs: 40, attempt: -3 })).toBe(40);
  });
});

describe("backoffDelayMs：抖动（ISSUE #3888，显式开启才生效）", () => {
  /* SQLITE_PRAGMA_BOOT：exponential 基数 25ms、封顶 200ms。attempt=2 ⇒ 25×4 = 100。 */
  const opts = { ...SQLITE_PRAGMA_BOOT, attempt: 2 };

  it("缺省 none：即使给了 rand 也不改取值", () => {
    expect(backoffDelayMs(opts, () => 0.999)).toBe(100);
  });

  it("full：[0, delay] 均匀 —— 两端与中点都对", () => {
    expect(backoffDelayMs({ ...opts, jitter: "full" }, () => 0)).toBe(0);
    expect(backoffDelayMs({ ...opts, jitter: "full" }, () => 1)).toBe(100);
    expect(backoffDelayMs({ ...opts, jitter: "full" }, () => 0.5)).toBe(50);
  });

  it("equal：[delay/2, delay] 均匀 —— 保住一半底噪", () => {
    expect(backoffDelayMs({ ...opts, jitter: "equal" }, () => 0)).toBe(50);
    expect(backoffDelayMs({ ...opts, jitter: "equal" }, () => 1)).toBe(100);
  });

  it("抖动不许越过封顶：delay 本身已被 maxMs 夹住", () => {
    expect(backoffDelayMs({ ...opts, attempt: 10, jitter: "full" }, () => 1)).toBe(200);
    expect(backoffDelayMs({ ...opts, attempt: 10, jitter: "equal" }, () => 1)).toBe(200);
  });

  it("rand 越界夹回 [0,1]（野值只改时机，不改上限）", () => {
    expect(backoffDelayMs({ ...opts, jitter: "full" }, () => 42)).toBe(100);
    expect(backoffDelayMs({ ...opts, jitter: "full" }, () => -5)).toBe(0);
  });
});
