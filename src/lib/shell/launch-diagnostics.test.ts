import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  appendLaunchLog,
  formatLogLine,
  formatReportItem,
  idleFallback,
  isShellFallbackStatus,
  launchPaths,
  logHintLines,
  orchestratingFallback,
  trimReportValue,
  writeStatusFile,
} from "./launch-diagnostics";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "launch-diag-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("launchPaths", () => {
  it("锚在项目根下，且与 Rust 侧读的路径逐一对应", () => {
    const paths = launchPaths("/proj");
    expect(paths.statusFile).toBe(
      path.join("/proj", "run", "launch-status.json"),
    );
    expect(paths.orchestratorLog).toBe(
      path.join("/proj", "log", "current", "launcher", "dev-launcher.log"),
    );
    expect(paths.orchestratorStderr).toBe(
      path.join(
        "/proj",
        "log",
        "current",
        "launcher",
        "dev-launcher-stderr.log",
      ),
    );
    expect(paths.shellLog).toBe(
      path.join("/proj", "log", "current", "shell", "shell.log"),
    );
    expect(paths.shellLaunchLog).toBe(
      path.join("/proj", "log", "current", "launcher", "shell-launch.log"),
    );
  });

  it("壳侧链路日志与编排器的两份日志同目录、不同文件", () => {
    const paths = launchPaths("/proj");
    expect(path.dirname(paths.shellLaunchLog)).toBe(paths.launcherDir);
    // 同名会让壳的写入与编排器的写入互相覆盖（正是「日志读不到」的成因之一）。
    for (const other of [paths.orchestratorLog, paths.orchestratorStderr]) {
      expect(paths.shellLaunchLog).not.toBe(other);
    }
  });
});

describe("启动快照", () => {
  it("进度必须 < 1（≥1 会被启动页画成「✓ 完成」）", () => {
    for (const fallback of [
      idleFallback(),
      orchestratingFallback(),
      idleFallback("shell-boot"),
    ]) {
      expect(fallback.progress).toBeLessThan(1);
      expect(fallback.progress).toBeGreaterThanOrEqual(0);
      expect(fallback.error).toBe(false);
      expect(fallback.fallback).toBe(true);
    }
  });

  it("两档快照的 phase 可区分（壳准备 / 编排中）", () => {
    expect(idleFallback().phase).toBe("shell-prepare");
    expect(orchestratingFallback().phase).toBe("shell-orchestrating");
  });

  it("快照自带诊断出口，且指向壳真实写入的那几份文件", () => {
    // 快照是「编排器写自己的状态之前」磁盘上唯一的一份进度：它不带诊断路径，
    // 启动页在这段窗口期就只能说「读不到」（ISSUE #784 手验反馈）。因此这里
    // 钉住「路径来自 launchPaths 而不是页面自己拼」。
    const paths = launchPaths("/proj");
    for (const fallback of [
      idleFallback("shell-prepare", "/proj"),
      orchestratingFallback("/proj"),
    ]) {
      expect(fallback.diagnostics.statusFile).toBe(paths.statusFile);
    }
    expect(orchestratingFallback("/proj").diagnostics.launchLog).toBe(
      paths.shellLaunchLog,
    );
    expect(orchestratingFallback("/proj").diagnostics.shellLog).toBe(
      paths.shellLog,
    );
    // 项目根为空时路径仍是可解释的（不是 `undefined` / `null` 拼出来的野字符串）。
    expect(idleFallback("shell-boot", "").diagnostics.projectRoot).toBe("");
  });
});

describe("formatReportItem", () => {
  it("空值写 (空) 而不是留白", () => {
    expect(formatReportItem({ key: "项目根", value: "" })).toBe("项目根: (空)");
    expect(
      formatReportItem({
        key: "编排器",
        value: "c:\\p\\scripts\\dev-launcher.mjs",
      }),
    ).toBe("编排器: c:\\p\\scripts\\dev-launcher.mjs");
  });
});

describe("formatLogLine", () => {
  it("形态与 log/services 同族：本地时刻 + 级别 + 正文", () => {
    const line = formatLogLine(
      "info",
      "编排器已拉起",
      new Date(2026, 8, 21, 9, 5, 3, 42),
    );
    expect(line).toBe("[2026-09-21 09:05:03.042] [INFO] 编排器已拉起");
  });

  it("级别一律大写（便于面板按级别着色 / 检索）", () => {
    expect(formatLogLine("warn", "x", new Date(2026, 0, 1))).toContain(
      "[WARN]",
    );
  });
});

describe("trimReportValue", () => {
  it("摘掉结尾换行（CRLF 与 LF 都算）", () => {
    expect(trimReportValue("a\n")).toBe("a");
    expect(trimReportValue("a\r\n")).toBe("a");
    expect(trimReportValue("a")).toBe("a");
  });
});

describe("logHintLines", () => {
  it("壳自己的那份排在最前（启动期最先有内容的就是它）", () => {
    const paths = launchPaths("/proj");
    const lines = logHintLines(paths);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain(paths.shellLaunchLog);
    expect(lines[1]).toContain(paths.orchestratorLog);
    expect(lines.join("\n")).toContain("启动期最先有内容");
  });
});

describe("落盘适配", () => {
  it("目录缺失时递归建目录并写入", () => {
    const dir = tempDir();
    const paths = launchPaths(dir);
    expect(writeStatusFile(paths.statusFile, { phase: "shell-boot" })).toBe(
      true,
    );
    expect(JSON.parse(readFileSync(paths.statusFile, "utf8"))).toEqual({
      phase: "shell-boot",
    });

    expect(appendLaunchLog(paths.shellLaunchLog, "first")).toBe(true);
    expect(appendLaunchLog(paths.shellLaunchLog, "second\n")).toBe(true);
    expect(readFileSync(paths.shellLaunchLog, "utf8")).toBe("first\nsecond\n");
  });

  it("写不进去时返回 false 而不是抛（失败出口本身不该再产生一个失败）", () => {
    // 用「父路径是文件」造一个必然失败的目录。
    const dir = tempDir();
    const blocker = path.join(dir, "blocker");
    expect(writeStatusFile(blocker, {})).toBe(true);
    expect(appendLaunchLog(path.join(blocker, "x.log"), "line")).toBe(false);
  });
});

describe("isShellFallbackStatus", () => {
  it("认壳自己写的两种快照（带 fallback / 状态文件缺席）", () => {
    expect(isShellFallbackStatus(idleFallback())).toBe(true);
    expect(isShellFallbackStatus(orchestratingFallback())).toBe(true);
    expect(isShellFallbackStatus({ phase: "no-status-file" })).toBe(true);
  });

  it("编排器写的权威进度一律不认（含 ready 与 error）", () => {
    // 编排器写的行里有 progress / error / ready 这些额外字段 —— 判据**只看**
    // fallback 与 phase，多出来的字段不该影响结论（这是「同域不同来源」的
    // 关键：状态文件是两种产物共用的一个信道）。
    const orchestratorStarting = {
      phase: "dev-server-starting",
      progress: 0.4,
    };
    const orchestratorError = { phase: "error", error: true };
    const orchestratorReady = { phase: "ready", ready: true };
    expect(isShellFallbackStatus(orchestratorStarting)).toBe(false);
    expect(isShellFallbackStatus(orchestratorError)).toBe(false);
    expect(isShellFallbackStatus(orchestratorReady)).toBe(false);
  });
});
