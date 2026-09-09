import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAppRuntimeLogger } from "@/lib/app-runtime-log";

/** 在一个临时目录里跑，避免污染真实 log/ 目录。 */
let tmpDir: string;
let logFile: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "app-runtime-log-"));
  logFile = path.join(tmpDir, "app-runtime.log");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("app-runtime-log 行格式", () => {
  it("写出的行符合 [日期时间] [LEVEL] [ns] msg 面板可解析格式", () => {
    const log = createAppRuntimeLogger("task", logFile);
    log.info("任务完成 abc", { outputs: 2 });
    const content = fs.readFileSync(logFile, "utf-8");
    expect(content).toMatch(
      /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] \[INFO\] \[task\] 任务完成 abc \{"outputs":2\}\n$/,
    );
  });

  it("warn / error / debug 级别正确写出", () => {
    const log = createAppRuntimeLogger("app", logFile);
    log.warn("w");
    log.error("e");
    log.debug("d");
    const lines = fs.readFileSync(logFile, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("[WARN]");
    expect(lines[1]).toContain("[ERROR]");
    expect(lines[2]).toContain("[DEBUG]");
  });

  it("子日志器命名空间拼接为 parent:child", () => {
    const parent = createAppRuntimeLogger("trpc", logFile);
    const child = parent.child("generate");
    child.info("hi");
    const content = fs.readFileSync(logFile, "utf-8");
    expect(content).toContain("[trpc:generate] hi");
  });

  it("未提供命名空间时不写 [ns] 段", () => {
    const log = createAppRuntimeLogger("", logFile);
    log.info("plain");
    const content = fs.readFileSync(logFile, "utf-8");
    expect(content).toContain("[INFO] plain");
    expect(content).not.toContain("[INFO] [");
  });

  it("字段序列化追加在消息后", () => {
    const log = createAppRuntimeLogger("app", logFile);
    log.info("gen", { durationMs: 25, type: "mutation" });
    const content = fs.readFileSync(logFile, "utf-8");
    expect(content).toContain('"durationMs":25');
    expect(content).toContain('"type":"mutation"');
  });

  it("写入失败不抛异常", () => {
    const log = createAppRuntimeLogger("app", "/nonexistent-dir-x/foo.log");
    expect(() => log.info("boom")).not.toThrow();
  });
});
