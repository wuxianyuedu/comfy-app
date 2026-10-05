#!/usr/bin/env node
// @ts-nocheck -- 判据执行者台账（供 .githooks/pre-commit 的 D 组调用）
/**
 * 判据 ⇄ 执行者的双向判据 —— 规范见 docs/standards/13-提交与-code-review.md §13.5.12。
 *
 * 背景（ISSUE #1451）：`scripts/check-comment-language.cjs` 头部自称「提交门槛脚本，
 * 供 `.githooks/pre-commit` 与 CI 调用」、§12.4.6 也写着它在钩子里报红 —— 而
 * `grep -c comment-language .githooks/pre-commit` 一直是 0，CI 又随 ISSUE #623 删除。
 * **一条基线为 0 的硬闸一个执行者都没有，而文档说它在执行。** 这类事故比漏报更难
 * 发现：漏报只是判据不响，而「自称在跑」会让所有人以为有人在守。
 *
 * 本脚本把「有没有执行者」这件事机器化，覆盖两向：
 *
 *   ① **判定型脚本无执行者** ⇒ 红，除非显式登记在「按需召唤」台账
 *      （`scripts/.gate-executor-ledger.json`，每条含「为什么不能进钩子」+「谁按需跑」）。
 *      判定型 = 源码里有 `process.exit`（会以非零退出阻断某次运行）。
 *   ② **报告型脚本自称「供 pre-commit 调用」** ⇒ 红。报告型 = 0 处 `process.exit`
 *      （只出清单不判失败），它按定义不该有判定者，那句承诺必然是假的
 *      —— `check-comment-language.cjs` 的事故就是这句话本身。
 *   ③ **台账双向拦**：登记了却其实有执行者 ⇒ 红（台账是负债，不是赦免名单）；
 *      有执行者却仍登记 ⇒ 同一条。
 *
 * **「报告档⇄判定档」是两件事，别混成一句「没有自动执行者」**：
 *   · 报告档按定义不判失败 —— 把它接进钩子 = 接一个恒 `exit(0)` 的东西（接了个寂寞）；
 *   · 判定档没有执行者 —— 判据在场、没人敲它，文档却可能说它在跑。
 * 所以本脚本只对**判定型**要求「要么有执行者、要么登记」，对报告型只拦「自称在跑」。
 *
 * 执行者的口径（**只认直接调用**，不做跨文件传递闭包推断 —— 那会把「A 调用 B、
 * B 调用 C」的间接链一路上溯，误报一片、也会随重构静默失效）：
 *   · `.githooks/pre-commit`（唯一本地钩子）
 *   · `scripts/quality-gate.mjs`（`pnpm check:all` 的编排）
 *   · `package.json` 的 `scripts`（`pnpm <名>` 入口）
 *   · `scripts/build-desktop.mjs`（打包链）
 *   · `scripts/standalone-private-inputs.mjs`（`pnpm build` 收尾，与上面同族）
 *   · `tests/**`（契约测试也是执行者：`spawnSync("node", ["scripts/x.cjs", …])`）
 *
 * 为什么把 `tests/**` 算执行者：本仓库多条判据的**唯一**执行者就是契约测试
 * （`lib-node-only-scan.mjs` 由 `tests/lib-node-only-declarations.test.ts` 跑），
 * 而它们在 C 组的固定清单里、每次提交都执行 —— 那是真的执行者，不是「文档里写着」。
 *
 * **扫描面是「事实 ∪ 名字族」，不是只有名字族**（ISSUE #1444 残活 A）：
 * 旧口径只看名字前缀，于是 `shell-gate.mjs` / `storybook-check.mjs` /
 * `visual-gate.mjs` / `pixel-run.mjs` 这四份**真在门禁链里跑**的判定型判据
 * 因名字不叫 `check-` 而不在盘点里 —— 判据自报「40 份」，真值是 44。
 * 「判据的覆盖面与它自称的不符」正是本脚本的立案现场（#1451），
 * 所以它自己的覆盖面必须由**门禁链里的事实**算出来（`gateChainScripts()`），
 * 名字前缀只作兜底（保证「新写的 `check-*` 还没接钩子」当场可见）。
 *
 * 用法：
 *   node scripts/check-gate-executors.cjs            # 检查（判定型无执行者即红）
 *   node scripts/check-gate-executors.cjs --report   # 只出清单，不判失败（盘点用）
 *   node scripts/check-gate-executors.cjs --update   # 诊疗后重写台账（人工核对后）
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ARGS = new Set(process.argv.slice(2));
const REPORT_ONLY = ARGS.has("--report");
const UPDATE = ARGS.has("--update");
const LEDGER = path.join(__dirname, ".gate-executor-ledger.json");

/* ── 扫描范围：`scripts/` 下的判据脚本 ─────────────────────────── */

