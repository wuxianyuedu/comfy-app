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
const COMMAND_LISTS = [
  ".githooks/pre-commit",
  "docs/standards/13-提交与-code-review.md",
];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    if (!inBlock && t.startsWith("#!")) continue;
    if (inBlock) {
      out.push(line);
      if (t.includes("*/")) inBlock = false;
      continue;
    }
    if (t.startsWith("/*")) {
      out.push(line);
      if (!t.includes("*/")) inBlock = true;
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
  const self = new RegExp(
    `(?:node\\s+)?(?:scripts/)?${escapeRe(scriptName)}(?![\\w.-])`,
  );
  for (const line of headText.split("\n")) {
    if (!self.test(line)) continue;
    for (const flag of FLIP_FLAGS) {
      if (new RegExp(`${escapeRe(flag)}(?![\\w-])`).test(line)) out.add(flag);
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
    if (patterns.some((re) => re.test(src))) out.add(flag);
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
function scriptFiles() {
  return fs
    .readdirSync(path.join(ROOT, SCRIPT_DIR))
    .filter((f) => /\.(cjs|mjs)$/.test(f))
    .sort();
}

/** 读出 `tests/ratchet-update-guards.test.ts` 里某张表的函数体。 */
function tableBody(name) {
  const src = fs.readFileSync(path.join(ROOT, RATCHET_TEST), "utf8");
  const at = src.indexOf(`const ${name}`);
  if (at < 0) return "";
  const end = src.indexOf("\n};", at);
  return src.slice(at, end < 0 ? undefined : end);
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
  const baseName = (text) => /"(\.[^"]+\.json)"/.exec(text)?.[1];
  for (const file of scriptFiles()) {
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    /* 声明：`const B = path.join(<根>, …, ".x.json")`。 */
    const declared = new Map();
    for (const m of src.matchAll(
      /(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*path\.join\(([^;]{0,300}?)\)/g,
    )) {
      const name = baseName(m[2] ?? "");
      if (m[1] && name) declared.set(m[1], name);
    }
    /* 真被当写入目标的变量名。 */
    const written = new Set();
    for (const m of src.matchAll(
      /(?:fs\.)?write(?:File|FileSync)\(\s*([A-Za-z0-9_$]+)/g,
    )) {
      if (m[1]) written.add(m[1]);
    }
    for (const [varName, name] of declared) {
      if (written.has(varName)) map.set(name, file);
    }
    /* 直接把路径拼在写入调用里的写法（不走变量）。 */
    for (const m of src.matchAll(
      /(?:fs\.)?write(?:File|FileSync)\(\s*path\.join\([^;]{0,300}?"(\.[^"]+\.json)"/g,
    )) {
      if (m[1]) map.set(m[1], file);
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
  for (const table of [
    "COVERED_LOCALLY",
    "RETIRED_RATCHETS",
    "NOT_A_RATCHET",
  ]) {
    /* 键 = 基线文件名（表里就以它当键）。 */
    for (const m of tableBody(table).matchAll(
      /["'`](\.[^"'`]+\.json)["'`]\s*:/g,
    )) {
      const script = owners.get(m[1]);
      if (script) out.add(script);
      else out.add(`(基线 ${m[1]} 今天没有任何脚本写回去)`);
    }
  }
  /* `RATCHETS` 是数组、行里有显式 `script:` 字段。 */
  for (const m of tableBody("RATCHETS").matchAll(
    /\bscript:\s*["'`]([a-z0-9-]+\.(?:cjs|mjs))["'`]/g,
  )) {
    out.add(m[1]);
  }
  return [...out].sort();
}

/** 已翻硬闸的脚本名（`HARD_GATE_FLIPS` 的键；否定式由那一份用例判）。 */
function flipsScripts() {
  const out = [];
  for (const m of tableBody("HARD_GATE_FLIPS").matchAll(
    /["'`]([a-z0-9-]+\.(?:cjs|mjs))["'`]\s*:/g,
  )) {
    out.push(m[1]);
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
 * 找「仍叫人跑已翻闸脚本的旧旗标」的行。
 *
 * 两个落点同一条判定：命令清单（`.githooks/pre-commit` 与 `docs/standards/13`）
 * 与**脚本自己的字符串字面量**（红话话术）。
 *
 * **为什么必须收脚本自己**：#1845 里最重的一处（用户可见阻断输出）就在那里；
 * 实测只收命令清单时，把那段回放回去**命中 0** —— 射程漏掉了最该管的一处。
 */
function staleFlipCommands(flips) {
  const targets = [
    ...COMMAND_LISTS,
    ...scriptFiles().map((f) => `${SCRIPT_DIR}/${f}`),
  ];
  const found = [];
  for (const rel of targets) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    fs.readFileSync(abs, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (RETIRED_WORDS.test(line)) return;
        /* **本判据自己的文件头**是「立案现场的描述」，必然要点名那两个脚本与旗标
         * —— 它描述的是**过去发生的事**，不是教人跑。这条自豁免是有先例的形态
         * （`check-doc-references.cjs` 的 `EXEMPT` 同款），且只豁免这一份文件、
         * 不是「凡是描述历史就不判」。 */
        if (rel === `${SCRIPT_DIR}/check-gate-flag-claims.cjs`) return;
        for (const script of flips) {
          for (const flag of FLIP_FLAGS) {
            const re = COMMAND_RE(script, flag);
            if (!re.test(line)) continue;
            /* ② 那一类进一步要求它落在**字符串字面量**里（红话 / 命令清单里的
             * 反引号引用都算）——裸的散文行不算。 */
            const inString = /["'`]/.test(line);
            if (!inString) continue;
            found.push({
              rel,
              line: i + 1,
              script,
              flag,
              text: line.trim().slice(0, 160),
            });
          }
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
      if (implemented.has(flag)) continue;
      violations.push({
        kind: "用法块承诺了实现里没有的旗标",
        where: `${SCRIPT_DIR}/${file}`,
        detail:
          `用法块教人跑 \`${flag}\`，而实现里读不到它 —— ` +
          "照它跑要么没反应、要么被读成别的档",
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
        detail: `${script.replace(/^\(基线 |\)$/g, "")} —— 该行的归属已不存在，删掉或改指新落点`,
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
    if (flips.includes(script)) continue; /* 翻闸那些由那一份的否定式判 */
    if (inspectScript(script).implemented.has("--update")) continue;
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

  const scope =
    `${scriptFiles().length} 份脚本 / ${ratchetTableScripts().length} 个归类表条目 / ` +
    `${flips.length} 条翻闸台账`;

  if (REPORT_ONLY) {
    console.log(
      `[gate-flag-claims] 盘点：${scope}；命中 ${violations.length} 处`,
    );
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

if (require.main === module) main();

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
  COMMAND_LISTS,
};
