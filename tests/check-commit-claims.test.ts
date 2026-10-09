/**
 * 「提交信息里的声明 ⇄ 那次提交的事实」的契约测试（ISSUE #1605 / 规范 §11.23）。
 *
 * 这一族的立案现场是 `ad81a912`：提交信息自称「`master` 新增的 §13.5.13 / §13.6.3
 * 两节与各处插记照旧保留」，而那次提交的树里两节**一次都不出现**，62 份文件被退回。
 * 「声明写得出来不算数，读的人在跑才算」—— 这句 §11.23 的口径此前管的是
 * 「判据 / 台账 / 用例 annotation」，本条是它的**新载体**：声明写在提交信息里。
 *
 * ── 为什么在**真 git 仓库**上跑（不用 mock）──────────────────────────────
 *
 * 本判据的全部输入是**git 的对象数据库**：那次提交的树、那份信息、那份 diff 名单。
 * 内存里假装这三件事，等于把「核对」这件事重新实现一遍（而它唯一的失效形态正是
 * 「拿错了一次提交的事实」）。所以夹具 `git init` + 真提交，脚本走真 `git show`。
 *
 * ── 覆盖：每一条都对应一个**实测踩过的**坑，不是对称性洁癖 ─────────────
 *
 *   ① **立案现场那一句要红**（`§x.y 照旧保留` + 该节不在树里）；
 *   ② **同一句里并列的多个章节各算一条**（`ad81a912` 是 `§13.5.13 / §13.6.3`
 *      一起没了；只报一个会让「这句说反了」看起来只涉及一半）；
 *   ③ **折行**要能拼回一句（`git log --format=%B` 里 `§13.5.13 /` 与
 *      `§13.6.3 两节…保留` 分在两行 —— 逐行匹配会只看见后者）；
 *   ④ 窗口里**只许连接物**：`§16.2.4.57）。 「双击重命名」保留` 那类跨小句的
 *      「保留」不许命中（第一版自由窗口在真历史上 8 处误报，误报的判据活不过评审）；
 *   ⑤ 语序 B（`保留 … §x.y`）要认；
 *   ⑥ **扫整棵规范目录**，不是「这次改了哪些文档」—— 后者方向反了：提交没碰那份
 *      文档时那一节当然还在，而它不在改动名单里，于是被判成「不出现」（实测 2 处假红）；
 *   ⑦ `git ls-tree` 的**非 ASCII 路径转义**要处理（默认按 C 风格转义加引号，
 *      名单会**静默变空** ⇒ 每一句「保留」都读成「不出现」；实测 4 处假红）；
 *   ⑧ 路径声明要过「该提交的树里真的存在这个路径」那一关
 *      （`60/68.75/75rem` 会被形状匹配读成路径，而它说的是 CSS 宽度值）；
 *   ⑨ 「跑不起来」（脚本不在）与「跑了且红」分开 —— 前者不构成「说反话」的证据。
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, test as vitestTest } from "vitest";

import { defineGateRepo, type GateRepo } from "./helpers/gate-repo";
import { extractClaims } from "../scripts/check-commit-claims.mjs";

const { test, expect: repoExpect } = defineGateRepo({
  script: "check-commit-claims.mjs",
  dirs: ["docs/standards", "src"],
  workdir: "commit-claims",
  /* 夹具就绪后 `git init` 一个空仓库：本判据的被测输入就是**提交对象**
   * （树 / 信息 / diff 名单），没有提交历史它无从判起。 */
  setup: (repo) => {
    repo.git("init", "-q", "-b", "main", ".");
  },
});

/** 夹具的工作区句柄（`GateRepo` 由共享夹具导出，见 §11.16.1）。 */
type Repo = GateRepo;

/**
 * 把当前工作区的全部改动提交上去。
 *
 * 夹具自带的 `repo.commit` 只调 `git commit`（不 `add`）—— 它服务的是
 * 「提交拓扑」那类判据（`check-branch-guard` 显式 `add` 一次），而本判据每一步
 * 都是「写文件 → 提交 → 再写 → 再提交」，所以这里补一层 `add -A` 的本地包装，
 * 不去改共享夹具（那是 §11.16.1 的连带面，理由不足就别动）。
 */
function commitAll(repo: Repo, message: string): void {
  repo.git("add", "-A");
  repo.commit(message);
}

