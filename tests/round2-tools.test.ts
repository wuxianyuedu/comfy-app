/**
 * 第二轮工具化的纯函数契约（ISSUE #5181-#5189）。
 */
import { describe, expect, it } from "vitest";

import { candidatesOf } from "../scripts/docs/doc-stale-scan.mjs";
import { attributePlan } from "../scripts/ci/ci-attribute.mjs";
import { cleanupPlan, worktreeBranches } from "../scripts/devtools/ship-cleanup.mjs";
import { diffArgs } from "../scripts/lockfile/deps-diff.mjs";
import { triageOutdated, versionParts } from "../scripts/devtools/deps-triage.mjs";
import { replaceVersion } from "../scripts/devtools/version-set.mjs";
import { tw4Invocation } from "../scripts/devtools/tw4.mjs";
import { dnsRow } from "../scripts/devtools/dns-check.mjs";
import { parseSub } from "../scripts/devtools/deps-install-ipv4.mjs";

describe("doc:stale-scan", () => {
  it("按 kind 抽候选，不判缺陷", () => {
    expect(candidatesOf({ text: "见 `docs/guides/x.md` 与 `pnpm logs`", kind: "path" })).toEqual([
      "docs/guides/x.md",
    ]);
    expect(candidatesOf({ text: "跑 pnpm logs -n 2", kind: "command" })).toEqual(["logs"]);
    expect(candidatesOf({ text: "见 `checkFoo` 和 `pnpm`", kind: "symbol" })).toEqual([
      "checkFoo",
      "pnpm",
    ]);
    expect(candidatesOf({ text: "`docs/x.md#slug`", kind: "anchor" })).toEqual(["docs/x.md#slug"]);
  });
});

describe("ci:attribute", () => {
  it("带超时指纹且点名文件才隔离复跑，否则不复跑", () => {
    expect(
      attributePlan({ text: "Test timed out in 120000ms", file: "tests/a.test.ts" }).rerun,
    ).toBe(true);
    expect(attributePlan({ text: "Test timed out in 120000ms", file: null }).rerun).toBe(false);
    expect(attributePlan({ text: "AssertionError", file: "tests/a.test.ts" }).rerun).toBe(false);
  });
});

describe("ship:cleanup", () => {
  it("落地可删、未落地保留、窗口无结论、当前检出跳过", () => {
    const rows = cleanupPlan([
      { name: "a", verdict: "landed", current: false },
      { name: "b", verdict: "not-merged", current: false },
      { name: "c", verdict: "no-pull-in-window", current: false },
      { name: "d", verdict: "landed", current: true },
    ]);
    expect(rows.map((r) => r.action)).toEqual(["delete", "keep", "no-conclusion", "skip-current"]);
  });
  it("worktree porcelain 按 worktree/branch 配对", () => {
    expect(
      worktreeBranches(
        "worktree /repo\nbranch refs/heads/master\n\nworktree /repo/.worktrees/x\nbranch refs/heads/feat/y\n",
      ),
    ).toEqual([
      { path: "/repo", branch: "master" },
      { path: "/repo/.worktrees/x", branch: "feat/y" },
    ]);
  });
});

describe("deps:diff", () => {
  it("把路径与旗标顺序填死", () => {
    expect(diffArgs({ extra: ["--max-per-section", "3"] })).toEqual([
      "scripts/lockfile/diff-cli.mjs",
      "--installed",
      "node_modules/.pnpm/lock.yaml",
      "--root",
      ".",
      "--max-per-section",
      "3",
    ]);
  });
});

describe("deps:triage", () => {
  it("三段版本号忽略后缀，三档分诊", () => {
    expect(versionParts("1.2.3-beta.1")).toEqual([1, 2, 3]);
    const g = triageOutdated({
      a: { current: "1.2.3", latest: "1.2.4" },
      b: { current: "1.2.3", latest: "1.3.0" },
      c: { current: "1.2.3", latest: "2.0.0" },
    });
    expect(g.patch.map((r) => r.name)).toEqual(["a"]);
    expect(g.minor.map((r) => r.name)).toEqual(["b"]);
    expect(g.major.map((r) => r.name)).toEqual(["c"]);
  });
});

describe("version:set", () => {
  it("只换版本字段，不动其它排版", () => {
    const r = replaceVersion({
      text: '{\n  "version": "0.1.0",\n  "name": "x"\n}',
      pattern: /(?<pre>"version"\s*:\s*")[^"]+(?<post>")/,
      version: "0.2.0",
    });
    expect(r.changed).toBe(true);
    expect(r.text).toContain('"version": "0.2.0"');
    expect(r.text).toContain('"name": "x"');
  });
});

describe("tw4 / dns / ipv4", () => {
  it("codemod 必须点名文件，其它档只透传", () => {
    expect(tw4Invocation({ cmd: "codemod", args: [] })).toBeNull();
    expect(tw4Invocation({ cmd: "scan", args: [] })?.script).toContain("tw4-scan-core");
  });
  it("dns 读数只记 family 与地址", () => {
    expect(
      dnsRow({ host: "x", addresses: [{ address: "127.0.0.1", family: 4 }] }).families,
    ).toEqual([4]);
  });
  it("ipv4 安装入口只透传 -- 之后的 pnpm 子命令", () => {
    expect(parseSub(["--", "install", "--frozen-lockfile"])).toEqual({
      sub: ["install", "--frozen-lockfile"],
      bad: [],
    });
    expect(parseSub(["install"]).bad).toEqual(["install"]);
  });
});
