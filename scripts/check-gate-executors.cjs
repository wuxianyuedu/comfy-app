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
 *   ④ **入口级登记要验**（ISSUE #2530）：台账 `entrypoints` 里写下的「脚本 + 那串旗标」的每一形，
 *      都必须在那个执行者文件里**真找得到一行以这串旗标调起它** —— 找不到就红。
 *      它补的是 ① 的一条已知盲区：`hasExecutor()` 按 **basename** 比（刻意的：整命令逐字比会随
 *      引号与参数顺序漂），于是同一份脚本的两个入口在账上**塌成一个**，而这两档可能判的根本
 *      不是同一件事（`check-deps-freshness.mjs --staged` 只判「这次动了依赖面」，无参数那一档
 *      把整个「远端引用 / 装没装对」判一遍 —— #2385 的现场）。
 *      ⚠️ 这一层**只验人登记过的**，不自动发现「还有哪些脚本有多形没登记」：那是一台启发式机器，
 *      探针实测把转述型包装器（`ci-cp936-exit.mjs -- node 别的 --json`）数成 11 形，误报一片 ——
 *      本仓对这类机器的纪律就是不写（硬规则 24 末句）。未登记那一格由 `--report` 的计数念出来。
 *
 * **「报告档⇄判定档」是两件事，别混成一句「没有自动执行者」**：
 *   · 报告档按定义不判失败 —— 把它接进钩子 = 接一个恒 `exit(0)` 的东西（接了个寂寞）；
 *   · 判定档没有执行者 —— 判据在场、没人敲它，文档却可能说它在跑。
 * 所以本脚本只对**判定型**要求「要么有执行者、要么登记」，对报告型只拦「自称在跑」。
 *
 * 执行者的口径（**只认直接调用**，不做跨文件传递闭包推断 —— 那会把「A 调用 B、
 * B 调用 C」的间接链一路上溯，误报一片、也会随重构静默失效）：
 *   · `.githooks/pre-commit`（提交门槛）与 `.githooks/prepare-commit-msg`（提交消息门槛）
 *     —— 后者是 ISSUE #1594 起的第二个本地钩子:「合并提交必须双亲」只能在那里判
 *     （`pre-commit` 看不到本次的消息），漏了它那条判据会被判成「无执行者」。
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
 * `shell-gate.mjs` 这几份**真在门禁链里跑**的判定型判据
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
const { readForScan, walkForScan, vanishedNote } = require("./gate-scan-read.cjs");
const { gateChainScripts } = require("./gate-chain-scripts.cjs");

/** 扫描期间消失的 `tests/` 文件数（由 `executorSources` 累加，结论行打印）。 */
let vanishedTests = 0;

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
 * `storybook-check.mjs` / `shell-gate.mjs` 几份**真在门禁链里跑**的
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
 * 「步骤位置」口径的**反向判据**：只作散文举例 / 被 import 的脚本不算判据。
 *
 * 为什么这条要住在脚本里而不是只住用例里：口径的退化（读全文而不是读步骤行）
 * **不会**让任何别的判定变红 —— 份数从 46 涨到 49，而涨出来的三份本来就「有执行者」
 * （它们在门禁链里被别的行提到），于是 `--report` 的「无执行者」那两栏一个字都不变。
 * 实测：把 `gateChainScripts()` 第一段换成读钩子全文，用例里比总数、比名字**都不响**。
 * 所以必须在**判据自己算出来的那张表**上反查 —— 那是唯一看得见这个差异的地方。
 *
 * 名单是实测来的（散文占位符 + 被 import / 被别的步骤行提到的执行器，见
 * `tests/gate-executors.test.ts` 的同名用例）。**只作断言、不参与过滤**：
 * 真实口径是「读步骤行」，这张名单只是它的一面镜子。
 */
const PROSE_ONLY_SCRIPTS = [
  "x.cjs", // 散文里的占位符举例
  "xxx.cjs",
  "affected-tests.mjs", // 清单库（C 组的执行器，不是判据）
  "install-git-hooks.mjs", // postinstall（被注释提到）
  "run-affected-tests.mjs", // C 组的测试启动器
  "quality-gate-shared.mjs", // 被 import 的共享常量
];

/**
 * 是否属于扫描面：**被门禁链调用**（事实）或**名字在前缀族里**（兜底）。
 * @param {string} name
 * @param {Set<string>} chain
 */
function isGateScript(name, chain) {
  if (!/\.(cjs|mjs)$/.test(name)) {
    return false;
  }
  if (chain.has(name)) {
    return true;
  }
  return GATE_NAME_PREFIXES.some((p) => name.startsWith(p));
}

