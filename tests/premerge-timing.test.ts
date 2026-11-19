/**
 * `premerge-timing.mjs` 的判据（ISSUE #2832）：这一层是**记账**不是门禁，钉「账的形态」而非退出码 ——
 * 追加写、不抛、best-effort（读数空 / 写失败都回 false，调用方照常收尾）；格式化的那一半钉
 * 「快照建树单独一格 + 最慢 5 条 + 合计」的读数形状，因为「10 分钟从印象变成基线」就靠这一屏可读。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isRecord, isUnknownArray } from "~/lib/is-record";

import { formatTimingSummary, recordTimingLedger } from "../scripts/gates/premerge-timing.mjs";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "premerge-timing-"));
  // `resolveRepoRoot` 走 `git rev-parse`：台账落点跟着「哪份工作树」走，夹具就得起真仓。
  const git = (args: Array<string>) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  git(["init", "-q"]);
  git(["config", "user.email", "t@example.test"]);
  git(["config", "user.name", "t"]);
  fs.writeFileSync(path.join(root, "a.txt"), "x", "utf8");
  git(["add", "a.txt"]);
  git(["commit", "-q", "-m", "init"]);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("recordTimingLedger —— 追加写、best-effort", () => {
  it("落点在 .tmp/timing 下、JSONL 逐行可解析、两次跑是两行，totalMs/trigger 进账", () => {
    const entries = [
      { label: "快照建树(worktree add + 链依赖)", ms: 4200.4 },
      { label: "本检出:tsc --noEmit", ms: 61_000 },
    ];
    expect(
      recordTimingLedger(
        {
          at: "2026-11-01T00:00:00Z",
          ref: "origin/master",
          totalMs: 602_500.8,
          trigger: "pre-push",
          entries,
        },
        { cwd: root },
      ),
    ).toBe(true);
    expect(
      recordTimingLedger(
        { at: "2026-11-01T00:10:00Z", ref: "origin/master", entries },
        { cwd: root },
      ),
    ).toBe(true);
    const ledgerPath = path.join(root, ".tmp", "timing", "comfy-premerge-timing.jsonl");
    const lines = fs.readFileSync(ledgerPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    /* 首行用运行时守卫收窄（B5 清账：不走 `as` 断言），字段断言在下面逐条兜。 */
    const first: unknown = JSON.parse(lines[0] ?? "");
    const ledgerEntries: unknown = isRecord(first) ? first.entries : undefined;
    if (!isUnknownArray(ledgerEntries)) {
      throw new Error("计时账首行形状不对");
    }
    const entryAt = (index: number): Record<string, unknown> => {
      const entry = ledgerEntries[index];
      if (!isRecord(entry)) {
        throw new Error(`计时账第 ${index + 1} 条不是对象`);
      }
      return entry;
    };
    expect(isRecord(first) && first.ref).toBe("origin/master");
    expect(entryAt(0).ms).toBe(4200); // 取整
    expect(String(entryAt(1).label)).toContain("tsc");
    /* 总墙钟与触发来源是 ISSUE #4520 补的两格：逐格相加不是墙钟；push 触发与手工跑
     * 的读数不能混着比。没给的那一格不冒充（第二条 trigger 缺省 → manual）。 */
    expect(isRecord(first) && first.totalMs).toBe(602_501);
    expect(isRecord(first) && first.trigger).toBe("pre-push");
    const second: unknown = JSON.parse(lines[1] ?? "");
    expect(isRecord(second) && second.trigger).toBe("manual");
    expect(isRecord(second) && second.totalMs).toBeUndefined();
  });

  it("空读数不落盘（回 false，连文件都不建）", () => {
    expect(recordTimingLedger({ at: "x", ref: "y", entries: [] }, { cwd: root })).toBe(false);
    expect(fs.existsSync(path.join(root, ".tmp", "timing", "comfy-premerge-timing.jsonl"))).toBe(
      false,
    );
  });

  it("脏读数（非有限 ms）不进账", () => {
    expect(
      recordTimingLedger(
        {
          at: "x",
          ref: "y",
          entries: [
            { label: "good", ms: 10 },
            { label: "bad", ms: Number.NaN },
          ],
        },
        { cwd: root },
      ),
    ).toBe(true);
    const ledgerPath = path.join(root, ".tmp", "timing", "comfy-premerge-timing.jsonl");
    const line = fs.readFileSync(ledgerPath, "utf8").trim();
    expect(line).toContain("good");
    expect(line).not.toContain("bad");
  });
});

