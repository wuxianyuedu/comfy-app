/**
 * 启动耗时时间线（ISSUE #4185）的判据：span 记录与偏移口径、进行中段补时长、
 * 未知 end 是 no-op、格式化行取**墙钟**合计（并行段不求和）、launch-status 的
 * `timings` 字段透传、阶段模块在 ctx 不带 timeline 时照常工作（可选注入）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createLaunchTimeline,
  formatLaunchTimeline,
  formatSpanDuration,
} from "../scripts/launcher-core/timeline.mjs";
import { writeLaunchStatus } from "../scripts/launcher-core/orchestrator.mjs";
import { startShellStage } from "../scripts/launcher-core/shell-stage.mjs";
import { runStartupGates } from "../scripts/launcher-core/startup-gates.mjs";
import { isRecord } from "~/lib/is-record";

/** 读回 launch-status.json 并收窄成对象（不用 `as`：type-aware 判据禁 any 断言）。 */
function readStatusBody(dir: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(
    fs.readFileSync(path.join(dir, "run", "launch-status.json"), "utf8"),
  );
  if (!isRecord(parsed)) {
    throw new TypeError("launch-status.json 不是对象");
  }
  return parsed;
}

let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "launch-timeline-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("createLaunchTimeline：span 记录与偏移口径", () => {
  it("begin/end 记出各段起止，偏移相对 startedAt", () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const timeline = createLaunchTimeline(1_000_000);

    timeline.begin("a", "预检");
    now += 100;
    timeline.begin("b", "依赖对齐");
    now += 200;
    timeline.end("a");
    now += 50;
    timeline.end("b");

    expect(timeline.snapshot()).toEqual([
      { key: "a", label: "预检", startMs: 0, endMs: 300, durationMs: 300 },
      { key: "b", label: "依赖对齐", startMs: 100, endMs: 350, durationMs: 250 },
    ]);
  });

  it("进行中的段：endMs 保持 null，durationMs 按「现在」补", () => {
    let now = 2_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const timeline = createLaunchTimeline(2_000_000);
    timeline.begin("ready", "等待就绪");
    now += 12_400;
    const spans = timeline.snapshot();
    expect(spans).toEqual([
      { key: "ready", label: "等待就绪", startMs: 0, endMs: null, durationMs: 12_400 },
    ]);
  });

  it("end 不存在的键 / 重复 end 都是 no-op，不抛错", () => {
    vi.spyOn(Date, "now").mockImplementation(() => 3_000_000);
    const timeline = createLaunchTimeline(3_000_000);
    expect(() => {
      timeline.end("nope");
    }).not.toThrow();
    timeline.begin("a", "预检");
    timeline.end("a");
    expect(() => {
      timeline.end("a");
    }).not.toThrow();
    expect(timeline.snapshot()).toHaveLength(1);
  });

  it("同键重复 begin 记两段，end 收最近打开的那段", () => {
    let now = 4_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const timeline = createLaunchTimeline(4_000_000);
    timeline.begin("x", "第一段");
    now += 100;
    timeline.begin("x", "第二段");
    now += 100;
    timeline.end("x");
    const spans = timeline.snapshot();
    expect(spans).toHaveLength(2);
    expect(spans[0]?.endMs).toBeNull();
    expect(spans[1]?.startMs).toBe(100);
    expect(spans[1]?.endMs).toBe(200);
    expect(spans[1]?.durationMs).toBe(100);
  });
});

describe("formatLaunchTimeline：一行分解，合计取墙钟", () => {
  it("空时间线返回空串（调用方据此跳过日志）", () => {
    expect(formatLaunchTimeline([])).toBe("");
  });

  it("各段秒数 + 墙钟合计：并行重叠段**不求和**", () => {
    // a: 0→300，b: 100→400（与 a 重叠 200）——合计是 400（墙钟），不是 600。
    const spans = [
      { key: "a", label: "预检", startMs: 0, endMs: 300, durationMs: 300 },
      { key: "b", label: "等待就绪", startMs: 100, endMs: 400, durationMs: 300 },
    ];
    expect(formatLaunchTimeline(spans)).toBe(
      "启动耗时分解（合计 0.4s）：预检 0.3s · 等待就绪 0.3s",
    );
  });

  it("进行中的段按 nowMs 计入合计", () => {
    const spans = [
      { key: "a", label: "预检", startMs: 0, endMs: 200, durationMs: 200 },
      { key: "b", label: "等待就绪", startMs: 200, endMs: null, durationMs: 5000 },
    ];
    expect(formatLaunchTimeline(spans, { nowMs: 5200 })).toBe(
      "启动耗时分解（合计 5.2s）：预检 0.2s · 等待就绪 5.0s",
    );
  });

  it("formatSpanDuration 与 #4137 三段行同粒度（秒一位小数）", () => {
    expect(formatSpanDuration(0)).toBe("0.0s");
    expect(formatSpanDuration(999)).toBe("1.0s");
    expect(formatSpanDuration(12_345)).toBe("12.3s");
  });
});

