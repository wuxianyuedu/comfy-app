import { afterEach, describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";

import { createLogger, coreLogger } from "~/lib/core/logger";

const streams: PassThrough[] = [];

afterEach(() => {
  while (streams.length > 0) streams.pop()?.destroy();
});

/**
 * 造一个把 JSON 行写进内存流的日志器。
 *
 * 必须显式传 `destination`：默认目标在 dev 下是 pino-pretty 的 worker transport
 * （抓不到稳定 JSON），生产是 stdout；而且全局实例的级别来自 `LOG_LEVEL`，
 * 用例会随环境漂移。
 */
function makeLogger(ns: string) {
  const stream = new PassThrough();
  streams.push(stream);
  const chunks: string[] = [];
  stream.on("data", (c: Buffer) => chunks.push(c.toString("utf8")));
  const log = createLogger(ns, { destination: stream, level: "debug" });
  const lines = () =>
    chunks
      .join("")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  return { log, lines };
}

describe("core/logger — 核心层门面（实现只有一份，就是本模块）", () => {
  it("级别过滤走 pino：实例级别 debug 时四档全出", () => {
    const { log, lines } = makeLogger("t");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(lines().map((l) => l.level)).toEqual([20, 30, 40, 50]);
  });

  it("实例级别决定门槛：level=error 时只有 error 输出", () => {
    const stream = new PassThrough();
    streams.push(stream);
    const chunks: string[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c.toString("utf8")));
    const log = createLogger("t", { destination: stream, level: "error" });
    log.info("i");
    log.error("e");
    const out = chunks
      .join("")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { level: number });
    expect(out.map((l) => l.level)).toEqual([50]);
  });

  it("结构化字段原样进 JSON，不进 msg 字符串", () => {
    const { log, lines } = makeLogger("repo");
    log.debug("create", { id: "t1" });
    const [entry] = lines();
    expect(entry?.msg).toBe("create");
    expect(entry?.id).toBe("t1");
    expect(entry?.ns).toBe("repo");
  });

  it("child 的命名空间拼接为 parent:child", () => {
    const { log, lines } = makeLogger("a");
    log.child("b").info("hi");
    expect(lines()[0]?.ns).toBe("a:b");
  });

  /* 旧实现「零脱敏」正是本条要根治的缺口：同一条字段在 pino 那条通道会被
   * `REDACT_PATHS` 擦成 `[Redacted]`，在旧 `core/logger` 里则原文落盘。 */
  it("敏感字段被 pino redact 擦掉", () => {
    const { log, lines } = makeLogger("auth");
    log.error("login", { password: "sample-password", token: "sample-token" });
    const raw = JSON.stringify(lines()[0]);
    expect(raw).toContain("[Redacted]");
    expect(raw).not.toContain("sample-password");
    expect(raw).not.toContain('"sample-token"');
  });

  it("命名空间不同的两个日志器互不串台", () => {
    const a = makeLogger("a");
    const b = makeLogger("b");
    a.log.info("from-a");
    b.log.info("from-b");
    expect(a.lines()[0]?.ns).toBe("a");
    expect(b.lines()[0]?.ns).toBe("b");
  });

  it("默认实例暴露标准方法", () => {
    expect(typeof coreLogger.info).toBe("function");
    expect(typeof coreLogger.child).toBe("function");
  });
});