/**
 * 「判据脚本」的识别口径 —— **两条来源取并集**，因为单靠名字认不出来。
 *
 * ① **被当判据调用的事实**（主口径）：`.githooks/pre-commit` 的 `run` 步骤、
 *    `quality-gate.mjs` 的 gate 表、`quality-gate.ps1` 的 `$Blocks` 里出现的
 *    `scripts/<x>` —— 一个脚本被门禁链按名字调起来，它就是判据，与它叫什么无关。
 * ② **名字族**（兜底）：`check-` / `tw4-` / `report-` / `lib-node-only-scan` /
 *    `render-doc-placeholders`。覆盖面靠它兜底：新写一个 `check-*.cjs` 还没接进
 *    钩子时，也当场被这条判据看见（那正是本脚本要拦的形态）。
 *
 * **为什么不能只留 ①**：那么「新写一个判定型脚本、没接钩子也没登记」就永远不会
 * 被看出来 —— 判据的扫描面本身就是「有执行者的东西」，问题却出在没有执行者的那些。
 * **为什么不能只留 ②**（改名之前的旧口径，实测翻过车）：`shell-gate.mjs` /
 * `storybook-check.mjs` / `visual-gate.mjs` / `pixel-run.mjs` 四份**真在门禁链里跑**的
 * 判定型判据，只因名字不叫 `check-` 就不在盘点里 —— 判据自报「40 份判据脚本」而真值
 * 是 44，且漏掉的恰是最容易被摘掉又没人发现的那类（`storybook-check.mjs` 连
 * `pnpm check:all` 那一档都在跑。ISSUE #1444 残活 A）。
 * **这条判据的立案现场（#1451）正是「判据的覆盖面与它自称的不符」**，所以它自己的
 * 覆盖面必须是**事实**算出来的，不是名字猜出来的。
 *
 * 为什么不按「目录里的所有 .cjs/.mjs」一刀切：`scripts/` 里还有编排器
 * （`dev.mjs` / `build-desktop.mjs` / `dev-launcher.mjs`）、一次性工具
 * （`repair-imports.cjs` / `heal-db.cjs`）与 `*.ps1` 入口 —— 它们不是判据，逼它们
 * 「要么进钩子要么登记」等于制造噪音，而噪音会让人整条规则都不看（同 §12.16 的教训）。
 * 用「门禁链里被按名字调起」这条事实把它们分开，比维护一份「哪些文件是判据」的
 * 手工名单可靠 —— 手工名单会随改名 / 搬目录静默失效。
 *
 * 不去递归子目录（`launcher-core/**` 是启动编排的实现件，不是判据；它们的执行者是
 * `dev-launcher.mjs`，另一条线）。
 */
const GATE_NAME_PREFIXES = [
  "check-",
  "tw4-",
  "report-",
  "render-doc-placeholders",
  "lib-node-only-scan",
];

