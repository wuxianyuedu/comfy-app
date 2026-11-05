#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本：翻闸删掉的旗标 ⇄ 还在教人跑它们的散文（供 .githooks/pre-commit 的 D 组调用）
/**
 * 判据脚本的**散文承诺** ⇄ **真实旗标** —— 规范见
 * docs/standards/13-提交与-code-review.md §13.5.16。
 *
 * ── 立案现场（ISSUE #1811 收尾复审第三轮）────────────────────────────
 *
 * 翻硬闸这件事会在脚本里**删掉两个旗标**（`--update` / `--strict`）、删掉一份基线。
 * 而「谁还在说要跑那条命令」此前**没有任何判据**：上一轮（#1845）是人工 grep 一遍
 * 清掉 8 处，并把「翻闸时顺手 grep 旧旗标」写成一个**动作** —— 动作没有执行者，
 * 所以下一批翻闸必然再漂一次。
 *
 * 这一轮把它机器化，但**只做能证明的那一半**。
 *
 * ── 为什么只判 `--update` / `--strict`（而不是「所有旗标」）────────────
 *
 * 实测：把口径放成「用法块里提到的任何旗标都得在实现里读得到」，全仓报出 **17 处**，
 * 其中 **16 处是假红** —— `argv.indexOf("--x")` / `flags.has(名字)` /
 * `argv[i - 1] !== "--baseline"` / 位置透传（`e2e-run.mjs --grep` 直接交给
 * Playwright）……「实现里读不到」与「这个旗标不存在」是两件事，而前者的读法有**无穷
 * 多种**。判据一旦靠枚举读法，就会在每一种新写法上静默失效或误报 ——
 * 而**会误报的判据活不过一次评审**（§11.18.4），那正是 §12.18 点名的那类
 * 「靠清单守、下一次就漂」的判据。
 *
 * 收窄到 `--update` / `--strict` 之后假红归零，而这两个恰好是**翻闸唯一的动作对象**：
 *   · 只有它们被「翻硬闸」这件事删掉（`--report` / `--verify` 是清零后的自证，留着）；
 *   · 它们的**在场本身就是被别处断言的事实**（`tests/ratchet-update-guards.test.ts`
 *     的归类表为每一行断言「它仍带 `--update` 落盘通道」）；
 *   · 「承诺了却读不到」在这两面上**没有正当形态**：一个脚本不会既把
 *     `node scripts/x.cjs --update` 写进用法块、又在实现里完全不认它。
 * 这不是「覆盖面小」的妥协 —— 它是判据面**恰好等于**翻闸的风险面。
 *
 * ── 判什么（三格，各自一条用例）──────────────────────────────────────
 *
 * ① **用法块承诺 ⇄ 实现**：从脚本头部注释块里抽它**教人跑自己**的用法行
 *    （`node scripts/<自己>.cjs … --update`），取其中的 `--update` / `--strict`；
 *    实现里一个字都读不到那个旗标 ⇒ 红。
 *    **只看头部注释块**：实现里的红话话术（拒涨时打印的「再跑 `--update`」）
 *    同形同词，混进来会把判据变成另一件事。
 *
 * ② **棘轮归类表的陈词 ⇄ 事实**（`tests/ratchet-update-guards.test.ts`）：表里点名
 *    一个脚本，就是在**断言**「它今天仍带 `--update` 落盘通道」。出口没了却仍在表里
 *    ⇒ 红（该搬去 `HARD_GATE_FLIPS`，或删掉这一行）。
 *
 *    ⚠️ **① 判脚本自己的散文，② 判别人替它做的断言**：#1845 那 8 处里有 2 处正是
 *    「别人替它做的断言」（`check-reformat-only.cjs` 的红话叫人去跑
 *    `check-format.cjs --update`、`.githooks/pre-commit` 的注释叫人跑
 *    `check-file-structure.cjs --strict`），① 的射程到不了那里。
 *
 * ③ **仍叫人跑已翻闸脚本的旧旗标**：在「命令清单」与「脚本自己的红话 / 注释」里，
 *    找**同一行**既点到那个已翻闸脚本、又出现 `--update` / `--strict` 的地方。
 *
 *    · 命令清单 = `.githooks/pre-commit` 与 `docs/standards/13` —— 读的人下一步会
 *      照抄的地方；
 *    · 脚本自己 = `scripts/*.{cjs,mjs}` —— #1845 里最重的一处正在这里：
 *      `check-reformat-only.cjs` 的**用户可见阻断输出**末尾写着「存量清掉后记得
 *      `node scripts/check-format.cjs --update` 收紧格式棘轮」，而那条命令早已不存在。
 *      只收命令清单的话，这一处**恰恰漏在射程外**（实测：只收两处时那段回放命中 0）。
 *
 *    ⚠️ **为什么不是「全仓 grep 这个词」**：那样会把沿革叙述一起判（§11.25.1、
 *    §13.5.1、`changelog.d/**` 大量如实写着「曾经带 `--update`、翻闸时删掉」），
 *    误报一片 ⇒ 判据活不过一次评审（§11.18.4）。这一格要的是**同现**：
 *    一个**已翻闸的脚本名** + 一个翻闸旗标，落在同一行 —— 沿革叙述里也有同现
 *    （「`check-format.cjs` 已是硬闸、没有 `--update`」），所以再过一道**否定词**：
 *    行里出现「已删 / 不再 / 没有 / 翻闸 / 收掉 / 删除 / 断头」一类词就跳过。
 *    这不是「让判据猜语义」，它是**把已知的正当形态显式列出来**（与各判据的
 *    `EXEMPT_SITES` 同构），且下面每一条豁免都有实例可指。
 *
 * ④ **翻闸台账点名的脚本必须有执行者**（`HARD_GATE_FLIPS` 的键 ⇄ 门禁链 / 按需台账）：
 *    `HARD_GATE_FLIPS` 的值是自测文件，而**自测不是执行者** —— 它证明「这条判据的形态
 *    是对的」，不证明「有人会跑它」。18 条翻闸里有两条（`tw4-*`）起 Tailwind 引擎、
 *    单次约 6s，因此**不进钩子**（登记在 `scripts/.gate-executor-ledger.json` 的按需
 *    召唤台账里，这正是它们该有的形态）。
 *
 *    缺这一格的后果是**「已翻硬闸」这句话只兑现了一半**：翻闸的语义是「命中即退 1」，
 *    而**退 1 要有人跑**才发生。把一条判据从棘轮翻成硬闸、却不给它任何落点，
 *    得到的是「账面写着硬闸、实际连棘轮都不如」—— 棘轮至少有钩子里的那一步。
 *    （`check-ui-primitives.cjs` 的棘轮车道空置是另一件事：它**仍在钩子里跑**，
 *    只是写回去的账是空的。）
 *
 *    判据面是「两条正当落点**至少占一条**」：门禁链（`.githooks/pre-commit` /
 *    `quality-gate.mjs` / `quality-gate.ps1` 的步骤行）**或**按需召唤台账
 *    （`scripts/.gate-executor-ledger.json`）。两条都没有 ⇒ 红。
 *
 *    ⚠️ **为什么不复用 `check-gate-executors.cjs` 的口径直接判「无执行者」**：
 *    那一条已经在跑（实测它在 `--report` 里点名了 `tw4-*` 两条），而它判的是
 *    「**登记了没有**」；这一格判的是「**翻闸台账里那一句『命中即退 1』有没有兑现**」
 *    —— 两者的对象不同（一个是「每份判定型脚本」，一个是「翻了闸的那批」），
 *    而后者恰恰是 #1811 这条线上唯一还没被机器盯过的断言。
 *
 * ── 刻意不判（明写在案，别当成漏报）────────────────────────────────
 *
 *   · **沿革叙述里的旧旗标**（`docs/**` 与 `changelog.d/**` 里「曾经带 `--update`、
 *     翻闸时删掉」那类句子）：数量巨大（§11.25.1、§13.5.1、§16.2.3…），而「写错」
 *     与「如实记述沿革」在文本上同形。
 *   · **散文那一半**（这一段自己、§11.25.1 的收尾叙述）：与 `RETIRED_RATCHETS`
 *     那格的结论相同 —— 文字不可判，只能靠人对读。本判据只把**能证明的那一半**
 *     （同一份文件里 / 归类表的断言 / 确定命令形态）机器化。
 *   · **`--report` / `--verify` / `--grep` 一类**：它们的读法有多种（见上），
 *     且都不是翻闸的动作对象。
 *
 * ── 成本 ──────────────────────────────────────────────────────────────
 *
 * 纯文本扫描 140+ 份脚本 + 两张清单，实测 < 0.3s（零网络、零子进程）—— 照 §13.5.4
 * 的成本判据，这个量级该进钩子而不是按需召唤。
 *
 * 用法：
 *   node scripts/check-gate-flag-claims.cjs            # 检查（硬闸：命中即退 1）
 *   node scripts/check-gate-flag-claims.cjs --report   # 只出清单不判失败（盘点用）
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ARGS = new Set(process.argv.slice(2));
const REPORT_ONLY = ARGS.has("--report");

/**
 * 被翻闸删掉的旗标 —— 判据面**恰好**等于翻闸的风险面，理由见文件头。
 * 加一个新旗标之前先回答：「它是不是翻闸时会删掉的那个、且承诺了却没有正当形态？」
 */
