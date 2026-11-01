/**
 * `premerge-timing.mjs` 的判据（ISSUE #2832）。
 *
 * 这一层是**记账**，不是门禁 —— 判据钉的是「账的形态」而不是任何退出码：
 * 追加写、不抛、best-effort（读数空 / 写失败都回 false 而调用方照常收尾）。
 * 格式化那一半钉「快照建树单独一格 + 最慢 5 条 + 合计」的读数形状，
 * 因为「10 分钟从印象变成基线」靠的就是这一屏能被人逐格读。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { formatTimingSummary, recordTimingLedger } from "../scripts/premerge-timing.mjs";
import { resolveGitDir } from "../scripts/git-dir.mjs";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "premerge-timing-"));
  // `resolveGitDir` 走 `git rev-parse`：台账落点跟着「哪份检出」走，夹具就得起真仓。
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
  it("落点在 git 目录下、JSONL 逐行可解析、两次跑是两行", () => {
    const entries = [
      { label: "快照建树(worktree add + 链依赖)", ms: 4200.4 },
      { label: "本检出:tsc --noEmit", ms: 61_000 },
    ];
    expect(
      recordTimingLedger(
        { at: "2026-11-01T00:00:00Z", ref: "origin/master", entries },
        { cwd: root },
      ),
    ).toBe(true);
    expect(
      recordTimingLedger(
        { at: "2026-11-01T00:10:00Z", ref: "origin/master", entries },
        { cwd: root },
      ),
    ).toBe(true);
    const ledgerPath = path.join(resolveGitDir(root)!, "comfy-premerge-timing.jsonl");
    const lines = fs.readFileSync(ledgerPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const first = /* SAFETY: 类型断言已复核 */ JSON.parse(lines[0]!) as {
      at: string;
      entries: Array<{ label: string; ms: number }>;
      ref: string;
    };
    expect(first.ref).toBe("origin/master");
    expect(first.entries[0]!.ms).toBe(4200); // 取整
    expect(first.entries[1]!.label).toContain("tsc");
  });

  it("空读数不落盘（回 false，连文件都不建）", () => {
    expect(recordTimingLedger({ at: "x", ref: "y", entries: [] }, { cwd: root })).toBe(false);
    expect(fs.existsSync(path.join(resolveGitDir(root)!, "comfy-premerge-timing.jsonl"))).toBe(
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
    const ledgerPath = path.join(resolveGitDir(root)!, "comfy-premerge-timing.jsonl");
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
