/**
 * AST 判据聚合档（`scripts/run-ast-gates.cjs`）的**接线判据**——规范 §13.5.8.2「第四笔账」。聚合把 6 条判据从 6 个独立进程收成 1 个进程、一次解析（省 ≈1.9s），而省错了不会有任何判据看见：少跑一条、把某条判定换成「永远绿」、让 `--staged` 短路面变宽/变窄，跑起来都只是「快了一点」、退出码照样 0。所以钉的都是**静默失效点**：
 * 6 条逐条点名真跑（不是数个数）；输出与 6 条单跑**逐字节相同**（判定是复用不是重写）；任一条红 ⇒ rc 1 且继续跑完其余；`--staged` 按条判；`--report`/`--update` 等人为动作被拒（基线按单条记账）；钩子 D 组里只有聚合档这一行。
 * 全部在**真仓库**里起子进程，不搭临时夹具：临时仓库的 `src/` 是空的，6 条会全部报「0 处」，那种绿判不出任何东西。
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { gitSandboxEnv } from "./helpers/git-sandbox-env";
import { copyGateDeps } from "./helpers/gate-repo";

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
function run(script: string, args: Array<string> = [], cwd = REPO_ROOT) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { code: r.status ?? 1, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** 聚合档输出里「各判据自己的那些行」——去掉聚合档自己的汇总行。 */
function gateLines(output: string): Array<string> {
  return output.split("\n").filter((l) => l.length > 0 && !l.startsWith("[ast-gates]"));
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
    /* 输入面**故意收窄到探针**（ISSUE #1747「C 组第五笔账」）：早期在**真仓库**上跑全量 `src/`（1082 份 / 7.3MB），6 条判据**全是绿的** —— 只走过 `OK` 分支，
     * 违规分支、点名话术、退出码这些最该被对拍的一半一次没走到；实测墙钟 4.76s，大头是 6 次「require typescript + walk + createSourceFile 全量」。
     * 换成「临时仓库 + 6 条各自的违规探针」后两边只解析 1–3 份文件：更便宜（4.76s → 约 1.1s）、更强（5 条走违规分支、1 条走基线缺失档）。
     * 等式本身（同一份输入 ⇒ 两边逐字节相同）没有改变，改变的是**喂什么输入**；判据的扫描根由脚本自己的 `__dirname/..` 决定，所以把脚本与探针
     * 一起放进临时仓库就够（与 `tests/form-field-wiring-gate.test.ts` 同一个样板）。 */
    const repo = probeRepo();
    const agg = repo.run(["scripts/run-ast-gates.cjs"]);
    const fromAgg = gateLines(agg.output);

    const fromSingles: Array<string> = [];
    for (const g of GATES) {
      const { output } = repo.run([`scripts/${g}`]);
      fromSingles.push(...output.split("\n").filter((l) => l.length > 0));
    }

    expect(fromAgg).toEqual(fromSingles);
    /* 对拍**不许在两边都空转**：全空也「逐字节相同」。至少要有一条真走了违规分支
     * （探针就是为它准备的），否则这条等式会退化成「两个空输出相等」。 */
    expect(fromAgg.join("\n")).toContain("违规");

    /* 上面那次的输入让 5 条红 ⇒ 聚合档会打**失败收尾段**（`逐条复验` + 每条的复验命令）。
     * 这一段是聚合档自己的输出，所以每一行都必须带 `[ast-gates]` 前缀 —— 否则
     * `gateLines()` 会把它们算进「判定代码的输出」而对拍失败。早期形态正是
     * 「首行带前缀 + 续行缩进」，而老输入面（真仓库全量、永远全绿）走不到这一段，
     * 于是一个只在**失败档**才出现的对拍差异**从未被发现**。 */
    const lines = agg.output.split("\n");
    const head = lines.findIndex((l) => l.includes("逐条复验"));
    expect(head, "失败收尾段不见了 —— 探针没让任何判据红？").toBeGreaterThanOrEqual(0);
    /* 收尾段 = 「逐条复验」那一行 + 紧随其后的复验命令行（形态固定：
     * `  node scripts/<判据脚本>`）。**只认这一段**，不要拿 `node scripts/check-` 泛匹配 ——
     * 判据自己的输出里也有「先跑 node scripts/check-*.cjs --update」这类提示行，
     * 泛匹配会把它们一起圈进来（实测撞到过）。 */
    const tail = lines.slice(head).filter((l) => l.trim() !== "");
    const cmds = tail.filter((l) => /^\[ast-gates\]\s+node scripts\/\S+\.cjs$/.test(l));
    expect(cmds.length, "复验命令一行都没有").toBeGreaterThan(0);
    for (const line of tail) {
      expect(
        line.startsWith("[ast-gates]"),
        `聚合档的收尾行没有 [ast-gates] 前缀，会被对拍当成判据自己的输出：${line}`,
      ).toBe(true);
    }
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
    /* 复用「单条红线」这一档：往真仓库的 `src/` 里塞一个越界探针会让
     * `check-non-null-assertions`（存量已清零的硬闸）红 —— 但改真仓库不是用例该做的事。
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
    const runLines = hook.split("\n").filter((l) => l.startsWith("  run "));
    const aggLines = runLines.filter((l) => l.includes("scripts/run-ast-gates.cjs"));
    expect(aggLines.length, "钩子里聚合档那一行不见了").toBe(1);
    for (const g of GATES) {
      const dup = runLines.filter((l) => l.includes(`scripts/${g}`));
      expect(dup, `${g} 又单独占了一行钩子 —— 它会与聚合档跑两遍`).toEqual([]);
    }
  });
});

/** 在临时 git 仓库里跑聚合档（只有给定的暂存文件），返回 `{code, output}`。 */
function runInScratchGit(rel: Array<string>) {
  const dir = mkdtempSync(join(tmpdir(), "ast-gates-scratch-"));
  const git = (...args: Array<string>) =>
    spawnSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      env: gitSandboxEnv(),
    });
  git("init");
  git("config", "user.email", "t@t.t");
  git("config", "user.name", "t");
  /* 宿主可能全局开着 `commit.gpgsign` 而没有可用密钥 —— 夹具不许假定读者的
   * git 配置（台账 R12-01 / ISSUE #1817），就地关掉签名。 */
  git("config", "commit.gpgsign", "false");
  git("config", "tag.gpgsign", "false");
  for (const r of rel) {
    const abs = join(dir, r);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, "## Added\n");
  }
  git("add", "-A");
  git("commit", "-m", "x");
  return run(AGG, ["--staged"], dir);
}

