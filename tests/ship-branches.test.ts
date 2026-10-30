/**
 * 「分支落地读数」的判据自测（规范 §13.6.5，ISSUE #2427）。
 *
 * 这一件存在的理由是：**它要防的那个错法我自己犯过** —— 用
 * `git diff origin/master...<分支>` 判「合了没」，而 squash 拓扑下它恒非空。
 * 所以这里钉的不是「输出好不好看」，而是三条会让人误删的形状：
 *   ① 结论只有三种，且「没取到」与「没合并」**必须长得不一样**；
 *   ② 匹配要按平台的 `head.ref = "refs/heads/<名>"` 形状 —— 裸名匹配会把九条已合并
 *      分支全判成「没找到 PR」；
 *   ③ 这一趟**一次也不删**：任何写 ref 的命令都不许出现在 calls 里。
 * 另有一条主干排除（`resolveTrunk()` 给的是带远端前缀的 `origin/master`，
 * 与清单里的裸分支名不同形 —— 狗食这一跑抓到过）。
 */
import { describe, expect, it } from "vitest";
import {
  BRANCH_PULL_PAGE_SIZE,
  branchLandingRows,
  fetchPullsForBranches,
} from "../scripts/ship-branches.mjs";
import { main } from "../scripts/ship.mjs";

const CODE = { GREEN: 0, RED: 1, NOT_RUN: 2 };

type FakeResult = {
  status: number;
  stdout: string;
  stderr: string;
  error: string | null;
};

/** 一条 PR 记录的最小形状（字段按平台原样：`head.ref` 带 `refs/heads/` 前缀）。 */
function pull(number: number, branch: string, merged: boolean) {
  return {
    number,
    state: merged ? "closed" : "open",
    is_merged: merged,
    merged_by: merged ? { username: "ci" } : null,
    head: { ref: `refs/heads/${branch}`, sha: `sha-of-${branch}` },
  };
}

describe("branchLandingRows：三种结论，且「没取到」不等于「没合并」", () => {
  const pulls = [pull(2420, "fix/a", true), pull(2421, "feat/b", false)];
  const branches = [
    { name: "fix/a", sha: "sha-of-fix/a" },
    { name: "feat/b", sha: "sha-of-feat/b" },
    { name: "feat/c", sha: "whatever" },
  ];

  it("已合并的那条给 landed，未合并的那条给 not-merged", () => {
    const rows = branchLandingRows(branches.slice(0, 2), pulls, new Set(), "master");
    expect(rows.map((r) => r.verdict)).toEqual(["landed", "not-merged"]);
    expect(rows[0]?.pr).toBe(2420);
    expect(rows[0]?.mergedBy).toBe(true);
    expect(rows[1]?.isMerged).toBe(false);
  });

  it("窗口取满而确实没有 PR ⇒ not-merged（这是正面事实，保守到「别删」）", () => {
    const rows = branchLandingRows([{ name: "scratch/x", sha: "s" }], pulls, new Set(), "master", {
      windowComplete: true,
    });
    expect(rows[0]?.verdict).toBe("not-merged");
  });

  it("窗口没取满 ⇒ no-pull-in-window，不许被读成「没合并」", () => {
    const rows = branchLandingRows([{ name: "scratch/x", sha: "s" }], pulls, new Set(), "master", {
      windowComplete: false,
    });
    expect(rows[0]?.verdict).toBe("no-pull-in-window");
    expect(rows[0]?.pr).toBeNull();
    expect(rows[0]?.isMerged).toBeNull();
  });

  it("裸分支名匹配不上：平台的形状是 refs/heads/<名>（错法实测把九条已合并分支判成「没找到」）", () => {
    const bareShape = [{ number: 1, is_merged: true, head: { ref: "fix/a", sha: "x" } }];
    const rows = branchLandingRows([{ name: "fix/a", sha: "x" }], bareShape, new Set(), "master", {
      windowComplete: true,
    });
    // 按裸名存的那份记录**不该**被认成命中（认了就是拿一次巧合当结论）。
    expect(rows[0]?.pr).toBeNull();
    expect(rows[0]?.verdict).toBe("not-merged");
  });

  it("远端引用与「当前分支」两列按事实给，不参与结论", () => {
    const rows = branchLandingRows(
      [{ name: "fix/a", sha: "x" }],
      pulls,
      new Set(["fix/a"]),
      "fix/a",
    );
    expect(rows[0]?.remote).toBe(true);
    expect(rows[0]?.current).toBe(true);
    expect(rows[0]?.verdict).toBe("landed");
  });
});

describe("fetchPullsForBranches：取不到就是取不到", () => {
  const ok = (stdout: string): FakeResult => ({
    status: 0,
    stdout,
    stderr: "",
    error: null,
  });

  it("响应不是 JSON ⇒ ok:false（不许拿一份空列表去判「都没提过 PR」）", () => {
    const got = fetchPullsForBranches(() => ok("cnb: command not found"), "o/r", { maxPages: 1 });
    expect(got.ok).toBe(false);
    expect(got.windowComplete).toBe(false);
    expect(got.note).toContain("没有结论");
  });

  it("一页到底 ⇒ 窗口取满，并报最老编号", () => {
    const got = fetchPullsForBranches(
      () => ok(JSON.stringify({ data: [pull(900, "a", true)] })),
      "o/r",
      { maxPages: 3 },
    );
    expect(got.ok).toBe(true);
    expect(got.windowComplete).toBe(true);
    expect(got.oldest).toBe(900);
  });

  it("每页都满 ⇒ 到顶也没取满，note 里明说「窗口外的只能给没取到」", () => {
    const full = Array.from({ length: BRANCH_PULL_PAGE_SIZE }, (_, i) =>
      pull(2000 - i, `b${i}`, true),
    );
    const got = fetchPullsForBranches(() => ok(JSON.stringify({ data: full })), "o/r", {
      maxPages: 2,
    });
    expect(got.windowComplete).toBe(false);
    expect(got.note).toContain("就到顶");
  });
});

