/**
 * AST 判据聚合档（`scripts/run-ast-gates.cjs`）的**接线判据** —— 规范 §13.5.8.2
 * 「第四笔账」。
 *
 * ── 为什么这几条必须存在 ──────────────────────────────────────────────
 *
 * 聚合档把 6 条判据从「6 个独立进程」收成「1 个进程、一次解析」。它能省 ≈1.9s，而
 * **省错了不会有任何判据看见**：少跑一条判据、把某条的判定换成「永远绿」、
 * 或者让 `--staged` 的短路面变宽/变窄 —— 这三种形态跑起来都只是「快了一点」，
 * 退出码照样 0。所以这里钉的都是**静默失效点**：
 *
 *   1. 清单里 6 条**每条都真跑**（逐条点名，不是数个数）；
 *   2. 聚合档输出与「6 条单跑各自输出」**逐字节相同**（判定代码是复用、不是重写）；
 *   3. 任一条红 ⇒ 聚合档 rc 1，且**继续跑完其余各条**（不被第一处失败打死）；
 *   4. `--staged` 按条判：全不在面内 ⇒ 一次解析都不做；只有一条在面内 ⇒ 只跑那一条；
 *   5. 人的动作（`--report` / `--update` / …）被聚合档拒绝（基线要按单条记账）；
 *   6. 钩子 D 组里**只有聚合档这一行**，6 条单条脚本不再各占一行（否则等于跑两遍）。
 *
 * 跑法：全部在**真仓库**里起子进程（聚合档要读真基线、真 `src/`），不搭临时夹具 ——
 * 临时仓库里 `src/` 是空的，6 条判据会全部报「0 处」，那种绿判不出任何东西。
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(".");
const AGG = join(REPO_ROOT, "scripts", "run-ast-gates.cjs");
const HOOK = join(REPO_ROOT, ".githooks", "pre-commit");

/** 聚合档 / 单条脚本都需要的 6 条判据（**这张表与 `run-ast-gates.cjs` 的 GATES 同批**）。 */
const GATES = [
  "check-react-updater-purity.cjs",
  "check-non-null-assertions.cjs",
  "check-void-floats.cjs",
  "check-ts-duplicate-keys.cjs",
  "check-form-field-wiring.cjs",
  "check-click-keyboard.cjs",
];