/** 规范文档的最小骨架：判据只认 `#… <号> ` 这个标题形态。 */
function docWith(...sections: string[]): string {
  return sections.map((n) => `### ${n} 某节标题\n\n正文。\n`).join("\n");
}

/* ── ① 立案现场：那句反事实的声明必须红 ───────────────────────────── */

test("§x.y 照旧保留 而该节不在那次提交的树里 → 红", ({ repo }) => {
  repo.write("docs/standards/13-提交与-code-review.md", docWith("13.5.12"));
  commitAll(repo, "feat: 某次改动");
  repo.write("src/a.ts", "export const a = 1;\n");
  commitAll(
    repo,
    "feat: 收掉一批红\n\nmaster 新增的 §13.5.13 / §13.6.3 两节照旧保留。",
  );

  const { code, output } = repo.run(["--commit", "HEAD"]);
  repoExpect(code).toBe(1);
  repoExpect(output).toContain("§13.5.13");
  repoExpect(output).toContain("§13.6.3");
  repoExpect(output).toContain("一次都不出现");
});

test("声明与该节一致时 → 绿", ({ repo }) => {
  repo.write(
    "docs/standards/13-提交与-code-review.md",
    docWith("13.5.13", "13.6.3"),
  );
  commitAll(repo, "docs: 补两节");
  repo.write("src/a.ts", "export const a = 2;\n");
  commitAll(
    repo,
    "feat: 某次改动\n\nmaster 新增的 §13.5.13 / §13.6.3 两节照旧保留。",
  );

  const { code, output } = repo.run(["--commit", "HEAD"]);
  repoExpect(code).toBe(0);
  repoExpect(output).toContain("都与事实一致");
});

/* ── ② / ③ 并列章节各算一条、折行拼回一句 ─────────────────────────── */

test("同一句里并列的两个章节各报一条（不是只报一个）", ({ repo }) => {
  repo.write("docs/standards/13-提交与-code-review.md", docWith("13.5.12"));
  commitAll(repo, "docs: 起点");
  repo.write("src/a.ts", "export const a = 3;\n");
  commitAll(repo, "feat: 某次改动\n\n§13.5.13 / §13.6.3 两节照旧保留。");

  const { code, output } = repo.run(["--commit", "HEAD", "--json"]);
  repoExpect(code).toBe(1);
  const parsed = JSON.parse(output) as {
    verdict: string;
    audits: Array<{
      rows: Array<{ claim: { target: string }; verdict: string }>;
    }>;
  };
  repoExpect(parsed.verdict).toBe("contradicted");
  const targets = parsed.audits[0]!.rows.filter(
    (r) => r.verdict === "contradicted",
  )
    .map((r) => r.claim.target)
    .sort();
  repoExpect(targets).toEqual(["13.5.13", "13.6.3"]);
});

test("折行的提交信息要能拼回一句（`§13.5.13 /` 与 `§13.6.3 两节…保留` 分两行）", ({
  repo,
}) => {
  repo.write("docs/standards/13-提交与-code-review.md", docWith("13.5.12"));
  commitAll(repo, "docs: 起点");
  repo.write("src/a.ts", "export const a = 4;\n");
  commitAll(
    repo,
    "feat: 某次改动\n\nmaster 新增的 §13.5.13 /\n§13.6.3 两节照旧保留。",
  );

  const { code, output } = repo.run(["--commit", "HEAD"]);
  repoExpect(code).toBe(1);
  repoExpect(output).toContain("§13.6.3");
});

/* ── ④ 窗口只许连接物：跨小句的「保留」不许命中 ────────────────────── */

test("`）。 「双击重命名」保留` 那类跨小句的「保留」不算声明", ({ repo }) => {
  repo.write("docs/standards/16-某章.md", docWith("16.2.4.57"));
  commitAll(repo, "docs: 起点");
  repo.write("src/a.ts", "export const a = 5;\n");
  commitAll(
    repo,
    "feat: 某次改动\n\n§16.2.4.57）。 「双击重命名」保留双击，另补 Enter / F2。",
  );

  const { code, output } = repo.run(["--commit", "HEAD"]);
  repoExpect(code).toBe(0);
  repoExpect(output).toContain("都与事实一致");
});

