/** 启动 / 日志工具的形状契约（#5157）：日志按次命名（不固定名、不锁句柄），
 *  `pnpm logs` 的分区 / tail / follow 参数解析有明确边界。 */
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { logFileName, pruneOldLogs } from "../scripts/devtools/dev-log.mjs";
import { parseArgs, PARTITIONS, tailLines } from "../scripts/devtools/logs.mjs";

describe("dev:log 按次命名与轮转", () => {
  it("同一时间戳不同 pid 不撞名，且不是固定名", () => {
    const a = logFileName("2026-11-27T09-00-00", 100);
    const b = logFileName("2026-11-27T09-00-00", 101);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^dev-[\dT:-]+-\d+\.log$/);
  });

  it("轮转只删最旧的，保留最近 keep 份", () => {
    const removed: Array<string> = [];
    pruneOldLogs(["dev-a.log", "dev-b.log", "dev-c.log", "dev-d.log"], 2, (p: string) =>
      removed.push(p),
    );
    expect(removed.map((p) => path.basename(p))).toEqual(["dev-a.log", "dev-b.log"]);
  });
});

describe("logs 参数与定位", () => {
  it("分区 / tail / follow 解析，未知值不猜默认", () => {
    expect(parseArgs([])).toEqual({ partition: null, follow: false, tail: 40, help: false });
    expect(parseArgs(["nextjs", "-n", "5", "-f"])).toEqual({
      partition: "nextjs",
      follow: true,
      tail: 5,
      help: false,
    });
    expect(() => parseArgs(["bogus"])).toThrow("未知分区");
    expect(() => parseArgs(["--tail", "x"])).toThrow("非负整数");
    expect(() => parseArgs(["--bogus"])).toThrow("未知旗标");
  });

  it("分区表是规范 §4 的固定布局", () => {
    expect(PARTITIONS).toEqual([
      "comfyui",
      "dev",
      "launcher",
      "nextjs",
      "services",
      "shell",
      "tools",
    ]);
  });

  it("tail 只返回末尾 N 行，不把整份日志倒出来", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "logs-tool-"));
    const file = path.join(dir, "dev-new.log");
    writeFileSync(file, "a\nb\nc\nd\n");
    expect(await tailLines(file, 2)).toBe("c\nd");
    expect(await tailLines(file, 0)).toBe("");
  });
});
