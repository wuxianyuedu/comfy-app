/**
 * `merge-changelog-fragments.mjs` 的并入落点（规范 §13.10.6）。
 *
 * 落点此前是**硬编的**：脚本无条件找 `## [Unreleased]` 那一行、把碎片贴在它正下方。
 * 后果是「碎片并入哪一段」取决于并的那一刻仓库是什么状态，与条目**实际属于哪个版本**
 * 无关 —— 而这一格此前一个判据都没有（`check-changelog-fragments.cjs` 只管碎片形态）。
 *
 * 现在落点由**来源锚**决定：挑锚最早的那个待发段落，并把锚刷新成「本轮新增条目里
 * 最早的那一个」。这四件事各有一条用例：
 *   ① 锚最早者优先（不是「文件里排最上面的那个」）；
 *   ② 锚刷新（旧锚不留第二行，且刷成 `--anchor` 给的那个）；
 *   ③ 段落本来没有锚时补上、标题在 `--release` 之外不动；
 *   ④ **锚解析不出提交时在落盘之前就拦下**（并进去之后再发现，账上已经多了一条
 *      查不到出处的记录）。
 *
 * ⚠️ 用例走**真子进程 + 真临时 git 仓库**：脚本的落点判据要 `git cat-file` 解析锚，
 * 而「锚解析不出」那一档是它自己的失败路径 —— 用假的 git 就等于在测另一个东西。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { gitSandboxEnv } from "./helpers/git-sandbox-env";

const SCRIPT = path.resolve(import.meta.dirname, "../scripts/merge-changelog-fragments.mjs");
const tempDirs: Array<string> = [];

/** 造一个临时「仓库」：脚本 + CHANGELOG.md + 若干碎片，并 `git init` 出一次提交。 */
function fixture(
  changelog: string,
  fragments: Record<string, string>,
): {
  exists: (rel: string) => boolean;
  head: string;
  read: (rel: string) => string;
  root: string;
  run: (args?: Array<string>) => { ok: boolean; output: string };
} {
  const root = mkdtempSync(path.join(tmpdir(), "merge-changelog-"));
  tempDirs.push(root);
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  mkdirSync(path.join(root, "changelog.d"), { recursive: true });
  copyFileSync(SCRIPT, path.join(root, "scripts", path.basename(SCRIPT)));
  writeFileSync(path.join(root, "CHANGELOG.md"), changelog);
  for (const [name, body] of Object.entries(fragments)) {
    writeFileSync(path.join(root, "changelog.d", name), body);
  }
  const git = (...args: Array<string>) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: gitSandboxEnv(),
    });
  git("init", "-q", ".");
  git("add", "-A");
  git(
    "-c",
    "commit.gpgsign=false",
    "-c",
    "user.email=t@e.com",
    "-c",
    "user.name=t",
    "commit",
    "-qm",
    "init",
  );
  const head = git("rev-parse", "--short", "HEAD").trim();
  return {
    root,
    head,
    run: (args: Array<string> = []) => {
      try {
        return {
          ok: true,
          output: execFileSync(
            process.execPath,
            [path.join(root, "scripts", path.basename(SCRIPT)), ...args],
            { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          ),
        };
      } catch (err) {
        const e = /* SAFETY: 类型断言已复核 */ err as { stderr?: string; stdout?: string; };
        return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
      }
    },
    read: (rel: string) => readFileSync(path.join(root, rel), "utf8"),
    exists: (rel: string) => {
      try {
        readFileSync(path.join(root, rel));
        return true;
      } catch {
        return false;
      }
    },
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * 两个带锚的待发段落：`## [未发布]`（锚**较早**、但在文件里排在后面）与
 * `## [Unreleased]`（锚较晚）—— 于是「落点由锚决定」与「落点是文件里第一个」
 * 给出**不同的**答案，用例才真的在判前者。
 *
 * ⚠️ 两个待发段落只能是这两种写法：带日期的 `## [x.y.z] - <日期>` **不算待发**
 * （见 `merge-changelog-fragments.mjs` 的 `isPendingTitle`）—— 那是「已切出去的那
 * 一版」，往里记新条目等于把变更记进一个日期属于过去的版本里。
 */
function twoAnchoredSections(): string {
  return [
    "# 更新日志",
    "",
    "## [Unreleased]",
    "<!-- since: bbb2222 — 较晚的那一批 -->",
    "",
    "### Added",
    "",
    "- 锚较晚的那一段里的条目。",
    "",
    "## [未发布]",
    "<!-- since: aaa1111 — 较早的那一批 -->",
    "",
    "### Added",
    "",
    "- 锚较早的那一段里的条目。",
    "",
    "## [0.1.0] - 2026-08-31",
    "",
    "首个版本基线。",
    "",
  ].join("\n");
}

describe("merge-changelog —— 落点由来源锚决定", () => {
  it("并入**锚最早**的待发段落（不是文件里排最上面的那个）", () => {
    const f = fixture(twoAnchoredSections(), {
      "1693-new.md": "## Fixed\n\n- 新条目 C。\n",
    });
    const res = f.run(["--anchor", f.head]);
    expect(res.ok, res.output).toBe(true);
    /* `aaa1111` < `bbb2222` ⇒ 落到 `[未发布]` 那一段（它在文件里排在**后面**）。 */
    const text = f.read("CHANGELOG.md");
    const atEarlier = text.indexOf("- 锚较早的那一段里的条目。");
    expect(atEarlier).toBeGreaterThan(0);
    expect(text.slice(atEarlier)).toContain("- 新条目 C。");
    /* 落点**不是**文件里第一个待发段落（`[Unreleased]`）—— 它那条链里没有新条目。 */
    const unreleasedSeg = text.slice(text.indexOf("## [Unreleased]"), text.indexOf("## [未发布]"));
    expect(unreleasedSeg).not.toContain("- 新条目 C。");
  });

  it("锚刷新成 `--anchor` 给的提交，且旧锚不留第二行", () => {
    const f = fixture(twoAnchoredSections(), {
      "1693-new.md": "## Fixed\n\n- 新条目 C。\n",
    });
    const res = f.run(["--anchor", f.head]);
    expect(res.ok, res.output).toBe(true);
    const text = f.read("CHANGELOG.md");
    expect(text).toContain(`<!-- since: ${f.head} — 较早的那一批 -->`);
    /* 那一段原来那一行锚被替换掉了，段落里不会有第二条 `since:`。 */
    const seg = text.slice(text.indexOf("## [未发布]"), text.indexOf("## [0.1.0]"));
    expect(seg.match(/since:/g)?.length).toBe(1);
    /* 另一段的锚**不动**（那一段这一轮没有新条目）。 */
    expect(text).toContain("<!-- since: bbb2222 — 较晚的那一批 -->");
  });

  it("段落本来没有锚时补上，且 `[Unreleased]` 的标题不因为是它而改动", () => {
    const f = fixture(
      ["# 更新日志", "", "## [Unreleased]", "", "### Added", "", "- 旧条目。", ""].join("\n"),
      { "1693-new.md": "## Fixed\n\n- 新条目 C。\n" },
    );
    const res = f.run(["--anchor", f.head]);
    expect(res.ok, res.output).toBe(true);
    const text = f.read("CHANGELOG.md");
    expect(text).toContain("## [Unreleased]");
    expect(text).toContain(`<!-- since: ${f.head} —`);
  });

  it("碎片被删掉（并入是「搬运」而不是「复制」）", () => {
    const f = fixture(twoAnchoredSections(), {
      "1693-new.md": "## Fixed\n\n- 新条目 C。\n",
    });
    f.run(["--anchor", f.head]);
    expect(f.exists("changelog.d/1693-new.md")).toBe(false);
  });

  it("`--release` 把落点那一段定版、并把 `--anchor` 写进锚", () => {
    const f = fixture(twoAnchoredSections(), {
      "1693-new.md": "## Fixed\n\n- 新条目 C。\n",
    });
    const res = f.run(["--release", "0.3.0", "--anchor", f.head]);
    expect(res.ok, res.output).toBe(true);
    const text = f.read("CHANGELOG.md");
    /* 锚最早那一段（`[未发布]`）被定版成 `[0.3.0] - <今天>`，`[Unreleased]` 原样留着。 */
    expect(text).not.toContain("## [未发布]");
    expect(text).toMatch(/## \[0\.3\.0\] - \d{4}-\d{2}-\d{2}/);
    expect(text).toContain("## [Unreleased]");
  });
});

describe("merge-changelog —— 锚是「来源」而不是「随便一个字符串」", () => {
  it("`--anchor` 指一个不存在的提交 ⇒ **落盘之前**就退非零，CHANGELOG 不动", () => {
    const before = twoAnchoredSections();
    const f = fixture(before, { "1693-new.md": "## Fixed\n\n- 新条目 C。\n" });
    const res = f.run(["--anchor", "deadbee"]);
    expect(res.ok).toBe(false);
    expect(res.output).toContain("解析不出提交");
    expect(f.read("CHANGELOG.md")).toBe(before);
    expect(f.exists("changelog.d/1693-new.md")).toBe(true);
  });

  it("`--anchor` 不是提交对象（给了日期）⇒ 退非零", () => {
    const f = fixture(twoAnchoredSections(), {
      "1693-new.md": "## Fixed\n\n- 新条目 C。\n",
    });
    const res = f.run(["--anchor", "2026-10-01"]);
    expect(res.ok).toBe(false);
    expect(res.output).toContain("必须是一个提交对象");
  });

  it("`--check` 一个文件都不写（含锚）", () => {
    const before = twoAnchoredSections();
    const f = fixture(before, { "1693-new.md": "## Fixed\n\n- 新条目 C。\n" });
    const res = f.run(["--check", "--anchor", f.head, "--json"]);
    expect(res.ok, res.output).toBe(true);
    expect(f.read("CHANGELOG.md")).toBe(before);
    expect(f.exists("changelog.d/1693-new.md")).toBe(true);
    expect(res.output).toContain('"anchor"');
  });

  it("一个待发段落都没有 ⇒ 报错而不是「静默什么都不做」", () => {
    /* 只有带日期的版本段落 —— 它是**已发布**的那一版，往里记新条目等于把变更记进
     * 一个日期属于过去的版本里（口径见 `isPendingTitle`）。 */
    const f = fixture("# 更新日志\n\n## [0.1.0] - 2026-08-31\n\n基线。\n", {
      "1693-new.md": "## Fixed\n\n- 新条目 C。\n",
    });
    const res = f.run(["--anchor", f.head]);
    expect(res.ok).toBe(false);
    expect(res.output).toContain("找不到待发段落");
  });
});

describe("merge-changelog —— 缺省锚取当前 HEAD", () => {
  it("不给 `--anchor` 时用 HEAD（碎片是随那次改动一起写的）", () => {
    const f = fixture(twoAnchoredSections(), {
      "1693-new.md": "## Fixed\n\n- 新条目 C。\n",
    });
    const res = f.run();
    expect(res.ok, res.output).toBe(true);
    expect(f.read("CHANGELOG.md")).toContain(`<!-- since: ${f.head} — 较早的那一批 -->`);
  });
});
