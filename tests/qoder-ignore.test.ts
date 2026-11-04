/**
 * `scripts/qoder-ignore.mjs`（`.qoderignore` 唯一写出者）判据（#2712）：索引器不吃 `.gitignore`、只吃 `.qoderignore`，工具固化「哪些树贵」的发现。
 * 判的是两份文本（入库 `.qoderignore` ⇄ 工具渲染）；它不被任何 import，漂了不是红而是「装了等于没装」——别人跑一次只会得到更窄的表（同 #2574、#2599 进固定清单）。
 * 逐行相等只保证一致、不保证够宽（删一半 `IGNORE_SECTIONS` 仍然绿），故另立 `MUST_COVER` 钉「哪些树必须排除」（最重的几棵 + 私有输入），不钉行形状。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "./helpers/strip-comments";
import { defineGateRepo, expectGateRan } from "./helpers/gate-repo";
import { IGNORE_SECTIONS, diffIgnore, renderIgnore } from "../scripts/qoder-ignore.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

/** 工具自己渲染的那一份（所有比对的唯一基准，不在此重抄一遍内容）。 */
const WANTED = renderIgnore();

/** 必须被排除的树 —— 删掉其中任何一条，索引就贵回去（这条是「够宽」那一半）。 */
const MUST_COVER = [
  "/node_modules/",
  "/.next/",
  "/coverage/",
  "/src-tauri/target/",
  "/python-venv/",
  "/log/",
  "/data/",
  "/docs/api/",
  /* 两个代码索引工具自己的工作区目录：它们是**检索工具本身的产物**，再被索引一遍
   * 既没意义又让「索引为什么这么贵」重新长回来（ISSUE #2762）。 */
  "/.codegraph/",
  "/.zvec-grep/",
  /* 入库的那两条：正文与源逐字重复（镜像）或纯历史（归档），它们在检索面里常驻
   * 就等于让每一次文档检索都命中两份 —— 见 ISSUE #2761。 */
  "/docs/generated/",
  "/CHANGELOG-archive.md",
];

function diskIgnore(): string {
  return readFileSync(path.join(ROOT, ".qoderignore"), "utf8");
}

function scriptSource(): string {
  return readFileSync(path.join(ROOT, "scripts", "qoder-ignore.mjs"), "utf8");
}

describe("渲染出的形状：每条排除都带着它的理由", () => {
  it("每一个 pattern 的上一行就是它的 why（没有理由的排除会被下一个人删掉）", () => {
    const lines = WANTED.split("\n");
    for (const { entries } of IGNORE_SECTIONS) {
      for (const { pattern, why } of entries) {
        expect(why.trim(), `模式 ${pattern} 没有理由`).not.toBe("");
        const at = lines.indexOf(pattern);
        expect(at, `渲染结果里没有这一行：${pattern}`).toBeGreaterThan(-1);
        expect(lines[at - 1], `#${pattern} 的上一行不是它的 why`).toBe(`# ${why}`);
      }
    }
  });

  it("分组名以注释行出现，读者能看出这份表分了几件事", () => {
    for (const { section } of IGNORE_SECTIONS) {
      expect(WANTED.split("\n"), `缺少分组注释：${section}`).toContain(`# ${section}`);
    }
  });

  it("头注回答了三件事：谁写的、怎么刷新、改了要怎么生效", () => {
    const head = WANTED.split("\n").slice(0, 12).join("\n");
    expect(head).toContain("pnpm qoder:ignore");
    expect(head).toContain("--check");
    expect(head).toContain("重启 Qoder CN");
  });

  it("头注不许自称「列出的目录本来都被 .gitignore 忽略着」—— 入库那一组会推翻它", () => {
    /* 那句话在这份表只有构建产物时是真的，而它的失效方式很坏：读者拿它当结论，
     * 看到一条 git 跟踪的路径被排除，就判成「漏配」并删掉那条。所以头注现在要
     * 显式回答「入库但只出索引」这件事，而不是一句话把两组混成一组。 */
    const head = WANTED.split("\n").slice(0, 14).join("\n");
    expect(head).not.toContain("本来也都被 .gitignore 忽略着");
    expect(head).toContain("只出索引");
  });

  it("入库那一组的「入库」是事实：git 确实跟踪这些路径", () => {
    /* 反向也判：若它们哪天不再入库（镜像出库、归档被拆走），这条排除就是在藏一份
     * 不存在的产物，该整条删掉 —— 而不是留一句会过期的理由占着排除面。 */
    for (const one of ["docs/generated", "CHANGELOG-archive.md"]) {
      const out = execFileSync("git", ["-c", "core.quotePath=false", "ls-files", "-z", "--", one], {
        cwd: ROOT,
        encoding: "utf8",
      });
      expect(
        out.split("\0").filter(Boolean).length,
        `${one} 并不入库 —— 那这一条排除该归到「构建产物」那一组，或直接删掉`,
      ).toBeGreaterThan(0);
    }
  });

  it("产物里没有绝对体积读数（那是「这台机器、这一刻」的数）", () => {
    expect(WANTED).not.toMatch(/\d+(?:[.,]\d+)?\s*(?:GB|MB|KB)/i);
  });
});

