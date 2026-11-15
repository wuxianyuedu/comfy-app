/**
 * 判据 ⇄ 执行者的双向判据（ISSUE #1451 要求 2 / 规范 §13.5.12）。三向缺一即摆设：①判定型脚本无执行者 ⇒ 红
 * （现场 `check-comment-language.cjs` 自称供钩子调用、文档也说它在报红，却一个执行者都没有）；②报告型脚本
 * 自称「供 pre-commit 调用」⇒ 红（报告档按定义恒 exit(0)，承诺必假；文档说谎而全绿比漏报更难发现）；③台账
 * 双向拦：登记了却其实有执行者 ⇒ 红（台账是负债，不是赦免名单）。用例在临时区拷真脚本跑（本仓临时文件会被并行 C 组 `vitest run` 看见）；临时区只放判据脚本，不放 `quality-gate.mjs` / `.githooks/` / `package.json`。 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { defineGateRepo, describe } from "./helpers/gate-repo";
import { isRecord, isUnknownArray } from "~/lib/is-record";

const REPO_ROOT = process.cwd();
const SCRIPT_NAME = "check-gate-executors.cjs";

/** 判据脚本的识别口径与脚本自身保持一致（前缀族）。 */
const GATE_PREFIXES = [
  "check-",
  "tw4-",
  "report-",
  "render-doc-placeholders",
  "lib-node-only-scan",
];

/**
 * 把判据脚本本体拷进临时工作区的 `scripts/`（台账由用例自己写）。为什么不用夹具的 `copy` 整目录灌 `scripts/`：
 * 那会把 `quality-gate.mjs` / `quality-gate.ps1` 带进来，而它们是本判据的**执行者来源**（`.githooks/` 与
 * `package.json` 同族）；它们一出现，「某个探针一个执行者都没有」这一档就被喂成「有执行者」，用例测的东西
 * 当场变成别的东西 —— 所以这里的过滤是**判据语义的一部分**，不是图省事。 */
function copyGateScripts(repo: { dir: string }): void {
  const srcScripts = join(REPO_ROOT, "scripts");
  const dstScripts = join(repo.dir, "scripts");
  mkdirSync(dstScripts, { recursive: true });
  for (const entry of readdirSync(srcScripts)) {
    const isGate = /\.(?:cjs|mjs)$/.test(entry) && GATE_PREFIXES.some((p) => entry.startsWith(p));
    if (isGate) {
      copyFileSync(join(srcScripts, entry), join(dstScripts, entry));
    }
  }
}

