/**
 * `scripts/ship/wait-for-ship.mjs` 的契约（ISSUE #4118）：「等 ship 出终态」的确定性组件。
 * 钉四件：① 已出终态 ⇒ 第一眼就返回，一次 sleep 都不发生；② 坏消息（red / interrupted）
 * 立即返回，不等满上限；③ 总上限到点 ⇒ 退 4（无终态 ≠ 通过）；④ 判定只认落盘读数的
 * 结构化字段（`.git/ship-result.json` 快照），不碰平台、不碰 ship 进程、不按行号截输出。
 *
 * 落盘路径靠 `resolve` 注入到临时目录；`sleep` / `now` 注入后逐条可断言，不真等。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CODE } from "../scripts/ship/ship-codes.mjs";
import { parseArgs, waitForShip } from "../scripts/ship/wait-for-ship.mjs";

const ROOT = process.cwd();

let fakeGitDir: string;
const resolve = () => fakeGitDir;

beforeEach(() => {
  fakeGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "wait-for-ship-"));
});

afterEach(() => {
  fs.rmSync(fakeGitDir, { recursive: true, force: true });
});

/** 写一份快照；`status` 决定等待方该不该停（running = 继续等）。
 * `startedAt` 是「等的是哪一跑」的身份锚（ISSUE #4510）：并发跑互相覆盖单文件时，
 * 靠它分辨眼前的结论来自哪一跑。 */
function writeSnapshot(
  status: string,
  exitCode: number | null = null,
  stages: string[] = [],
  startedAt = "T0",
) {
  fs.writeFileSync(
    path.join(fakeGitDir, "ship-result.json"),
    JSON.stringify({
      version: 2,
      status,
      startedAt,
      finishedAt: status === "running" ? null : "T1",
      interruptedBy: null,
      pid: 1,
      cwd: ROOT,
      argv: [],
      branch: "feat/x",
      headSha: "abc1234",
      repo: "moon-read/comfy-app-t3",
      pr: 4118,
      stages,
      lines: [],
      lineCount: 0,
      truncated: false,
      exitCode,
      conclusion: null,
      events: [],
      eventsTruncated: false,
    }),
    "utf8",
  );
}

/** 已出终态还睡 ⇒ 测试当场红（等待方必须第一眼就返回）。 */
const noSleep = () => {
  throw new Error("已出终态却还在睡 ⇒ 违反「能立即执行就直接执行」");
};