const FLIP_FLAGS = ["--update", "--strict"];

const SCRIPT_DIR = "scripts";
const RATCHET_TEST = path.join("tests", "ratchet-update-guards.test.ts");

/**
 * 命令清单形态的目标文件（相对仓库根）。
 *
 * 只收这两处：它们的形态是**确定命令**（`node scripts/x.cjs …`），不是沿革叙述。
 * `docs/**` 的其余部分与 `changelog.d/**` 大量如实记述「曾经带 --update」，纳入即误报。
 */
const COMMAND_LISTS = [".githooks/pre-commit", "docs/standards/13-提交与-code-review.md"];

/**
 * 翻闸脚本的**两条正当落点**（④ 用）——「有人会跑它」这件事只有这两种机器形态：
 *
 *   · **门禁链**：`.githooks/pre-commit` 的步骤行、`quality-gate.mjs` 的 gate 表项、
 *     `quality-gate.ps1` 的 `$Blocks` 表项 —— 口径与 `check-gate-executors.cjs` 的
 *     `gateChainScripts()` **刻意同源**（那里只读「门禁步骤位置」、不读全文，理由见它
 *     的注释：读全文会把散文里的占位符举例与被 import 的执行器一起收进来）。
 *   · **按需召唤台账**：`scripts/.gate-executor-ledger.json` 的 `onDemand` 键
 *     —— `check-gate-executors.cjs` 已判过「登记了就说明它确实无执行者」，所以
 *     这里只认它的在场，不重复判它的理由写得对不对。
 *
 * **不抄第二份清单**：门禁链那三处是现读的（与那份脚本同一份事实），台账是现读的
 * JSON —— 新增一条翻闸时不需要回来改本文件。
 */
