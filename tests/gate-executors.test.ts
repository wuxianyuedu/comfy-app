/**
 * 判据 ⇄ 执行者的双向判据（ISSUE #1451 要求 2 / 规范 §13.5.12）。
 *
 * 这条门禁的价值全在**三个方向**都成立上，缺一个方向它就成了摆设：
 *   ① 判定型脚本无执行者 ⇒ 红（本次立案现场：`check-comment-language.cjs` 自称
 *      供钩子调用、文档也写着它在报红，而它一个执行者都没有）；
 *   ② 报告型脚本自称「供 pre-commit 调用」⇒ 红（报告档按定义恒 exit(0)，
 *      那句承诺必然是假的 —— 文档说谎而全绿比漏报更难发现）；
 *   ③ 台账双向拦：登记了却其实有执行者 ⇒ 红（台账是负债，不是赦免名单）。
 *
 * 为什么用「临时工作区 + 拷真脚本」而不是在本仓库里造探针：本仓库的任何临时文件
 * 都可能被并行的 C 组 `vitest run` 看见（用例之间共享同一份检出），而这里要为每条
 * 方向各造一次现场。拷进临时区后本仓库零副作用。
 *
 * 临时工作区走共享夹具 `defineGateRepo`（§11.16.1）。本文件有一处夹具选项盖不住的
 * 形状：临时区里必须**同时**放「全部判据脚本」，而**不能**放 `quality-gate.mjs` /
 * `.githooks/` / `package.json` 这些**执行者来源** —— 它们一旦在场，「某个探针没有
 * 执行者」这一档就造不出来（判据会把编排器当执行者来源读）。所以过滤拷贝写在
 * `setup` 里，而不是拿 `copy` 整目录往里灌（见那份函数的注释）。
 *
 * 规范：docs/standards/13-提交与-code-review.md §13.5.12
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { defineGateRepo, describe } from "./helpers/gate-repo";

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
 * 把**判据脚本本体**拷进临时工作区的 `scripts/`（台账由用例自己写）。
 *
 * 为什么不用夹具的 `copy` 整目录灌 `scripts/`：那会把 `quality-gate.mjs` /
 * `quality-gate.ps1` 一并带进来，而这两份正是本判据的**执行者来源**（以及
 * `.githooks/` 与 `package.json` 同族）。它们在临时区里一出现，「某个探针一个
 * 执行者都没有」那一档就被喂成了「有执行者」，用例测的东西当场变成别的东西。
 * 所以这里的过滤是**判据语义的一部分**，不是图省事。
 */