/**
 * 门禁链里被按名字调起的 `scripts/<x>` 全表（口径 ① 的输入）。
 *
 * **只读「门禁步骤位置」，不读文件全文** —— 这一条是实测撞出来的：全文匹配会把
 * 注释里提到的、被本地 import 的、以及散文里当占位符举例的（`x.cjs` / `xxx.cjs`）
 * 一网打进，于是 `affected-tests.mjs`（清单库）、`install-git-hooks.mjs`（postinstall）、
 * `quality-gate.mjs`（编排器）、`quality-gate-shared.mjs`（共享常量）全被当成判据。
 * 下面三个位置才是「判据被当判据用」的事实：
 *   · `.githooks/pre-commit` 的 `run "<标签>" node scripts/<x>` 步骤行；
 *   · `scripts/quality-gate.mjs` 的 `args: ["../scripts/<x>"]` gate 表项；
 *   · `scripts/quality-gate.ps1` 的 `$Blocks` 表项（`Args` 栏）。
 * 比对 basename 而不是整条命令：三种写法（`scripts/x`、`../scripts/x`、
 * `scripts\x`）落点相同，而整条命令一比就会随引号 / 反斜杠 / 参数顺序漂移。
 * @returns {Set<string>}
 */
function gateChainScripts() {
  const out = new Set();
  /**
   * 从一段文本里收 `scripts/<x>` 的 basename。
   * @param {string} text
   */
  const collect = (text) => {
    for (const m of text.matchAll(
      /scripts[\\/]+([A-Za-z0-9_.-]+\.(?:cjs|mjs))/g,
    )) {
      out.add(m[1]);
    }
  };

  // ① 钩子的 `run "<标签>" <命令>` 步骤行（与 tests/doc-check-hook-wiring.test.ts 同款解析）。
  const hook = path.join(ROOT, ".githooks/pre-commit");
  if (fs.existsSync(hook)) {
    for (const m of fs
      .readFileSync(hook, "utf8")
      .matchAll(/^ {2}run "[^"]+" (.+)$/gm)) {
      collect(m[1] ?? "");
    }
  }

  // ② `quality-gate.mjs` 的 gate 表项。
  const qm = path.join(ROOT, "scripts/quality-gate.mjs");
  if (fs.existsSync(qm)) {
    for (const m of fs
      .readFileSync(qm, "utf8")
      .matchAll(/args:\s*\[([^\]]*)\]/g)) {
      collect(m[1] ?? "");
    }
  }

  // ③ `quality-gate.ps1` 的 `$Blocks` 表项（`Cmd = "node"; Args = @("scripts\x.cjs")`）。
  const qp = path.join(ROOT, "scripts/quality-gate.ps1");
  if (fs.existsSync(qp)) {
    for (const m of fs
      .readFileSync(qp, "utf8")
      .matchAll(/Args\s*=\s*@\(([^)]*)\)/g)) {
      collect(m[1] ?? "");
    }
  }

  return out;
}

/**
 * 是否属于扫描面：**被门禁链调用**（事实）或**名字在前缀族里**（兜底）。
 * @param {string} name
 * @param {Set<string>} chain
 */
function isGateScript(name, chain) {
  if (!/\.(cjs|mjs)$/.test(name)) return false;
  if (chain.has(name)) return true;
  return GATE_NAME_PREFIXES.some((p) => name.startsWith(p));
}

/* ── 执行者来源（六处；口径见文件头） ─────────────────────────── */

const EXECUTOR_SOURCES = [
  ".githooks/pre-commit",
  "scripts/quality-gate.mjs",
  "package.json",
  "scripts/build-desktop.mjs",
  "scripts/standalone-private-inputs.mjs",
];

/** `tests/**` 下的 `.test.ts(x)` 全表（执行者来源之一）。 */
function testFiles() {
  const out = [];
  if (!fs.existsSync(path.join(ROOT, "tests"))) return out;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.test\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  walk(path.join(ROOT, "tests"));
  return out;
}