const GATE_CHAIN_FILES = [
  ".githooks/pre-commit",
  "scripts/quality-gate.mjs",
  "scripts/quality-gate.ps1",
];

/**
 * **聚合档**也是落点（`check-gate-executors.cjs` 的 `isGateScript` 认这一层）：
 * `run-ast-gates.cjs` 在自己的 `GATES` 表里逐条点名脚本，钩子只调它一行 ——
 * 于是「谁跑这条判据」的答案在**那张表**里，而不在钩子的步骤行上。
 *
 * 这不是特例补丁，而是与 `run-ast-gates.cjs` 自己的契约一致：它文件头写着
 * 「新增一条要同改三处：这里、`.githooks/pre-commit` 的那一行、以及
 * `tests/ast-gates-aggregate.test.ts` 的清单断言」。所以这一层必须跟着认，
 * 否则 ④ 会把「经聚合档真在跑」的两条判成无落点（实测：`check-non-null-assertions`
 * 与 `check-click-keyboard` 正是这样被误报的 —— 误报的判据活不过一次评审，§11.18.4）。
 */
const GATE_AGGREGATORS = ["scripts/run-ast-gates.cjs"];

const GATE_EXECUTOR_LEDGER = path.join("scripts", ".gate-executor-ledger.json");

/**
 * 门禁链里被按名字调起的脚本 basename 集合 —— 与 `check-gate-executors.cjs` 的
 * `gateChainScripts()` 同口径（只读**步骤位置**，不读全文）。
 */
function gateChainScripts() {
  const out = new Set();
  for (const rel of [...GATE_CHAIN_FILES, ...GATE_AGGREGATORS]) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      continue;
    }
    const src = fs.readFileSync(abs, "utf8");
    /* 形态一：`scripts/<x>`（钩子的 `run "…" node scripts/<x>`、`quality-gate` 的
     * `args: ["../scripts/<x>"]`、`$Blocks` 的 `Args`）—— 与 `check-gate-executors`
     * 的 `gateChainScripts()` 逐字同口径。 */
    for (const m of src.matchAll(/scripts[\\/]+(?<script>[A-Za-z0-9_.-]+\.(?:cjs|mjs))/g)) {
      out.add(m.groups?.script ?? "");
    }
    /* 形态二：聚合档表项里的裸 `script: "<x>"`（`run-ast-gates.cjs` 的 `GATES`）
     * —— 这里**没有** `scripts/` 前缀，因为聚合档按 basename import 它们。
     * 不收这一形态的后果实测过：经聚合档真在跑的两条被误报成「无落点」。 */
    for (const m of src.matchAll(
      /\bscript:\s*["'`](?<script>[A-Za-z0-9_.-]+\.(?:cjs|mjs))["'`]/g,
    )) {
      out.add(m.groups?.script ?? "");
    }
  }
  return out;
}

