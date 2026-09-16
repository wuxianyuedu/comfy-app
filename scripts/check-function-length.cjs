#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:函数长度扫描(供 .githooks/pre-commit 与 CI 调用)
/**
 * 函数长度扫描 —— 规范见 docs/standards/12-代码组织与文件结构.md §12.13。
 *
 * 背景(ISSUE #536 P4)：文件行数有 R5 守着(超 900 行提醒)，**函数**没有 ——
 * 于是 `settings/SettingsPageView.tsx` 的 `SettingsPageView` 单函数 2186 行
 * 一路合法存在：它塞了约 15 个设置分区，任何改动都要先在这两千行里定位，
 * 而「能不能拆」这件事**没有任何机器信号**。R5 看见了文件，看不见函数。
 *
 * 本脚本补齐那个维度，分两层(与主题色扫描同构)：
 *   ① **提示层**(`--strict` 之外): 超 `HINT_LINES`(400) 的函数打印清单，
 *      只提醒不阻断 —— 存量 19 个函数在这一档，逐步拆。
 *   ② **阻断层**(strict，棘轮): 每个文件的「超阈值函数数」记进
 *      `scripts/.function-length-baseline.json`，**只许降不许升**：新增一个
 *      400 行以上的函数即阻断(不得静默长出第二个巨型函数)。
 *
 * 判定的是**函数体行数**(声明行到配对右括号)，不是文件行数：
 *  · 认 `function f(...) {`、`export async function f(...) {`、
 *    `const f = (...) => {`、`const f = async (...) => {` 几种声明形态；
 *  · 用**括号配对**定位函数尾 —— 比缩进可靠(本项目 2 空格缩进，但模板字符串
 *    与 JSX 里的括号不参与计数，靠括号字符流即可)；
 *  · 跳过小函数与测试文件(用例之间雷同是正常的)。
 *
 * 用法:
 *   node scripts/check-function-length.cjs           # 检查(棘轮)
 *   node scripts/check-function-length.cjs --strict  # 基线未收紧也失败(CI 用)
 *   node scripts/check-function-length.cjs --update  # 重写基线(须伴随下降)
 *   node scripts/check-function-length.cjs --report  # 只出清单不判失败(盘点用)
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const BASELINE = path.join(__dirname, ".function-length-baseline.json");
const ARGS = new Set(process.argv.slice(2));
const UPDATE = ARGS.has("--update");
const STRICT = ARGS.has("--strict");
const REPORT_ONLY = ARGS.has("--report");

/** 扫描范围：应用源码。 */
const SCAN_DIR = "src";
const SOURCE_EXT = /\.(ts|tsx)$/;
const isTestFile = (rel) =>
  /\.test\.[cm]?[jt]sx?$/.test(rel) || /\.snap$/.test(rel) || rel.includes("/__tests__/");

/** 超过这个行数的函数进「拆分候选」清单(与 R5 的文件阈值同性质：提示级)。
 *
 *  400 不是拍的：本项目 400 行以上的函数共 19 个，正好是「人工排期拆得完」的
 *  规模；降到 200 会让 40 个函数一起亮，清单变成噪音，没人会照它排期。 */
const HINT_LINES = 400;

/** **判据版本**：命中哪些形态算「一个函数」。
 *
 *  棘轮基线记的是「该判据下每个文件的超阈值函数数」，所以判据本身变了（例如
 *  把无名字的 IIFE / 回调体纳入统计）之后，旧基线与新计数**不是同一个量** ——
 *  直接比对会把「新看见的存量」误判成「新增的巨型函数」。
 *
 *  这个常量的作用是让那次变更**可审计**：改了判据必须同步改这里，`--update`
 *  才允许重记基线（否则一律按棘轮拒绝放宽）。版本号写进基线文件，评审时能看出
 *  「这次基线数字变了，是因为判据变了，而不是有人偷偷放宽」。 */
const RULE_VERSION = 3;

