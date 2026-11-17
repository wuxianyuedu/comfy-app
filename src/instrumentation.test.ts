// 进程级兜底的契约（ISSUE #4216）：unhandledRejection / uncaughtException 只记
// 日志、不退出，且注册幂等。直接调导出的安装函数，断言监听器挂载与输出通道
// （console.error 由已装好的流捕获收进「应用日志」面板）。

import { afterEach, describe, expect, it, vi } from "vitest";

import { installProcessSafetyNet } from "./instrumentation";

describe("installProcessSafetyNet —— 进程级兜底（ISSUE #4216）", () => {
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
    process.emit("unhandledRejection", new Error("测试拒绝"), Promise.resolve());
    process.emit("uncaughtException", new Error("测试异常"));
    expect(errSpy).toHaveBeenCalledTimes(2);
    expect(errSpy.mock.calls.every((c) => String(c[0]).includes("[process]"))).toBe(true);
  });
});
