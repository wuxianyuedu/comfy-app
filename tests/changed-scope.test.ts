/**
 * 「这次改动面」的**唯一出处**（`scripts/changed-scope.mjs`）。
 *
 * 它收的是同一个问题的两个消费点：「受影响用例」那一格（`ci-affected-tests.mjs`）
 * 与桌面壳门禁（`shell-gate.mjs --base`）。两边各算一次，就会在某一次改动里漂开
 * —— 改名的旧路径算不算？三点 diff 还是两点？基线取 PR 目标 sha 还是 merge-base？
 *
 * 这里钉的是**基线怎么选**与**diff 形态**两件事：前者决定「这个 PR 改了什么」，
 * 后者决定「改名那一行的两侧是不是都在面里」（ISSUE #2226）。
 */
import { describe, expect, it } from "vitest";

import {
  changedFilesForBaseRef,
  resolveBaseRef,
  resolveChangedFiles,
} from "../scripts/changed-scope.mjs";

/** 假 git：按调用顺序回放预置结果。 */
function fakeGit(handlers: Record<string, { ok: boolean; stdout: string }>) {
  const calls: string[][] = [];
  const runGit = (args: string[], _cwd: string) => {
    calls.push(args);
    /* 剥掉**全局旗标**那一对（`-c core.quotePath=false`，ISSUE #2272）：它是 git 的
     * 全局配置，不属于「这条 diff 是什么形状」⇒ 键要按形状算。 */
    const shape = args[0] === "-c" ? args.slice(2) : args;
    const key =
      shape[0] === "diff"
        ? `diff ${shape[shape.length - 1] ?? ""}`
        : (shape[0] ?? "");
    const hit = handlers[key] ?? handlers[shape[0] ?? ""];
    if (!hit) return { ok: false, stdout: "" };
    return hit;
  };
  return { runGit, calls };
}

describe("changed-scope —— 基线怎么选", () => {
  it("PR 事件：平台给的目标 sha 优先（本地 master 可能已经前进）", () => {
    const { runGit, calls } = fakeGit({});
    const got = resolveBaseRef({
      env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123" },
      runGit,
    });
    expect(got).toEqual({
      ok: true,
      ref: "abc123",
      via: "CNB_PULL_REQUEST_TARGET_SHA（三点 diff）",
      dots: "...",
    });
    /* PR 档直接用那个 sha，不去问 git —— 问 git 会引入「那个 sha 在不在本地」这件事。 */
    expect(calls).toHaveLength(0);
  });

  it("非 PR 事件：退回「要并进去的那条」的 merge-base（两点 diff）", () => {
    const { runGit, calls } = fakeGit({
      "merge-base": { ok: true, stdout: "base123\n" },
    });
    const got = resolveBaseRef({
      env: {},
      runGit,
      fallbackRef: "origin/master",
    });
    expect(got).toEqual({
      ok: true,
      ref: "base123",
      via: "origin/master 的分叉点",
      dots: "..",
    });
    expect(calls[0]).toEqual(["merge-base", "origin/master", "HEAD"]);
  });

  it("两档都取不到 ⇒ 「取不到」而不是「空清单」（空清单若放行会跑成全量）", () => {
    const got = resolveBaseRef({
      env: {},
      runGit: () => ({ ok: false, stdout: "" }),
      fallbackRef: null,
    });
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.reason).toContain("取不到");
  });
});

describe("changed-scope —— 改动面怎么读", () => {
  it("改名 ⇒ 旧路径与新路径都进面（#2226）", () => {
    const { runGit } = fakeGit({
      "diff abc123...HEAD": {
        ok: true,
        stdout: "R100\tscripts/old-name.mjs\tscripts/new-name.mjs\n",
      },
    });
    const got = changedFilesForBaseRef("abc123", { runGit });
    expect(got).toEqual({
      ok: true,
      files: ["scripts/old-name.mjs", "scripts/new-name.mjs"],
      renamedFrom: ["scripts/old-name.mjs"],
    });
  });

  it("diff 形态逐字分两档：PR 档三点、兜底档两点（既有用例钉着，不许改）", () => {
    const { runGit, calls } = fakeGit({
      "diff base123..HEAD": { ok: true, stdout: "M\tsrc/c.ts\n" },
      "diff abc123...HEAD": { ok: true, stdout: "M\tsrc/a.ts\n" },
    });
    changedFilesForBaseRef("abc123", { runGit }, "...");
    changedFilesForBaseRef("base123", { runGit }, "..");
    expect(calls[0]).toEqual([
      "-c",
      "core.quotePath=false",
      "diff",
      "--name-status",
      "-M",
      "abc123...HEAD",
    ]);
    expect(calls[1]).toEqual([
      "-c",
      "core.quotePath=false",
      "diff",
      "--name-status",
      "-M",
      "base123..HEAD",
    ]);
  });

  it("路径要原样：`-c core.quotePath=false` 必须在（ISSUE #2272）", () => {
    /* 不带它，git 默认把非 ASCII 路径转义加引号（`"docs/standards/15-\351\231\204…"`），
     * 改动面里那一条与真实路径对不上 ⇒ 「改了文档源、镜像没同批带上」在平台上永远
     * 判不出来；而本机全局配了 `core.quotepath=false` ⇒ 同一份代码两种判决。 */
    const { runGit, calls } = fakeGit({
      "diff abc123...HEAD": { ok: true, stdout: "M\tsrc/a.ts\n" },
    });
    changedFilesForBaseRef("abc123", { runGit });
    expect(calls[0]?.slice(0, 2)).toEqual(["-c", "core.quotePath=false"]);
  });

  it("git 没跑起来 ⇒ 报「没跑起来」，不当成空清单放行", () => {
    const { runGit } = fakeGit({});
    const got = changedFilesForBaseRef("abc123", { runGit });
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.reason).toContain("没跑起来");
  });

  it("resolveChangedFiles 合起来：PR 档三点、改名两侧都在面里", () => {
    const { runGit } = fakeGit({
      "diff abc123...HEAD": {
        ok: true,
        stdout: "M\tsrc/a.ts\nR100\told.ts\tnew.ts\n",
      },
    });
    const got = resolveChangedFiles({
      env: { CNB_PULL_REQUEST_TARGET_SHA: "abc123" },
      runGit,
    });
    expect(got).toEqual({
      ok: true,
      files: ["src/a.ts", "old.ts", "new.ts"],
      renamedFrom: ["old.ts"],
      via: "CNB_PULL_REQUEST_TARGET_SHA（三点 diff）",
    });
  });
});