/* ── 执行者来源（以这份清单为准，别在注释里数条数 —— 数一次就会漂）────── */

const EXECUTOR_SOURCES = [
  ".githooks/pre-commit",
  // `prepare-commit-msg` 是**第二个**本地钩子（ISSUE #1594）：「合并提交必须双亲」
  // 只能在这里判 —— `pre-commit` 看不到本次的消息（`COMMIT_EDITMSG` 在那一刻仍停在
  // 上一条提交上），而 prepare-commit-msg 的 `$2`(source) 能把 `--amend` 排除在外。
  // 漏登记它 = 那份判据被判成「无执行者」、台账双向拦报成负债 —— 而被拦下的动作
  // 恰恰是「把它接回钩子」，方向正好反了。
  // `pre-push` 同理，且它填的正是这一族最难补的那一格：平台侧 squash 合并本地看不见，
  // 「合并前的固定动作」此前唯一的执行者是人的记性（规范 §13.6.2.1）。不登记它，
  // 那次接线就会被读成「文档说有人跑、实际没人跑」—— 与本文件立案的现场同形。
  ".githooks/pre-push",
  "scripts/quality-gate.mjs",
  "package.json",
  "scripts/build-desktop.mjs",
  "scripts/standalone-private-inputs.mjs",
];

/**
 * `tests/**` 下的 `.test.ts(x)` 全表（执行者来源之一）。
 *
 * 枚举与读取都走 `gate-scan-read.cjs`：本判据把 `tests/` 当**扫描面**遍历，而并发用例
 * 会往里写自删探针（`.setup-cleanup-probe-*.test.tsx`）。原来的写法是
 * `fs.existsSync(dir)` + 裸 `readdirSync` + 裸 `readFileSync`，撞上那个空档会以一条
 * Node 栈崩在这里 —— 而这条判据报的是「谁的执行者没了」，崩掉时一个字都不吐。
 */
