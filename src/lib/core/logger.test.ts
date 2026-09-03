import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger, logger } from "~/lib/core/logger";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.LOG_LEVEL;
});

describe("logger — 级别过滤", () => {
  it("默认(info)只输出 >= info", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const log = createLogger("test");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(logSpy).toHaveBeenCalledTimes(2); // info + warn 走 stdout
    expect(errSpy).toHaveBeenCalledTimes(1); // error 走 stderr
  });

  it("LOG_LEVEL=error 时仅 error 输出", () => {
    process.env.LOG_LEVEL = "error";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const log = createLogger("test");
    log.info("i");
    log.error("e");
    expect(logSpy).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledTimes(1);
  });

  it("非法 LOG_LEVEL 回退 info", () => {
    process.env.LOG_LEVEL = "bogus";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const log = createLogger("test");
    log.info("i");
    expect(logSpy).toHaveBeenCalledTimes(1);
  });
});

describe("logger — child 命名空间", () => {
  it("命名空间拼接为 parent:child", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    createLogger("a").child("b").info("hi");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[a:b]"));
  });
});

describe("logger — 缺省实例", () => {
  it("logger 暴露标准方法", () => {
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.child).toBe("function");
  });
});
