/**
 * `tests/helpers/probe-worktree.ts` 的用例（ISSUE #2665）：其失效形态都是静默的（克隆没建成、脏文件没带进去、
 * 登记没注销），只会让用例给出假结论。三条各钉一格：① 脏形状逐项进克隆（未跟踪目录须展开 --porcelain 的
 * 目录记录）；② `worktree add` 中途抛错必须注销登记；③ 建不出来不许静默退回真实树。全程在临时夹具仓库上跑。
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGateRepo, type GateRepo, type GateRepoHandle } from "./helpers/gate-repo.ts";
import { createProbeTree, type ProbeTree } from "./helpers/probe-worktree.ts";

/** 夹具只需要一个「存在的最小 git 仓」，不跑任何判据脚本 —— 这份 script 只用来落 `scripts/` 那格。 */
const FIXTURE_SCRIPT = "check-doc-references.cjs";

function worktreeLines(cwd: string): string {
  return execFileSync("git", ["worktree", "list"], { cwd, encoding: "utf8" });
}

describe("createProbeTree —— 一次性克隆带进工作树的脏，且不留登记", () => {
  let fixture: GateRepoHandle;
  let tree: ProbeTree | null = null;

  beforeAll(() => {
    fixture = createGateRepo({
      script: FIXTURE_SCRIPT,
      /* `git init` 走夹具的 `setup` 这一层（与 `tests/check-branch-guard.test.ts` 同一形）：
       * 共享件里配好了身份与 `commit.gpgsign=false`，自己抄一遍最容易漏的就是后者。 */
      setup: (repo: GateRepo) => {
        repo.git("init", "-q", "-b", "master", ".");
      },
      files: {
        "docs/kept.md": "# 已提交的基线\n",
        "docs/dirty.md": "# 提交里的那一版\n",
        "docs/gone.md": "# 会被删掉\n",
      },
    });
    const repo = fixture.repo;
    /* `commit()` 刻意不替调用点 `git add`（暂存粒度本身是被测形状，见 gate-repo 那句注释），
     * 所以这里要自己把夹具文件加进去再落第一次提交。 */
    repo.git("add", "-A");
    repo.commit("base");
    /* 四种形状各造一格：改 / 新建未跟踪文件 / 全新未跟踪**目录** / 删掉已提交的那份。 */
    repo.write("docs/dirty.md", "# 工作树里正在改的那一版\n");
    repo.write("docs/fresh.md", "# 全新未跟踪\n");
    repo.write("docs/newdir/inside.md", "# 新目录里的新文档\n");
    repo.remove("docs/gone.md");
  });

  afterAll(() => {
    tree?.dispose();
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- beforeAll 失败时 fixture 仍未赋值，teardown 照样会跑，保留 ?.
    fixture?.dispose();
  });

  it("脏的四种形状都按各自的样子进克隆（真实树一字不动）", () => {
    tree = createProbeTree(fixture.repo.dir);
    const dir = tree.dir;
    /* 改过的那份：克隆里必须是工作树那一版，不是 HEAD 那一版 —— 判据读的就是这一格。 */
    expect(readFileSync(join(dir, "docs/dirty.md"), "utf8")).toContain("正在改的那一版");
    /* 未跟踪的新文件与新**目录**里的文件：目录那格单独钉，porcelain 只给一条目录记录。 */
    expect(readFileSync(join(dir, "docs/fresh.md"), "utf8")).toContain("全新未跟踪");
    expect(readFileSync(join(dir, "docs/newdir/inside.md"), "utf8")).toContain("新目录里的新文档");
    /* 真实树里已删的那份，克隆里也不能在。 */
    expect(existsSync(join(dir, "docs/gone.md"))).toBe(false);
    /* 已提交而没动的照旧在（克隆不是只带脏文件）。 */
    expect(readFileSync(join(dir, "docs/kept.md"), "utf8")).toContain("已提交的基线");
    /* 点名清单：四条都该在里面（它是出问题时第一个要看的东西）。 */
    expect(tree.carried.join("\n")).toMatch(/docs\/dirty\.md/);
    expect(tree.carried.join("\n")).toMatch(/docs\/fresh\.md/);
    expect(tree.carried.join("\n")).toMatch(/dir docs\/newdir/);
    expect(tree.carried.join("\n")).toMatch(/D docs\/gone\.md/);
    /* 造克隆**不动**来源工作树：那份脏还是脏，没有被「顺手还原」。 */
    expect(fixture.repo.read("docs/dirty.md")).toContain("正在改的那一版");
    expect(fixture.repo.exists("docs/fresh.md")).toBe(true);
  });

  it("dispose 之后：登记与临时目录都没了（不留在仓库上）", () => {
    /* 用守卫而不是 `!`：上一条没建成就是本文件的 bug，这里要**带着那句话**失败，
     * 而不是拿一个断言把 null 抹掉（抹掉之后 `dir` 是 undefined，测试会以另一种形态红）。 */
    if (!tree) {
      throw new Error("上一条没建出克隆，这条就没有可验的对象");
    }
    const dir = tree.dir;
    /* 比较一律用**规范化后的完整路径**：`git worktree list` 在 Windows 上打的是
     * `G:/Temp/...` 形，而 Node 给的是反斜杠形。也不要拿 "tree" 这种子串去认 ——
     * 夹具路径本身就叫 `…-gate-XXXX`，那一句会恒真（本文件第一版就是这么写的）。 */
    const asGitPath = (p: string): string => p.replaceAll("\\", "/");
    const listed = worktreeLines(fixture.repo.dir);
    expect(listed).toContain(asGitPath(dir));
    tree.dispose();
    expect(worktreeLines(fixture.repo.dir)).not.toContain(asGitPath(dir));
    expect(existsSync(dir)).toBe(false);
    /* 登记目录也清空了：留在 `.git/worktrees/` 里的那条会让之后每个人 `git worktree list`
     * 都看见一个指向不存在路径的幽灵。 */
    const left = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: fixture.repo.dir,
      encoding: "utf8",
    })
      .split("\n")
      .filter((l) => l.startsWith("worktree"))
      .map((l) => l.slice("worktree ".length).trim());
    expect(left).toEqual([asGitPath(fixture.repo.dir)]);
    tree = null;
  });

  it("② 中途抛错也不把登记留在仓库上（注入一记会炸的落盘口）", () => {
    const before = worktreeLines(fixture.repo.dir);
    expect(() =>
      createProbeTree(fixture.repo.dir, {
        copyFile: () => {
          throw new Error("注入的落盘失败");
        },
      }),
    ).toThrow(/注入的落盘失败/);
    /* 关键断言不是「抛了」，是**没有多出一条没被注销的登记**：只数 worktree 行的条数，
     * 不按名字找 —— 名字是随机临时目录，按名字找的那句会永远为真。 */
    const after = worktreeLines(fixture.repo.dir);
    expect(after.split("\n").filter(Boolean).length).toBe(
      before.split("\n").filter(Boolean).length,
    );
  });

  it("③ 建不出来时抛，而不是退回真实树", () => {
    const notARepo = mkdtempSync(join(tmpdir(), "probe-tree-not-a-repo-"));
    try {
      expect(() => createProbeTree(notARepo)).toThrow(/不退回真实树/);
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
  });
});