/** 按需召唤台账里登记的脚本名集合（读不出 ⇒ 空集，由 ④ 报「两条落点都没有」）。 */
function onDemandScripts() {
  const abs = path.join(ROOT, GATE_EXECUTOR_LEDGER);
  if (!fs.existsSync(abs)) {
    return new Set();
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(abs, "utf8"));
    return new Set(Object.keys(parsed.onDemand ?? {}));
  } catch {
    return new Set();
  }
}

/**
 * 格 ④：翻闸台账里点名的脚本，**两条正当落点至少占一条**。
 *
 * 缺这一格的形态很具体：「已翻硬闸」这句话宣称「命中即退 1」，而退 1 要有人跑才发生
 * —— 把一条判据从棘轮翻成硬闸却不给它落点，得到的是「账面写着硬闸、实际连棘轮都不如」。
 * 返回缺落点的那批脚本名。
 */
function flipsWithoutExecutor(flips) {
  const chain = gateChainScripts();
  const onDemand = onDemandScripts();
  return flips.filter((name) => !chain.has(name) && !onDemand.has(name));
}

function escapeRe(s) {
  return s.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/**
 * 头部注释块（文件头到第一行落在注释之外的实义代码）。
 *
 * **必须止于头部**：实现里的红话话术（`check-void-floats.cjs` 拒涨时打印的
 * 「……再 `--update`」）与用法行同形同词，混进来判的就是另一件事。
 */
function headComments(src) {
  const out = [];
  let inBlock = false;
  for (const line of src.split("\n")) {
    const t = line.trim();
    /* shebang（`#!…`）在用法块之前，跳过它继续读。 */
    if (!inBlock && t.startsWith("#!")) {
      continue;
    }
    if (inBlock) {
      out.push(line);
      if (t.includes("*/")) {
        inBlock = false;
      }
      continue;
    }
    if (t.startsWith("/*")) {
      out.push(line);
      if (!t.includes("*/")) {
        inBlock = true;
      }
      continue;
    }
    if (t.startsWith("//") || t === "") {
      out.push(line);
      continue;
    }
    break;
  }
  return out.join("\n");
}

/**
 * 头部注释里「教人跑**自己**」的那些行 —— 取其中的翻闸旗标。
 *
 * 行内必须点到脚本自己的名字（`scripts/<name>` 或裸 `<name>`）：叫别人去跑某条命令的
 * 那一类由 ② / ③ 判。旗标用**词边界**取（`--no` 不该被 `--no-verify` 带出来）。
 */
function promisedFlags(scriptName, headText) {
  const out = new Set();
  const self = new RegExp(`(?:node\\s+)?(?:scripts/)?${escapeRe(scriptName)}(?![\\w.-])`);
  for (const line of headText.split("\n")) {
    if (!self.test(line)) {
      continue;
    }
    for (const flag of FLIP_FLAGS) {
      if (new RegExp(`${escapeRe(flag)}(?![\\w-])`).test(line)) {
        out.add(flag);
      }
    }
  }
  return out;
}

/**
 * 实现里真读到的翻闸旗标 —— 认法从宽（判据要抓的是「整个旗标被删掉而用法行没跟着
 * 改」，不是「读法换了就报不出来」）。每一种拼法都认，假红就越少。
 */
function implementedFlags(src) {
  const out = new Set();
  for (const flag of FLIP_FLAGS) {
    const f = escapeRe(flag);
    const patterns = [
      /* `ARGS.has("--update")` / `args.includes('--update')` */
      new RegExp(`\\.(?:has|includes)\\(\\s*["'\`]${f}["'\`]\\s*\\)`),
      /* `argv.indexOf("--update")` / `argv.lastIndexOf(…)` */
      new RegExp(`indexOf\\(\\s*["'\`]${f}["'\`]\\s*\\)`),
      /* `argv[i] === "--update"` / `=== '--update'` */
      new RegExp(`===\\s*["'\`]${f}["'\`]`),
      /* `flags.add("--update")` / `flags.delete("--update")` / `new Set(["--update"])` */
      new RegExp(`["'\`]${f}["'\`]`),
      /* `--update` 作对象键（`{ "--update": handler }`） */
      new RegExp(`["'\`]${f}["'\`]\\s*:`),
    ];
    if (patterns.some((re) => re.test(src))) {
      out.add(flag);
    }
  }
  return out;
}

/** 一个脚本的「承诺 ⇄ 实现」两集合。 */
function inspectScript(file) {
  const src = fs.readFileSync(path.join(ROOT, SCRIPT_DIR, file), "utf8");
  return {
    file,
    promised: promisedFlags(file, headComments(src)),
    implemented: implementedFlags(src),
  };
}

/** `scripts/` 下的判据脚本（顶层，不含机制层子目录）。 */
/**
 * 全仓脚本文清单（一次进程内只 `readdir` 一次）。
 *
 * 这一份判据有四趟遍历都要它，而 `readdirSync` + 正则过滤在负载高的机器上不是零钱。
 * 缓存在这里是安全的：`ROOT` 取自 `__dirname/..`（用例把本脚本拷进临时工作区再 spawn，
 * 一个进程一个根），所以不存在「同一进程内两次答案不同」这条路。
 */
let scriptFilesCache = null;
function scriptFiles() {
  if (scriptFilesCache === null) {
    scriptFilesCache = fs
      .readdirSync(path.join(ROOT, SCRIPT_DIR))
      .filter((f) => /\.(?:cjs|mjs)$/.test(f))
      .sort();
  }
  return scriptFilesCache;
}

/** 读出 `tests/ratchet-update-guards.test.ts` 里某张表的函数体。 */
function tableBody(name) {
  const src = fs.readFileSync(path.join(ROOT, RATCHET_TEST), "utf8");
  const at = src.indexOf(`const ${name}`);
  if (at === -1) {
    return "";
  }
  const end = src.indexOf("\n};", at);
  return src.slice(at, end === -1 ? undefined : end);
}

/**
 * 现算「哪个脚本把哪份基线写回去」——与 `tests/ratchet-update-guards.test.ts` 的
 * `discoveredBaselines()` **同一份事实**，但这里**只取名字**，不复刻它的全部口径。
 *
 * 为什么必须现算而不是「表里读脚本名」：三张归类表的键是**基线文件名**
 * （`.form-field-wiring-baseline.json`），值是**用例文件**（`tests/…-gate.test.ts`），
 * 两者都不含脚本名 —— 脚本名只存在于「谁把这份基线写回去」这个事实上。
 * 抄一份对照表就是 §12.18 点名的「清单会漂」，而下一批棘轮落地时必漂。
 *
 * 口径与那份用例同源（认 `path.join(…, ".x.json")` 声明 + 真把它当写入目标）；
 * 差异只有一处：本判据**不参与**「基线该不该在册」的判定（那是那份用例的活），
 * 它只要「基线名 → 脚本名」这一层映射。
 */
function baselineOwners() {
  const dir = path.join(ROOT, SCRIPT_DIR);
  /** 基线名 → 脚本名（一个脚本可能落多份，一个基线也可能……不可能属于两个脚本）。 */
  const map = new Map();
  const baseName = (text) => /"(?<base>\.[^"]+\.json)"/.exec(text)?.groups?.base;
  for (const file of scriptFiles()) {
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    /* 声明：`const B = path.join(<根>, …, ".x.json")`。 */
    const declared = new Map();
    for (const m of src.matchAll(
      /(?:const|let|var)\s+(?<name>[A-Za-z0-9_$]+)\s*=\s*path\.join\((?<args>[^;]{0,300}?)\)/g,
    )) {
      const name = baseName(m.groups?.args ?? "");
      if (m.groups?.name && name) {
        declared.set(m.groups?.name, name);
      }
    }
    /* 真被当写入目标的变量名。 */
    const written = new Set();
    for (const m of src.matchAll(
      /(?:fs\.)?write(?:File|FileSync)\(\s*(?<varName>[A-Za-z0-9_$]+)/g,
    )) {
      const varName = m.groups?.varName;
      if (varName) {
        written.add(varName);
      }
    }
    for (const [varName, name] of declared) {
      if (written.has(varName)) {
        map.set(name, file);
      }
    }
    /* 直接把路径拼在写入调用里的写法（不走变量）。 */
    for (const m of src.matchAll(
      /(?:fs\.)?write(?:File|FileSync)\(\s*path\.join\([^;]{0,300}?"(?<json>\.[^"]+\.json)"/g,
    )) {
      if (m.groups?.json) {
        map.set(m.groups?.json, file);
      }
    }
  }
  return map;
}

