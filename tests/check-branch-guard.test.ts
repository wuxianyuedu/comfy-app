/**
 * 提交门槛自检:把 scripts/check-branch-guard.cjs 当黑盒跑在临时仓库上,验证
 * 「不在 master 上直接提交」这条硬规则(规范 13.6 / ISSUE #492)真的会阻断提交,
 * 而不是只写在文档里。
 *
 * 为什么用临时 git 仓库而不是 mock git 调用:
 *   判据本身依赖三条 git 事实(当前分支名、HEAD 父提交数、工作树定位),在内存里
 *   假装这些事实恰好等于把规则重新实现一遍;真的建仓库、真的 commit 才等价于
 *   pre-commit 被触发时的处境(这也正是历史事故的来源:规则写得对,但没在真实
 *   提交路径上跑过)。
 *
 * 覆盖三类场景:
 *   - 分支上提交          → 放行
 *   - master 上直接提交    → 阻断,且提示里给出「怎么把提交搬走」
 *   - master 上合并提交    → 放行(PR 合并在平台侧完成,不该被本地门槛二次阻挡)
 *
 * 另覆盖服务端复核(`--pr-check`)。它的判据**不能**复用「分支名」:CNB 在
 * pull_request 事件上 checkout 的是**预合并提交**,容器里 `symbolic-ref HEAD` 恒等于
 * 目标分支——照搬「HEAD 在 master 上就是直连主干」会把每一条正常 PR 都拦死
 * (PR #633 第一次跑就是这么红的)。所以这里用真仓库把三种拓扑都跑一遍:
 *   - 源分支领先目标分支            → 放行
 *   - 源分支归并过目标分支(预合并)   → 放行
 *   - 源分支与目标分支完全同步       → 阻断(平台允许创建 source=master 的 PR)
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defineGateRepo, describe, type GateRepo } from "./helpers/gate-repo";
import { vi } from "vitest";

/* 这些用例每条都要**真跑 git**（init / add / commit / merge，夹具里还有一次
 * init + 文件拷贝），负载高的机器上 5s 的用例超时与 10s 的钩子超时经常都
 * 不够（实测单条 7~16s）—— 文件级放宽到 30s，只影响本文件。 */
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const SCRIPT = join(process.cwd(), "scripts", "check-branch-guard.cjs");

const { test, expect } = defineGateRepo({
  script: "check-branch-guard.cjs",
  /* 脚本用 `process.cwd()` 定位扫描根 —— 落哪都一样，选 root。 */
  dir: "root",
  /* 夹具就绪后 `git init` 一个「master 上已有一个提交」的仓库：本判据的
   * 被测输入就是**提交拓扑**，没有提交历史它无从判起。 */
  setup: (repo: GateRepo) => {
    repo.git("init", "-q", "-b", "master", ".");
    repo.git("config", "user.email", "gate@example.com");
    repo.git("config", "user.name", "gate");
    repo.git("config", "commit.gpgsign", "false");
    repo.write("seed.txt", "seed\n");
    repo.git("add", ".");
    repo.commit("chore: seed");
  },
});

