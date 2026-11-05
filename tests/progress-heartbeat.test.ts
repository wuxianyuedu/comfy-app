/**
 * #3144 进度心跳：**两种模式的行为**（不是只跑通）。
 *
 * 终端 = 同一行 `\r` 刷新、结束时清行；CI/非 TTY = 按间隔逐行打纯文本心跳，
 * 绝不出现 `\r` 或 ANSI。两条都由 `startProgress()` 驱动，节流与收尾在下面逐条钉住。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_INTERVAL_MS,
  formatElapsed,
  progressMode,
  startProgress,
} from "../scripts/progress-heartbeat.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/progress-heartbeat.mjs", import.meta.url));

function capture() {
  const chunks: string[] = [];
  return {
    chunks,
    write: (text: string) => {
      chunks.push(text);
    },
    text: () => chunks.join(""),
    heartbeats: () => chunks.filter((c) => c.includes("已跑")).length,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("模式判定", () => {
  it("TTY + 无 CI 标记 ⇒ 本地模式", () => {
    expect(progressMode({ isTTY: true, env: {} })).toBe("terminal");
  });

  it("非 TTY ⇒ 日志模式（CI 的宿主就是这样）", () => {
    expect(progressMode({ isTTY: false, env: {} })).toBe("log");
  });

  it("CI / GITHUB_ACTIONS / CNB_* 置位 ⇒ 即使 TTY 也是日志模式", () => {
    for (const env of [{ CI: "1" }, { GITHUB_ACTIONS: "true" }, { CNB_BUILD_ID: "1" }]) {
      expect(progressMode({ isTTY: true, env })).toBe("log");
    }
  });

  it("`CI=0` / `CI=false` 不算置位（本地调试的常见写法）", () => {
    expect(progressMode({ isTTY: true, env: { CI: "0" } })).toBe("terminal");
    expect(progressMode({ isTTY: true, env: { CI: "false" } })).toBe("terminal");
  });
});

describe("日志模式（CI）", () => {
  it("逐行心跳带时间戳，且绝不出现 `\\r` 或 ANSI", () => {
    vi.useFakeTimers();
    const c = capture();
    const p = startProgress({
      label: "premerge",
      total: 3,
      mode: "log",
      intervalMs: 15_000,
      write: c.write,
    });
    p.step("合并前复算");
    vi.advanceTimersByTime(15_000);
    p.step("提交信息声明");
    vi.advanceTimersByTime(15_000);
    const live = c.text();
    p.done();

    expect(live).not.toContain("\r");
    expect(live).not.toContain("\u001B");
    expect(c.heartbeats()).toBe(2);
    /* 时间戳是 `[YYYY-MM-DD HH:mm:ss]` —— CI 日志靠它证明「这一段还在跑」。 */
    expect(live).toMatch(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/);
    expect(live).toContain("已跑 15s");
    expect(live).toContain("(2/3)");
    expect(live).toContain("提交信息声明");
  });

  it("间隔节流：不到间隔不刷行，跨过间隔才有一行", () => {
    vi.useFakeTimers();
    const c = capture();
    const p = startProgress({ label: "ship-poll", mode: "log", intervalMs: 15_000, write: c.write });

    vi.advanceTimersByTime(14_000);
    expect(c.heartbeats(), "14 秒时还不该有心跳").toBe(0);
    vi.advanceTimersByTime(1000);
    expect(c.heartbeats(), "第 15 秒恰好一行").toBe(1);
    vi.advanceTimersByTime(15_000);
    expect(c.heartbeats()).toBe(2);

    p.done();
    vi.advanceTimersByTime(15_000);
    expect(c.heartbeats(), "收尾之后不再有心跳").toBe(2);
  });

  it("间隔可配（同一入口，调用方只改数字）", () => {
    vi.useFakeTimers();
    const c = capture();
    const p = startProgress({
      label: "hook-step",
      mode: "log",
      intervalMs: 1000,
      write: c.write,
    });
    vi.advanceTimersByTime(3000);
    p.done();
    expect(c.heartbeats()).toBe(3);
  });

  it("收尾落一行总结，且重复收尾是空操作", () => {
    vi.useFakeTimers();
    const c = capture();
    const p = startProgress({ label: "premerge", mode: "log", write: c.write });
    p.done();
    const once = c.text();
    p.done();
    p.step("迟到的段");
    expect(c.text()).toBe(once);
    expect(once.trimEnd().split("\n").at(-1)).toContain("完成 · 共 0s");
  });
});

