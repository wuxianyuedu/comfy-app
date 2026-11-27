/**
 * `pnpm ship:branch-clean`（ISSUE #5166）：删分支前只认 PR 的 `is_merged`，
 * 没结论 / 未落地一律不删；落地后复用 ship 的删除链（远端 + 本地都回读）。
 */
import { describe, expect, it } from "vitest";

import { decideBranchClean, runBranchClean } from "../scripts/devtools/branch-clean.mjs";

type Exec = { error: null; status: number; stderr: string; stdout: string };

function harness(opts: {
  branches?: string[];
  current?: string;
  delOk?: boolean;
  hasPr?: boolean;
  merged: boolean | null;
  readBack?: boolean;
  windowIncomplete?: boolean;
}) {
  const lines: Array<string> = [];
  const calls: Array<Array<string>> = [];
  const hasPr = opts.hasPr ?? true;
  const branches = opts.branches ?? [
    "feat/x\t1111111111111111111111111111111111111111",
    "master\t2222222222222222222222222222222222222222",
  ];
  const run = (cmd: string, args: Array<string>): Exec => {
    calls.push([cmd, ...args]);
    const ok = (stdout = "", status = 0): Exec => ({ stdout, stderr: "", status, error: null });
    if (cmd === "git" && args[0] === "for-each-ref") {
      return ok(`${branches.join("\n")}\n`);
    }
    if (cmd === "git" && args[0] === "rev-parse" && args[1] === "--abbrev-ref") {
      return ok(`${opts.current ?? "master"}\n`);
    }
    if (cmd === "git" && args[0] === "ls-remote" && args[2] === "origin") {
      return ok(args.length === 3 ? "refs/heads/feat/x\t1111111\n" : "");
    }
    if (cmd === "git" && args[0] === "rev-parse" && args[1] === "--short") {
      return ok("1111111\n");
    }
    if (cmd === "git" && args[0] === "checkout") {
      return ok();
    }
    if (cmd === "cnb" && args[0] === "pulls") {
      const data = hasPr
        ? [
            {
              number: 9001,
              state: "closed",
              is_merged: opts.merged,
              head: { ref: "refs/heads/feat/x" },
            },
          ]
        : [];
      return ok(
        JSON.stringify({
          status: 200,
          data,
          ...(opts.windowIncomplete ? { has_more: true } : {}),
        }),
      );
    }
    if (cmd === "git" && args[0] === "push" && args[2] === "--delete") {
      return ok("remote: - [deleted] feat/x\n");
    }
    if (cmd === "git" && args[0] === "branch" && args[1] === "-D") {
      return ok(
        opts.delOk === false ? "" : "Deleted branch feat/x (was 1111111).\n",
        opts.delOk === false ? 1 : 0,
      );
    }
    if (cmd === "git" && args[0] === "show-ref") {
      return ok("", opts.readBack === true ? 0 : 1);
    }
    return ok("{}");
  };
  return { run, lines, calls, log: (s: string) => lines.push(s) };
}

describe("decideBranchClean（ISSUE #5166）", () => {
  it("没取到 PR / 没合并 ⇒ 一律不删", () => {
    expect(decideBranchClean({ verdict: null, confirmed: true, current: false }).code).toBe(2);
    expect(
      decideBranchClean({ verdict: "no-pull-in-window", confirmed: true, current: false }).code,
    ).toBe(2);
    expect(decideBranchClean({ verdict: "not-merged", confirmed: true, current: false }).code).toBe(
      1,
    );
  });
  it("已落地但未给 --yes ⇒ 只读，退 0", () => {
    const plan = decideBranchClean({ verdict: "landed", confirmed: false, current: false });
    expect(plan.act).toBe(false);
    expect(plan.code).toBe(0);
    expect(plan.reason).toContain("只读判定");
  });
  it("已落地且点名 --yes ⇒ 执行", () => {
    expect(decideBranchClean({ verdict: "landed", confirmed: true, current: true }).act).toBe(true);
  });
});

describe("runBranchClean 的执行链", () => {
  const ctx = { slug: "org/repo", name: "feat/x" };

  it("未落地不删：一次 git push --delete / branch -D 都不发", () => {
    const h = harness({ merged: false });
    expect(runBranchClean({ ...ctx, ...h, confirmed: true })).toBe(1);
    expect(h.calls.some((c) => c.includes("--delete"))).toBe(false);
    expect(h.calls.some((c) => c.includes("-D"))).toBe(false);
  });

  it("没取到 PR 窗口不冒充「没合并」", () => {
    const h = harness({ merged: null, hasPr: false, windowIncomplete: true });
    expect(runBranchClean({ ...ctx, ...h, confirmed: true })).toBe(2);
    expect(h.lines.join("\n")).toContain("没有结论");
  });

  it("只读判定念出 PR 与 is_merged，但不删", () => {
    const h = harness({ merged: true });
    expect(runBranchClean({ ...ctx, ...h })).toBe(0);
    expect(h.lines.join("\n")).toContain("is_merged=true");
    expect(h.calls.some((c) => c.includes("--delete"))).toBe(false);
  });

  it("落地 + --yes：删远端与本地，两边各回读一次", () => {
    const h = harness({ merged: true });
    expect(runBranchClean({ ...ctx, ...h, confirmed: true })).toBe(0);
    const calls = h.calls.map((c) => c.join(" "));
    expect(calls.some((c) => c.includes("push origin --delete feat/x"))).toBe(true);
    expect(calls.some((c) => c.includes("ls-remote --heads origin feat/x"))).toBe(true);
    expect(calls.some((c) => c.includes("branch -D feat/x"))).toBe(true);
    expect(calls.some((c) => c.includes("show-ref --verify --quiet refs/heads/feat/x"))).toBe(true);
    expect(h.lines.join("\n")).toContain("远端回读");
    expect(h.lines.join("\n")).toContain("本地回读");
  });

  it("当前检出占着：先 checkout --detach 恢复线再删", () => {
    const h = harness({ merged: true, current: "feat/x" });
    expect(runBranchClean({ ...ctx, ...h, confirmed: true })).toBe(0);
    const calls = h.calls.map((c) => c.join(" "));
    const checkoutAt = calls.findIndex((c) => c.includes("checkout --detach"));
    const deleteAt = calls.findIndex((c) => c.includes("branch -D feat/x"));
    expect(checkoutAt).toBeGreaterThanOrEqual(0);
    expect(deleteAt).toBeGreaterThan(checkoutAt);
  });

  it("本地删失败 ⇒ 红，不念「已清理」", () => {
    const h = harness({ merged: true, delOk: false, readBack: true });
    expect(runBranchClean({ ...ctx, ...h, confirmed: true })).toBe(1);
    expect(h.lines.join("\n")).toContain("本地那一半没删掉");
  });

  it("本地没有这条分支 ⇒ 2，不动远端同名 ref", () => {
    const h = harness({ merged: true, branches: ["master\t2222"] });
    expect(runBranchClean({ ...ctx, ...h, confirmed: true })).toBe(2);
    expect(h.calls.some((c) => c.includes("--delete"))).toBe(false);
  });
});
