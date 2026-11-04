/** 「分支落地读数」判据自测（规范 §13.6.5，ISSUE #2427）。防的错法：`git diff origin/master...<分支>` 在 squash
 * 拓扑下恒非空，会被误判为「没合并」。钉三点：① 结论仅三种且「没取到」≠「没合并」；② 匹配按
 * `head.ref = "refs/heads/<名>"`（裸名匹配会把九条已合并分支判成「没找到 PR」）；③ 一次也不删，任何写
 * ref 的命令都不许出现在 calls 里。另加主干排除：`resolveTrunk()` 的 `origin/master` 与清单裸名不同形。
 */
import { describe, expect, it } from "vitest";
import {
  BRANCH_PULL_MAX_PAGES,
  BRANCH_PULL_PAGE_SIZE,
  branchLandingRows,
  fetchPullsForBranches,
  readListHasMore,
} from "../scripts/ship-branches.mjs";
import { main } from "../scripts/ship.mjs";

const CODE = { GREEN: 0, RED: 1, NOT_RUN: 2 };

type FakeResult = {
  error: string | null;
  status: number;
  stderr: string;
  stdout: string;
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

  it("每页都满 ⇒ 撞防失控上限也没取满，note 显式报「取不满」（页数 / 条数都在）", () => {
    const full = Array.from({ length: BRANCH_PULL_PAGE_SIZE }, (_, i) =>
      pull(2000 - i, `b${i}`, true),
    );
    const got = fetchPullsForBranches(() => ok(JSON.stringify({ data: full })), "o/r", {
      maxPages: 2,
    });
    expect(got.windowComplete).toBe(false);
    expect(got.stopReason).toBe("ceiling");
    expect(got.note).toContain("取不满");
    expect(got.note).toContain("2 页（已取 200 条）");
    expect(got.note).toContain("没取到");
  });
});

describe("ISSUE #3058：取数窗口 —— 终止看平台形状，8 页硬顶没了", () => {
  const ok = (stdout: string): FakeResult => ({
    status: 0,
    stdout,
    stderr: "",
    error: null,
  });
  /** 一页 100 条满页（编号从 start 往下数）。 */
  const fullPage = (start: number) =>
    Array.from({ length: BRANCH_PULL_PAGE_SIZE }, (_, i) =>
      pull(start - i, `b${start - i}`, true),
    );
  /** 按 `--page` 参数给应答的假执行者（没登记的页给空页）。 */
  const pagedRun = (pages: Record<number, unknown>, counter?: { n: number }) => {
    return (_cmd: string, args: Array<string>): FakeResult => {
      if (counter) {
        counter.n += 1;
      }
      const page = Number(args[args.indexOf("--page") + 1]);
      return ok(JSON.stringify(pages[page] ?? { data: [] }));
    };
  };

  it("readListHasMore 三态：布尔键 / next 键 / 缺键（缺键 ≠ 没有更多，与 #3059 同族）", () => {
    expect(readListHasMore({ data: { data: [], has_more: true } })).toBe(true);
    expect(readListHasMore({ data: { data: [], hasMore: false } })).toBe(false);
    expect(readListHasMore({ data: { data: [], next: "2" } })).toBe(true);
    expect(readListHasMore({ data: { data: [], next: null } })).toBe(false);
    /* 信封顶层贴键也认；data 是清单数组时不把它当键袋。 */
    expect(readListHasMore({ data: [], has_more: true })).toBe(true);
    expect(readListHasMore({ data: [pull(1, "a", true)] })).toBeNull();
    expect(readListHasMore({ data: { data: [] } })).toBeNull();
    expect(readListHasMore(null)).toBeNull();
  });

  it(">800 条（缺 next 键、靠不足页收尾）：默认上限不再掐在 8 页，9 页翻满", () => {
    const pages: Record<number, unknown> = {};
    for (let p = 1; p <= 8; p += 1) {
      pages[p] = { data: fullPage(3000 - (p - 1) * 100) };
    }
    pages[9] = { data: [pull(2199, "tail", true), pull(2198, "tail2", false)] };
    const got = fetchPullsForBranches(pagedRun(pages), "o/r"); /* 不传 maxPages：默认上限 */
    expect(got.ok).toBe(true);
    expect(got.windowComplete).toBe(true);
    expect(got.pages).toBe(9);
    expect(got.pulls).toHaveLength(802);
    expect(got.stopReason).toBe("short-page");
    expect(got.hasMoreKey).toBe(false);
    expect(BRANCH_PULL_MAX_PAGES).toBeGreaterThan(9); /* 钉住「上限是防失控，不是窗口」 */
  });

  it("正好 800 条边界：第 9 页空页 ⇒ 取满（旧口径会在第 8 页报「没取满」冤枉它）", () => {
    const pages: Record<number, unknown> = {};
    for (let p = 1; p <= 8; p += 1) {
      pages[p] = { data: fullPage(3000 - (p - 1) * 100) };
    }
    pages[9] = { data: [] };
    const got = fetchPullsForBranches(pagedRun(pages), "o/r");
    expect(got.windowComplete).toBe(true);
    expect(got.pulls).toHaveLength(800);
    expect(got.stopReason).toBe("empty-page");
  });

  it("平台给 has_more 键就听它的：满页但 has_more=false ⇒ 当场停（不再靠满页猜）", () => {
    const pages: Record<number, unknown> = {
      1: { data: { data: fullPage(3000), has_more: false } },
    };
    const got = fetchPullsForBranches(pagedRun(pages), "o/r");
    expect(got.windowComplete).toBe(true);
    expect(got.pages).toBe(1);
    expect(got.stopReason).toBe("has-more-false");
    expect(got.hasMoreKey).toBe(true);
  });

  it("上限触发 ⇒ 显式报「取不满」（平台 has-more 页页喊还有，翻满 3 页收）", () => {
    const counter = { n: 0 };
    const run = pagedRun(
      new Proxy({}, { get: () => ({ data: { data: fullPage(3000), has_more: true } }) }),
      counter,
    );
    const got = fetchPullsForBranches(run, "o/r", { maxPages: 3 });
    expect(counter.n).toBe(3); /* 翻满上限即收，不多翻 */
    expect(got.windowComplete).toBe(false);
    expect(got.stopReason).toBe("ceiling");
    expect(got.note).toContain("取不满");
    expect(got.note).toContain("3 页（已取 300 条）");
    expect(got.note).toContain("has-more 键仍说还有");
  });

  it("防退化无限循环：平台喊「还有」却给空页 ⇒ 停，按取不满如实报", () => {
    const counter = { n: 0 };
    const pages: Record<number, unknown> = {
      1: { data: { data: fullPage(3000), has_more: true } },
      2: { data: { data: [], has_more: true } },
    };
    const got = fetchPullsForBranches(pagedRun(pages, counter), "o/r");
    expect(counter.n).toBe(2); /* 不是 64 —— 空页必停 */
    expect(got.windowComplete).toBe(false);
    expect(got.stopReason).toBe("empty-page");
    expect(got.note).toContain("空页");
  });
});

/** `main()` 那一层需要的最小 io（形状同 `tests/ship.test.ts` 的 `issueMainIo`）。 */
function branchesMainIo(opts: { branchList: string; pulls: Array<unknown> }) {
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