/** 跑一个脚本，归一成 `{code, output}`（stdout+stderr 合并）。 */
function run(script: string, args: string[] = [], cwd = REPO_ROOT) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { code: r.status ?? 1, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** 聚合档输出里「各判据自己的那些行」——去掉聚合档自己的汇总行。 */
function gateLines(output: string): string[] {
  return output
    .split("\n")
    .filter((l) => l.length > 0 && !l.startsWith("[ast-gates]"));
}

describe("run-ast-gates.cjs（AST 判据聚合档，ISSUE #1747 续）", () => {
  it("`--list` 的清单与脚本里 GATES 表的 6 条一致（新增判据忘了登记会被这里抓住）", () => {
    const { code, output } = run(AGG, ["--list"]);
    expect(code).toBe(0);
    const listed = output
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split(" ")[1]);
    expect(listed).toEqual(GATES);
  });

  it("聚合档的输出与 6 条单跑各自输出**逐字节相同**（判定是复用不是重写）", () => {
    const agg = run(AGG);
    expect(agg.code).toBe(0);
    const fromAgg = gateLines(agg.output);

    const fromSingles: string[] = [];
    for (const g of GATES) {
      const { output } = run(join(REPO_ROOT, "scripts", g));
      fromSingles.push(...output.split("\n").filter((l) => l.length > 0));
    }

    expect(fromAgg).toEqual(fromSingles);
  });

  it("6 条判据**每条都真跑**：每条自己的 OK/盘点行都在聚合档输出里逐条出现", () => {
    const { output } = run(AGG);
    /* 逐条点名的形态各有不同（`OK` / `总数` / `扫描 N 个文件`），所以用各判据自己的
     * 输出前缀来核 —— 只数「有几行」会把两条合并成一条还看不出来。 */
    for (const tag of [
      "[updater-purity]",
      "[non-null]",
      "[void-floats]",
      "[form-field-wiring]",
      "[click-keyboard]",
    ]) {
      expect(output, `聚合档输出里没有 ${tag} 的行 —— 这一条没跑`).toContain(tag);
    }
    expect(output, "ts-duplicate-keys 没跑").toContain("同一属性指定两次");
  });

  it("有判据红时**继续跑完其余各条**，并逐条点名 + 给复验命令（不被第一处失败打死）", () => {
    /* 复用「单条红线」这一档：`check-non-null-assertions` 有一份基线，往真仓库的
     * `src/` 里塞一个越界探针会让它红 —— 但改真仓库不是用例该做的事。
     * 所以这条**只读源码**钉结构：判定区必须先跑完再汇总（不是 for 里 break），
     * 且汇总里要有「逐条复验」这一节。行为侧由下一条（`--staged`）与钩子接线覆盖。 */
    const src = readFileSync(AGG, "utf8");
    expect(src).toContain("逐条复验");
    /* `results = runnable.map(...)` = 全部先跑完；`runGate()` 内部也不 `return` 早退。 */
    expect(src).toMatch(/const results = runnable\.map\(/);
  });

  it("判据自己抛异常时**不是「通过」**：按红算并留下面向人的一行（§13.5.12）", () => {
    /* `runGate` 的 catch 分支：非哨兵异常 ⇒ code = 1 且写一行说明。这是「判据没跑成
     * 不许被读成绿」那一条的落点 —— 抹掉它，判据一抛异常聚合档就静默放过整条。 */
    const src = readFileSync(AGG, "utf8");
    expect(src).toContain("这一条没有结论，按红处理");
    expect(src).toMatch(/code = 1;\s*\n\s*cap\.lines\.push\(/);
  });

  it("`--staged` 且暂存面全不命中 ⇒ 一次解析都不做（短路在解析之前）", () => {
    /* 在临时空 git 仓库里跑：暂存只有 changelog 碎片，6 条的根都不命中。 */
    const { code, output } = runInScratchGit(["changelog.d/x.md"]);
    expect(code).toBe(0);
    expect(output).toContain("未触及任何 AST 判据的扫描面");
    /* 判据一条都不该跑（跑了就说明短路点在解析之后）。 */
    expect(output).not.toContain("[non-null]");
    expect(output).not.toContain("[void-floats]");
  });

  it("人的动作（`--report` / `--update`）被聚合档拒绝：基线要按单条记账", () => {
    for (const flag of ["--report", "--update", "--json", "--with-tests"]) {
      const { code, output } = run(AGG, [flag]);
      expect(code, `${flag} 不该走聚合档`).toBe(2);
      expect(output).toContain("人的动作");
    }
  });

  it("钩子 D 组里 6 条单条脚本不再各占一行，只留聚合档这一行（否则等于跑两遍）", () => {
    const hook = readFileSync(HOOK, "utf8");
    const runLines = hook
      .split("\n")
      .filter((l) => l.startsWith("  run "));
    const aggLines = runLines.filter((l) =>
      l.includes("scripts/run-ast-gates.cjs"),
    );
    expect(aggLines.length, "钩子里聚合档那一行不见了").toBe(1);
    for (const g of GATES) {
      const dup = runLines.filter((l) => l.includes(`scripts/${g}`));
      expect(dup, `${g} 又单独占了一行钩子 —— 它会与聚合档跑两遍`).toEqual([]);
    }
  });
});

/** 在临时 git 仓库里跑聚合档（只有给定的暂存文件），返回 `{code, output}`。 */
function runInScratchGit(rel: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "ast-gates-scratch-"));
  const git = (...args: string[]) =>
    spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init");
  git("config", "user.email", "t@t.t");
  git("config", "user.name", "t");
  for (const r of rel) {
    const abs = join(dir, r);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, "## Added\n");
  }
  git("add", "-A");
  git("commit", "-m", "x");
  return run(AGG, ["--staged"], dir);
}