/**
 * 格 ②：棘轮归类表里那些**替脚本做的断言**。
 *
 * 表里点名一份基线，就在**断言**「拥有它的那个脚本今天仍带 `--update` 落盘通道」
 * （见 §11.25 那张表）。核法不是抄一份旗标清单，而是把基线名经 `baselineOwners()`
 * 翻成脚本名、再**问脚本自己**。
 */
function ratchetTableScripts() {
  const owners = baselineOwners();
  const out = new Set();
  for (const table of ["COVERED_LOCALLY", "RETIRED_RATCHETS", "NOT_A_RATCHET"]) {
    /* 键 = 基线文件名（表里就以它当键）。 */
    for (const m of tableBody(table).matchAll(/["'`](?<baseline>\.[^"'`]+\.json)["'`]\s*:/g)) {
      const baseline = m.groups?.baseline ?? "";
      const script = owners.get(baseline);
      if (script) {
        out.add(script);
      } else {
        out.add(`(基线 ${baseline} 今天没有任何脚本写回去)`);
      }
    }
  }
  /* `RATCHETS` 是数组、行里有显式 `script:` 字段。 */
  for (const m of tableBody("RATCHETS").matchAll(
    /\bscript:\s*["'`](?<script>[a-z0-9-]+\.(?:cjs|mjs))["'`]/g,
  )) {
    out.add(m.groups?.script ?? "");
  }
  return [...out].sort();
}

/** 已翻硬闸的脚本名（`HARD_GATE_FLIPS` 的键；否定式由那一份用例判）。 */
function flipsScripts() {
  const out = [];
  for (const m of tableBody("HARD_GATE_FLIPS").matchAll(
    /["'`](?<script>[a-z0-9-]+\.(?:cjs|mjs))["'`]\s*:/g,
  )) {
    out.push(m.groups?.script ?? "");
  }
  return out.sort();
}

/**
 * 「这一行是在**如实记述它已经没了**」—— 出现这些词就跳过。
 *
 * 这不是语义猜测，是**把已知的正当形态显式列出来**（各判据的 `EXEMPT_SITES` 同款）：
 * 逐条都能指到实例 —— §11.25.1「`--strict` / `--update` 连同基线一并删除」、
 * §13.5.1「`--update` / `--strict` **不存在**（翻闸时删掉）」、
 * `check-format.cjs` 文件头「删基线、删 `--update` / `--strict`，命中即退 1」。
 *
 * 少一个词就会误报一片，多一个词就会漏一处 —— 所以这一组词**只收**「明确表示
 * 那个通道已经不在」的表述，不收「棘轮」「硬闸」这类还需要一句话语境的词。
 */
/**
 * 「这一行是在**如实记述它已经没了**」—— 出现这些词就跳过。
 *
 * 这不是语义猜测，是**把已知的正当形态显式列出来**（各判据的 `EXEMPT_SITES` 同款）：
 * 逐条都能指到实例 —— §11.25.1「`--strict` / `--update` 连同基线一并删除」、
 * §13.5.1「`--update` / `--strict` **不存在**（翻闸时删掉）」、
 * `check-format.cjs` 文件头「删基线、删 `--update` / `--strict`，命中即退 1」。
 */
const RETIRED_WORDS =
  /已删|删掉了|删掉|删除|不存在|不再|没有\s*`?--|无\s*`?--|翻闸|收掉|断头|摘掉|棘轮时代|曾带|曾经|原本还有|翻转前|翻前|同族先例/;

/**
 * 只认**命令**形态，不认「提到了那个旗标」。
 *
 * 两个形态各是一类真实事故：
 *
 * ① **裸命令**：行里出现 `node scripts/<翻闸脚本> … --flag`（含不带 `node` 前缀的
 *    清单写法与反引号包起来的写法）。这是 `.githooks/pre-commit` 与规范门禁清单里
 *    的形态 —— 读的人下一步就照它跑。
 * ② **输出话术里的命令**：**字符串字面量**里出现 `node scripts/<翻闸脚本> … --flag`。
 *    这是 #1845 里最重的那一处：`check-reformat-only.cjs` 的**用户可见阻断输出**
 *    叫人去跑 `node scripts/check-format.cjs --update`。
 *
 * 刻意**不认**「散文里并列提到某个脚本名与某个旗标」——实测那样的口径在全仓报出
 * 10 处，其中 10 处都是**分析性提及**（「与 `check-ui-logic-separation.cjs` 的
 * `--update` 门同一口径」「同族先例：… 的 `--update`」）。它们说的是**另一件事**
 * 且都成立，判它们就是把判据变成噪声源（§11.18.4）。
 */
const COMMAND_RE = (script, flag) =>
  new RegExp(
    `(?:node\\s+)?(?:scripts/)?${escapeRe(script)}(?![\\w.-])[^\`'"\n]{0,80}?${escapeRe(flag)}(?![\\w-])`,
  );

/**
 * 每条「(翻闸脚本, 旗标)」的正量**只编译一次**。
 *
 * 原先它在最内层构造 —— 量级是「目标文件 × 每份的行数 × 翻闸脚本数 × 2」，
 * 本机 `--cpu-prof` 空载实测吃掉了 **78%**（`COMMAND_RE` 50.1% + `escapeRe` 27.8%）。
 * 判定内容一字未改（同一个模板、同一组量、同一个 `test`），改的只是「什么时候构造」。
 *
 * @param {string[]} flips
 */
function commandMatchers(flips) {
  return flips.flatMap((script) =>
    FLIP_FLAGS.map((flag) => ({ script, flag, re: COMMAND_RE(script, flag) })),
  );
}

/**
 * 行里「有任何一个被管的旗标」这一条便宜前置门。
 *
 * 由 `FLIP_FLAGS` 派生，不在这里再抄一份字面量 —— 抄一份就等于给将来加旗标的人
 * 留一条「加了旗标、前置门不认，于是那一族永远扫不到」的静默缝。
 */
const SOME_FLIP_FLAG = new RegExp(
  `(?:${FLIP_FLAGS.map((flag) => escapeRe(flag)).join("|")})(?![\\w-])`,
);

/**
 * 找「仍叫人跑已翻闸脚本的旧旗标」的行。
 *
 * 两个落点同一条判定：命令清单（`.githooks/pre-commit` 与 `docs/standards/13`）
 * 与**脚本自己的字符串字面量**（红话话术）。
 *
 * **为什么必须收脚本自己**：#1845 里最重的一处（用户可见阻断输出）就在那里；
 * 实测只收命令清单时，把那段回放回去**命中 0** —— 射程漏掉了最该管的一处。
 */
function staleFlipCommands(flips) {
  const targets = [...COMMAND_LISTS, ...scriptFiles().map((f) => `${SCRIPT_DIR}/${f}`)];
  const matchers = commandMatchers(flips);
  const found = [];
  for (const rel of targets) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      continue;
    }
    fs.readFileSync(abs, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (RETIRED_WORDS.test(line)) {
          return;
        }
        /* **本判据自己的文件头**是「立案现场的描述」，必然要点名那两个脚本与旗标
         * —— 它描述的是**过去发生的事**，不是教人跑。这条自豁免是有先例的形态
         * （`check-doc-references.cjs` 的 `EXEMPT` 同款），且只豁免这一份文件、
         * 不是「凡是描述历史就不判」。 */
        if (rel === `${SCRIPT_DIR}/check-gate-flag-claims.cjs`) {
          return;
        }
        /* 下面两道前置门都是**原判定里就有的条件**，只是被挪到跑「翻闸脚本 × 旗标」
         * 那一圈正则之前：命中必须落在字符串字面量里（原式在 `re.test` 之后才看这个），
         * 而命令形态必然带旗标字面量。筛掉的是不可能命中的行，结论逐字不变。 */
        if (!/["'`]/.test(line)) {
          return;
        }
        if (!SOME_FLIP_FLAG.test(line)) {
          return;
        }
        for (const m of matchers) {
          if (!m.re.test(line)) {
            continue;
          }
          found.push({
            rel,
            line: i + 1,
            script: m.script,
            flag: m.flag,
            text: line.trim().slice(0, 160),
          });
        }
      });
  }
  return found;
}

/* ── main ─────────────────────────────────────────────────────────── */

function main() {
  const violations = [];
  const flips = flipsScripts();

  /* ① 用法块承诺 ⇄ 实现（只看脚本自己头部注释里教人跑自己的行）。 */
  for (const file of scriptFiles()) {
    const { promised, implemented } = inspectScript(file);
    for (const flag of promised) {
      if (implemented.has(flag)) {
        continue;
      }
      violations.push({
        kind: "用法块承诺了实现里没有的旗标",
        where: `${SCRIPT_DIR}/${file}`,
        detail:
          `用法块教人跑 \`${flag}\`，而实现里读不到它 —— ` + "照它跑要么没反应、要么被读成别的档",
      });
    }
  }

  /* ② 棘轮归类表的陈词 ⇄ 事实（表里每一行都断言「它仍带 --update」）。 */
  for (const script of ratchetTableScripts()) {
    /* 基线名翻了半天翻不出拥有者 —— 表里的那一行已经**没有对应的事实**了
     * （脚本被删/改名，或那份基线不再由任何脚本写回去）。 */
    if (script.startsWith("(基线 ")) {
      violations.push({
        kind: "棘轮归类表点名了一份没有任何脚本写回去的基线",
        where: RATCHET_TEST,
        detail: `${script.replaceAll(/^\(基线 |\)$/g, "")} —— 该行的归属已不存在，删掉或改指新落点`,
      });
      continue;
    }
    if (!fs.existsSync(path.join(ROOT, SCRIPT_DIR, script))) {
      violations.push({
        kind: "棘轮归类表点名了一个不存在的脚本",
        where: RATCHET_TEST,
        detail: `${script} 在表里，而 scripts/ 下没有这份文件`,
      });
      continue;
    }
    if (flips.includes(script)) {
      continue;
    } /* 翻闸那些由那一份的否定式判 */
    if (inspectScript(script).implemented.has("--update")) {
      continue;
    }
    violations.push({
      kind: "棘轮归类表断言它带 --update，而实现里没有",
      where: `${RATCHET_TEST} → ${SCRIPT_DIR}/${script}`,
      detail:
        "表里点名 = 断言「仍有 --update 落盘通道」。出口没了就不是这一类：" +
        "该搬去 HARD_GATE_FLIPS，或删掉这一行",
    });
  }

  /* ③ 命令清单里仍叫人跑已翻闸脚本的旧旗标。 */
  for (const hit of staleFlipCommands(flips)) {
    violations.push({
      kind: `命令清单里仍叫人跑已翻闸脚本的 ${hit.flag}`,
      where: `${hit.rel}:${hit.line}`,
      detail: `${hit.script} 已翻硬闸（无 ${hit.flag}），这里还写着：${hit.text}`,
    });
  }

  /* ④ 翻闸台账点名的脚本必须有执行者（翻闸说的是「命中即退 1」，而退 1 要有人跑）。 */
  for (const script of flipsWithoutExecutor(flips)) {
    violations.push({
      kind: "翻闸台账点名了它，而它一条落点都没有",
      where: `${RATCHET_TEST} → ${SCRIPT_DIR}/${script}`,
      detail:
        `${script} 已翻硬闸，但门禁链（${[...GATE_CHAIN_FILES, ...GATE_AGGREGATORS].join(" / ")}）与` +
        `按需召唤台账（${GATE_EXECUTOR_LEDGER}）都没有它 —— ` +
        "「命中即退 1」这条承诺要有人跑才兑现；两条落点选一条接上再登记进 HARD_GATE_FLIPS",
    });
  }

  const scope =
    `${scriptFiles().length} 份脚本 / ${ratchetTableScripts().length} 个归类表条目 / ` +
    `${flips.length} 条翻闸台账（落点缺失 ${flipsWithoutExecutor(flips).length}）`;

  if (REPORT_ONLY) {
    console.log(`[gate-flag-claims] 盘点：${scope}；命中 ${violations.length} 处`);
    for (const v of violations) {
      console.log(`  · [${v.kind}] ${v.where}\n      ${v.detail}`);
    }
    return;
  }

  if (violations.length) {
    console.error(`✗ 翻闸删掉的旗标还在被人教着跑（${violations.length} 处）：`);
    for (const v of violations) {
      console.error(`\n  [${v.kind}] ${v.where}`);
      console.error(`    ${v.detail}`);
    }
    console.error(
      "\n修法：**改散文**（用法块 / 归类表 / 命令清单）去对实现，不要为了留住那句话" +
        "\n     把旗标加回来 —— 翻硬闸删掉的通道不会因为有人还在教它而应该存在。" +
        "\n     若那段是沿革叙述（「曾经带 --update，已删」），把它写出「已删」并移出用法块：" +
        "\n     本判据认的是**命令**形态，不是「提到过这个词」。",
    );
    process.exit(1);
  }

  console.log(`✓ 翻闸旗标没有残留的散文承诺（${scope}）`);
}

if (require.main === module) {
  main();
}

module.exports = {
  FLIP_FLAGS,
  headComments,
  promisedFlags,
  implementedFlags,
  inspectScript,
  scriptFiles,
  ratchetTableScripts,
  flipsScripts,
  staleFlipCommands,
  flipsWithoutExecutor,
  gateChainScripts,
  onDemandScripts,
  COMMAND_LISTS,
  GATE_CHAIN_FILES,
  GATE_AGGREGATORS,
};