/**
 * 汇总所有「执行者」文本 —— 判据要回答「这个脚本名有没有被哪个执行者**调用**」。
 *
 * ⚠️ **两类来源的取证宽度不同**（这是判据自身踩过的坑）：
 *   · **命令型来源**（钩子 / `quality-gate` / `package.json` / `build-desktop` /
 *     `standalone-private-inputs`）：名字出现即算。这几个文件里提到某个
 *     `scripts/*.cjs`，几乎必然是「按这个名字调它」。
 *   · **测试型来源**（`tests/**`）：**必须同一文件里既有该脚本名、又有子进程调用
 *     API**（`execFileSync` / `spawnSync` / `execFile` / `spawn`）才算。只看名字会把
 *     「读源码文本的形态判据」误算成执行者 —— 实测过：新增
 *     `tests/tw4-canonical-ratchet.test.ts`（它 `readFileSync` 那两份脚本、断言
 *     `--check` 分支还在）之后，两个 canonical 棘轮被判成「有执行者」，于是台账
 *     双向判定把两条正当的按需召唤登记报成负债。**「读它的文本」与「跑它」是两件事。**
 * @returns {{commandText: string, testSources: string[]}}
 */
function executorSources() {
  const commandParts = [];
  for (const rel of EXECUTOR_SOURCES) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) continue;
    commandParts.push(fs.readFileSync(full, "utf8"));
  }
  /** 只收「真的起了子进程」的测试文件。 */
  const testSources = [];
  for (const full of testFiles()) {
    const src = fs.readFileSync(full, "utf8");
    if (/\b(execFileSync|execFile|spawnSync|spawn)\s*\(/.test(src)) {
      testSources.push({
        rel: path.relative(ROOT, full).replace(/\\/g, "/"),
        text: src,
      });
    }
  }
  return { commandText: commandParts.join("\n"), testSources };
}

/**
 * 某个脚本名是否被某类执行者**调用**。
 * @param {string} name
 * @param {{commandText: string, testSources: {rel: string, text: string}[]}} sources
 * @returns {boolean}
 */
function hasExecutor(name, sources) {
  if (sources.commandText.includes(name)) return true;
  return sources.testSources.some((t) => t.text.includes(name));
}

/* ── 判定型 / 报告型 ─────────────────────────────────────────── */

/**
 * 判定型 = 源码里有 `process.exit`。这是**保守**的形态判据（不解析调用点、
 * 不判退出码是否真为 0）：「有 process.exit」说明它有能力阻断某次运行，
 * 而「报告档恒 exit(0)」那类由它自己的 `--report` 分支区分，不是本脚本的事。
 * @param {string} src
 */
function hasExit(src) {
  return /process\.exit/.test(src);
}

/**
 * 报告型是否自称「供 pre-commit 调用」—— 头部注释 / 文档里那句承诺。
 * 只在**文件头 20 行**与用户名上找：这是脚本自我介绍的位置，也让判据不受
 * 正文里「不要接 pre-commit」这种否定句的影响（那种句子不该被当成自白）。
 * @param {string} src
 */
function claimsPreCommit(src) {
  const head = src.split("\n").slice(0, 20).join("\n");
  return /供\s*`?\.githooks\/pre-commit`?/.test(head);
}

/* ── 台账 ────────────────────────────────────────────────────── */

/**
 * @returns {{onDemand: Record<string, {why: string, who: string}>}}
 */
function readLedger() {
  if (!fs.existsSync(LEDGER)) return { onDemand: {} };
  const parsed = JSON.parse(fs.readFileSync(LEDGER, "utf8"));
  return { onDemand: parsed.onDemand ?? {} };
}

/* ── 主流程 ──────────────────────────────────────────────────── */

const ledger = readLedger();
const executors = executorSources();
const scriptsDir = path.join(ROOT, "scripts");
const chainScripts = gateChainScripts();
const names = fs
  .readdirSync(scriptsDir, { withFileTypes: true })
  .filter((e) => e.isFile() && isGateScript(e.name, chainScripts))
  .map((e) => e.name)
  .sort();