const { test, expect } = defineGateRepo({
  script: SCRIPT_NAME,
  workdir: "gate-executors",
  setup: (repo) => {
    copyGateScripts(repo);
    /* 台账原样带上（临时区里它就是「当前台账」）。共用扫描读取器 `gate-scan-read.cjs` 以 `gate-` 而非
     * `check-` 开头，`copyGateScripts` 的前缀循环不会带它；缺了它本判据会以 `MODULE_NOT_FOUND` 崩在临时区
     * 里，读起来像「台账判据坏了」，实际是夹具少一个文件。它由夹具的 `copyGateDeps` 自动补齐（沿脚本的
     * `require("./x.cjs")` 递归），所以这里不必再抄一遍。 */
    copyFileSync(
      join(REPO_ROOT, "scripts", ".gate-executor-ledger.json"),
      join(repo.dir, "scripts", ".gate-executor-ledger.json"),
    );
    /* 空执行者来源：`.githooks/`、`package.json`、`tests/` 都不建 ——
     * 那正是「无执行者」这一档成立的前提。 */
  },
});
describe("判据执行者台账（ISSUE #1451 要求 2）", () => {
  test("本仓库原样应通过：按需召唤那些条在册为按需召唤", () => {
    // 在真仓库根跑（不建临时区）：这条断言的对象是「本仓库当前的判据-执行者关系」，
    // 而临时区里没有 `.githooks/` / `package.json` / `tests/`，所有靠它们当执行者的
    // 脚本都会被判成无执行者 —— 那是用例环境的问题，不是仓库的问题。
    const output = execFileSync(process.execPath, [join(REPO_ROOT, "scripts", SCRIPT_NAME)], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    /* 条数从台账现算，不写死：写死一份计数就等于再造一条「加了条目忘了改数」的
     * 会漂的判据（同一族先例见 #2135 那次钩子步数被钉死）。 */
    /* 台账用运行时守卫收窄，不走 `as` 断言（B5 清账）。 */
    const onDemand: unknown = JSON.parse(
      readFileSync(join(REPO_ROOT, "scripts", ".gate-executor-ledger.json"), "utf8"),
    );
    if (!isRecord(onDemand) || !isRecord(onDemand.onDemand)) {
      throw new Error("台账形状不对（缺 onDemand）");
    }
    expect(output).toContain(`按需召唤 ${Object.keys(onDemand.onDemand).length}`);
    expect(output).toContain("报告型自称在跑 0");
  });

  test("① 判定型脚本无执行者且未登记 ⇒ 红并点名", ({ repo }) => {
    repo.write(
      "scripts/check-probe-orphan.cjs",
      `#!/usr/bin/env node\n// @ts-nocheck -- 探针\nconsole.log("probe");\nprocess.exit(0);\n`,
    );
    const { code, output } = repo.run();
    expect(code, "判定型无执行者必须阻断").toBe(1);
    expect(output).toContain("check-probe-orphan.cjs");
    expect(output).toContain("一个执行者都没有");
  });

  test("② 报告型脚本自称「供 .githooks/pre-commit 调用」 ⇒ 红", ({ repo }) => {
    // 0 处 process.exit = 报告型；头部那句承诺按定义是假的。
    repo.write(
      "scripts/check-probe-report.cjs",
      `#!/usr/bin/env node\n// @ts-nocheck -- 探针(供 .githooks/pre-commit 调用)\n/** 报告型探针。 */\nconsole.log("report");\n`,
    );
    const { code, output } = repo.run();
    expect(code, "报告型自称在跑必须阻断").toBe(1);
    expect(output).toContain("check-probe-report.cjs");
    expect(output).toContain("报告型");
  });

  test("③ 台账登记了却其实有执行者 ⇒ 红（台账不是赦免名单）", ({ repo }) => {
    // 造一个执行者来源，让 `check-probe-orphan` 真的有执行者，
    // 同时它又在台账里登记着 —— 双向拦的第二个方向。
    repo.write(
      "scripts/check-probe-orphan.cjs",
      `#!/usr/bin/env node\n// @ts-nocheck -- 探针\nconsole.log("probe");\nprocess.exit(0);\n`,
    );
    repo.write(
      "package.json",
      JSON.stringify({
        scripts: { probe: "node scripts/check-probe-orphan.cjs" },
      }),
    );
    // 把它加进台账（读原台账、补一条）。
    repo.write(
      "scripts/.gate-executor-ledger.json",
      JSON.stringify({
        onDemand: {
          "check-probe-orphan.cjs": { why: "探针", who: "探针" },
        },
      }),
    );
    const { code, output } = repo.run();
    expect(code, "有执行者却仍登记必须阻断").toBe(1);
    expect(output).toContain("有执行者");
  });

  test("台账双向误报的锚点：测试只**读**脚本文本不算执行者，真 **spawn** 才算", ({ repo }) => {
    // 判据自身的坑：`tests/tw4-canonical-ratchet.test.ts` 用 readFileSync 读两份
    // canonical 脚本、断言 `--check` 分支还在 —— 若「测试里出现脚本名」就算执行者，
    // 那两个棘轮会被判成「有执行者」，台账双向判定把两条正当的按需召唤登记报成负债。
    // 这里把两种测试各造一份，断言只有**真起子进程**的那份算执行者。
    repo.write(
      "scripts/check-probe-a.cjs",
      `#!/usr/bin/env node\n// @ts-nocheck -- 探针\nconsole.log("a");\nprocess.exit(0);\n`,
    );
    repo.write(
      "scripts/check-probe-b.cjs",
      `#!/usr/bin/env node\n// @ts-nocheck -- 探针\nconsole.log("b");\nprocess.exit(0);\n`,
    );
    // 只读文本的测试（不算执行者）
    repo.write(
      "tests/read-only.test.ts",
      `import { readFileSync } from "node:fs";\n` +
        `export const x = readFileSync("scripts/check-probe-a.cjs", "utf8");\n`,
    );
    // 真起子进程的测试（算执行者）
    repo.write(
      "tests/real-spawn.test.ts",
      `import { execFileSync } from "node:child_process";\n` +
        `export const run = () => execFileSync(process.execPath, ["scripts/check-probe-b.cjs"]);\n`,
    );
    const { code, output } = repo.run();
    // a 只有「读文本」的测试 ⇒ 仍是无执行者 ⇒ 红并点名
    expect(code).toBe(1);
    expect(output, "只读文本的测试不算执行者").toContain("check-probe-a.cjs");
    // b 有真 spawn 的测试 ⇒ 有执行者 ⇒ 不点名
    expect(output, "真起子进程的测试算执行者").not.toContain("check-probe-b.cjs");
  });

  test("台账里的孤儿条目（脚本已不存在）⇒ 红", ({ repo }) => {
    repo.write(
      "scripts/.gate-executor-ledger.json",
      JSON.stringify({
        onDemand: {
          "check-already-deleted.cjs": { why: "探针", who: "探针" },
        },
      }),
    );
    const { code, output } = repo.run();
    expect(code, "台账条目改名 / 删除后必须摘掉").toBe(1);
    expect(output).toContain("check-already-deleted.cjs");
  });

  test("`--report` 只盘点、不判失败（供排批次用）", ({ repo }) => {
    repo.write(
      "scripts/check-probe-orphan.cjs",
      `#!/usr/bin/env node\n// @ts-nocheck -- 探针\nconsole.log("probe");\nprocess.exit(0);\n`,
    );
    const { code, output } = repo.run(["--report"]);
    expect(code, "--report 是盘点档").toBe(0);
    expect(output).toContain("check-probe-orphan.cjs");
  });
});
describe("pre-commit D 组的在位判据（ISSUE #1451 要求 2）", () => {
  const hook = (): string => readFileSync(join(REPO_ROOT, ".githooks", "pre-commit"), "utf8");

  /** D 组步骤 = `  run "<标签>" <命令>`（与同族用例同款解析，不许 toContain）。 */
  const steps = (): Array<{ cmd: string; label: string }> =>
    [...hook().matchAll(/^ {2}run "(?<label>[^"]+)" (?<cmd>.+)$/gm)].map((m) => ({
      label: m.groups?.label ?? "",
      cmd: m.groups?.cmd ?? "",
    }));

  test("「判据执行者台账」这一步真在 D 组里（被注掉的行不算在场）", () => {
    expect(steps().find((s) => s.cmd.includes("scripts/check-gate-executors.cjs"))).toEqual({
      label: "判据执行者台账",
      cmd: "node scripts/check-gate-executors.cjs",
    });
  });

  test("「TS 重复属性判定」所在的 AST 判据聚合档这一步真在 D 组里", () => {
    /* 这一条原本钉的是 `check-ts-duplicate-keys.cjs` 单独占一行。ISSUE #1747 续
     * （§13.5.8.2「第四笔账」）把它连同另外 5 条 AST 判据收进聚合档
     * `run-ast-gates.cjs` —— 6 条共享一次解析。判据的**执行者**因此从
     * 「这 6 行」变成「这 1 行」，本用例跟着改靶子（钉的还是同一件事：
     * 这一步的 flag 层面不许漂）。 */
    expect(steps().find((s) => s.cmd.includes("scripts/run-ast-gates.cjs"))).toEqual({
      label: "AST 判据聚合（6 条共享一次解析）",
      // `--staged` = 输入面跳过（按条透传，口径见 §13.5.8.2）。逐字相等的口径
      // 保留（这一族的价值就是「flag 层面也不许漂」）。
      cmd: "node scripts/run-ast-gates.cjs --staged",
    });
  });

  test("被聚合档接管的 6 条不再单独占一行（否则与聚合档各跑一遍）", () => {
    for (const script of [
      "check-react-updater-purity.cjs",
      "check-non-null-assertions.cjs",
      "check-void-floats.cjs",
      "check-ts-duplicate-keys.cjs",
      "check-form-field-wiring.cjs",
      "check-click-keyboard.cjs",
    ]) {
      expect(
        steps()
          .filter((s) => s.cmd.includes(`scripts/${script}`))
          .map((s) => s.label),
        `${script} 又单独占了一行 —— 它会与聚合档各跑一遍，白付一次解析`,
      ).toEqual([]);
    }
  });

  test("旧报告档名不再被任何地方引用（改名后没留孤儿）", () => {
    // `report-ts-duplicate-keys.mjs` 已收成判定档 `check-ts-duplicate-keys.cjs`。
    // 旧名残留会让「按文档跑」的人跑一个不存在的文件。
    expect(hook()).not.toContain("report-ts-duplicate-keys");
  });
});

