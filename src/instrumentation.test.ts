// 进程级兜底的契约（ISSUE #4216 / #4256）：unhandledRejection / uncaughtException
// 只记日志、不退出；同一 message 的重复异常限频（首 3 条全量、之后每 50 条一条）；
// 注册幂等。直接调导出的安装函数，并经 process.listeners().at(-1) 取到**本模块注册
// 的**处理器调用（数组里可能还有别的消费者先注册的监听器，取最后一个才是自己的）。

import { afterEach, describe, expect, it, vi } from "vitest";

import { installProcessSafetyNet } from "./instrumentation";

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
});