/** 括号字符流需要跳过的部分：字符串 / 模板 / 注释 / 正则里的括号不算配对。
 *  逐字符状态机(与 check-theme-colors 的 stripComments 同思路，这里保留原
 *  字符以便定位)。 */
function bracketDepths(lines) {
  /** 每行结束时的括号深度(从函数起始行开始累计)。 */
  const depthAtLine = new Array(lines.length).fill(0);
  let depth = 0;
  /** 跨行的块注释/模板字符串状态。 */
  let inBlock = false;
  let inTemplate = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let inStr = null;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      const nx = line[j + 1];
      if (inBlock) {
        if (ch === "*" && nx === "/") {
          inBlock = false;
          j++;
        }
        continue;
      }
      if (inTemplate > 0) {
        if (ch === "\\") {
          j++;
          continue;
        }
        if (ch === "`") inTemplate--;
        continue;
      }
      if (inStr) {
        if (ch === "\\") {
          j++;
          continue;
        }
        if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === "/" && nx === "/") break; // 行注释
      if (ch === "/" && nx === "*") {
        inBlock = true;
        j++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inStr = ch;
        continue;
      }
      if (ch === "`") {
        inTemplate++;
        continue;
      }
      /* 只认 `()` `{}` `[]`：`<` `>` **不参与配对** —— TSX 里的泛型参数
       * (`TaskProgressNode | undefined`) 与 JSX 标签都会被当成不配平的尖括号，
       * 累计下去整文件深度漂成负数，函数尾永远找不到(实测泄漏为「一个 TSX 文件
       * 只报 0~1 个巨型函数」)。这三种括号在 TS/TSX 里总是配平的。 */
      if (ch === "{" || ch === "(" || ch === "[") depth++;
      else if (ch === "}" || ch === ")" || ch === "]") depth--;
    }
    depthAtLine[i] = depth;
  }
  return depthAtLine;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      walk(p, out);
    } else out.push(p);
  }
  return out;
}

const relOf = (p) =>
  p.split(path.sep).join("/").replace(ROOT.split(path.sep).join("/") + "/", "");

/* ── 采集 ────────────────────────────────────────────────── */

/** 具名函数头的**开头**：签名可能跨行（`export async function f(\n  opts…`），
 *  所以这里只认开头，函数体 `{` 由 findBodyBrace 向后配平 `()` 找。 */
const NAMED_HEAD_RE =
  /(?:^|[\s;{}()])(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*[(<]/;
/** `const f = (` / `const f = async (` / `const f: T = function (` 三种赋值形态。 */
const ASSIGN_HEAD_RE =
  /(?:^|[\s;{}()])(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*?)?=\s*(?:async\s*)?(?:\(\s*\)|\([^()\n]*\)\s*(?::[^=\n]*?)?=>|function\b)/;

/** 中文、字符串、模板与注释里的 `=>` / `function` / `const x = (` 会误报：
 *  采集前先把它们按字符换成空格（**保留长度与列号**，行号不受影响）。 */
function stripNonCode(lines) {
  const out = [];
  let inBlock = false;
  let inTemplate = 0;
  for (const line of lines) {
    let res = "";
    let inStr = null;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      const nx = line[j + 1];
      if (inBlock) {
        if (ch === "*" && nx === "/") {
          inBlock = false;
          j++;
        }
        res += "  ";
        continue;
      }
      if (inTemplate > 0) {
        if (ch === "\\") {
          j++;
          res += "  ";
          continue;
        }
        if (ch === "`") inTemplate--;
        res += " ";
        continue;
      }
      if (inStr) {
        if (ch === "\\") {
          j++;
          res += "  ";
          continue;
        }
        if (ch === inStr) inStr = null;
        res += " ";
        continue;
      }
      if (ch === "/" && nx === "/") {
        res += " ".repeat(line.length - j);
        break;
      }
      if (ch === "/" && nx === "*") {
        inBlock = true;
        j++;
        res += "  ";
        continue;
      }
      if (ch === '"' || ch === "'") {
        inStr = ch;
        res += " ";
        continue;
      }
      if (ch === "`") {
        inTemplate++;
        res += " ";
        continue;
      }
      res += ch;
    }
    out.push(res);
  }
  return out;
}

/** 从 (line, col) 处的 `(` 起配平，返回紧跟其后的函数体 `{` 坐标；找不到返回 null。
 *  只配 `()` 与 `[]`（`<>` 与 bracketDepths 同一取舍：TSX 里不配平）。 */
function findBodyBrace(codeLines, line, col) {
  let depth = 0;
  let seenClose = false;
  for (let i = line; i < codeLines.length; i++) {
    const text = codeLines[i];
    for (let j = i === line ? col : 0; j < text.length; j++) {
      const ch = text[j];
      if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") {
        depth--;
        if (ch === ")") seenClose = true;
      } else if (depth <= 0 && ch === "{") {
        /* 必须已见过 `)` —— 否则 `function f({a, b}) {` 的解构参数会被当函数体。 */
        return seenClose ? { line: i, col: j } : null;
      } else if (depth < 0) return null;
    }
  }
  return null;
}

