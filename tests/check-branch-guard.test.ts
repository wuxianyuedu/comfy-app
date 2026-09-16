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
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* 这些用例每条都要**真跑 git**（init / add / commit / merge，beforeEach 里还有
 * 一次 init + 文件拷贝），负载高的机器上 5s 的用例超时与 10s 的钩子超时经常都
 * 不够（实测单条 7~16s）—— 文件级放宽到 30s，只影响本文件。 */
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const SCRIPT = join(process.cwd(), "scripts", "check-branch-guard.cjs");

let workdir = "";

function run(args: string[] = []): { code: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [join(workdir, "check-branch-guard.cjs"), ...args], {
      cwd: workdir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      code: typeof e.status === "number" ? e.status : 1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
    };
  }
}

function git(args: string[]): void {
  execFileSync("git", args, { cwd: workdir, stdio: "ignore" });
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "branch-guard-"));
  copyFileSync(SCRIPT, join(workdir, "check-branch-guard.cjs"));
  // 临时仓库自成一体:身份与签名都就地配置,不读宿主的 gitconfig
  // (宿主可能开了 commit.gpgsign,会让这里的 commit 直接失败)。
  git(["init", "-q", "-b", "master", "."]);
  git(["config", "user.email", "gate@example.com"]);
  git(["config", "user.name", "gate"]);
  git(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(workdir, "seed.txt"), "seed\n");
  git(["add", "."]);
  git(["commit", "-qm", "chore: seed"]);
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("check-branch-guard.cjs（提交门槛）", () => {
  it("master 上直接提交 → 阻断,并给出搬迁出口", () => {
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("master");
    expect(output).toContain("git checkout -b");
    expect(output).toContain("git reset --hard origin/master");
  });

  it("工作分支上提交 → 放行", () => {
    git(["checkout", "-q", "-b", "feat/branch-guard"]);
    const { code, output } = run();
    expect(code).toBe(0);
    expect(output).toContain("[branch-guard] OK");
  });

  it("master 上的合并提交 → 放行(PR 合并不被本地门槛二次阻挡)", () => {
    git(["checkout", "-q", "-b", "feat/merge-me"]);
    writeFileSync(join(workdir, "feature.txt"), "feature\n");
    git(["add", "."]);
    git(["commit", "-qm", "feat: feature"]);
    git(["checkout", "-q", "master"]);
    // --no-ff 造一个真实的合并提交(两个父),等价于平台侧合并 PR 的形态
    git(["merge", "--no-ff", "--no-edit", "-q", "feat/merge-me"]);
    const { code, output } = run();
    expect(code).toBe(0);
    expect(output).toContain("合并提交");
  });

  it("--status 只做体检,不在 master 上阻断", () => {
    const { code, output } = run(["--status"]);
    expect(code).toBe(0);
    expect(output).toContain("master");
  });

  it("非 git 目录里不崩(裸目录 / tarball 解包场景)", () => {
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

  it("--pr-check:源分支领先目标分支 → 放行(正常 PR)", () => {
    git(["checkout", "-q", "-b", "feat/pr"]);
    writeFileSync(join(workdir, "feature.txt"), "feature\n");
    git(["add", "."]);
    git(["commit", "-qm", "feat: feature"]);
    const { code, output } = run(["--pr-check", "--target", "master"]);
    expect(code).toBe(0);
    expect(output).toContain("不在 master 上");
  });

  it("--pr-check:目标分支还在推进、源分支已归并它(CNB 预合并形态)→ 放行", () => {
    git(["checkout", "-q", "-b", "feat/pr"]);
    writeFileSync(join(workdir, "feature.txt"), "feature\n");
    git(["add", "."]);
    git(["commit", "-qm", "feat: feature"]);
    git(["checkout", "-q", "master"]);
    writeFileSync(join(workdir, "advance.txt"), "advance\n");
    git(["add", "."]);
    git(["commit", "-qm", "chore: advance"]);
    git(["checkout", "-q", "feat/pr"]);
    git(["merge", "--no-ff", "--no-edit", "-q", "master"]);
    const { code, output } = run(["--pr-check", "--target", "master"]);
    expect(code).toBe(0);
    expect(output).toContain("[branch-guard] OK");
  });

  it("--pr-check:源分支没有任何超出目标分支的提交 → 阻断(源分支就是 master)", () => {
    // 平台允许创建 source=master 的 PR,这正是本条要拦的场景。
    git(["checkout", "-q", "-b", "sync-with-master"]);
    const { code, output } = run(["--pr-check", "--target", "master"]);
    expect(code).toBe(1);
    expect(output).toContain("源分支就是 master");
    expect(output).toContain("git checkout -b");
  });

  it("--pr-check:取不到目标分支 → 保守放行,不误报", () => {
    const { code, output } = run(["--pr-check", "--target", "release/nope"]);
    expect(code).toBe(0);
    expect(output).toContain("保守放行");
  });

  it("--pr-check 缺省目标分支是 master(不靠环境变量,参数缺省也判得动)", () => {
    git(["checkout", "-q", "-b", "feat/pr"]);
    writeFileSync(join(workdir, "feature.txt"), "feature\n");
    git(["add", "."]);
    git(["commit", "-qm", "feat: feature"]);
    const { code, output } = run(["--pr-check"]);
    expect(code).toBe(0);
    expect(output).toContain("目标分支 master");
  });

  /* ── --merge-commit:master 的 push 事件复核 ───────────────────────── */

  it("--merge-commit:master 上的合并提交 → 放行(push 事件上 HEAD 就是合并提交)", () => {
    git(["checkout", "-q", "-b", "feat/merge-me"]);
    writeFileSync(join(workdir, "feature.txt"), "feature\n");
    git(["add", "."]);
    git(["commit", "-qm", "feat: feature"]);
    git(["checkout", "-q", "master"]);
    git(["merge", "--no-ff", "--no-edit", "-q", "feat/merge-me"]);
    const { code, output } = run(["--merge-commit"]);
    expect(code).toBe(0);
    expect(output).toContain("PR 合并提交");
  });

  it("--merge-commit:master 上的非合并提交 → 阻断(变更绕过了 PR)", () => {
    // 默认判据在 master 上也会拦,这条锁的是「push 复核形态也拦」——
    // 否则任何在 push 事件上调用它的流水线都会把每一条正常 PR 合并都判红
    //(平台侧流水线已删除,该形态暂无调用方,判据本身留着见规范 13.5.3)。
    const { code, output } = run(["--merge-commit"]);
    expect(code).toBe(1);
    expect(output).toContain("非合并提交");
    expect(output).toContain("绕过了 PR");
  });

  it("--merge-commit:工作分支上提交 → 放行(不误报)", () => {
    git(["checkout", "-q", "-b", "feat/push"]);
    const { code } = run(["--merge-commit"]);
    expect(code).toBe(0);
  });

  it("pre-commit 钩子把守卫放在第一步(顺序错了会先跑一堆必然白费的门禁)", () => {
    const hookPath = join(process.cwd(), ".githooks", "pre-commit");
    copyFileSync(hookPath, join(workdir, "pre-commit"));
    const text = readFileSync(hookPath, "utf8");
    const guardAt = text.indexOf("check-branch-guard.cjs");
    const structureAt = text.indexOf("check-file-structure.cjs");
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(structureAt);
  });
});