describe("本地模式（终端）", () => {
  it("同一行原地刷新：有 `\\r`、无换行，段名与耗时都在那一行", () => {
    vi.useFakeTimers();
    const c = capture();
    const p = startProgress({
      label: "premerge",
      total: 2,
      mode: "terminal",
      intervalMs: 15_000,
      write: c.write,
    });
    p.step("合并前复算");
    vi.advanceTimersByTime(15_000);
    const live = c.text();

    expect(live).toContain("\r");
    expect(live).not.toContain("\n");
    expect(live).toContain("premerge");
    expect(live).toContain("合并前复算");
    expect(live).toContain("(1/2)");
    expect(live).toContain("已跑 15s");
    p.done();
  });

  it("结束清行并落一行总结：不残留刷新行", () => {
    vi.useFakeTimers();
    const c = capture();
    const p = startProgress({ label: "premerge", mode: "terminal", write: c.write });
    p.step("合并前复算");
    p.done("premerge 各段跑完");
    const text = c.text();
    expect(text).toContain("\r\u001B[K");
    expect(text).toContain("premerge 各段跑完\n");
    expect(text.split("\n").at(-1)).toBe("");
  });
});

describe("收尾与异常", () => {
  it("异常抛出时在 finally 收尾，之后定时器不再写任何东西", () => {
    vi.useFakeTimers();
    const c = capture();
    expect(() => {
      const p = startProgress({ label: "boom", mode: "log", intervalMs: 1000, write: c.write });
      try {
        throw new Error("杀进程");
      } finally {
        p.done("异常退出");
      }
    }).toThrow("杀进程");
    const afterThrow = c.text();
    vi.advanceTimersByTime(10_000);
    expect(c.text()).toBe(afterThrow);
    expect(afterThrow).toContain("异常退出");
  });

  it("两种模式由同一入口驱动：相同的 step 序列，形状不同但读数都在", () => {
    vi.useFakeTimers();
    const terminal = capture();
    const log = capture();
    const steps = ["段 A", "段 B"] as const;

    const t = startProgress({ label: "X", total: 2, mode: "terminal", write: terminal.write });
    const l = startProgress({ label: "X", total: 2, mode: "log", write: log.write });
    for (const s of steps) {
      t.step(s);
      l.step(s);
    }
    vi.advanceTimersByTime(15_000);
    t.done();
    l.done();

    expect(terminal.text()).toContain("段 B");
    expect(terminal.text()).toContain("\r");
    expect(log.text()).toContain("段 B");
    expect(log.text()).not.toContain("\r");
    expect(log.text()).not.toContain("\u001B");
  });
});

describe("同步模式（spawnSync 场景）", () => {
  it("主线程阻塞时由子进程打点：段名跟得上，日志模式无 `\\r` / ANSI", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ph-sync-"));
    const statePath = path.join(dir, "state.json");
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        label: "premerge",
        prefix: "[progress]",
        note: "",
        total: 3,
        index: 1,
        stepLabel: "合并前复算",
        startedAt: Date.now() - 5000,
        mode: "log",
      }),
    );
    const child = spawn(
      process.execPath,
      [SCRIPT, "--heartbeat-child", statePath, "200", String(process.pid)],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    const chunks: string[] = [];
    child.stderr?.on("data", (buf: Buffer) => chunks.push(String(buf)));
    /* 等「真有两行心跳」而不是睡一拍：`setTimeout(…, 0)` 等的是宏任务排空，
     * 不是赌时间（§11.14 的靶子之外）。 */
    const waitFor = async (predicate: () => boolean) => {
      for (let i = 0; i < 2000; i += 1) {
        if (predicate()) {
          return;
        }
        // oxlint-disable-next-line no-await-in-loop -- 用例逐轮 await 以保持断言顺序与桩状态
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      throw new Error("等不到心跳行");
    };
    await waitFor(() => chunks.join("").split("\n").filter((line) => line.includes("已跑")).length >= 2);
    const text = chunks.join("");
    child.kill();
    await new Promise((resolve) => child.on("close", resolve));
    fs.rmSync(dir, { recursive: true, force: true });

    expect(text).toContain("合并前复算");
    expect(text.split("\n").filter((line) => line.includes("已跑")).length).toBeGreaterThanOrEqual(2);
    expect(text).not.toContain("\r");
    expect(text).not.toContain("\u001B");
  });
});

describe("读数格式", () => {
  it("整秒 + 分钟 + 小时", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(1500)).toBe("2s");
    expect(formatElapsed(65_000)).toBe("1m05s");
    expect(formatElapsed(3_600_000)).toBe("1h00m");
  });

  it("默认间隔是 15 秒", () => {
    expect(DEFAULT_INTERVAL_MS).toBe(15_000);
  });
});
