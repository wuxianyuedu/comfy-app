/**
 * 提交门槛自检：黑盒跑 `scripts/check-merge-parents.mjs`，验证「合并提交必须双亲」真会阻断（§13.6.1 / ISSUE #1594）。
 * 必须真调 `git merge`：判据吃 `.git/MERGE_HEAD` 行数而非内存布尔，「拓扑错而树对」只有真合并+真解冲突才复现。
 * 覆盖：普通/真合并/`--amend`/正文含 "Merge branch"/非 git 目录放行；声明合并但单亲**阻断**并给重建出口；另钉钩子接线（§13.5.12）：`prepare-commit-msg` 真透传 `$1`/`$2`。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defineGateRepo, describe, type GateRepo } from "./helpers/gate-repo";
import { vi } from "vitest";

/* 每条用例都要真跑 git(init / add / commit / merge / checkout),负载高的机器上
 * 默认超时经常不够 —— 文件级放宽到 30s,只影响本文件。 */
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const SCRIPT = join(process.cwd(), "scripts", "check-merge-parents.mjs");

const { test, expect } = defineGateRepo({
  script: "check-merge-parents.mjs",
  /* 脚本用 `process.cwd()` 定位仓库(git 命令都在 cwd 里跑),落哪都一样,选 root。 */
  dir: "root",
  /* 本判据的被测输入是**消息文件 + 提交拓扑** —— 先造一个「master 上已有一个提交」
   * 的仓库,再按各条用例造分支与合并。 */
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

/** 造一个「解冲突后待提交」的合并现场:两条分支改了同一个文件。 */
function stageConflictingMerge(repo: GateRepo) {
  repo.git("checkout", "-q", "-b", "feat/merge-me");
  repo.write("seed.txt", "feature\n");
  repo.git("add", ".");
  repo.commit("feat: feature");
  repo.git("checkout", "-q", "master");
  repo.write("seed.txt", "master\n");
  repo.git("add", ".");
  repo.commit("chore: master");
  /* 冲突是预期内的:merge 会以非零退出,这里只要现场,不要它成功。 */
  try {
    repo.git("merge", "feat/merge-me");
  } catch {
    /* 冲突 → 正是要的现场 */
  }
  repo.write("seed.txt", "resolved\n");
  repo.git("add", "seed.txt");
}

/** 把一条提交信息写进消息文件,返回该文件路径。 */
function messageFile(repo: GateRepo, message: string): string {
  repo.write("msg.txt", message);
  return "msg.txt";
}

describe("check-merge-parents.mjs(合并提交必须双亲)", () => {
  test("普通提交(消息没声明是合并)→ 放行", ({ repo }) => {
    const { code, output } = repo.run([messageFile(repo, "chore: 顺手改一处")]);
    expect(code).toBe(0);
    expect(output).toContain("未声明是合并");
  });

  test("真合并提交(解冲突后 commit,MERGE_HEAD 在场)→ 放行", ({ repo }) => {
    stageConflictingMerge(repo);
    /* source=merge 是 git 在真合并时给的;消息形态也是 git 自己写的。 */
    const { code, output } = repo.run([messageFile(repo, "Merge branch 'feat/merge-me'"), "merge"]);
    expect(code).toBe(0);
    expect(output).toContain("2 个父提交");
  });

  test("消息声明是合并但只有一个父 → 阻断,并给出重建合并的出口", ({ repo }) => {
    stageConflictingMerge(repo);
    /* 回退现场:合并进行中 checkout / checkout -b / branch -f 会静默清掉 MERGE_HEAD,
     * 之后提交照常落成单亲。这里手工把 MERGE_HEAD 摘掉,等价于那次 checkout。 */
    repo.remove(".git/MERGE_HEAD");
    const { code, output } = repo.run([
      messageFile(repo, "Merge branch 'feat/merge-me'"),
      "message",
    ]);
    expect(code).toBe(1);
    expect(output).toContain("只有一个父提交");
    expect(output).toContain("MERGE_HEAD");
    expect(output).toContain("git merge --no-commit");
    expect(output).toContain("--no-verify");
  });

  test("--amend 一个合并提交 → 放行(source=commit,父提交从 HEAD 继承)", ({ repo }) => {
    /* 这条是**误报防线**:amend 一个合并提交时消息照样是 Merge…、MERGE_HEAD 也照样
     * 不在,只看消息 + MERGE_HEAD 会把真正来修合并信息的人 100% 拦下。 */
    repo.git("checkout", "-q", "-b", "feat/amend-me");
    repo.write("other.txt", "other\n");
    repo.git("add", ".");
    repo.commit("feat: other");
    repo.git("checkout", "-q", "master");
    repo.git("merge", "--no-ff", "--no-edit", "-q", "feat/amend-me");
    const { code, output } = repo.run([
      messageFile(repo, "Merge branch 'feat/amend-me'"),
      "commit",
    ]);
    expect(code).toBe(0);
    expect(output).toContain("source=commit");
  });

  test("正文里出现 Merge branch 不算声明(只认首行)→ 放行", ({ repo }) => {
    const { code, output } = repo.run([
      messageFile(repo, "fix: 修正一处\n\n顺带说明:原先的 Merge branch 写法是错的\n"),
    ]);
    expect(code).toBe(0);
    expect(output).toContain("未声明是合并");
  });

  test("消息文件取不到 → 放行(判据无从命中,不误报)", ({ repo }) => {
    const { code, output } = repo.run(["不存在的消息文件.txt"]);
    expect(code).toBe(0);
    expect(output).toContain("未声明是合并");
  });

  test("取不到 MERGE_HEAD 时按一个父算(单亲 + 合并消息 = 阻断)", ({ repo }) => {
    /* 与上面那条同源:本次提交的父数 = 1 + MERGE_HEAD 行数,没有它就是个父。 */
    const { code } = repo.run([messageFile(repo, "Merge remote-tracking branch 'origin/master'")]);
    expect(code).toBe(1);
  });
});

describe("check-merge-parents.mjs(非 git 目录 / 钩子接线)", () => {
  test("非 git 目录里不崩(裸目录 / tarball 解包场景)", () => {
    /* 这一条要的正是**没有 git** 的工作区,所以不走共享夹具(它的 setup 会 init 仓库)。
     * 自己造一个裸目录:判据取不到 git 事实时应放行,而不是抛错。 */
    const bare = mkdtempSync(join(tmpdir(), "merge-parents-nogit-"));
    try {
      copyFileSync(SCRIPT, join(bare, "check-merge-parents.mjs"));
      const output = execFileSync(process.execPath, [join(bare, "check-merge-parents.mjs")], {
        cwd: bare,
        encoding: "utf8",
      });
      expect(output).toContain("保守放行");
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  /* 这一条判的是**本仓库的钩子文件**,不搭临时仓库。 */
  test(".githooks/prepare-commit-msg 存在,且把 $1 / $2 透传给判据", () => {
    const hookPath = join(process.cwd(), ".githooks", "prepare-commit-msg");
    const text = readFileSync(hookPath, "utf8");
    /* 判据本体在 scripts/ 下;入口只做透传 —— 少传 $1 会让它退回默认的
     * COMMIT_EDITMSG,少传 $2 会让 --amend 那条误报防线失效,两者都是静默的。 */
    expect(text).toContain("scripts/check-merge-parents.mjs");
    expect(text).toContain('"$1"');
    expect(text).toContain('"$2"');
  });
});