test("`§11.14，…新增 §11.15，…。 保留` 跨句号的那条不算声明", ({ repo }) => {
  repo.write("docs/standards/11-测试.md", docWith("11.14", "11.15"));
  commitAll(repo, "docs: 起点");
  repo.write("src/a.ts", "export const a = 6;\n");
  commitAll(
    repo,
    "feat: 某次改动\n\n§11.14，本 PR 在文末新增 §11.15，两侧无实质重叠。 保留",
  );

  const { code } = repo.run(["--commit", "HEAD"]);
  repoExpect(code).toBe(0);
});

/* ── ⑤ 语序 B：`保留 … §x.y` ─────────────────────────────────────── */

test("语序 B（`保留 master 新增的 §11.24`）也要核", ({ repo }) => {
  repo.write("docs/standards/11-测试.md", docWith("11.23"));
  commitAll(repo, "docs: 起点");
  repo.write("src/a.ts", "export const a = 7;\n");
  commitAll(repo, "feat: 某次改动\n\n并保留 master 新增的 §11.24 与表三行。");

  const { code, output } = repo.run(["--commit", "HEAD"]);
  repoExpect(code).toBe(1);
  repoExpect(output).toContain("§11.24");
});

/* ── ⑥ 扫整棵规范目录，不是「这次改了哪些文档」 ───────────────────── */

test("提交**没碰**那份文档时，那一节仍在（不得判成「不出现」）", ({ repo }) => {
  repo.write("docs/standards/11-测试.md", docWith("11.15"));
  commitAll(repo, "docs: 起点");
  /* 这次提交与规范文档毫无关系 —— 老实现（只扫改动文件）会在这里假红。 */
  repo.write("src/a.ts", "export const a = 8;\n");
  commitAll(repo, "feat: 某次改动\n\n保留 §11.15，生成物重新生成。");

  const { code, output } = repo.run(["--commit", "HEAD"]);
  repoExpect(code).toBe(0);
  repoExpect(output).toContain("都与事实一致");
});

test("非 ASCII 文档名要读得出来（`ls-tree` 的路径转义会静默把名单变空）", ({
  repo,
}) => {
  /* 文件名带中文是**本仓库的常态**（`11-测试与可观测性.md`）。`git ls-tree` 默认
   * 按 C 风格转义加引号，处理不当会让规范文档名单变成 0 份 ⇒ 每句「保留」都读成
   * 「不出现」（实测 4 处假红，而输出看起来完全正常）。 */
  repo.write("docs/standards/11-测试与可观测性.md", docWith("11.24"));
  commitAll(repo, "docs: 起点（中文文件名）");
  repo.write("src/a.ts", "export const a = 9;\n");
  commitAll(repo, "feat: 某次改动\n\n保留 master 新增的 §11.24。");

  const { code, output } = repo.run(["--commit", "HEAD"]);
  repoExpect(code).toBe(0);
  repoExpect(output).toContain("都与事实一致");
});

/* ── ⑦ 路径声明：要真的存在这个路径 ─────────────────────────────── */

test("`60/68.75/75rem … 一个数字都没动` 不是路径声明（树里没有这个路径）", ({
  repo,
}) => {
  repo.write("src/a.ts", "export const a = 10;\n");
  commitAll(
    repo,
    "feat: 收口宽度\n\n60/68.75/75rem = 从前的 960/1100/1200，一个数字都没动。",
  );

  const { code, output } = repo.run(["--commit", "HEAD"]);
  repoExpect(code).toBe(0);
  repoExpect(output).toContain("没有可机械核对的声明");
});

test("`src/a.ts 没动` 而它在这条提交的 diff 里 → 红", ({ repo }) => {
  repo.write("src/a.ts", "export const a = 11;\n");
  commitAll(repo, "chore: 起点");
  repo.write("src/a.ts", "export const a = 12;\n");
  commitAll(repo, "feat: 某次改动\n\nsrc/a.ts 一个字没动，只是顺手过一遍。");

  const { code, output } = repo.run(["--commit", "HEAD"]);
  repoExpect(code).toBe(1);
  repoExpect(output).toContain("没动");
});

/* ── ⑧ 没点名的「N 处收到 0」不判 ──────────────────────────────── */

test("计数归零点名了执行者才核；没点名的（散文）不成声明", ({ repo }) => {
  repo.write("src/a.ts", "export const a = 13;\n");
  commitAll(repo, "feat: 收口\n\n故事面 args 判据的 6 处误报收到 0。");

  const { code } = repo.run(["--commit", "HEAD"]);
  /* 无从复算（点名的不是脚本路径 / 钩子标签）⇒ 不构成「说反话」的证据。 */
  repoExpect(code).toBe(0);
});

