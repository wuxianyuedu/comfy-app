// 进程级兜底的契约（ISSUE #4216 / #4256 / #4338）：unhandledRejection / uncaughtException
// 只记日志、不退出；同一 message 的重复异常限频（首 3 条全量、之后每 50 条一条）；
// 去重表封顶、LRU 淘汰；注册幂等。直接调导出的安装函数，并经 process.listeners().at(-1)
// 取到**本模块注册的**处理器调用（数组里可能还有别的消费者先注册的监听器，取最后一个才是自己的）。

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createSafetyNetReporter,
  installProcessSafetyNet,
  SAFETY_NET_MAX_KEYS,
} from "./instrumentation";

function lastSafetyNetHandlers(): {
  onException: (error: Error, origin: NodeJS.UncaughtExceptionOrigin) => void;
  onRejection: (reason: unknown, promise?: Promise<unknown>) => void;
} {
  const rejection = process.listeners("unhandledRejection").at(-1);
  const exception = process.listeners("uncaughtException").at(-1);
  if (!rejection || !exception) {
    throw new Error("进程级兜底尚未注册");
  }
  return {
    onException: (error: Error, origin: NodeJS.UncaughtExceptionOrigin) => {
      exception(error, origin);
    },
    onRejection: (reason: unknown, promise?: Promise<unknown>) => {
      rejection(reason, promise ?? Promise.resolve());
    },
  };
}

describe("installProcessSafetyNet —— 进程级兜底（ISSUE #4216 / #4256）", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("注册 unhandledRejection / uncaughtException 两个监听器，且幂等", () => {
    const before = {
      rejection: process.listenerCount("unhandledRejection"),
      exception: process.listenerCount("uncaughtException"),
    };
    installProcessSafetyNet();
    installProcessSafetyNet();
    expect(process.listenerCount("unhandledRejection")).toBe(before.rejection + 1);
    expect(process.listenerCount("uncaughtException")).toBe(before.exception + 1);
  });

  it("兜底只记日志、不退出进程", () => {
    installProcessSafetyNet();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { onRejection, onException } = lastSafetyNetHandlers();
    onRejection(new Error("测试拒绝"));
    onException(new Error("测试异常"), "uncaughtException");
    expect(errSpy).toHaveBeenCalledTimes(2);
    expect(errSpy.mock.calls.every((c) => String(c[0]).includes("[process]"))).toBe(true);
  });

  it("同一 message 的重复异常限频：首 3 条全量、之后每 50 条一条（ISSUE #4256）", () => {
    installProcessSafetyNet();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { onRejection } = lastSafetyNetHandlers();
    for (let i = 0; i < 60; i++) {
      onRejection(new Error("周期循环的同一异常"));
    }
    const logged = errSpy.mock.calls.filter((c) => String(c[0]).includes("周期循环的同一异常"));
    /* 首 3 条 + 第 50 条一条 = 4 条；其余 56 条静默计数，不再灌满日志文件。 */
    expect(logged.length).toBe(4);
  });

  it("去重表封顶：大量一次性变体不再无界增长（ISSUE #4338）", () => {
    const reporter = createSafetyNetReporter();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    /* 故障态后台循环的形状：每拍抛出带不同 id / 路径 / SQL 片段的变体，
     * 修复前每种变体各占一条完整堆栈键、永久驻留（键数 = 抛出次数）。 */
    for (let i = 0; i < SAFETY_NET_MAX_KEYS + 200; i++) {
      reporter.report(
        "unhandledRejection",
        new Error(`变体异常 id=${i}：SELECT * FROM t WHERE p=${i}`),
      );
    }
    expect(reporter.size).toBe(SAFETY_NET_MAX_KEYS);
  });

  it("热键不被冷变体洪水挤掉：持续重复的异常限频记账不中断（ISSUE #4338）", () => {
    const reporter = createSafetyNetReporter();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    /* 同一个 Error 实例复用：键是完整 stack（含构造点行号），换行构造会变成不同键。 */
    const hotError = new Error("热键：周期循环的同一异常");
    for (let i = 0; i < 10; i++) {
      reporter.report("unhandledRejection", hotError);
    }
    /* 故障态的真实形状：周期循环每拍抛同一异常（热键），期间夹杂一次性变体（冷键）。
     * 热键每次命中都刷新 LRU 位次 ⇒ 洪水中不被淘汰，计数连续累计。 */
    for (let i = 0; i < 600; i++) {
      reporter.report("unhandledRejection", new Error(`冷变体 ${i}`));
      reporter.report("unhandledRejection", hotError);
    }
    expect(reporter.size).toBe(SAFETY_NET_MAX_KEYS);
    /* 热键计数累计到 610：首 3 条 + 每 50 条一条（50~600 共 12 条）= 15 条。
     * 若热键被挤掉重置，中期会再记「首 3 条」、总数与末条序号都对不上。 */
    const hotLogged = errSpy.mock.calls.filter((c) => String(c[0]).includes("热键"));
    expect(hotLogged.length).toBe(15);
    expect(String(hotLogged.at(-1)?.[0])).toContain("#600");
  });
});
