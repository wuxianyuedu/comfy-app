/**
 * 存活判据的三条纯判决（ISSUE #1351）：
 *   · `classifyLivenessPhase` —— 此刻处在哪个阶段；
 *   · `livenessIntervalMs` —— 该阶段该以多快轮询；
 *   · `createCrashLatch` —— 连续 3 次失败才判 crash。
 *
 * 为什么逐条钉死：这三条正是「轮询是兜底、不是主力」这条设计的**可执行形态**
 * —— 阶段判错会让出图高峰期照旧高频探它（那正是用户投诉的那件事），阈值判错
 * 会让单次超时重启、把用户跑到一半的图杀掉。
 */
import { describe, expect, it } from "vitest";

import {
  assertCrashThreshold,
  classifyLivenessPhase,
  createCrashLatch,
  CRASH_FAILURE_THRESHOLD,
  livenessIntervalMs,
  LIVENESS_GENERATING_MS,
  LIVENESS_HIDDEN_MS,
  LIVENESS_IDLE_MS,
  LIVENESS_STARTING,
  LIVENESS_VERIFY_MS,
  type LivenessFacts,
} from "./liveness";

/** 一组合法事实（默认「空闲且可见」），用例只覆盖自己关心的那几项。 */
function facts(over: Partial<LivenessFacts> = {}): LivenessFacts {
  return {
    up: true,
    starting: false,
    busy: false,
    hidden: false,
    verifying: false,
    ...over,
  };
}

describe("classifyLivenessPhase", () => {
  it("崩溃复核优先于一切：收到退出信号就不该等下一拍", () => {
    expect(classifyLivenessPhase(facts({ verifying: true }))).toBe("verifying");
    expect(
      classifyLivenessPhase(facts({ verifying: true, hidden: true })),
    ).toBe("verifying");
  });

  it("隐藏优先于启动等待与出图：用户看不见时先省资源", () => {
    expect(classifyLivenessPhase(facts({ hidden: true }))).toBe("hidden");
    expect(classifyLivenessPhase(facts({ hidden: true, starting: true }))).toBe(
      "hidden",
    );
    expect(classifyLivenessPhase(facts({ hidden: true, busy: true }))).toBe(
      "hidden",
    );
  });

  it("启动等待优先于出图：用户在盯着转圈，用出图档会把「就绪」拖成半分钟", () => {
    expect(classifyLivenessPhase(facts({ starting: true, busy: true }))).toBe(
      "starting",
    );
  });

  it("有活儿就是出图档，其余是空闲档", () => {
    expect(classifyLivenessPhase(facts({ busy: true }))).toBe("generating");
    expect(classifyLivenessPhase(facts())).toBe("idle");
  });
});

describe("livenessIntervalMs", () => {
  it("复核档是 0（立刻发这一拍，不等下一拍）", () => {
    expect(livenessIntervalMs("verifying")).toBe(LIVENESS_VERIFY_MS);
    expect(livenessIntervalMs("verifying")).toBe(0);
  });

  it("启动等待：10s 内 400ms，之后降到 1s", () => {
    expect(livenessIntervalMs("starting", 0)).toBe(LIVENESS_STARTING.fastMs);
    expect(livenessIntervalMs("starting", 9_999)).toBe(
      LIVENESS_STARTING.fastMs,
    );
    expect(livenessIntervalMs("starting", 10_000)).toBe(
      LIVENESS_STARTING.slowMs,
    );
  });

  it("空闲 15s / 出图 30s / 隐藏 60s：出图期刻意比空闲更松（GPU 繁忙，HTTP 会排队）", () => {
    expect(livenessIntervalMs("idle")).toBe(LIVENESS_IDLE_MS);
    expect(livenessIntervalMs("generating")).toBe(LIVENESS_GENERATING_MS);
    expect(livenessIntervalMs("hidden")).toBe(LIVENESS_HIDDEN_MS);
    expect(LIVENESS_GENERATING_MS).toBeGreaterThan(LIVENESS_IDLE_MS);
    expect(LIVENESS_HIDDEN_MS).toBeGreaterThan(LIVENESS_GENERATING_MS);
  });

  it("每个阶段都有频率，没有「可以不管」的档", () => {
    for (const phase of [
      "verifying",
      "hidden",
      "starting",
      "generating",
      "idle",
    ] as const) {
      expect(livenessIntervalMs(phase)).toBeTypeOf("number");
    }
  });
});

describe("createCrashLatch", () => {
  it("连续 3 次失败才判 crash：单次失败只累加", () => {
    const latch = createCrashLatch();
    expect(latch(false)).toBe("tolerating");
    expect(latch(false)).toBe("tolerating");
    expect(latch(false)).toBe("crashed");
  });

  it("成功一次就清零：出图高峰的单次超时不该把用户跑到一半的图杀掉", () => {
    const latch = createCrashLatch();
    latch(false);
    latch(false);
    expect(latch(true)).toBe("alive");
    expect(latch(false)).toBe("tolerating");
    expect(latch(false)).toBe("tolerating");
    expect(latch(false)).toBe("crashed");
  });

  it("阈值为 1 时第一次失败即判死（合法的最小档）", () => {
    const latch = createCrashLatch(1);
    expect(latch(false)).toBe("crashed");
  });

  it("默认阈值就是 3", () => {
    expect(CRASH_FAILURE_THRESHOLD).toBe(3);
  });

  it("非法阈值直接抛：阈值为 0 会让第一次失败就判死（正是本条要拦的形态）", () => {
    expect(() => assertCrashThreshold(0)).toThrow();
    expect(() => assertCrashThreshold(-1)).toThrow();
    expect(() => assertCrashThreshold(1.5)).toThrow();
    expect(() => assertCrashThreshold(3)).not.toThrow();
  });
});