/** 找出一行里所有**匿名**块体：`=> {` 与无名字的 `function (…) {`。 */
function findAnonHeads(codeLines, i) {
  const text = codeLines[i];
  const heads = [];
  const arrow = /=>\s*\{/g;
  let m;
  while ((m = arrow.exec(text)) !== null) {
    heads.push({ decl: i, body: i, name: null });
  }
  const fnAnon = /(?:^|[\s(=,:;[{])(?:async\s+)?function\s*\(/g;
  while ((m = fnAnon.exec(text)) !== null) {
    const brace = findBodyBrace(codeLines, i, m.index + m[0].length - 1);
    if (brace) heads.push({ decl: i, body: brace.line, name: null });
  }
  return heads;
}

/** 扫描一个文件里的全部函数头。具名头的签名区间不再参与匿名识别 ——
 *  否则 `(msg: string) => void` 这种类型注解会被当成回调。 */
function collectHeads(codeLines) {
  const heads = [];
  const byPos = new Map();
  /* 同一个函数体只留一条（键 = 函数体所在行）：签名跨行时声明行与函数体行不同，
   *  但函数体只有一个。具名优先于匿名（名字比「(匿名块体)」有信息量），
   *  `decl` 取最小（函数头真正开始的那一行）。 */
  const push = (h) => {
    const key = h.body;
    const prev = byPos.get(key);
    if (!prev) {
      byPos.set(key, h);
      return;
    }
    if (prev.name && !h.name) return;
    byPos.set(key, {
      decl: Math.min(prev.decl, h.decl),
      body: h.body,
      name: h.name ?? prev.name,
    });
  };
  for (let i = 0; i < codeLines.length; i++) {
    const line = codeLines[i];
    let namedEnd = -1;
    for (const re of [NAMED_HEAD_RE, ASSIGN_HEAD_RE]) {
      const m = re.exec(line);
      if (!m) continue;
      const parenAt = line.indexOf("(", m.index + m[0].length - 1);
      const brace = findBodyBrace(codeLines, i, parenAt < 0 ? 0 : parenAt);
      if (!brace) continue;
      push({ decl: i, body: brace.line, name: m[1] });
      namedEnd = brace.line;
      break;
    }
    for (const h of findAnonHeads(codeLines, i)) {
      /* 落在具名签名区间内的匿名头是类型注解 / 参数默认值的一部分，跳过。 */
      if (namedEnd >= i && h.body <= namedEnd) continue;
      push(h);
    }
  }
  return [...byPos.values()].sort((a, b) => a.decl - b.decl || a.body - b.body);
}

/** 扫描一个文件，返回超阈值函数清单。
 *
 *  **嵌套两层都报**：外层具名函数与它内部的无名字块体各自超阈值时是两条记录
 *  —— 它们要拆的方式不同（前者按职责切分支，后者直接提成具名函数），只报外层
 *  会让内块继续在「外层已经很糟」的掩护下膨胀。完全相同的区间才去重。 */
function scanFile(rel, source) {
  const lines = source.split("\n");
  const codeLines = stripNonCode(lines);
  const depthAtLine = bracketDepths(lines);
  const rows = [];

  for (const head of collectHeads(codeLines)) {
    /* 函数尾：函数体 `{` 所在行(含 `{`)结束时的深度为 D，函数体内容在
     *  D 之上；配平回 `D - 1` 的那一行就是函数尾（含它的 `}`）。 */
    const bodyDepth = depthAtLine[head.body];
    let end = -1;
    for (let j = head.body; j < lines.length; j++) {
      if (depthAtLine[j] < bodyDepth) {
        end = j;
        break;
      }
    }
    if (end < 0) continue;
    /* 长度从**声明行**算起（签名占了 7 行时那 7 行也属这个函数）。 */
    const size = end - head.decl + 1;
    if (size < HINT_LINES) continue;
    rows.push({
      rel,
      line: head.decl + 1,
      name: head.name ?? "(匿名块体)",
      lines: size,
      start: head.decl,
      end,
      named: !!head.name,
    });
  }

  rows.sort((a, b) => a.start - b.start || b.lines - a.lines);
  /* 去重只对**完全相同**的区间生效（同一函数被多个形态命中）。嵌套两条
   *  （外层具名 405 行、内层 IIFE 288 行）**都保留**：两条都要拆，只报外层会
   *  让内层继续在「外层已经很糟」的掩护下膨胀。 */
  const kept = [];
  const seen = new Set();
  for (const f of rows) {
    const key = f.start + ":" + f.end;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(f);
  }
  return kept.map(({ start, end, named, ...rest }) => rest);
}

const longFunctions = [];
for (const abs of walk(path.join(ROOT, SCAN_DIR))) {
  const rel = relOf(abs);
  if (!SOURCE_EXT.test(rel) || rel.endsWith(".d.ts")) continue;
  if (isTestFile(rel)) continue;
  longFunctions.push(...scanFile(rel, fs.readFileSync(abs, "utf8")));
}

longFunctions.sort((a, b) => b.lines - a.lines || a.rel.localeCompare(b.rel));

/** 棘轮口径：**按文件的超阈值函数数**记账(与主题色棘轮的「文件→处数」同构)。
 *  用函数名做键会让「改名」被当成新增；用数量则只关心「这个文件里还有几个
 *  巨型函数」，拆掉一个就少一个。 */
const counts = {};
for (const f of longFunctions) counts[f.rel] = (counts[f.rel] ?? 0) + 1;

const fmt = (f) => `  · ${f.lines} 行  ${f.rel}:${f.line}  ${f.name}`;

/* ── 报告 / 棘轮 ────────────────────────────────────────── */

if (REPORT_ONLY) {
  console.log(
    `[function-length] 扫描 ${SCAN_DIR}/**：超过 ${HINT_LINES} 行的函数 ${longFunctions.length} 个：`,
  );
  console.log(longFunctions.map(fmt).join("\n") || "  （无）");
  console.log("[function-length] --report 模式：只出清单，不判失败 ✓");
  process.exit(0);
}

const prev = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : null;
const baseFiles = prev?.files ?? null;

if (UPDATE) {
  const before = baseFiles ? Object.values(baseFiles).reduce((a, b) => a + b, 0) : 0;
  const after = longFunctions.length;
  /* 判据变更时（RULE_VERSION 抬升）允许一次性重记：旧基线与新计数不是同一个量。
   * 除此之外，数字只许下降 —— 否则 `--update` 就成了「放宽棘轮」的后门。 */
  const ruleChanged = baseFiles && prev.ruleVersion !== RULE_VERSION;
  if (baseFiles && after > before && !ruleChanged) {
    console.error(
      `[function-length] 拒绝放宽基线：${before} → ${after} 个巨型函数（棘轮只许下降）。\n` +
        "  新增的先拆开，不要用 --update 掩盖。\n" +
        `  若确属判据变更（现为 RULE_VERSION=${RULE_VERSION}），须先改脚本里的常数再 --update。`,
    );
    process.exit(1);
  }
  fs.writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString().slice(0, 10),
        ruleVersion: RULE_VERSION,
        note:
          `超过 ${HINT_LINES} 行的函数计数（规范 §12.13，判据版本 ${RULE_VERSION}）。` +
          "棘轮只许下降：新增巨型函数须先拆分，再收紧基线。",
        total: after,
        files: counts,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `[function-length] 基线已更新：${before} → ${after}（scripts/.function-length-baseline.json）` +
      (ruleChanged ? `【判据版本 ${prev.ruleVersion ?? "?"} → ${RULE_VERSION}，一次性重记】` : ""),
  );
  process.exit(0);
}

if (!baseFiles) {
  console.error(
    "[function-length] 基线文件缺失：先执行 node scripts/check-function-length.cjs --update",
  );
  process.exit(1);
}

/* 基线若来自旧判据，先提示重记：旧数字与新计数不是同一个量，直接比对没有意义
 * （重记前不阻断，只把「该跑一次 --update」说清楚 —— 阻断会让判据变更本身
 *  在 CI 上无法合并）。 */
if (prev.ruleVersion !== RULE_VERSION) {
  console.error(
    `[function-length] 基线的判据版本（${prev.ruleVersion ?? "未标记"}）与当前脚本（${RULE_VERSION}）不一致：\n` +
      "  判据变了，旧基线数字不再是同一个量。请执行 node scripts/check-function-length.cjs --update\n" +
      "  重记一次（判据变更允许一次性重记；重记后棘轮照旧只许下降）。",
  );
  process.exit(1);
}

const increased = [];
const dropped = [];
for (const [file, n] of Object.entries(counts)) {
  const base = baseFiles[file] ?? 0;
  if (n > base) increased.push({ file, from: base, to: n });
}
for (const [file, base] of Object.entries(baseFiles)) {
  const now = counts[file] ?? 0;
  if (now < base) dropped.push({ file, from: base, to: now });
}

console.log(
  `[function-length] 超过 ${HINT_LINES} 行的函数 ${longFunctions.length} 个 ` +
    `（基线 ${Object.values(baseFiles).reduce((a, b) => a + b, 0)} 个）`,
);

if (increased.length) {
  console.error(
    "[function-length] 基线外新增巨型函数（规范 §12.13）：\n" +
      increased
        .map((i) => `  ✗ ${i.file}：${i.from} → ${i.to} 个`)
        .join("\n") +
      "\n" +
      longFunctions
        .filter((f) => increased.some((i) => i.file === f.rel))
        .map(fmt)
        .join("\n") +
      "\n  判据：函数体超过 " +
      HINT_LINES +
      " 行即应拆分（按职责切子函数 / 子组件 / 子 hook），\n" +
      "  不是靠「在一个函数里加注释分段」。",
  );
  process.exit(1);
}

if (dropped.length) {
  const msg =
    `[function-length] ${dropped.length} 个文件的巨型函数已减少（治理有进展）：\n` +
    dropped.map((d) => `  · ${d.file}：${d.from} → ${d.to}`).join("\n") +
    "\n  建议执行 node scripts/check-function-length.cjs --update 收紧基线。";
  if (STRICT) {
    console.error(msg + "\n  --strict 模式：未收紧基线即失败。");
    process.exit(1);
  }
  console.log(msg);
}

/* 清单始终打印：这是「排期拆分」时唯一要看的那张表。 */
if (longFunctions.length) {
  console.log("[function-length] 拆分候选（按行数降序）：\n" + longFunctions.map(fmt).join("\n"));
}

console.log("[function-length] OK");