function copyGateScripts(repo: { dir: string }): void {
  const srcScripts = join(REPO_ROOT, "scripts");
  const dstScripts = join(repo.dir, "scripts");
  mkdirSync(dstScripts, { recursive: true });
  for (const entry of readdirSync(srcScripts)) {
    const isGate =
      /\.(cjs|mjs)$/.test(entry) &&
      GATE_PREFIXES.some((p) => entry.startsWith(p));
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
    /* 台账原样带上（临时区里它就是「当前台账」）。
     * 判据共用的扫描读取器 `gate-scan-read.cjs` 以 `gate-` 开头而不以 `check-` 开头，
     * `copyGateScripts` 的前缀循环不会带它 —— 缺了它本判据会以 `MODULE_NOT_FOUND`
     * 崩在临时区里，读起来像「台账判据坏了」，实际是夹具少一个文件。
     * 它由夹具的 `copyGateDeps` **自动补齐**（沿脚本的 `require("./x.cjs")` 递归），
     * 所以这里不必再抄一遍。 */
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
    const output = execFileSync(
      process.execPath,
      [join(REPO_ROOT, "scripts", SCRIPT_NAME)],
      { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    /* 条数从台账现算，不写死：写死一份计数就等于再造一条「加了条目忘了改数」的
     * 会漂的判据（同一族先例见 #2135 那次钩子步数被钉死）。 */
    const onDemand = JSON.parse(
      readFileSync(
        join(REPO_ROOT, "scripts", ".gate-executor-ledger.json"),
        "utf8",
      ),
    ) as { onDemand: Record<string, unknown> };
    expect(output).toContain(
      `按需召唤 ${Object.keys(onDemand.onDemand).length}`,
    );
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

  test("台账双向误报的锚点：测试只**读**脚本文本不算执行者，真 **spawn** 才算", ({
    repo,
  }) => {
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
    expect(output, "真起子进程的测试算执行者").not.toContain(
      "check-probe-b.cjs",
    );
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
  const hook = (): string =>
    readFileSync(join(REPO_ROOT, ".githooks", "pre-commit"), "utf8");

  /** D 组步骤 = `  run "<标签>" <命令>`（与同族用例同款解析，不许 toContain）。 */
  const steps = (): { label: string; cmd: string }[] =>
    [...hook().matchAll(/^ {2}run "([^"]+)" (.+)$/gm)].map((m) => ({
      label: m[1] ?? "",
      cmd: m[2] ?? "",
    }));

  test("「判据执行者台账」这一步真在 D 组里（被注掉的行不算在场）", () => {
    expect(
      steps().find((s) => s.cmd.includes("scripts/check-gate-executors.cjs")),
    ).toEqual({
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
    expect(
      steps().find((s) => s.cmd.includes("scripts/run-ast-gates.cjs")),
    ).toEqual({
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
 * 扫描面本身（ISSUE #1444 残活 A）。
 *
 * 这条靶子是**判据自己的覆盖面**：旧口径只看名字前缀，于是那几份真在门禁链里跑的
 * 判定型判据（`shell-gate.mjs` / `storybook-check.mjs` 等）因名字不叫 `check-`
 * 而不在盘点里 —— 判据自报的份数与真值不符。
 * 而「判据的覆盖面与它自称的不符」正是 #1451 的立案现场，所以这里逐份把
 * **门禁链事实**钉住。
 *
 * ⚠️ 这几条**必须在真仓库根跑**：临时区里没有 `.githooks/` / `quality-gate.*`，
 * 链口径恒为空 —— 在那里测这件事等于测「前缀口径还在不在」。
 */
describe("扫描面 = 门禁链事实 ∪ 名字族（ISSUE #1444 残活 A）", () => {
  /** 在**真仓库根**跑判据（不经临时区）。 */
  const runInRepo = (args: string[] = []): string =>
    execFileSync(
      process.execPath,
      [join(REPO_ROOT, "scripts", SCRIPT_NAME), ...args],
      { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );

  /**
   * 门禁链「步骤位置」里出现的 `scripts/<x>` basename（三个来源，与判据同口径）。
   * 只读步骤位置、不读全文 —— 全文会把散文里的 `x.cjs` 占位符也带进来。
   */
  const chainScripts = (): string[] => {
    const out = new Set<string>();
    const collect = (text: string): void => {
      for (const mm of text.matchAll(
        /scripts[\\/]+([A-Za-z0-9_.-]+\.(?:cjs|mjs))/g,
      )) {
        out.add(mm[1] ?? "");
      }
    };
    const read = (rel: string): string =>
      readFileSync(join(REPO_ROOT, rel), "utf8");
    for (const m of read(".githooks/pre-commit").matchAll(
      /^ {2}run "[^"]+" (.+)$/gm,
    )) {
      collect(m[1] ?? "");
    }
    for (const m of read("scripts/quality-gate.mjs").matchAll(
      /args:\s*\[([^\]]*)\]/g,
    )) {
      collect(m[1] ?? "");
    }
    for (const m of read("scripts/quality-gate.ps1").matchAll(
      /Args\s*=\s*@\(([^)]*)\)/g,
    )) {
      collect(m[1] ?? "");
    }
    return [...out];
  };

  test("四份「名字不叫 check- 但在门禁链里跑」的判据确实被数进去了", () => {
    const output = runInRepo(["--report"]);
    // 份数必须 > 纯前缀口径的 40 —— 差额就是「链里认出、前缀认不出」的那几份。
    const total = Number(/判据脚本 (\d+) 份/.exec(output)?.[1] ?? "0");
    expect(total, "扫描面必须含门禁链认出的判据").toBeGreaterThan(40);
    const chain = chainScripts();
    for (const name of ["shell-gate.mjs", "storybook-check.mjs"]) {
      expect(chain, `${name} 应当出现在钩子的门禁步骤位置`).toContain(name);
      // 名字不在「无执行者 / 报告型自称在跑」这两份点名清单里 ⇒ 已被认作判据且执行者在场。
      expect(output.includes(name), `${name} 不该被点名`).toBe(false);
    }
  });

  test("只作散文举例 / 被 import 的脚本不算判据（步骤位置口径）", () => {
    // 只读「门禁步骤位置」而非文件全文的原因：全文匹配会把这些一起打进 ——
    // `x.cjs` / `xxx.cjs`（散文里的占位符举例）、`affected-tests.mjs`（清单库，
    // 被钩子注释提到）、`install-git-hooks.mjs`（postinstall，被注释提到）、
    // `run-affected-tests.mjs`（被 `node scripts/run-affected-tests.mjs` 那行调，
    // 但它是 C 组的测试执行器、不是判据）、`quality-gate-shared.mjs`（被 import）。
    // 实测：把口径退化成全文匹配时，下面这六份里会多认出几份（那几份本来
    // 「有执行者」，所以 `--report` 的点名清单一个字都不变）。
    //
    // ⚠️ 这里**不写死份数**：份数会随「新写一份 `check-*.cjs` 还没接钩子」而正当变动
    // （那正是名字族兜底要它可见的东西），把它冻成一个数字等于给下一份新判据留一道
    // 无谓的红 —— 而规范 §13.5.10 的「步数不写、读数不写死」说的就是这件事。
    // 上涨后的数字同样不写：它随仓库里散文提到 `scripts/x.mjs` 的次数漂移，
    // 写死就成了下一个人照着它去核的假账（§12.14）。
    //
    // 口径（步骤位置 vs 全文）的差异**不体现为「名单里出现没出现」**：判据退化成
    // 读全文时多出来的几份本来就「有执行者」，所以真正的执行者在
    // **`check-gate-executors.cjs` 的 `PROSE_ONLY_SCRIPTS` 自检**里 ——
    // 它在判据自己算出来的那张表上反查，那是唯一看得见这个差异的地方。
    // 这里只钉三件**与口径无关**的事实（保证那个自检不是空转，且读数不写死）：
    //   ① 扫描面非空（口径坏掉时会退成 0，而 0 份照样「无违规」）。
    //   ② 份数 = 「门禁链事实 ∪ 名字族」独立数一遍来对（不随正当变动漂）。
    //   ③ 那份自检的名单与这里的名单**逐字同源**（两处各写一份就会漂）。
    const output = runInRepo(["--report"]);
    const total = Number(/判据脚本 (\d+) 份/.exec(output)?.[1] ?? "0");
    expect(
      total,
      "扫描面空转（退成 0 时下面每一条都照样报 OK）",
    ).toBeGreaterThan(40);
    const listed = readdirSync(join(REPO_ROOT, "scripts"))
      .filter((n) => /\.(cjs|mjs)$/.test(n))
      .filter(
        (n) =>
          chainScripts().includes(n) ||
          GATE_PREFIXES.some((p) => n.startsWith(p)),
      );
    expect(
      total,
      "份数 = 「门禁链事实 ∪ 名字族」自己数出来的份数（不写死数字）",
    ).toBe(listed.length);
    const gateSrc = readFileSync(
      join(REPO_ROOT, "scripts", SCRIPT_NAME),
      "utf8",
    );
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