describe("waitForShip：终止条件（ISSUE #4118）", () => {
  it("已出终态（green）⇒ 第一眼就返回，一次 sleep 都不发生，退码照抄快照", async () => {
    writeSnapshot("green", 0, ["预检通过", "合并"]);
    const { code, timedOut, reading } = await waitForShip({ root: ROOT, resolve, sleep: noSleep });
    expect(code).toBe(CODE.GREEN);
    expect(timedOut).toBe(false);
    expect(reading.result?.pr).toBe(4118);
  });

  it("坏消息立即返回：red ⇒ 退 1，绝不「只等成功、不等失败」地睡满上限", async () => {
    writeSnapshot("red", 1);
    const { code, timedOut } = await waitForShip({ root: ROOT, resolve, sleep: noSleep });
    expect(code).toBe(CODE.RED);
    expect(timedOut).toBe(false);
  });

  it("not-run / interrupted（被杀没退码）⇒ 退 2（没结论），不读成通过", async () => {
    writeSnapshot("not-run", 7);
    expect((await waitForShip({ root: ROOT, resolve, sleep: noSleep })).code).toBe(7);
    writeSnapshot("interrupted", null);
    expect((await waitForShip({ root: ROOT, resolve, sleep: noSleep })).code).toBe(CODE.NOT_RUN);
  });

  it("还在跑 ⇒ 按节奏轮询；出终态的那一眼停下（短间隔 + 确定终止）", async () => {
    writeSnapshot("running", null, []);
    const sleeps: number[] = [];
    const { code, timedOut } = await waitForShip({
      root: ROOT,
      resolve,
      intervalMs: 5,
      timeoutMs: 30_000,
      sleep: (ms) => {
        sleeps.push(ms);
        if (sleeps.length === 3) {
          writeSnapshot("green", 0, ["预检通过"]);
        }
        return Promise.resolve();
      },
    });
    expect(code).toBe(CODE.GREEN);
    expect(timedOut).toBe(false);
    expect(sleeps).toEqual([5, 5, 5]);
  });

  it("总上限到点 ⇒ 退 4（无终态 ≠ 通过），这是等待方自己的坏分支", async () => {
    writeSnapshot("running", null);
    const { code, timedOut } = await waitForShip({
      root: ROOT,
      resolve,
      timeoutMs: 80,
      sleep: () => Promise.resolve(),
    });
    expect(code).toBe(CODE.CI_PENDING);
    expect(timedOut).toBe(true);
  });

  it("快照压根不存在（ship 还没开跑）⇒ 同样等满上限退 4，不猜、不编一个结论", async () => {
    const { code, timedOut, reading } = await waitForShip({
      root: ROOT,
      resolve,
      timeoutMs: 80,
      sleep: () => Promise.resolve(),
    });
    expect(code).toBe(CODE.CI_PENDING);
    expect(timedOut).toBe(true);
    expect(reading.found).toBe(false);
  });

  it("等的是哪一跑要念出来：running 的 startedAt 进输出（ISSUE #4510）", async () => {
    writeSnapshot("running", null, ["预检通过"]);
    const lines: Array<string> = [];
    const sleeps: number[] = [];
    const { code } = await waitForShip({
      root: ROOT,
      resolve,
      intervalMs: 5,
      timeoutMs: 30_000,
      log: (s) => lines.push(s),
      sleep: (ms) => {
        sleeps.push(ms);
        if (sleeps.length >= 2) {
          writeSnapshot("green", 0, ["预检通过", "合并"]);
        }
        return Promise.resolve();
      },
    });
    expect(code).toBe(CODE.GREEN);
    expect(lines.some((l) => l.includes("等的是这一跑：startedAt=T0"))).toBe(true);
  });

  it("别的跑的结论不冒充等的那一跑的终态（#4510 现场：并发跑互相覆盖单文件）", async () => {
    writeSnapshot("running", null, ["预检通过"]);
    const sleeps: number[] = [];
    const { code, timedOut } = await waitForShip({
      root: ROOT,
      resolve,
      intervalMs: 5,
      timeoutMs: 30_000,
      sleep: (ms) => {
        sleeps.push(ms);
        if (sleeps.length === 2) {
          /* 别的跑（不同 startedAt）收口覆盖了单文件快照 —— 不许被它放行。 */
          writeSnapshot("green", 0, ["评论已回读"], "T9");
        }
        if (sleeps.length === 4) {
          /* 等的那一跑（T0）自己收口了。 */
          writeSnapshot("green", 0, ["预检通过", "合并"]);
        }
        return Promise.resolve();
      },
    });
    expect(code).toBe(CODE.GREEN);
    expect(timedOut).toBe(false);
    expect(sleeps).toEqual([5, 5, 5, 5]);
  });
});

describe("parseArgs：形状不对退 2，不静默收下", () => {
  it("缺省：10s 一眼、45min 上限", () => {
    expect(parseArgs([])).toEqual({
      intervalMs: 10_000,
      timeoutMs: 2_700_000,
      json: false,
      error: null,
    });
  });

  it("--interval / --timeout / --json 都认（单位：秒）", () => {
    const p = parseArgs(["--interval", "5", "--timeout", "900", "--json"]);
    expect(p).toEqual({ intervalMs: 5000, timeoutMs: 900_000, json: true, error: null });
  });

  it("负数 / 非数字 / 缺值 / 认不出的旗标 ⇒ 给 error（入口据此退 2）", () => {
    expect(parseArgs(["--interval", "0"]).error).toBeTruthy();
    expect(parseArgs(["--timeout", "abc"]).error).toBeTruthy();
    expect(parseArgs(["--interval"]).error).toBeTruthy();
    expect(parseArgs(["--what"]).error).toBeTruthy();
  });
});
