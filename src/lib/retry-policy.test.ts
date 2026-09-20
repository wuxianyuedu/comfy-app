/**
 * 「一个异步动作重试几次、退避多久」出口的判据（规范 16 §16.2.4.49）。
 *
 * 本条账的形状与 `text-clamp` / `progress` 同族：**不是重复代码，是口径**。
 * 三处各写一份重试策略，而它们的形状其实只有两种 —— 但此前没有任何一处
 * 说明「为什么这一处用指数退避、那一处用固定间隔」：
 *
 *   · WS 重连 —— **指数退避 + 上限**（对端可能长时间不可用，别一直砸它）
 *   · history 读 / Ollama 就绪 —— **固定间隔 + 有界次数**（对端一定就绪、
 *     只是慢一拍，退避只会让它更晚拿到结果）
 *
 * 用例重点即：
 *   1. `backoffDelayMs` 是**纯函数**（不 sleep）—— 排定策略与执行解耦；
 *   2. 指数档的 `attempt` 夹取是**防溢出**，不是「最多重试几次」；
 *   3. 具名策略的取值与「为什么是这个数」一致（次数 × 间隔 = 说的那个总时长）。
 */
import { describe, expect, it } from "vitest";

import {
  COMFY_STOP_PROBE,
  DRIZZLE_STOP_PROBE,
  HISTORY_READ,
  OLLAMA_READY,
  OLLAMA_STOP_PROBE,
  WS_RECONNECT,
  backoffDelayMs,
} from "./retry-policy";

describe("backoffDelayMs", () => {
  it("fixed：恒定不变（attempt 无关）", () => {
    for (const attempt of [0, 1, 5, 100]) {
      expect(backoffDelayMs({ shape: "fixed", baseMs: 250, attempt })).toBe(
        250,
      );
    }
  });

  it("exponential：2 ** attempt 逐档翻倍", () => {
    const at = (attempt: number) =>
      backoffDelayMs({
        shape: "exponential",
        baseMs: 1000,
        maxMs: 15000,
        attempt,
      });
    expect(at(0)).toBe(1000);
    expect(at(1)).toBe(2000);
    expect(at(2)).toBe(4000);
    expect(at(3)).toBe(8000);
  });

  it("exponential：封顶（maxMs）生效", () => {
    expect(
      backoffDelayMs({
        shape: "exponential",
        baseMs: 1000,
        maxMs: 15000,
        attempt: 10,
      }),
    ).toBe(15000);
  });

  it("exponential：maxAttempt 夹住 `2 ** attempt`（防 Infinity，不是「最多几次」）", () => {
    /* 若不用 maxAttempt 夹取，attempt 涨到 1024 时 `2 ** 1024 === Infinity`。 */
    const huge = backoffDelayMs({
      shape: "exponential",
      baseMs: 1000,
      maxMs: 15000,
      maxAttempt: 8,
      attempt: 1024,
    });
    expect(huge).toBe(15000);
    expect(Number.isFinite(huge)).toBe(true);
    /* 夹取后的值与 attempt 恰好到 8 时相同 —— 就是「不再涨」的意思。 */
    expect(
      backoffDelayMs({
        shape: "exponential",
        baseMs: 1000,
        maxMs: 15000,
        maxAttempt: 8,
        attempt: 8,
      }),
    ).toBe(huge);
  });

  it("负数 attempt 当 0 处理（不返回比基数更小的等待）", () => {
    expect(
      backoffDelayMs({ shape: "exponential", baseMs: 1000, attempt: -3 }),
    ).toBe(1000);
    expect(backoffDelayMs({ shape: "fixed", baseMs: 250, attempt: -3 })).toBe(
      250,
    );
  });
});

describe("具名策略（本条账的核心：策略不同、且各有理由）", () => {
  it("WS 重连是指数退避档", () => {
    expect(WS_RECONNECT.shape).toBe("exponential");
    expect(WS_RECONNECT.baseMs).toBe(1000);
    expect(WS_RECONNECT.maxMs).toBe(15000);
    expect(WS_RECONNECT.maxAttempt).toBe(8);
  });

  it("三条轮询都是固定间隔档 —— 它们的场景是「对端一定就绪、只是慢一拍」", () => {
    for (const p of [HISTORY_READ, OLLAMA_READY, COMFY_STOP_PROBE]) {
      expect(p.shape).toBe("fixed");
    }
  });

  it("每个具名策略的「次数 × 间隔」与它声称的总时长一致", () => {
    /* 这几个总数此前散在注释里，且行文与实现已经对不上过一次
     *（ollama-stop 的注释写「最多 5s」，实现是 10 × 500ms —— 恰好相等，
     *  但那条注释并没有把两个因子写出来）。这里把因子与总数都钉住。 */
    const total = (p: { baseMs: number; maxAttempts: number }) =>
      p.baseMs * p.maxAttempts;
    expect(total(HISTORY_READ)).toBe(3000); // 12 × 250ms
    expect(total(OLLAMA_READY)).toBe(40_000); // 20 × 2s
    expect(total(COMFY_STOP_PROBE)).toBe(2500); // 5 × 500ms
    expect(total(DRIZZLE_STOP_PROBE)).toBe(3200); // 8 × 400ms
    expect(total(OLLAMA_STOP_PROBE)).toBe(5000); // 10 × 500ms
  });

  it("停止探针的总时长都在「别让用户干等」的量级（< 6s）", () => {
    /* 这是这三条探针的**共同判据**：它们在界面同步路径上等着，
     * 总时长一旦过长，用户会以为「点了没反应」。 */
    for (const p of [COMFY_STOP_PROBE, DRIZZLE_STOP_PROBE, OLLAMA_STOP_PROBE]) {
      expect(p.baseMs * p.maxAttempts).toBeLessThan(6000);
    }
  });
});