const problems = [];
const report = { judgeWithExecutor: [], judgeOrphaned: [], reportClaiming: [] };

for (const name of names) {
  const src = fs.readFileSync(path.join(scriptsDir, name), "utf8");
  const judge = hasExit(src);
  const referenced = hasExecutor(name, executors);
  const registered = Object.prototype.hasOwnProperty.call(
    ledger.onDemand,
    name,
  );

  if (judge) {
    if (referenced) {
      report.judgeWithExecutor.push(name);
      // ③ 双向：有执行者却仍登记 ⇒ 台账是过期负债
      if (registered) {
        problems.push(
          `「${name}」已在台账登记为按需召唤，但它其实有执行者 —— ` +
            `台账不是赦免名单，能接进执行者就把它从台账摘掉（口径见 §13.5.12）`,
        );
      }
    } else if (registered) {
      report.judgeOrphaned.push(name);
    } else {
      report.judgeOrphaned.push(name);
      problems.push(
        `「${name}」是判定型（有 process.exit）却一个执行者都没有，也没登记台账 —— ` +
          `要么接进 .githooks/pre-commit，要么在 scripts/.gate-executor-ledger.json ` +
          `登记「为什么不能进钩子」与「谁按需跑」（ISSUE #1451 的立案现场就是这一族）`,
      );
    }
  } else {
    // ② 报告型自称「供 pre-commit 调用」⇒ 红（本次事故的直接判据）
    if (claimsPreCommit(src)) {
      report.reportClaiming.push(name);
      problems.push(
        `「${name}」是报告型（0 处 process.exit，只出清单不判失败），` +
          `头部却自称「供 .githooks/pre-commit 调用」—— 它按定义不该有判定者，` +
          `这句承诺必然是假的（ISSUE #1451：文档说谎而全绿比漏报更难发现）`,
      );
    }
  }
}

// 台账反向：登记了却不存在的脚本 ⇒ 红（防「改名后留下孤儿条目」）
for (const key of Object.keys(ledger.onDemand)) {
  if (!names.includes(key)) {
    problems.push(
      `台账登记了「${key}」，但 scripts/ 下没有这个判据脚本 —— ` +
        `脚本改名 / 删除后要把台账条目一并摘掉`,
    );
  }
}

if (UPDATE) {
  const next = { onDemand: {} };
  for (const name of report.judgeOrphaned) {
    next.onDemand[name] = ledger.onDemand[name] ?? {
      why: "（请在 --update 后填写：为什么不能进钩子）",
      who: "（谁按需跑）",
    };
  }
  fs.writeFileSync(LEDGER, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`台账已重写：scripts/.gate-executor-ledger.json`);
  process.exit(0);
}

if (REPORT_ONLY) {
  console.log(
    `判据脚本 ${names.length} 份：判定型有执行者 ${report.judgeWithExecutor.length}` +
      ` / 判定型无执行者 ${report.judgeOrphaned.length}` +
      ` / 报告型自称供 pre-commit ${report.reportClaiming.length}`,
  );
  if (report.judgeOrphaned.length > 0)
    console.log(`  无执行者：${report.judgeOrphaned.join("、")}`);
  if (report.reportClaiming.length > 0)
    console.log(`  报告型自称在跑：${report.reportClaiming.join("、")}`);
  process.exit(0);
}

if (problems.length > 0) {
  console.log(
    `判据执行者台账：${problems.length} 处不一致（判据脚本共 ${names.length} 份）\n`,
  );
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(
    `\n规范 §13.5.12 的口径：判定型「要么有执行者、要么登记按需召唤」，` +
      `报告型不许自称供 pre-commit 调用，台账双向拦。`,
  );
  process.exit(1);
}

console.log(
  `判据执行者台账：${names.length} 份判据脚本 —— ` +
    `判定型有执行者 ${report.judgeWithExecutor.length}、` +
    `按需召唤 ${report.judgeOrphaned.length}、` +
    `报告型自称在跑 0 ✓`,
);