/**
 * 搭一个「只含违规探针」的临时仓库，把 6 条判据 + 聚合档 + 它们的同目录依赖一起放进去。对拍要在**真判据、真基线、真判定代码**上比等式，而真仓库的全量 `src/` 让等式只在**全绿**输入成立（违规分支一次都走不到）；判据的扫描根由脚本自己的 `__dirname/..` 决定，所以「脚本落 `scripts/`、探针落 `src/`」这一份布局就足以扫到东西。
 * 探针按每条判据各自的违规形态构造（一条覆盖一条判据，互不干扰）：`a.tsx` → updater-purity 函数式 updater 里的副作用裸调用；`b.ts` → non-null `!` 断言（无基线）；`c.ts` → void-floats `void someFn()`；`d.ts` → ts-duplicate-keys 重复键；`e.tsx` → form-field-wiring `<FormField>` plain-children；`f.tsx` → click-keyboard 非原生元素挂 `onClick` 无键等价物。
 * `typescript` 靠 `NODE_PATH` 指回本仓库（与 `ratchet-update-guards` 的 `AST_ENV` 同一招）：这 6 条走 CJS `require`，`NODE_PATH` 对它们是有效的。
 */
function probeRepo(): {
  run: (argv: Array<string>) => { code: number; output: string };
} {
  const dir = mkdtempSync(join(tmpdir(), "ast-gates-probe-"));
  const scriptsDir = join(dir, "scripts");
  mkdirSync(scriptsDir, { recursive: true });
  for (const name of ["run-ast-gates.cjs", ...GATES]) {
    const dest = join(scriptsDir, name);
    copyFileSync(join(REPO_ROOT, "scripts", name), dest);
    /* 递归带上 `./gate-scan-read.cjs` / `./gate-ast-read.cjs` 这类同目录依赖 ——
     * 判据新增一个同目录依赖时，只要它走 `./name.cjs` 形态就会自动被带过来。 */
    copyGateDeps(dest);
  }
  const probes: Record<string, string> = {
    "src/components/a.tsx":
      "export function A() { const [v, setV] = useState(0); setV((p) => { sideEffect(); return !p; }); return v; }\n",
    "src/lib/b.ts": "export const f = (s: string | null) => s!.length;\n",
    "src/lib/c.ts": "export function g() { void someFn(); }\n",
    "src/lib/d.ts": "export const o = { k: 1, k: 2 };\n",
    "src/components/e.tsx": 'export const E = () => <FormField label="x"><input /></FormField>;\n',
    "src/components/f.tsx": "export const F = () => <div onClick={() => go()}>x</div>;\n",
  };
  for (const [rel, content] of Object.entries(probes)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return {
    run: (argv) => {
      const r = spawnSync(process.execPath, [join(dir, argv[0]!), ...argv.slice(1)], {
        cwd: dir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, NODE_PATH: join(REPO_ROOT, "node_modules") },
      });
      return {
        code: r.status ?? 1,
        output: `${r.stdout ?? ""}${r.stderr ?? ""}`,
      };
    },
  };
}
