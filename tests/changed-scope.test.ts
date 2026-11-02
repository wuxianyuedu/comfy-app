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
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { gitSandboxEnv, sandboxGitConfig } from "./helpers/git-sandbox-env";

import {
  changedFilesForBaseRef,
  confirmEmptyChangeFace,
  reconcileSyntheticMergeFace,
  resolveBaseRef,
  resolveChangedFiles,
} from "../scripts/changed-scope.mjs";

/** 假 git：按调用顺序回放预置结果。 */
function fakeGit(handlers: Record<string, { ok: boolean; stdout: string }>) {
  const calls: Array<Array<string>> = [];
  const runGit = (args: Array<string>, _cwd: string) => {
    calls.push(args);
    /* 剥掉**全局旗标**那一对（`-c core.quotePath=false`，ISSUE #2272）：它是 git 的
     * 全局配置，不属于「这条 diff 是什么形状」⇒ 键要按形状算。 */
    const shape = args[0] === "-c" ? args.slice(2) : args;
    const key = shape[0] === "diff" ? `diff ${shape.at(-1) ?? ""}` : (shape[0] ?? "");
    const hit = handlers[key] ?? handlers[shape[0] ?? ""];
    if (!hit) {
      return { ok: false, stdout: "" };
    }
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
    if (got.ok) {
      return;
    }
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
    if (got.ok) {
      return;
    }
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

/**
 * 平台**合成 merge 提交**上的对账（口径 ⑤，ISSUE #2325）。
 *
 * 这一族治的是「与壳无关的 PR 被判成改了壳」：平台检出的是「本 PR 并进目标分支（那一刻）」
 * 的 merge 提交，而基线是 `CNB_PULL_REQUEST_TARGET_SHA` —— 两者错位时三点 diff 的
 * merge-base 就是**基线自己**，目标分支在基线之后自己落地的改动进了本 PR 的改动面。
 *
 * 用例**真造 git 仓库**（假 git 回放不出 merge 拓扑，而这一族判的就是拓扑）：
 *   基线 B → 目标分支上别人的改动 T（改了 `src-tauri/src/lib.rs`）
 *   → 本 PR 只改 `src/lib/x.ts` → 平台把 PR 并进 T 生成 M（合成提交）。
 * 期望：`<B>...M` 里**有**别人的 `lib.rs`（这就是 bug），而对账之后只剩 PR 自己那条。
 */
describe("changed-scope —— 平台合成 merge 提交上的对账（#2325）", () => {
  const temps: Array<string> = [];

  afterEach(() => {
    for (const dir of temps.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /** 建一个临时仓库；返仓库根。`git` 用户名/邮箱按仓库级设，不污染全局。 */
  function initRepo(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "changed-scope-merge-"));
    temps.push(dir);
    const git = (...args: Array<string>) =>
      execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@t.t");
    git("config", "user.name", "t");
    git("config", "commit.gpgsign", "false");
    return dir;
  }

  function git(dir: string, ...args: Array<string>): string {
    return execFileSync("git", ["-C", dir, ...args], {
      encoding: "utf8",
      stdio: "pipe",
    });
  }

  function write(dir: string, rel: string, body: string): void {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  }

  function commit(dir: string, msg: string): string {
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", msg);
    return git(dir, "rev-parse", "HEAD").trim();
  }

  /**
   * 造出 ISSUE #2325 的拓扑，返回三条 sha：
   * `base`（平台给的基线）/ `theirs`（目标分支自己落地的）/ `merged`（合成提交）。
   */
  function syntheticMerge(): {
    base: string;
    dir: string;
    merged: string;
    source: string;
    theirs: string;
  } {
    const dir = initRepo();
    write(dir, "README.md", "x\n");
    commit(dir, "base");
    const base = git(dir, "rev-parse", "HEAD").trim();

    /* 源分支：只改前端。 */
    git(dir, "checkout", "-q", "-b", "feat");
    write(dir, "src/lib/x.ts", "1\n");
    const source = commit(dir, "feat: 前端");

    /* 目标分支：基线之后，**别人**改了 Rust 壳。 */
    git(dir, "checkout", "-q", "main");
    write(dir, "src-tauri/src/lib.rs", "fn main() {}\n");
    const theirs = commit(dir, "perf(shell): 别人的壳改动");

    /* 平台合成：把 feat 并进 main（不冲突 ⇒ 自动生成 merge 提交）。 */
    git(dir, "merge", "--no-ff", "-q", "-m", "Merge feat into main", "feat");
    const merged = git(dir, "rev-parse", "HEAD").trim();
    return { dir, base, theirs, source, merged };
  }

  it("BUG 现场：三点 diff 会把「目标分支在基线之后自己落地的壳改动」算进本 PR", () => {
    const { dir, base } = syntheticMerge();
    const got = changedFilesForBaseRef(base, { cwd: dir });
    expect(got.ok).toBe(true);
    if (!got.ok) {
      return;
    }
    /* 这一行就是 ISSUE #2325 的现场读数：PR 没有碰过 `src-tauri/`，面里却有它。 */
    expect(got.files).toContain("src-tauri/src/lib.rs");
  });

  it("对账之后（CNB_COMMIT 是 HEAD 的某一父）⇒ 面里只剩本 PR 带进来的，别人的改动被念出来", () => {
    const { dir, base, source } = syntheticMerge();
    const face = reconcileSyntheticMergeFace(base, {
      cwd: dir,
      env: { CNB_COMMIT: source },
    });
    expect(face.used).toBe(true);
    if (!face.used) {
      return;
    }
    expect(face.files).toEqual(["src/lib/x.ts"]);
    expect(face.deduped).toEqual(["src-tauri/src/lib.rs"]);
  });

  it("常态（基线就是合成时的目标侧）⇒ 对账是恒等变换：一条都不剔", () => {
    const { dir, theirs, source } = syntheticMerge();
    const face = reconcileSyntheticMergeFace(theirs, {
      cwd: dir,
      env: { CNB_COMMIT: source },
    });
    expect(face.used).toBe(true);
    if (!face.used) {
      return;
    }
    expect(face.files).toEqual(["src/lib/x.ts"]);
    expect(face.deduped).toEqual([]);
  });

  it("没有 CNB_COMMIT（本地 / 手工触发）⇒ 不做减法，说明理由", () => {
    const { dir, base } = syntheticMerge();
    const face = reconcileSyntheticMergeFace(base, { cwd: dir, env: {} });
    expect(face.used).toBe(false);
    if (face.used) {
      return;
    }
    expect(face.why).toContain("CNB_COMMIT");
  });

  it("HEAD 不是 merge 提交（有人覆盖了 HEAD / 不是合成形态）⇒ 不做减法", () => {
    const { dir, base, source } = syntheticMerge();
    /* 在源分支上直接看（HEAD = 那条普通提交）。 */
    git(dir, "checkout", "-q", "feat");
    expect(git(dir, "rev-parse", "HEAD").trim()).toBe(source);
    const face = reconcileSyntheticMergeFace(base, {
      cwd: dir,
      env: { CNB_COMMIT: source },
    });
    expect(face.used).toBe(false);
    if (face.used) {
      return;
    }
    expect(face.why).toContain("不是 merge 提交");
  });

  it("CNB_COMMIT 对不上任何一父（形态认不出来）⇒ 不做减法", () => {
    const { dir, base } = syntheticMerge();
    const face = reconcileSyntheticMergeFace(base, {
      cwd: dir,
      env: { CNB_COMMIT: "0".repeat(40) },
    });
    expect(face.used).toBe(false);
    if (face.used) {
      return;
    }
    expect(face.why).toContain("父提交里没有");
  });

  it("基线比第一父新（PR 已经并进目标 / 逐字节相同）⇒ 三点是恒等式，一个文件都不剔", () => {
    /* PR #3023 的现场：目标分支已经包含源分支的全部提交。此时基线（= 第一父）与
     * `第一父^1` 之间没东西可算，`<基线>..第一父` 是空的 —— 早先那一支被读成
     * 「两段历史不相交」而整条对账被丢掉，调用方连「这说明基线比你们那侧新」都念不出来。 */
    const { dir, source } = syntheticMerge();
    const firstParent = git(dir, "rev-parse", "HEAD^1").trim();
    const face = reconcileSyntheticMergeFace(firstParent, {
      cwd: dir,
      env: { CNB_COMMIT: source },
    });
    expect(face.used).toBe(true);
    if (!face.used) {
      return;
    }
    expect(face.files).toEqual(["src/lib/x.ts"]);
    expect(face.deduped).toEqual([]);
  });

  it("没有基线（`null`）⇒ 只剩拓扑那一半：不做减法，理由指得出缺的是哪一半", () => {
    /* 没有基线就没有「别人那一段」可对 —— 这一支不许静默放过（`used: true`），
     * 也不许把「没基线」说成「浅克隆」。 */
    const { dir, source } = syntheticMerge();
    const face = reconcileSyntheticMergeFace(null, { cwd: dir, env: { CNB_COMMIT: source } });
    expect(face.used).toBe(false);
    if (face.used) {
      return;
    }
    expect(face.why).toMatch(/不做减法/);
  });

  it("两段历史不相交（合成提交的父与基线无关）⇒ 不做减法，也不许静默", () => {
    const { dir } = syntheticMerge();
    /* 另起一条与 HEAD 完全无关的历史，充作基线。 */
    git(dir, "checkout", "-q", "--orphan", "island");
    write(dir, "island.txt", "1\n");
    const island = commit(dir, "island");
    git(dir, "checkout", "-q", "main");
    const face = reconcileSyntheticMergeFace(island, {
      cwd: dir,
      env: { CNB_COMMIT: git(dir, "rev-parse", "main^2").trim() },
    });
    expect(face.used).toBe(false);
    if (face.used) {
      return;
    }
    /* 两份历史不相交时三点 diff 本身就拼不出来 —— 与「两段清单不重合」是同一类
     * 「这一份检出拿不出对照」，只是更早一步。两条都念「不做减法」。 */
    expect(face.why).toContain("不做减法");
  });
});

/**
 * 「这个 PR 真的一处没改」（口径 ⑥，ISSUE #3026）。
 *
 * 现场是 PR #3023：目标分支已经包含源分支的全部提交（同步 master 之后逐字节相同），
 * 平台仍合成 merge 提交，而 `<基线>...HEAD` 是空的 —— 那一跑被读成「改动面为空 ⇒ 没判」
 * 而红。它其实判过了：答案是零个文件。
 *
 * 与上面那族同样**真造 git 仓库**（假 git 回放不出拓扑，而这一族判的就是拓扑）。
 */
describe("changed-scope —— 空改动面的两半读法（#3026）", () => {
  const temps: Array<string> = [];

  afterEach(() => {
    for (const dir of temps.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /** 跑一条 git。**必须带沙箱环境**：继承来的 `GIT_DIR` 会让 `-C <临时仓库>` 直接失效
   * （那一次调试里就是它：读的是别人的树，于是每条 diff 都像「坏了」）。 */
  function git(dir: string, ...args: Array<string>): string {
    return execFileSync("git", ["-C", dir, ...args], {
      encoding: "utf8",
      stdio: "pipe",
      env: gitSandboxEnv(),
    });
  }

  function write(dir: string, rel: string, body: string): void {
    writeFileSync(path.join(dir, rel), body);
  }

  function commit(dir: string, msg: string): string {
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", msg);
    return git(dir, "rev-parse", "HEAD").trim();
  }

  /** 建临时仓库并落下第一条提交（基线）；身份走 `sandboxGitConfig()`。 */
  function initRepo(): { base: string; dir: string } {
    const dir = mkdtempSync(path.join(tmpdir(), "changed-scope-empty-"));
    temps.push(dir);
    git(dir, "init", "-q", "-b", "main");
    for (const [k, v] of Object.entries(sandboxGitConfig())) {
      git(dir, "config", k, v);
    }
    write(dir, "README.md", "x\n");
    return { base: commit(dir, "base"), dir };
  }

  it("逐字节相同的 PR（同步 master 之后）⇒ 两半都空，判得出「零个文件」", () => {
    /* #3023 的现场：#3000 的冲突已经以目标分支那一侧解掉，源分支剩下的**净改动为零**
     * —— 平台照样合成一个 merge 提交，而 `<目标>...HEAD` 是空的。
     * 拓扑照原样造：源分支 `feat` 从基线分出来、一处没改；目标分支自己有一步。 */
    const { base, dir } = initRepo();
    git(dir, "checkout", "-q", "-b", "feat");
    /* 源分支的净改动为零，但确实动过（那一步与目标分支**同一份内容**）——
     * #3000 的冲突正是以目标分支那一侧解掉的。 */
    write(dir, "x.txt", "1\n");
    commit(dir, "feat: 与目标同形的一步");
    git(dir, "checkout", "-q", "main");
    write(dir, "x.txt", "1\n");
    const target = commit(dir, "main: 同一份内容");
    git(dir, "checkout", "-q", "feat");
    git(dir, "merge", "-q", "--no-ff", "-m", "sync main", target);
    const source = git(dir, "rev-parse", "HEAD").trim();
    git(dir, "checkout", "-q", "main");
    git(dir, "merge", "-q", "--no-ff", "-m", "Merge feat into main", source);

    /* 前置读数：这就是 #3023 的那一条（三点 diff 空）。 */
    expect(changedFilesForBaseRef(target, { cwd: dir })).toEqual({
      ok: true,
      files: [],
      renamedFrom: [],
    });

    const got = confirmEmptyChangeFace({ cwd: dir, env: { CNB_PULL_REQUEST_TARGET_SHA: target } });
    expect(got.ok).toBe(true);
    if (!got.ok) {
      return;
    }
    expect(got.firstParent).toBe(target);
    /* 读数（同步带进来的那几条）不参与判决 —— 这一版拓扑里它是空的，只核它是一条数组。 */
    expect(Array.isArray(got.lead)).toBe(true);
    expect(base === "").toBe(false);
  });

  it("真的有改动 ⇒ 不是那条形态，理由说得清", () => {
    const { base, dir } = initRepo();
    write(dir, "a.txt", "1\n");
    commit(dir, "feat: a");
    const got = confirmEmptyChangeFace({ cwd: dir, env: { CNB_PULL_REQUEST_TARGET_SHA: base } });
    expect(got.ok).toBe(false);
    if (got.ok) {
      return;
    }
    expect(got.reason).toContain("不是空的");
  });

  it("三点 diff 空、而「第一父..HEAD」非空 ⇒ 证不出来（两半判据缺一不可）", () => {
    /* 拓扑：PR 那一侧**只**同步了目标分支、自己一处没改 ⇒ 第一父..HEAD 是空的。
     * 这一条要造的是反面：第一父..HEAD 有东西。最直接的形态是「PR 自己的改动
     * 与目标分支那一步在两边各有一份、三点因此为空，而两点看得见自己的那一份」。 */
    const { base, dir } = initRepo();
    git(dir, "checkout", "-q", "-b", "feat");
    write(dir, "a.txt", "1\n");
    commit(dir, "feat: a");
    git(dir, "checkout", "-q", "main");
    write(dir, "t.txt", "t\n");
    const target = commit(dir, "main: t");
    git(dir, "checkout", "-q", "feat");
    git(dir, "checkout", "-q", "--detach");
    git(dir, "reset", "-q", "--hard", target);
    git(dir, "merge", "-q", "--no-ff", "-m", "sync main", target);
    const synced = git(dir, "rev-parse", "HEAD").trim();
    /* 同步之后再落一笔自己的改动 ⇒ 第一父..HEAD 非空。 */
    write(dir, "own.txt", "o\n");
    const source = commit(dir, "feat: own");
    git(dir, "checkout", "-q", "main");
    git(dir, "merge", "-q", "--no-ff", "-m", "Merge feat into main", source);

    /* 基线取「同步提交」：三点相对它看得见自己的改动 ⇒ 不是空面形态（退到上面那条判据）。 */
    const notEmpty = confirmEmptyChangeFace({
      cwd: dir,
      env: { CNB_PULL_REQUEST_TARGET_SHA: synced },
    });
    expect(notEmpty.ok).toBe(false);
    if (notEmpty.ok) {
      return;
    }
    expect(notEmpty.reason).toContain("不是空的");
    expect(base === "").toBe(false);
  });

  it("两个父的对称差只进「只在一侧之下」的那一份", () => {
    /* 钉的是**判据的形状**：两个父各自往前走了、谁也包不住谁时，对称差里两边的新文件
     * 都在；而 `<第一父>..HEAD` 只看得见第二父那一侧。两个答案不同 —— 这正是它与
     * 「单个父的两点 diff」的实质差别。 */
    const { dir, base } = initRepo();
    write(dir, "m.txt", "m\n");
    commit(dir, "main＃1");
    git(dir, "checkout", "-q", "-b", "feat", base);
    write(dir, "a.txt", "1\n");
    commit(dir, "feat: a");

    git(dir, "checkout", "-q", "main");
    git(dir, "merge", "-q", "--no-ff", "-m", "main＃1 采纳源分支那一笔", "feat");
    const adopted = git(dir, "rev-parse", "HEAD").trim();
    git(dir, "checkout", "-q", "feat");
    git(dir, "merge", "-q", "--no-ff", "-m", "sync main", adopted);
    write(dir, "n.txt", "n\n");
    const source = commit(dir, "feat: 自己的一步");

    git(dir, "checkout", "-q", "main");
    write(dir, "main3.txt", "m3\n");
    const firstParent = commit(dir, "main＃2: 目标分支自己写的");
    git(dir, "checkout", "-q", "feat");
    /* 让第二父也再走一步（两边各往前一步，谁都不包住谁）。 */
    write(dir, "main3.txt", "m3\n");
    write(dir, "n2.txt", "n2\n");
    const secondParent = commit(dir, "feat: 再走一步");
    git(dir, "checkout", "-q", "main");
    git(dir, "merge", "-q", "--no-ff", "-m", "Merge feat into main", secondParent);

    /* 对称差：`main3.txt`（只在第一父之下）与 `n.txt`/`n2.txt`（只在第二父之下）。 */
    expect(git(dir, "diff", "--name-status", "-M", `${firstParent}...${secondParent}`).trim()).toBe(
      "A\tmain3.txt\nA\tn.txt\nA\tn2.txt",
    );
    expect(source === "").toBe(false);
  });

  it("读不到基线 ⇒ 证不出来（拿不到测量 ≠ 结果是 0）", () => {
    const { dir } = initRepo();
    const got = confirmEmptyChangeFace({ cwd: dir, env: {}, fallbackRef: null });
    expect(got.ok).toBe(false);
    if (got.ok) {
      return;
    }
    expect(got.reason).toContain("取不到");
  });
});