/**
 * 扫描面本身（ISSUE #1444 残活 A）：靶子是判据自己的覆盖面 —— 旧口径只看名字前缀，`shell-gate.mjs` /
 * `storybook-check.mjs` 等真在门禁链里跑却不叫 `check-` 的判据不在盘点里，自报份数与真值不符；而「覆盖面与
 * 自称的不符」正是 #1451 的立案现场，所以这里逐份钉住**门禁链事实**。⚠️ 这几条必须在真仓库根跑：临时区没有
 * `.githooks/` / `quality-gate.*`，链口径恒为空，在那里测等于测「前缀口径还在不在」。 */
describe("扫描面 = 门禁链事实 ∪ 名字族（ISSUE #1444 残活 A）", () => {
  /** 在**真仓库根**跑判据（不经临时区）。 */
  const runInRepo = (args: Array<string> = []): string =>
    execFileSync(process.execPath, [join(REPO_ROOT, "scripts", SCRIPT_NAME), ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  /**
   * 门禁链「步骤位置」里出现的 `scripts/<x>` basename（三个来源，与判据同口径）。
   * 只读步骤位置、不读全文 —— 全文会把散文里的 `x.cjs` 占位符也带进来。
   */
  const chainScripts = (): Array<string> => {
    const out = new Set<string>();
    const collect = (text: string): void => {
      for (const mm of text.matchAll(/scripts[\\/]+(?<name>[A-Za-z0-9_.-]+\.(?:cjs|mjs))/g)) {
        out.add(mm.groups?.name ?? "");
      }
    };
    const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), "utf8");
    for (const m of read(".githooks/pre-commit").matchAll(/^ {2}run "[^"]+" (?<cmd>.+)$/gm)) {
      collect(m.groups?.cmd ?? "");
    }
    for (const m of read("scripts/quality-gate.mjs").matchAll(/args:\s*\[(?<body>[^\]]*)\]/g)) {
      collect(m.groups?.body ?? "");
    }
    for (const m of read("scripts/quality-gate.ps1").matchAll(/Args\s*=\s*@\((?<body>[^)]*)\)/g)) {
      collect(m.groups?.body ?? "");
    }
    return [...out];
  };

  test("四份「名字不叫 check- 但在门禁链里跑」的判据确实被数进去了", () => {
    const output = runInRepo(["--report"]);
    // 份数必须 > 纯前缀口径的 40 —— 差额就是「链里认出、前缀认不出」的那几份。
    const total = Number(/判据脚本 (?<count>\d+) 份/.exec(output)?.groups?.count ?? "0");
    expect(total, "扫描面必须含门禁链认出的判据").toBeGreaterThan(40);
    const chain = chainScripts();
    for (const name of ["shell-gate.mjs", "storybook-check.mjs"]) {
      expect(chain, `${name} 应当出现在钩子的门禁步骤位置`).toContain(name);
      // 名字不在「无执行者 / 报告型自称在跑」这两份点名清单里 ⇒ 已被认作判据且执行者在场。
      expect(output.includes(name), `${name} 不该被点名`).toBe(false);
    }
  });

  test("只作散文举例 / 被 import 的脚本不算判据（步骤位置口径）", () => {
    // 只读「门禁步骤位置」而非全文：全文匹配会把散文里的占位符、清单库、postinstall 脚本、C 组测试执行器与
    // 被 import 的共享模块一并算进来；实测那几份本来就「有执行者」，所以 `--report` 的点名清单一个字都不变，
    // 口径差异只体现在 `check-gate-executors.cjs` 的 `PROSE_ONLY_SCRIPTS` 自检里（它在判据自己算出的表上反查）。
    // ⚠️ 不写死份数：份数随「新写一份 `check-*.cjs` 还没接钩子」正当变动，上涨读数也随散文提及漂移（§12.14）。
    // 这里只钉三件与口径无关的事实：扫描面非空（坏掉退成 0 而 0 份照样「无违规」）、份数独立重数对账、名单逐字同源。
    const output = runInRepo(["--report"]);
    const total = Number(/判据脚本 (?<count>\d+) 份/.exec(output)?.groups?.count ?? "0");
    expect(total, "扫描面空转（退成 0 时下面每一条都照样报 OK）").toBeGreaterThan(40);
    const listed = readdirSync(join(REPO_ROOT, "scripts"))
      .filter((n) => /\.(?:cjs|mjs)$/.test(n))
      .filter((n) => chainScripts().includes(n) || GATE_PREFIXES.some((p) => n.startsWith(p)));
    expect(total, "份数 = 「门禁链事实 ∪ 名字族」自己数出来的份数（不写死数字）").toBe(
      listed.length,
    );
    const gateSrc = readFileSync(join(REPO_ROOT, "scripts", SCRIPT_NAME), "utf8");
    for (const name of [
      "x.cjs",
      "xxx.cjs",
      "affected-tests.mjs",
      "install-git-hooks.mjs",
      "run-affected-tests.mjs",
      "quality-gate-shared.mjs",
    ]) {
      expect(
        gateSrc,
        `${name} 不在判据的 PROSE_ONLY_SCRIPTS 自检名单里 —— 口径退化时没人看得见`,
      ).toContain(`"${name}"`);
    }
    for (const name of [
      "x.cjs",
      "xxx.cjs",
      "affected-tests.mjs",
      "install-git-hooks.mjs",
      "run-affected-tests.mjs",
      "quality-gate-shared.mjs",
    ]) {
      expect(output.includes(name), `${name} 不该被当成判据`).toBe(false);
    }
  });
});