function testFiles() {
  return walkForScan(path.join(ROOT, "tests"), /\.test\.tsx?$/);
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
    if (!fs.existsSync(full)) {
      continue;
    }
    commandParts.push(fs.readFileSync(full, "utf8"));
  }
  /** 只收「真的起了子进程」的测试文件。 */
  const testSources = [];
  for (const full of testFiles()) {
    const src = readForScan(full);
    if (src === null) {
      /* 这一轮没读到那一份文件 —— 计数进结论行，不许静默（静默会让「某条判据的执行者
         只剩这一份文件」这种情况读成「没有执行者」，报出一条假红）。 */
      vanishedTests += 1;
      continue;
    }
    if (/\b(execFileSync|execFile|spawnSync|spawn)\s*\(/.test(src)) {
      testSources.push({
        rel: path.relative(ROOT, full).replaceAll("\\", "/"),
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
  if (sources.commandText.includes(name)) {
    return true;
  }
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
 * @returns {{onDemand: Record<string, {why: string, who: string}>, entrypoints: Record<string, Array<{flags: string[], judges: string, executors: string[]}>>}}
 */
function readLedger() {
  if (!fs.existsSync(LEDGER)) {
    return { onDemand: {}, entrypoints: {} };
  }
  const parsed = JSON.parse(fs.readFileSync(LEDGER, "utf8"));
  return { onDemand: parsed.onDemand ?? {}, entrypoints: parsed.entrypoints ?? {} };
}

/**
 * 一行命令里，**属于这个脚本自己**的那串旗标。
 *
 * 为什么要切到 `--` 分隔符为止：转述型包装器（`ci-cp936-exit.mjs -- node 别的脚本 --json`）
 * 把别人的旗标写在同一行上，按整行收就会把「包装器的一种形」数成十一种（实测探针：
 * 那份包装器在 `.cnb.yml` 里被读出 11 形，而它自己只有「无旗标」与 `--no-block` 两形）。
 * 这些旗标**不是判据的输入面**，误收的后果是让入口台账去要求一堆不存在的登记。
 *
 * @param {string} line
 * @param {string} scriptName 脚本文件名（`check-deps-freshness.mjs`）
 * @returns {Set<string> | null} 这一行没调起这个脚本时 null
 */
function ownFlags(line, scriptName) {
  const at = line.indexOf(scriptName);
  if (at === -1) {
    return null;
  }
  let rest = line.slice(at + scriptName.length);
  const sep = rest.search(/(?:^|\s)--(?:\s|$)/);
  if (sep >= 0) {
    rest = rest.slice(0, sep);
  }
  return new Set([...rest.matchAll(/--[\w-]+/g)].map((m) => m[0]));
}

/**
 * 那一行是不是**调用**（而不是提到）。
 *
 * 只剔掉整行注释：判据按文本解析钩子与 YAML，而那些文件里「怎么写」的说明就在注释里
 * （`.githooks/pre-commit:175` 那句正写着本脚本的名字）。不剔，注释会冒充执行者。
 * 边界：不认块注释中间的行 —— 台账条目真写错时这一层挡不住，但挡不住的方向是
 * **报红**（找不到调用行），不是放行。
 */
function isCallLine(line) {
  const t = line.trim();
  if (t === "") {
    return false;
  }
  return !(t.startsWith("#") || t.startsWith("//") || t.startsWith("*"));
}

/**
 * 校验台账里每一个**入口**（`脚本 + 那串旗标` 的组合）是不是真有执行者。
 *
 * 为什么要有这一层（ISSUE #2530 / 立案现场 #2385）：`hasExecutor()` 按 basename 比 ——
 * 同一份脚本的两种入口在账上塌成一个，而这两档判的**不是同一件事**
 * （`--staged` 只看这次是否动了依赖面，无参数那一档把整个 ② 判一遍）。于是
 * 「账面说有主」与「主场景那一档没人跑」可以同时为真，而后者不会让任何东西红。
 *
 * 这里刻意**不做自动发现**（不扫出「还有哪些脚本有多形而没登记」）：那是一台启发式机器，
 * 探针实测会把转述型包装器数成 11 形、误报一片，而本仓对这种机器的纪律就是不写
 * （硬规则 24 末句）。这一层只判**人登记过的入口**：登记了就验，验不到就红。
 * 未登记的那一格由 `--report` 那行的计数看得见（「账上入口级登记 N 条形 M」——
 * 0 也会说出来，不静默）。
 *
 * @param {ReturnType<typeof readLedger>["entrypoints"]} entrypoints
 * @param {string[]} names 判据脚本名单（反向核对用）
 * @returns {{problems: string[], forms: number}}
 */
function checkEntrypoints(entrypoints, names) {
  const problems = [];
  const cache = new Map();
  const readLines = (rel) => {
    if (!cache.has(rel)) {
      const src = readForScan(path.join(ROOT, rel));
      cache.set(rel, src === null ? null : src.split("\n").filter(isCallLine));
    }
    return cache.get(rel);
  };
  let forms = 0;
  for (const [script, entries] of Object.entries(entrypoints)) {
    if (!names.includes(script)) {
      problems.push(
        `入口台账登记了「${script}」，但 scripts/ 下没有这个判据脚本 —— ` +
          `改名 / 删除时把条目一起摘掉（与 onDemand 那半边同一条反向判据）`,
      );
      continue;
    }
    if (!Array.isArray(entries) || entries.length < 2) {
      problems.push(
        `「${script}」的入口登记只有 ${Array.isArray(entries) ? entries.length : 0} 形 —— ` +
          `入口这层存在的理由就是「同一脚本的几形判的不同」：一形就别登记，` +
          `按 basename 的那条判据已经覆盖它了`,
      );
      continue;
    }
    /* 口径（ISSUE #2590 期望 3 选定的那一半）：**登记成「入口」的脚本必须是判定型**。
     * 理由不是风格：本仓「入口」这个词在读者面上一直指「一条会判成败的命令」
     * （`.cnb.yml` 的格表、钩子的 `run` 行、`quality-gate.mjs` 的 `args:` 表项都是那个形状），
     * 而这一层登记的语义是「这一形由这条命令执行」—— 一份 0 处 `process.exit` 的报告型脚本
     * 没有「这一形的结论」可执行，它的在册面是 §11.23 的声明索引，不是这里。
     * 两个出口里选了「补正向判据」而不是「在注释里写明不要求」：后者等于把读者面的歧义
     * 留在原地，而那条歧义正是本症状的成因。
     * 对照读数：在册这 2 份 5 形跑这条是 0 红（两份都是判定型），所以这条不需要改任何
     * 既有的 `judges` 文案 —— 台账是结论，不是缓冲区。 */
    const scriptSrc = readForScan(path.join(ROOT, "scripts", script));
    if (scriptSrc !== null && !hasExit(scriptSrc)) {
      problems.push(
        `「${script}」被登记成入口（${entries.length} 形），但它是**报告型**` +
          `（源码里 0 处 \`process.exit\`）⇒ 「这一形由谁执行」问的是一条会判成败的命令，` +
          `报告型答不了它。要登记的是它的**在册面**：§11.23 的声明索引` +
          `（check-declaration-readers.cjs），不是本台账的 entrypoints`,
      );
      continue;
    }
    /* 「同一脚本的每一形只能被认成它自己那一形」（ISSUE #2590 把这条从特例推广成一般式）。
     * 排除集是「别的形点名的、而不属于本形的旗标」：
     *   · 无旗标那一形 —— `others` 就是全部被登记的旗标，退化成今天那句「不许被带旗标的行冒充」；
     *   · 带旗标那一形 —— 一行 `--staged --json` 不再同时证 `--staged` 那一形，
     *     否则**子集那一形一个执行者都没有而账面全绿**（这就是 #2530 那个「塌成」换了个方向：
     *     当年收的是「无旗标 vs 带旗标」，把不变量写成了特例，带旗标形之间还开着）。
     * ⚠️ 别把它实现成「一行只能命中一形」的全局分配 —— 一条命令确实可能同时是
     * 两个**不同脚本**的执行者，那样改会把这条判据变成容易误报的那一类。 */
    const declaredFlags = new Set(entries.flatMap((e) => (Array.isArray(e?.flags) ? e.flags : [])));
    /* 登记时就拒掉「两形旗标有包含关系（含相等）」：允许它存在，等于让「超集那一行同时证两形」
     * 是错还是有意在规范里没有答案 —— 上面那条排除也就没有拦头。
     *
     * ⚠️ **只对「两形都点了旗标」的配对成立**，这条范围不是妥协而是实测定的：本仓的
     * 「无旗标那一形」表达的是「整档、不收窄输入面」，它在集合论上是任何一形的子集 ——
     * 照字面把「任意两形 A 是 B 的子集」做成判据，在册那 2 份 5 形当场就红 2 条
     * （`--json` 包含 `(无旗标)` 与 `--staged` 包含 `(无旗标)`），而单子里明写「先跑在册的对照，
     * 期望它 0 红」⇒ 要拒的是「两个带旗标形互相冒充」那一种，不是「全档 vs 收窄」这一种。
     * 两者在下面那条排除里也各自被认成自己那一形：一行 `--json` 不会证「无旗标那一形」，
     * 反过来一行不带旗标的也不会证 `--json` 那一形。 */
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const a = new Set(entries[i]?.flags ?? []);
        const b = new Set(entries[j]?.flags ?? []);
        if (a.size === 0 || b.size === 0) {
          continue;
        }
        const contained = (x, y) => [...x].every((f) => y.has(f));
        const labelOf = (s) => [...s].join(" ");
        if (a.size === b.size && contained(a, b)) {
          problems.push(
            `「${script}」的两形旗标**完全相同**（都是 ${labelOf(a)}）⇒ 它们就是同一形：` +
              `合成一条登记（executors 并起来），别在账上摆两条长得不同的假形状`,
          );
        } else if (contained(a, b) || contained(b, a)) {
          problems.push(
            `「${script}」的两形 ${labelOf(a)} 与 ${labelOf(b)} 有**包含关系** —— ` +
              `登记成两形就必须判得动两行：要么本来就是一形（合成一条），` +
              `要么给它们各配一行真的不同的命令（互不包含）`,
          );
        }
      }
    }
    for (const entry of entries) {
      forms += 1;
      const flags = Array.isArray(entry?.flags) ? entry.flags : [];
      const label = flags.length > 0 ? flags.join(" ") : "(无旗标)";
      if (typeof entry?.judges !== "string" || entry.judges.trim() === "") {
        problems.push(
          `「${script}」那一形（${label}）没写「它判的是什么」—— 入口登记的全部价值` +
            `就在「这两形判的不是同一件事」那句，空着等于没登记`,
        );
      }
      const executors = Array.isArray(entry?.executors) ? entry.executors : [];
      if (executors.length === 0) {
        problems.push(`「${script}」那一形（${label}）一个执行者都没写`);
        continue;
      }
      for (const rel of executors) {
        const lines = readLines(rel);
        if (lines === null) {
          problems.push(
            `「${script}」那一形（${label}）写的执行者「${rel}」读不到 —— ` +
              `文件不在，那条命令也就不在`,
          );
          continue;
        }
        const others = [...declaredFlags].filter((f) => !flags.includes(f));
        const hit = lines.some((line) => {
          const mine = ownFlags(line, script);
          if (mine === null) {
            return false;
          }
          return flags.every((f) => mine.has(f)) && others.every((f) => !mine.has(f));
        });
        if (!hit) {
          problems.push(
            `「${script}」登记了那一形（${label}）说执行者是「${rel}」，` +
              `但那一份文件里没有一行**以这串旗标**调起它 —— ` +
              `要么那行命令改了形状（把台账跟着改），要么这一形现在其实没人跑（那就是本案）`,
          );
        }
      }
    }
  }
  return { problems, forms };
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

/* 扫描面自检放在最前：口径退化成读全文时，下面每一处判定都会**照常通过**
 * （多出来的那几份本来就「有执行者」），只有这一句看得见它。 */
{
  const chain = gateChainScripts();
  const leaks = PROSE_ONLY_SCRIPTS.filter((n) => isGateScript(n, chain));
  if (leaks.length > 0) {
    console.error(
      `[gate-executors] 扫描面退化了：${leaks.join("、")} 被打进判据表 ——\n` +
        '  口径是「只读门禁链的**步骤行**」（钩子的 `  run "…" <命令>`、\n' +
        "  `quality-gate.mjs` 的 `args:` 表项、`quality-gate.ps1` 的 `$Blocks`），\n" +
        "  不是「读那几份文件的全文」—— 全文会把散文里的占位符举例与被 import 的\n" +
        "  执行器一起收进来。见 §13.5.12 与 `gateChainScripts()` 的注释。\n",
    );
    process.exit(1);
  }
}

const problems = [];
const report = { judgeWithExecutor: [], judgeOrphaned: [], reportClaiming: [] };

for (const name of names) {
  const src = fs.readFileSync(path.join(scriptsDir, name), "utf8");
  const judge = hasExit(src);
  const referenced = hasExecutor(name, executors);
  const registered = Object.hasOwn(ledger.onDemand, name);

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

/* ④ 入口级登记（ISSUE #2530）：登记过的**每一形**都要在写明的执行者里找到那行命令。
 * 放在反向核对之后、`--update` 之前 —— 它报的每一条都指得回台账那一处。 */
const entryAudit = checkEntrypoints(ledger.entrypoints, names);
problems.push(...entryAudit.problems);

if (UPDATE) {
  const next = { onDemand: {} };
  for (const name of report.judgeOrphaned) {
    next.onDemand[name] = ledger.onDemand[name] ?? {
      why: "（请在 --update 后填写：为什么不能进钩子）",
      who: "（谁按需跑）",
    };
  }
  /* ⚠️ `entrypoints` 必须原样带过去：`--update` 是「诊疗后重写台账」那一步，
   * 只写 onDemand 会把入口那一半**整块抹掉**，而入口条目是人一条条核出来的 ——
   * 一次随手 --update 就把 #2530 这层判据变成空转（账面连红都不会红，因为没东西可验）。 */
  next.entrypoints = ledger.entrypoints;
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
  /* 入口这一层单独念，且**0 也要念出来**：它不是一张自动生成的清单，而是人逐条登记的；
   * 念成「0 形」就是明说「同一脚本的多形在账上还塌成一个」，静默才是这台判据自己的失效形态。 */
  console.log(
    `  入口级登记：${Object.keys(ledger.entrypoints).length} 份脚本 / ${entryAudit.forms} 形` +
      `（判定型判据共 ${report.judgeWithExecutor.length + report.judgeOrphaned.length} 份按名字有主 ——` +
      ` 多形而没登记的，这一行不会自动发现，见 §13.5.12 那条「不写启发式扫描器」的口径）`,
  );
  if (report.judgeOrphaned.length > 0) {
    console.log(`  无执行者：${report.judgeOrphaned.join("、")}`);
  }
  if (report.reportClaiming.length > 0) {
    console.log(`  报告型自称在跑：${report.reportClaiming.join("、")}`);
  }
  process.exit(0);
}

if (problems.length > 0) {
  console.log(`判据执行者台账：${problems.length} 处不一致（判据脚本共 ${names.length} 份）\n`);
  for (const p of problems) {
    console.log(`  ✗ ${p}`);
  }
  console.log(
    `\n规范 §13.5.12 的口径：判定型「要么有执行者、要么登记按需召唤」，` +
      `报告型不许自称供 pre-commit 调用，台账双向拦，` +
      `而登记成入口的每一形都要在那个执行者里真找得到那行命令（#2530）。`,
  );
  process.exit(1);
}

console.log(
  `判据执行者台账：${names.length} 份判据脚本 —— ` +
    `判定型有执行者 ${report.judgeWithExecutor.length}、` +
    `按需召唤 ${report.judgeOrphaned.length}、` +
    `入口级登记 ${Object.keys(ledger.entrypoints).length} 份 ${entryAudit.forms} 形、` +
    `报告型自称在跑 0 ✓` +
    vanishedNote(vanishedTests),
);