describe("check-branch-guard.cjs（提交门槛）", () => {
  test("master 上直接提交 → 阻断,并给出搬迁出口", ({ repo }) => {
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("master");
    expect(output).toContain("git checkout -b");
    expect(output).toContain("git reset --hard origin/master");
  });

  test("工作分支上提交 → 放行", ({ repo }) => {
    repo.git("checkout", "-q", "-b", "feat/branch-guard");
    const { code, output } = repo.run();
    expect(code).toBe(0);
    expect(output).toContain("[branch-guard] OK");
  });

  test("master 上的合并提交 → 放行(PR 合并不被本地门槛二次阻挡)", ({ repo }) => {
    repo.git("checkout", "-q", "-b", "feat/merge-me");
    repo.write("feature.txt", "feature\n");
    repo.git("add", ".");
    repo.git("commit", "-qm", "feat: feature");
    repo.git("checkout", "-q", "master");
    // --no-ff 造一个真实的合并提交(两个父),等价于平台侧合并 PR 的形态
    repo.git("merge", "--no-ff", "--no-edit", "-q", "feat/merge-me");
    const { code, output } = repo.run();
    expect(code).toBe(0);
    expect(output).toContain("合并提交");
  });

  test("--status 只做体检,不在 master 上阻断", ({ repo }) => {
    const { code, output } = repo.run(["--status"]);
    expect(code).toBe(0);
    expect(output).toContain("master");
  });

  test("非 git 目录里不崩(裸目录 / tarball 解包场景)", () => {
    /* 这一条要的正是**没有 git** 的工作区，所以不走共享夹具（它的 `setup`
     * 会 init 一个仓库）—— 自己造一个裸目录，与「这条要验的形态」一一对应。 */
    const bare = mkdtempSync(join(tmpdir(), "branch-guard-nogit-"));
    try {
      copyFileSync(SCRIPT, join(bare, "check-branch-guard.cjs"));
      const output = execFileSync(process.execPath, [join(bare, "check-branch-guard.cjs")], {
        cwd: bare,
        encoding: "utf8",
      });
      // 取不到分支名(空) ≠ master,判据无从命中,放行而非报错
      expect(output).toContain("[branch-guard] OK");
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  /* ── --pr-check:服务端复核 ─────────────────────────────────────────── */

  test("--pr-check:源分支领先目标分支 → 放行(正常 PR)", ({ repo }) => {
    repo.git("checkout", "-q", "-b", "feat/pr");
    repo.write("feature.txt", "feature\n");
    repo.git("add", ".");
    repo.git("commit", "-qm", "feat: feature");
    const { code, output } = repo.run(["--pr-check", "--target", "master"]);
    expect(code).toBe(0);
    expect(output).toContain("不在 master 上");
  });

  test("--pr-check:目标分支还在推进、源分支已归并它(CNB 预合并形态)→ 放行", ({ repo }) => {
    repo.git("checkout", "-q", "-b", "feat/pr");
    repo.write("feature.txt", "feature\n");
    repo.git("add", ".");
    repo.git("commit", "-qm", "feat: feature");
    repo.git("checkout", "-q", "master");
    repo.write("advance.txt", "advance\n");
    repo.git("add", ".");
    repo.git("commit", "-qm", "chore: advance");
    repo.git("checkout", "-q", "feat/pr");
    repo.git("merge", "--no-ff", "--no-edit", "-q", "master");
    const { code, output } = repo.run(["--pr-check", "--target", "master"]);
    expect(code).toBe(0);
    expect(output).toContain("[branch-guard] OK");
  });

  test("--pr-check:源分支没有任何超出目标分支的提交 → 阻断(源分支就是 master)", ({ repo }) => {
    // 平台允许创建 source=master 的 PR,这正是本条要拦的场景。
    repo.git("checkout", "-q", "-b", "sync-with-master");
    const { code, output } = repo.run(["--pr-check", "--target", "master"]);
    expect(code).toBe(1);
    expect(output).toContain("源分支就是 master");
    expect(output).toContain("git checkout -b");
  });

  test("--pr-check:取不到目标分支 → 保守放行,不误报", ({ repo }) => {
    const { code, output } = repo.run(["--pr-check", "--target", "release/nope"]);
    expect(code).toBe(0);
    expect(output).toContain("保守放行");
  });

  test("--pr-check 缺省目标分支是 master(不靠环境变量,参数缺省也判得动)", ({ repo }) => {
    repo.git("checkout", "-q", "-b", "feat/pr");
    repo.write("feature.txt", "feature\n");
    repo.git("add", ".");
    repo.git("commit", "-qm", "feat: feature");
    const { code, output } = repo.run(["--pr-check"]);
    expect(code).toBe(0);
    expect(output).toContain("目标分支 master");
  });

  /* ── --merge-commit:master 的 push 事件复核 ───────────────────────── */

  test("--merge-commit:master 上的合并提交 → 放行(push 事件上 HEAD 就是合并提交)", ({ repo }) => {
    repo.git("checkout", "-q", "-b", "feat/merge-me");
    repo.write("feature.txt", "feature\n");
    repo.git("add", ".");
    repo.git("commit", "-qm", "feat: feature");
    repo.git("checkout", "-q", "master");
    repo.git("merge", "--no-ff", "--no-edit", "-q", "feat/merge-me");
    const { code, output } = repo.run(["--merge-commit"]);
    expect(code).toBe(0);
    expect(output).toContain("PR 合并提交");
  });

  test("--merge-commit:squash 合并(单父 + PR 关联)→ 放行", ({ repo }) => {
    // 本仓库规范 §13.6 优先 Squash Merge。squash 提交只有 1 个父,与「直连主干」
    // 在拓扑上同形 —— 拿「父提交数 > 1」当判据会把每一次正常合并都判红
    // (此前 master 的 push 流水线**每一次都是红的**,就是这么来的)。
    // 平台在合并提交信息里写下 PR 关联,这是可核实的「走过 PR」的痕迹。
    repo.git("checkout", "-q", "-b", "feat/squash-me");
    repo.write("feature.txt", "feature\n");
    repo.git("add", ".");
    repo.git("commit", "-qm", "feat: feature");
    repo.git("checkout", "-q", "master");
    // squash 等价形态:把分支改动并成 master 上的单个提交,并带上平台的 PR 关联。
    repo.git("merge", "--squash", "-q", "feat/squash-me");
    repo.git("commit", "-qm", "feat: feature\n\nPR-URL: #646");
    const { code, output } = repo.run(["--merge-commit"]);
    expect(code).toBe(0);
    expect(output).toContain("squash/rebase");
    expect(output).toContain("PR 关联");
  });

  test("--merge-commit:单父且无 PR 关联 → 保守放行(不误报,直推拦截在平台分支保护)", ({ repo }) => {
    // 拓扑同形时判据无从命中,按「保守放行」处理 —— 与 --pr-check 的
    // 「取不到目标分支 → 保守放行」同一口径。真正拦直推的是平台分支保护
    // (规范 §13.6.1),这里不再叠加一条会误报的判据。
    const { code, output } = repo.run(["--merge-commit"]);
    expect(code).toBe(0);
    expect(output).toContain("保守放行");
  });

  test("--merge-commit:工作分支上提交 → 放行(不误报)", ({ repo }) => {
    repo.git("checkout", "-q", "-b", "feat/push");
    const { code } = repo.run(["--merge-commit"]);
    expect(code).toBe(0);
  });

  /* 这一条判的是**本仓库的钩子文件**，不搭临时仓库。 */
  test("pre-commit 钩子把守卫放在第一步(顺序错了会先跑一堆必然白费的门禁)", () => {
    const hookPath = join(process.cwd(), ".githooks", "pre-commit");
    const text = readFileSync(hookPath, "utf8");
    const guardAt = text.indexOf("check-branch-guard.cjs");
    const structureAt = text.indexOf("check-file-structure.cjs");
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(structureAt);
  });
});