/**
 * ④ 入口级登记要验（ISSUE #2530）。`hasExecutor()` 按 **basename** 比，所以「同一份脚本的两个入口」在账上
 * 塌成一个，而这两档可能判的根本不是同一件事（#2385：钩子跑的是 `--staged` 那窄档，硬规则 25「开工前跑
 * 一次」判的是整个 ②）。用例钉四个方向：登记了要在写明的执行者里真找得到那行；**无旗标那一形不许被带旗标
 * 的那行冒充**；转述型包装器不许把别人的旗标算到自己头上；台账条目不许空着（`judges` 缺失 / 只登记一形 / 脚本已改名）。 */
describe("入口级登记：登记成入口的每一形都要验得出（ISSUE #2530）", () => {
  /** 临时区里那份判据脚本本体（它只要名字在 `check-` 族里就进扫描面）。 */
  const PROBE = "check-probe-entry.cjs";
  const withProbe = (repo: { write: (p: string, s: string) => void }) => {
    repo.write(
      `scripts/${PROBE}`,
      `#!/usr/bin/env node\n// @ts-nocheck -- 探针\nconsole.log("entry");\nprocess.exit(0);\n`,
    );
  };
  const ledgerWith = (entrypoints: unknown) => JSON.stringify({ onDemand: {}, entrypoints });

  test("两形都真有那行命令 ⇒ 不报入口问题（计数那一行由真仓库那条验）", ({ repo }) => {
    withProbe(repo);
    repo.write(".githooks/pre-commit", `  run "窄档" node scripts/${PROBE} --staged\n`);
    repo.write("package.json", JSON.stringify({ scripts: { wide: `node scripts/${PROBE}` } }));
    repo.write(
      "scripts/.gate-executor-ledger.json",
      ledgerWith({
        [PROBE]: [
          {
            flags: ["--staged"],
            judges: "只判动了输入面的那一次",
            executors: [".githooks/pre-commit"],
          },
          {
            flags: [],
            judges: "整档全判（开工前那一档）",
            executors: ["package.json"],
          },
        ],
      }),
    );
    const { output } = repo.run();
    /* 临时区里**其它**拷进来的判据必然没有执行者（夹具刻意不放 `.githooks/` 等来源），
     * 所以整条一定红 —— 这里要断言的不是退码，而是「入口那一层没有贡献任何一条红」。 */
    expect(output).not.toContain("登记了那一形");
    expect(output).not.toContain("没写「它判的是什么」");
    expect(output).not.toContain("一形就别登记");
  });

  test("登记的某一形在执行者里没有那行命令 ⇒ 红并点名那一形", ({ repo }) => {
    withProbe(repo);
    repo.write(".githooks/pre-commit", `  run "窄档" node scripts/${PROBE} --staged\n`);
    repo.write("package.json", JSON.stringify({ scripts: { wide: `node scripts/${PROBE}` } }));
    repo.write(
      "scripts/.gate-executor-ledger.json",
      ledgerWith({
        [PROBE]: [
          {
            flags: ["--nope"],
            judges: "那一形其实没被接上",
            executors: [".githooks/pre-commit"],
          },
          {
            flags: [],
            judges: "整档全判",
            executors: ["package.json"],
          },
        ],
      }),
    );
    const { code, output } = repo.run();
    expect(code, "登记的形没有执行者必须阻断").toBe(1);
    expect(output).toContain("--nope");
    expect(output).toContain(".githooks/pre-commit");
  });

  test("「无旗标那一形」不许被带旗标的那行冒充（塌成的另一种写法）", ({ repo }) => {
    withProbe(repo);
    // 唯一的一行调用带着 --staged：窄档确实有人跑，宽档（无旗标）没有。
    repo.write(".githooks/pre-commit", `  run "窄档" node scripts/${PROBE} --staged\n`);
    repo.write(
      "scripts/.gate-executor-ledger.json",
      ledgerWith({
        [PROBE]: [
          {
            flags: ["--staged"],
            judges: "只判动了输入面的那一次",
            executors: [".githooks/pre-commit"],
          },
          {
            flags: [],
            judges: "整档全判（这一形其实没人跑）",
            executors: [".githooks/pre-commit"],
          },
        ],
      }),
    );
    const { code, output } = repo.run();
    expect(code, "无旗标那一形被 --staged 那行冒充 ⇒ 必须红").toBe(1);
    expect(output).toContain("(无旗标)");
  });

  test("转述型包装器：`--` 之后是别人的命令，那些旗标不算这一形", ({ repo }) => {
    withProbe(repo);
    /* 现场形状（`ci-cp936-exit.mjs -- node 别的脚本 --json`）：包装器把真命令跟在
     * 一个独立的 `--` 之后。按整行收旗标的话，包装器会被数出「--json 那一形」，
     * 而它自己从没带过那个旗标 —— 入口台账就会去要求一堆不存在的登记。
     * 所以这里探针是**外层**：`--` 之前没有旗标 ⇒ 无旗标那一形认得到；
     * 而登记 `--json` 那一形必须认不到。 */
    repo.write(".cnb.yml", `      转述=node scripts/${PROBE} -- node scripts/inner.cjs --json\n`);
    repo.write(
      "scripts/.gate-executor-ledger.json",
      ledgerWith({
        [PROBE]: [
          {
            flags: [],
            judges: "被包装器转述的那一形（自己不带旗标）",
            executors: [".cnb.yml"],
          },
          {
            flags: ["--json"],
            judges: "这一形并没有人跑",
            executors: [".cnb.yml"],
          },
        ],
      }),
    );
    const { code, output } = repo.run();
    expect(code, "--json 那一形不该被算成有执行者").toBe(1);
    expect(output, "无旗标那一形该被认出来（不该连它一起红）").not.toContain("(无旗标)");
    expect(output).toContain("--json");
  });

  test("台账条目自己不许空着：没写 judges ⇒ 红", ({ repo }) => {
    withProbe(repo);
    repo.write("package.json", JSON.stringify({ scripts: { a: "x" } }));
    repo.write(
      `scripts/.gate-executor-ledger.json`,
      ledgerWith({
        [PROBE]: [
          { flags: [], judges: "", executors: ["package.json"] },
          { flags: ["--wide"], judges: "另一形", executors: ["package.json"] },
        ],
      }),
    );
    repo.write(
      "package.json",
      JSON.stringify({
        scripts: { a: `node scripts/${PROBE}`, b: `node scripts/${PROBE} --wide` },
      }),
    );
    const { code, output } = repo.run();
    expect(code, "空 judges 等于没登记").toBe(1);
    expect(output).toContain("没写「它判的是什么」");
  });

  test("只登记一形 ⇒ 红（入口这层的理由就是「多形判的不同」）", ({ repo }) => {
    withProbe(repo);
    repo.write("package.json", JSON.stringify({ scripts: { a: `node scripts/${PROBE}` } }));
    repo.write(
      "scripts/.gate-executor-ledger.json",
      ledgerWith({
        [PROBE]: [{ flags: [], judges: "只有一形", executors: ["package.json"] }],
      }),
    );
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("一形就别登记");
  });

  test("登记了脚本已不在的入口 ⇒ 红（与 onDemand 同一条反向判据）", ({ repo }) => {
    repo.write(
      "scripts/.gate-executor-ledger.json",
      ledgerWith({
        "check-already-renamed.cjs": [
          { flags: [], judges: "x", executors: ["package.json"] },
          { flags: ["--y"], judges: "y", executors: ["package.json"] },
        ],
      }),
    );
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("check-already-renamed.cjs");
  });

  test("本仓库的台账：登记的每一形都真验得过（不是把红留在下一跳）", () => {
    // 在真仓库根跑：临时区里没有 `.githooks/` / `.cnb.yml` / `package.json` 的**原样**，
    // 而那些正是入口那一层的执行者来源 —— 这里要证的是「此刻这份账对得上」。
    /* 台账用运行时守卫收窄，不走 `as` 断言（B5 清账）。 */
    const ledger: unknown = JSON.parse(
      readFileSync(join(REPO_ROOT, "scripts", ".gate-executor-ledger.json"), "utf8"),
    );
    if (!isRecord(ledger) || !isRecord(ledger.entrypoints)) {
      throw new Error("台账形状不对（缺 entrypoints）");
    }
    const entrypoints: Record<string, Array<unknown>> = {};
    for (const [key, value] of Object.entries(ledger.entrypoints)) {
      if (!isUnknownArray(value)) {
        throw new Error(`台账 entrypoints.${key} 不是数组`);
      }
      entrypoints[key] = value;
    }
    const forms = Object.values(entrypoints).reduce((n, list) => n + list.length, 0);
    expect(forms, "入口这层一条都没登记，就是 #2530 没办").toBeGreaterThan(0);
    const output = execFileSync(process.execPath, [join(REPO_ROOT, "scripts", SCRIPT_NAME)], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    // 计数从台账现算，不写死（写死一份就等于再造一条会漂的账）。
    expect(output).toContain(`入口级登记 ${Object.keys(entrypoints).length} 份 ${forms} 形`);
  });

  test("--update 不许把入口那一半抹掉", ({ repo }) => {
    withProbe(repo);
    repo.write(
      "scripts/.gate-executor-ledger.json",
      ledgerWith({
        [PROBE]: [
          { flags: [], judges: "整档", executors: ["package.json"] },
          { flags: ["--staged"], judges: "窄档", executors: ["package.json"] },
        ],
      }),
    );
    repo.write("package.json", JSON.stringify({ scripts: { a: `node scripts/${PROBE}` } }));
    const { code, output } = repo.run(["--update"]);
    expect(output, output).toContain("台账已重写");
    expect(code).toBe(0);
    /* 台账用运行时守卫收窄，不走 `as` 断言（B5 清账）。 */
    const after: unknown = JSON.parse(
      readFileSync(join(repo.dir, "scripts", ".gate-executor-ledger.json"), "utf8"),
    );
    if (!isRecord(after) || !isRecord(after.entrypoints)) {
      throw new Error("台账形状不对（缺 entrypoints）");
    }
    const afterProbe = isUnknownArray(after.entrypoints[PROBE]) ? after.entrypoints[PROBE] : [];
    expect(afterProbe.length, "--update 之后入口条目必须原样还在").toBe(2);
  });

  /**
   * #2530 那个「塌成」换了个方向（ISSUE #2590）：当年收的是「无旗标那一形被带旗标的行冒充」，排除逻辑只写在
   * 那一个分支上，于是**两个带旗标形之间还开着** —— `--staged` 是 `--staged --json` 的子集时，超集那一行同时
   * 满足两形 ⇒ 子集那一形一个执行者都没有而账面全绿；把命令改成超集形状时没有任何一格会红。四档一起建：
   * 超集行冒充子集形 ⇒ 红、只有子集行而登记超集形 ⇒ 红（今天已对，别改坏）、两行都在 ⇒ 绿、在册「全档形 + 收窄形」不许被误判成包含关系。 */
  const twoFlagForms = (
    repo: {
      write: (p: string, s: string) => void;
    },
    hookBody: string,
  ) => {
    withProbe(repo);
    repo.write(".githooks/pre-commit", hookBody);
    repo.write(
      "scripts/.gate-executor-ledger.json",
      ledgerWith({
        [PROBE]: [
          {
            flags: ["--staged"],
            judges: "窄档（只判动了输入面的那一次）",
            executors: [".githooks/pre-commit"],
          },
          {
            flags: ["--staged", "--json"],
            judges: "窄档 + 机器读的输出",
            executors: [".githooks/pre-commit"],
          },
        ],
      }),
    );
  };

  test("钩子里只有超集行 ⇒ 子集那一形红并点名（今天不红的那一格）", ({ repo }) => {
    twoFlagForms(repo, `  run "超集档" node scripts/${PROBE} --staged --json\n`);
    const { output } = repo.run();
    expect(output).toContain("登记了那一形（--staged）");
    /* 反向那一半：超集那一形确实有行，不该跟着报 —— 只报「没被认出来的那一形」，
     * 否则这条判据会变成「两形都别登记旗标」。 */
    expect(output).not.toContain("登记了那一形（--staged --json）");
  });

  test("钩子里只有子集行 ⇒ 超集那一形仍然红（这条今天就对，别改坏）", ({ repo }) => {
    twoFlagForms(repo, `  run "窄档" node scripts/${PROBE} --staged\n`);
    const { output } = repo.run();
    expect(output).toContain("登记了那一形（--staged --json）");
    expect(output).not.toContain("登记了那一形（--staged）");
  });

  test("两行都在 ⇒ 两形各自被认成自己那一形", ({ repo }) => {
    twoFlagForms(
      repo,
      `  run "窄档" node scripts/${PROBE} --staged\n` +
        `  run "窄档出 JSON" node scripts/${PROBE} --staged --json\n`,
    );
    expect(repo.run().output).not.toContain("登记了那一形");
  });

  test("在册那种「全档形 + 收窄形」不算包含关系 —— 无旗标那一形表达的是整档，不是子集", ({
    repo,
  }) => {
    withProbe(repo);
    repo.write(
      ".githooks/pre-commit",
      `  run "窄档" node scripts/${PROBE} --staged\n` +
        /* 无旗标那一形也要真有一行 —— 少了它，下面那句「不算包含关系」会被一条
         * 「(无旗标) 那一形没有执行者」的红淹掉，而那条红是本例的**正确答案**。 */
        `  run "整档" node scripts/${PROBE}\n`,
    );
    repo.write(
      "scripts/.gate-executor-ledger.json",
      ledgerWith({
        [PROBE]: [
          { flags: [], judges: "整档全判", executors: [".githooks/pre-commit"] },
          {
            flags: ["--staged"],
            judges: "收窄档",
            executors: [".githooks/pre-commit"],
          },
        ],
      }),
    );
    const { output } = repo.run();
    /* 照字面把「任意两形 A 是 B 的子集」做成判据，这里会红两条 —— 而真仓库在册那 2 份 5 形
     * 跑这条是 0 红（单子里明写的对照）。空集是任何集合的子集，所以「无旗标」必须
     * 被排除在这条之外；它由上面那条命中逻辑单独认。 */
    expect(output).not.toContain("有**包含关系**");
    expect(output).not.toContain("完全相同");
    expect(output).not.toContain("登记了那一形");
  });

  test("两形旗标相等或有包含关系 ⇒ 登记当场红（要合成一形，或各配一行真不同的命令）", ({
    repo,
  }) => {
    withProbe(repo);
    repo.write(
      ".githooks/pre-commit",
      `  run "a" node scripts/${PROBE} --staged\n` +
        `  run "b" node scripts/${PROBE} --staged --json\n`,
    );
    repo.write(
      "scripts/.gate-executor-ledger.json",
      ledgerWith({
        [PROBE]: [
          {
            flags: ["--staged"],
            judges: "同一形登记了两遍",
            executors: [".githooks/pre-commit"],
          },
          {
            flags: ["--staged"],
            judges: "另一遍",
            executors: [".githooks/pre-commit"],
          },
        ],
      }),
    );
    expect(repo.run().output).toContain("完全相同");

    /* 相等那一档改成包含那一档（`--staged` 是 `--staged --json` 的子集），报的是另一句话。 */
    repo.write(
      "scripts/.gate-executor-ledger.json",
      ledgerWith({
        [PROBE]: [
          {
            flags: ["--staged"],
            judges: "窄档",
            executors: [".githooks/pre-commit"],
          },
          {
            flags: ["--staged", "--json"],
            judges: "窄档 + JSON",
            executors: [".githooks/pre-commit"],
          },
        ],
      }),
    );
    const nested = repo.run().output;
    expect(nested).toContain("有**包含关系**");
    expect(nested).not.toContain("完全相同");
  });

  /**
   * 「入口要不要要求判定型」这一格选的是**补正向判据**（ISSUE #2590 期望 3）。本仓「入口」在读者面上一直指
   * 「一条会判成败的命令」（`.cnb.yml` 的格表、钩子的 `run` 行、`quality-gate.mjs` 的 `args:` 都是那个形状），
   * 而台账登记的语义是「这一形由这条命令执行」；报告型没有「这一形的结论」可执行，在册面是 §11.23 的声明索引。
   * 另一个出口（只在注释里写明「不要求」）会把读者面的歧义留在原地，而那条歧义正是本症状的成因 —— 所以不选。 */
  test("报告型脚本不许登记成入口；补上 process.exit 就不再报（反证）", ({ repo }) => {
    const reportProbe = "check-probe-report.cjs";
    const asReport = (body: string) => {
      repo.write(`scripts/${reportProbe}`, body);
      repo.write(
        ".githooks/pre-commit",
        `  run "报告" node scripts/${reportProbe} --staged\n` +
          /* 两形都得有一行 —— 不然「没有执行者」那条红会先响，本例要判的那条
           * （它根本不是判定型）就被盖在下面。 */
          `  run "报告出 JSON" node scripts/${reportProbe} --json\n`,
      );
      repo.write(
        "scripts/.gate-executor-ledger.json",
        JSON.stringify({
          onDemand: {},
          entrypoints: {
            [reportProbe]: [
              {
                flags: ["--staged"],
                judges: "收窄档",
                executors: [".githooks/pre-commit"],
              },
              {
                flags: ["--json"],
                judges: "出 JSON",
                executors: [".githooks/pre-commit"],
              },
            ],
          },
        }),
      );
    };
    asReport('#!/usr/bin/env node\nconsole.log("只是报告，不判");\n');
    const report = repo.run().output;
    /* 锚点取这条消息独有的那半句：整条判据的收尾口径里本来就写着「报告型不许自称
     * 供 pre-commit 调用」，拿「报告型」三个字当判点会把收尾句也判进去。 */
    expect(report).toContain("但它是**报告型**");
    expect(report).toContain("§11.23");
    /* 同一条登记、同一份执行者，只把脚本换成判定型 ⇒ 这条红必须消失 ——
     * 不然它长得像「登记格式不对」，而报的其实是「它不是一条会判成败的命令」。 */
    asReport('#!/usr/bin/env node\nconsole.log("判一下");\nprocess.exit(0);\n');
    expect(repo.run().output).not.toContain("但它是**报告型**");
  });
});