describe("formatTimingSummary —— 快照单独一格 + 最慢 5 条 + 合计", () => {
  it("空读数 ⇒ 「没有读数」，不是一张全 0 的表", () => {
    expect(formatTimingSummary([])).toContain("没有逐格读数");
  });

  it("快照建树单独一行；其余按毫秒降序取前 5；合计收尾", () => {
    const entries = [
      { label: "本检出:tsc --noEmit", ms: 61_000 },
      { label: "快照建树(worktree add + 链依赖)", ms: 4200 },
      { label: "本检出:eslint", ms: 120_000 },
      { label: "快照:eslint", ms: 118_000 },
      { label: "本检出:check-x", ms: 300 },
      { label: "快照:check-x", ms: 280 },
      { label: "本检出:check-y", ms: 200 },
      { label: "快照:check-y", ms: 190 },
    ];
    const out = formatTimingSummary(entries);
    const lines = out.split("\n");
    expect(out).toContain("快照建树(worktree add + 链依赖): 4.2s");
    // 降序前三名都在（120s eslint 本检出 / 118s eslint 快照 / 61s tsc）
    const order = lines.findIndex((l) => l.includes("120.0s"));
    expect(order).toBeGreaterThan(-1);
    expect(lines.filter((l) => /^\s+\d+\.\ds\s/.test(l)).length).toBeLessThanOrEqual(5);
    expect(out).toContain("合计 304.2s");
    expect(out).toContain("其余");
  });

  it("≤5 条时不打「其余」那一行（少念一行不许长得像少记一笔）", () => {
    const out = formatTimingSummary([{ label: "快照建树(x)", ms: 100 }]);
    expect(out).not.toContain("其余");
    expect(out).toContain("快照建树(x): 0.1s");
  });
});

describe("读账 CLI —— 裸跑 / --last / --json（只读，不判）", () => {
  const SCRIPT = path.resolve("scripts", "gates", "premerge-timing.mjs");

  function runCli(args: Array<string>, cwd: string) {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: r.status, out: String(r.stdout ?? "") };
  }

  it("空账明说「还没有记录」，不打一张空表冒充读数", () => {
    expect(runCli([], root).out).toContain("还没有记录");
  });

  it("裸跑打逐次总墙钟 + 触发来源 + 逐格中位数排名", () => {
    recordTimingLedger(
      {
        at: "2026-11-19T00:00:00Z",
        ref: "origin/master",
        totalMs: 90_000,
        trigger: "pre-push",
        entries: [
          { label: "本检出:tsc --noEmit", ms: 61_000 },
          { label: "本检出:eslint", ms: 12_000 },
        ],
      },
      { cwd: root },
    );
    const out = runCli([], root).out;
    expect(out).toContain("最近 1 次（共 1 条");
    expect(out).toContain("总 90.0s");
    expect(out).toContain("pre-push");
    expect(out).toContain("对 origin/master");
    expect(out).toContain("本检出:tsc --noEmit");
  });

  it("--json 给机器可读原账；--last N 收窄逐次表", () => {
    for (const total of [10_000, 20_000]) {
      recordTimingLedger(
        { at: "x", ref: "y", totalMs: total, trigger: "manual", entries: [{ label: "g", ms: 5 }] },
        { cwd: root },
      );
    }
    const parsed: unknown = JSON.parse(runCli(["--json"], root).out);
    expect(isUnknownArray(parsed)).toBe(true);
    expect(runCli(["--last", "1"], root).out).toContain("最近 1 次（共 2 条");
  });
});
