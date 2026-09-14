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

/** 函数声明形态。刻意只认「有名字的顶层/模块级函数」——
 *  匿名回调(useEffect 里的箭头、数组 map)不在本规则射程内，它们的长度由
 *  它们所在函数的长度间接约束。 */
const DECLARATIONS = [
  // function name(...) {
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/,
  // const name = (...) => {   /   const name = async (...) => {
  /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*?)?=\s*(?:async\s*)?\(/,
  // const name = (...) : T => {
  /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function\b/,
];

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

const longFunctions = [];
for (const abs of walk(path.join(ROOT, SCAN_DIR))) {
  const rel = relOf(abs);
  if (!SOURCE_EXT.test(rel) || rel.endsWith(".d.ts")) continue;
  if (isTestFile(rel)) continue;
  const lines = fs.readFileSync(abs, "utf8").split("\n");
  const depthAtLine = bracketDepths(lines);
  for (let i = 0; i < lines.length; i++) {
    let name = null;
    for (const re of DECLARATIONS) {
      const m = lines[i].match(re);
      if (m) {
        name = m[1];
        break;
      }
    }
    if (!name) continue;
    /* 声明行末尾的深度基准：函数体从「声明起始深度 + 1」开始，
     * 配平回起始深度即函数结束。 */
    const startDepth = depthAtLine[i - 1] ?? 0;
    let end = -1;
    for (let j = i; j < lines.length; j++) {
      if (depthAtLine[j] <= startDepth) {
        end = j;
        break;
      }
    }
    if (end < 0) continue;
    const size = end - i + 1;
    // 声明行本身也可能是单行箭头函数(不跨行)：size <= 1 直接跳过
    if (size < HINT_LINES) {
      i = Math.max(i, end);
      continue;
    }
    longFunctions.push({ rel, line: i + 1, name, lines: size });
    i = end;
  }
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
  if (baseFiles && after > before) {
    console.error(
      `[function-length] 拒绝放宽基线：${before} → ${after} 个巨型函数（棘轮只许下降）。\n` +
        "  新增的先拆开，不要用 --update 掩盖。",
    );
    process.exit(1);
  }
  fs.writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString().slice(0, 10),
        note:
          `超过 ${HINT_LINES} 行的函数计数（规范 §12.13）。棘轮只许下降：` +
          "新增巨型函数须先拆分，再收紧基线。",
        total: after,
        files: counts,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `[function-length] 基线已更新：${before} → ${after}（scripts/.function-length-baseline.json）`,
  );
  process.exit(0);
}

if (!baseFiles) {
  console.error(
    "[function-length] 基线文件缺失：先执行 node scripts/check-function-length.cjs --update",
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