describe("入库那份 ⇄ 工具会写的那份", () => {
  it("盘上的 .qoderignore 与渲染结果逐字相同（漂移时给出增删行数）", () => {
    const disk = diskIgnore();
    const delta = diffIgnore(disk, WANTED);
    expect(
      delta.same,
      `.qoderignore 与工具输出不一致：+${delta.added.length} / -${delta.removed.length}\n${[
        ...delta.added.map((l) => `  + ${l}`),
        ...delta.removed.map((l) => `  - ${l}`),
      ].join("\n")}\n修法：pnpm qoder:ignore 后把结果一并提交（人别手改产物）`,
    ).toBe(true);
  });

  it("那份表确实**入库**了（否则「拿到仓库执行一下」这句话不成立）", () => {
    /* 守卫按 tests/git-path-quoting.test.ts 的口径带上（`-z` + `core.quotePath=false`）：
     * 这里读的是**输出的路径本身**，不是只看退出码。 */
    const out = execFileSync(
      "git",
      ["-c", "core.quotePath=false", "ls-files", "-z", "--", ".qoderignore"],
      { cwd: ROOT, encoding: "utf8" },
    );
    expect(out.split("\0").filter(Boolean)).toContain(".qoderignore");
  });

  it("覆盖面不窄于 MUST_COVER（一致判据只证「同步」，这一条证「够宽」）", () => {
    const patterns = IGNORE_SECTIONS.flatMap((s) => s.entries.map((e) => e.pattern));
    for (const one of MUST_COVER) {
      expect(patterns, `排除表不再覆盖 ${one}`).toContain(one);
    }
  });

  it("渲染是幂等的：同一份数据第二次渲染不出任何差异", () => {
    expect(diffIgnore(WANTED, renderIgnore()).same).toBe(true);
  });

  it("pnpm 出口在册：写/刷新 与 只比对 各一条，且都指向这一份脚本", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["qoder:ignore"]).toBe("node scripts/qoder-ignore.mjs");
    expect(pkg.scripts["qoder:ignore:check"]).toBe("node scripts/qoder-ignore.mjs --check");
  });
});

describe("它只写仓库根那一份，不碰别人的本地 git 状态", () => {
  it("代码里只有一处落盘，落点是 HERE（唯一的写出者）", () => {
    const code = stripComments(scriptSource());
    expect(code.match(/writeFileSync\(/g) ?? []).toHaveLength(1);
    expect(code).toMatch(/fs\.writeFileSync\(HERE,\s*wanted/);
  });

  it("`.git/info/exclude` 只出现在说明里，不在代码里", () => {
    /* 剥注释后还能命中，就说明真有一处往别人的本地 exclude 写东西 —— 那是每台机器
     * 自己的文件，工具跑在谁身上都不该改变他的本地配置。 */
    expect(stripComments(scriptSource())).not.toMatch(/info[/\\]exclude/);
    expect(scriptSource()).toContain(".git/info/exclude");
  });
});

/* ── 三态退出码：0 绿 / 1 不一致 / 2 没跑成 ──────────────────────────────── */

const { test } = defineGateRepo({
  script: "qoder-ignore.mjs",
  workdir: "2712-qoder-ignore",
});

test("缺文件时 --check 退 1 并明说是「不存在」而不是「内容不同」", ({ repo }) => {
  const r = repo.run(["--check"]);
  expectGateRan(r);
  expect(r.code, r.output).toBe(1);
  expect(r.raw.stderr).toContain("文件不存在");
  expect(repo.exists(".qoderignore"), "--check 不许落盘").toBe(false);
});

test("--print 只打到标准输出，一个字节都不落盘", ({ repo }) => {
  const r = repo.run(["--print"]);
  expectGateRan(r);
  expect(r.code, r.output).toBe(0);
  expect(r.raw.stdout).toBe(WANTED);
  expect(repo.exists(".qoderignore")).toBe(false);
});

test("默认档写出内容，第二次跑念「没动任何字节」（幂等 = 不写第二遍）", ({ repo }) => {
  const first = repo.run();
  expectGateRan(first);
  expect(first.code, first.output).toBe(0);
  expect(first.raw.stdout).toContain("已生成");
  expect(repo.read(".qoderignore")).toBe(WANTED);

  const second = repo.run();
  expectGateRan(second);
  expect(second.code, second.output).toBe(0);
  expect(second.raw.stdout).toContain("没动任何字节");
  expect(repo.read(".qoderignore")).toBe(WANTED);

  const checked = repo.run(["--check"]);
  expectGateRan(checked);
  expect(checked.code, checked.output).toBe(0);
});

test("手改产物 ⇒ --check 退 1 并报出增删；默认档刷回来", ({ repo }) => {
  repo.run();
  repo.write(".qoderignore", `${WANTED.replace("/node_modules/", "# 有人手删了一条")}\n`);
  const drift = repo.run(["--check"]);
  expectGateRan(drift);
  expect(drift.code, drift.output).toBe(1);
  expect(drift.raw.stderr).toContain("内容与工具输出不一致");
  expect(drift.raw.stderr).toContain("1 增 / 1 删");

  const fixed = repo.run();
  expectGateRan(fixed);
  expect(fixed.code, fixed.output).toBe(0);
  expect(fixed.raw.stdout).toContain("已刷新");
  expect(repo.read(".qoderignore")).toBe(WANTED);
});

test("写不进去退 2，且失败路上不念任何成功话术", ({ repo }) => {
  /* 把落点做成一个**目录**：读它失败（进 missing 分支）、写它也失败 ⇒ 走的是
   * 「这一档没有结论」那条出口，既不是绿也不该被读成红。 */
  repo.mkdir(".qoderignore");
  const r = repo.run();
  expectGateRan(r);
  expect(r.code, r.output).toBe(2);
  expect(r.raw.stderr).toContain("没跑成");
  /* 退 2 不是绿：成功话术（已生成 / 已刷新 / 没动任何字节）一条都不许出现在这一跑里。
   * 「拿不到测量」被读成「测量结果是绿的」是这一族最重的失效（规范 §13.6.4）。 */
  for (const success of ["已生成", "已刷新", "没动任何字节"]) {
    expect(r.raw.stdout, `退 2 的一跑里念了成功话术：${success}`).not.toContain(success);
  }
});