/** `main()` 那一层需要的最小 io（形状同 `tests/ship.test.ts` 的 `issueMainIo`）。 */
function branchesMainIo(opts: { pulls: Array<unknown>; branchList: string }) {
  const calls: Array<string> = [];
  const log: Array<string> = [];
  const ok = (stdout: string): FakeResult => ({
    status: 0,
    stdout,
    stderr: "",
    error: null,
  });
  const run = (cmd: string, args: Array<string>): FakeResult => {
    calls.push([cmd, ...args].join(" "));
    const key = args.join(" ");
    if (cmd === "cnb" && args[0] === "--version") {
      return ok("1.15.25");
    }
    if (cmd === "git" && key.includes("@{u}")) {
      return ok("cnb/master");
    }
    if (cmd === "git" && key === "remote") {
      return ok("cnb\n");
    }
    if (cmd === "git" && key.includes("symbolic-ref")) {
      return ok("refs/remotes/cnb/master");
    }
    if (cmd === "git" && key.includes("--abbrev-ref")) {
      return ok("master");
    }
    if (cmd === "git" && key.includes("rev-parse --verify --quiet")) {
      return ok("d02ec9");
    }
    if (cmd === "git" && key.includes("get-url")) {
      return ok("https://cnb.cool/moon-read/comfy-app-t3\n");
    }
    if (cmd === "git" && key.includes("for-each-ref")) {
      return ok(opts.branchList);
    }
    if (cmd === "git" && key.includes("ls-remote --heads")) {
      return ok("aaa\trefs/heads/fix/landed\n");
    }
    if (cmd === "cnb" && args[0] === "pulls" && args[1] === "list-pulls") {
      return ok(JSON.stringify({ data: opts.pulls }));
    }
    return ok("");
  };
  return { run, calls, log };
}

describe("main()：--branches 只读，且一次也不删", () => {
  it("全落地 ⇒ 绿；写 ref 的命令一条都没出现", async () => {
    const f = branchesMainIo({
      pulls: [pull(2420, "fix/landed", true)],
      branchList: "master\tm1\nfix/landed\tl1\n",
    });
    const code = await main({
      args: ["--branches"],
      env: {},
      run: f.run,
      log: (l: string) => f.log.push(l),
    });
    expect(code).toBe(CODE.GREEN);
    const text = f.log.join("\n");
    // 主干被排除，且把「基线原值带远端前缀」这件事念出来（狗食抓到过的那一形）。
    expect(text).toContain("已排除主干 `master`");
    expect(text).toContain("is_merged=true");
    expect(text).toContain("这一趟一条也没删");
    expect(f.calls.some((c) => /branch -[dD]/.test(c))).toBe(false);
    expect(f.calls.some((c) => c.includes("git push"))).toBe(false);
    expect(f.calls.some((c) => c.includes("merge-pull"))).toBe(false);
  });

  it("有未落地的分支 ⇒ 退 1 是「别删」的提醒，仍然一条不删", async () => {
    const f = branchesMainIo({
      pulls: [pull(2422, "feat/doing", false)],
      branchList: "master\tm1\nfeat/doing\td1\n",
    });
    const code = await main({
      args: ["--branches"],
      env: {},
      run: f.run,
      log: (l: string) => f.log.push(l),
    });
    expect(code).toBe(CODE.RED);
    expect(f.log.join("\n")).toContain("那些条不许删");
    expect(f.calls.some((c) => /branch -[dD]/.test(c))).toBe(false);
  });

  it("与显式动作同行 ⇒ 退 2，且一次平台请求都不发（读数不许被推断成动作）", async () => {
    const f = branchesMainIo({ pulls: [], branchList: "master\tm1\n" });
    const code = await main({
      args: ["--branches", "--merge"],
      env: {},
      run: f.run,
      log: (l: string) => f.log.push(l),
    });
    expect(code).toBe(CODE.NOT_RUN);
    expect(f.log.join("\n")).toContain("只读读数");
    expect(f.calls.some((c) => c.includes("list-pulls"))).toBe(false);
  });

  it("每页都满、翻到顶仍没取满 ⇒ 落在窗口外的分支给「没结论」，退 2（不是「都没合并」）", async () => {
    // 100 条无关记录 ⇒ 平台侧「还有下一页」，本跑按上限收工。
    const unrelated = Array.from({ length: BRANCH_PULL_PAGE_SIZE }, (_, i) =>
      pull(3000 - i, `other/${i}`, true),
    );
    const f = branchesMainIo({
      pulls: [...unrelated, pull(2420, "fix/landed", true)],
      branchList: "master\tm1\nfix/landed\tl1\nscratch/old\ts1\n",
    });
    const code = await main({
      args: ["--branches"],
      env: {},
      run: f.run,
      log: (l: string) => f.log.push(l),
    });
    expect(code).toBe(CODE.NOT_RUN);
    const text = f.log.join("\n");
    expect(text).toContain("我没取到");
    // 已命中的那条仍然给 landed —— 截断只影响「取不到」的那些，不许连坐。
    expect(text).toContain("landed");
  });
});