describe("writeLaunchStatus：timings 字段透传", () => {
  it("传入 timings 时写进 launch-status.json", () => {
    expect(
      writeLaunchStatus(tmp, {
        phase: "dev-server-ready",
        progress: 0.9,
        message: "ok",
        timings: [{ key: "a", label: "预检", startMs: 0, endMs: 120, durationMs: 120 }],
      }),
    ).toBe(true);
    const body = readStatusBody(tmp);
    expect(body.timings).toEqual([
      { key: "a", label: "预检", startMs: 0, endMs: 120, durationMs: 120 },
    ]);
  });

  it("不传 timings 时不写该字段（壳侧兜底快照的形状保持不变）", () => {
    writeLaunchStatus(tmp, { phase: "shell-orchestrating", progress: 0.1, message: "x" });
    const body = readStatusBody(tmp);
    expect("timings" in body).toBe(false);
  });
});

describe("阶段模块：timeline 是可选注入", () => {
  it("shell-stage 不带 timeline 照常工作；带上时记下 shell-spawn 段", () => {
    const exe = path.join(tmp, "app.exe");
    fs.writeFileSync(exe, "");
    // 真起一个立刻退出的子进程当壳替身：spawnShell 的返回类型是 ChildProcess，
    // 用真实对象而不是手拼字面量（后者缺十几个属性，tsc 过不去）。
    const shellChild = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
    const baseCtx = {
      log: () => {
        /* 静音：本组只关心 span 读数，不关心日志内容。 */
      },
      root: tmp,
      appendRuntimeWarning: () => {
        /* 静音：壳提醒不走 app-runtime 通道的断言不在本组。 */
      },
      defaultShellExe: () => exe,
      ensureSplashResource: () => {
        /* 静音：副本同步已在 splash-assets-sync 组覆盖。 */
      },
      spawnShell: () => shellChild,
      resetShellPidFile: () => {
        /* 静音：PID 文件清理与计时无关。 */
      },
      shellStaleWarning: () => null,
    };
    const target = { mode: "prebuilt", shellExe: exe, coldStart: false, port: 3100 };

    // 不带 timeline：不抛错、照常返回（存量测试夹具的兼容面）。
    expect(startShellStage(baseCtx, target).ok).toBe(true);

    // 带上：span 有开始有结束。
    const timeline = createLaunchTimeline(Date.now());
    const staged = startShellStage({ ...baseCtx, timeline }, target);
    expect(staged.ok).toBe(true);
    const spans = timeline.snapshot();
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ key: "shell-spawn", label: "桌面壳拉起" });
    expect(spans[0]?.endMs).not.toBeNull();
  });

  it("startup-gates 在 ctx 不带 timeline 时早退路径不抛错", async () => {
    const result = await runStartupGates(
      {
        log: () => {
          /* 静音：早退路径的文案不在本组断言面。 */
        },
        root: tmp,
        status: () => {
          /* 静音：快照写侧已单独覆盖。 */
        },
        reapStaleSession: () => Promise.resolve(null),
        checkEnvFile: () => ({ message: "缺 DATABASE_URL" }),
        envInitHint: () => null,
        runToolchainGate: () => null,
        syncDependencies: () => Promise.resolve(null),
        applyPendingRestoreAtBoot: () => ({ status: "nothing-to-do" }),
        resolveAppPort: () => 3100,
      },
      { portOrNull: null, mode: "web" },
    );
    expect(result.ok).toBe(false);
  });
});