/* ── ⑨ 跑不起来 ≠ 说反话 ────────────────────────────────────────── */

test("取不到那个提交 → 退出码 2（核对过程本身失败，与「声明说反话」分开）", ({
  repo,
}) => {
  repo.write("src/a.ts", "export const a = 14;\n");
  commitAll(repo, "feat: 起点");

  const { code, output } = repo.run(["--commit", "deadbeefdeadbeef"]);
  repoExpect(code).toBe(2);
  repoExpect(output).toContain("取不到要审的提交");
});

/* ── 纯函数：句式抽取（不碰 git，两种语序与「不出现」）───────────── */

describe("extractClaims 的句式口径", () => {
  /* 这些格只需要「形状」，所以给一个空 commit —— `extractClaims` 只有在
   * 路径那一类上才碰树（那一类由上面那些真仓库用例覆盖）。 */
  const NO_TREE = "";

  vitestTest("语序 A 的三种关键词都认（照旧保留 / 仍保留 / 保留）", () => {
    for (const kw of ["照旧保留", "仍保留", "保留"]) {
      const claims = extractClaims(`§13.6.3 两节${kw}`, NO_TREE);
      expect(claims.map((c) => c.target)).toEqual(["13.6.3"]);
    }
  });

  vitestTest("`不出现` 是**反向**断言（章节必须缺席）", () => {
    const claims = extractClaims("§11.24 那一节不出现", NO_TREE);
    expect(claims).toHaveLength(1);
    expect(claims[0]!.expectAbsent).toBe(true);
  });

  vitestTest("`master 新增的` / `各处插记` 这类连接物允许出现在窗口里", () => {
    const claims = extractClaims(
      "并保留 master 新增的 §11.24 与声明⇄读者表三行",
      NO_TREE,
    );
    expect(claims.map((c) => c.target)).toEqual(["11.24"]);
  });

  vitestTest("同一句里并列的章节各出一条（去重靠「原句 + 目标」）", () => {
    const claims = extractClaims("§13.5.13 / §13.6.3 两节照旧保留", NO_TREE);
    expect(claims.map((c) => c.target).sort()).toEqual(["13.5.13", "13.6.3"]);
    /* 语序 B 的正则也会命中同一句 ⇒ 不能因此多出一条。 */
    expect(claims).toHaveLength(2);
  });

  vitestTest("注释行（`#` 开头，git 模板）不算声明", () => {
    expect(extractClaims("# §1.1 照旧保留", NO_TREE)).toHaveLength(0);
  });

  vitestTest("窗口外的「保留」不算声明（跨小句 / 跨句号）", () => {
    for (const line of [
      "§16.2.4.57）。 「双击重命名」保留双击",
      "§11.14，新增 §11.15，无重叠。 保留",
      "§2.7.1 裁决存量 8 处为「全部保留",
    ]) {
      expect(extractClaims(line, NO_TREE)).toHaveLength(0);
    }
  });
});

/* ── 真历史回归：立案现场那一笔必须被认出来 ─────────────────────── */

describe("真历史（本仓库）", () => {
  /** 本仓库根（`tests/` 的上一级）—— 只读，不写。 */
  const REPO_ROOT = path.resolve(import.meta.dirname, "..");
  const SCRIPT = path.join(REPO_ROOT, "scripts", "check-commit-claims.mjs");

  /** 某个提交在本仓库里存在且可达（浅克隆 / 别的检出里跳过）。 */
  function hasCommit(rev: string): boolean {
    try {
      execFileSync("git", ["rev-parse", "--verify", `${rev}^{commit}`], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return true;
    } catch {
      return false;
    }
  }

  vitestTest.skipIf(!hasCommit("ad81a912"))(
    "ad81a912 那句「§13.5.13 / §13.6.3 两节照旧保留」被判成反事实",
    () => {
      let out = "";
      let code = 0;
      try {
        out = execFileSync(process.execPath, [SCRIPT, "--commit", "ad81a912"], {
          cwd: REPO_ROOT,
          encoding: "utf8",
        });
      } catch (err) {
        const e = err as { status?: number; stdout?: string; stderr?: string };
        code = e.status ?? -1;
        out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
      }
      expect(code).toBe(1);
      expect(out).toContain("§13.5.13");
      expect(out).toContain("§13.6.3");
    },
  );
});
