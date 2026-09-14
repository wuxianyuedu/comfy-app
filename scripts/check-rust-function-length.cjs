#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:Rust 壳函数长度扫描(供 .githooks/pre-commit 与 CI 调用)
/**
 * Rust 函数长度扫描 —— 规范见 docs/standards/12-代码组织与文件结构.md §12.13。
 *
 * 背景(ISSUE #536 P4): §12.13 的函数长度门禁
 * (`check-function-length.cjs`) 只扫 `src/**` 的 TS/TSX —— **Rust 侧完全没有
 * 同类护栏**。于是 `src-tauri/src/lib.rs` 的 `run()` 里塞了近 300 行的
 * 窗口 / 托盘 / 协议 / sidecar 编排,而「能不能拆」在这条链路上**没有任何
 * 机器信号**。本脚本补齐 Rust 的同一维度,与 JS 侧同构:
 *   ① **提示层**(`--strict` 之外): 超 `HINT_LINES` 的函数打印清单,
 *      只提醒不阻断 —— 存量逐步拆。
 *   ② **阻断层**(strict,棘轮): 每个文件的「超阈值函数数」记进
 *      `scripts/.rust-function-length-baseline.json`,**只许降不许升**:
 *      新增一个超阈值的函数即阻断(不得静默长出第二个巨型编排函数)。
 *
 * 阈值为什么是 120(而不是 JS 侧的 400): 两侧代码的「自然长度」不同 ——
 * TS/TSX 有大量 JSX 与类型声明,单个组件函数几百行尚可读;Rust 侧是结构化
 * 编排,120 行已属「该拆了」。这也正是 ISSUE #536 P4 报过长的口径(>120 行)。
 *
 * 判定的是**函数体行数**(声明行到配对右括号),不是文件行数(R5 管文件)。
 *
 * 用法:
 *   node scripts/check-rust-function-length.cjs           # 检查(棘轮)
 *   node scripts/check-rust-function-length.cjs --strict  # 基线未收紧也失败(CI 用)
 *   node scripts/check-rust-function-length.cjs --update  # 重写基线(须伴随下降)
 *   node scripts/check-rust-function-length.cjs --report  # 只出清单不判失败(盘点用)
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const BASELINE = path.join(__dirname, ".rust-function-length-baseline.json");
const ARGS = new Set(process.argv.slice(2));
const UPDATE = ARGS.has("--update");
const STRICT = ARGS.has("--strict");
const REPORT_ONLY = ARGS.has("--report");

/** 扫描范围: Rusta 壳源码。 */
const SCAN_DIR = "src-tauri/src";
const SOURCE_EXT = /\.rs$/;
const isTestFile = (rel) => rel.includes("/tests/") || /_test\.rs$/.test(rel);

/** 超过这个行数的函数进「拆分候选」清单。
 *
 *  120 与 ISSUE #536 P4 报过长的口径一致,也贴合 Rust 侧「结构化编排」的
 *  自然长度:重构后全仓最长的 Rust 函数是 `run()` 的 79 行,120 留出了合理
 *  余量,不会把清单跑成噪音。 */
const HINT_LINES = 120;

/** 函数声明形态: `fn name(`, `pub fn name(`, `pub(crate) fn name(`,
 *  `pub async fn name(`, `unsafe fn name(` 等。刻意只认有名字的函数 ——
 *  闭包/匿名块不在本规则射程内(它们由所在函数的长度间接约束)。 */
const DECLARATION = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+([A-Za-z_]\w*)/;

/** 逐字符状态机: 计算每行结束时的括号深度,跳过字符串 / 字符字面量 / 注释
 *  里的括号(Rust 的 `"}"` / `'{'` / 注释里的括号若不跳过,函数尾会被切错)。
 *
 *  只认 `()` `{}` `[]`;尖括号(`<` `>`)不参与配对 —— Rust 的泛型参数
 *  (`Vec<Option<T>>`) 与比较运算符都会让尖括号不配平,累计深度必然漂负。 */
function bracketDepths(lines) {
  const depthAtLine = new Array(lines.length).fill(0);
  let depth = 0;
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let j = 0;
    let inStr = false;
    let inChar = false;
    while (j < line.length) {
      const ch = line[j];
      const nx = line[j + 1] ?? "";
      if (inBlockComment) {
        if (ch === "*" && nx === "/") {
          inBlockComment = false;
          j += 2;
          continue;
        }
        j++;
        continue;
      }
      if (inStr) {
        if (ch === "\\") {
          j += 2;
          continue;
        }
        if (ch === '"') inStr = false;
        j++;
        continue;
      }
      if (inChar) {
        if (ch === "\\") {
          j += 2;
          continue;
        }
        if (ch === "'") inChar = false;
        j++;
        continue;
      }
      if (ch === "/" && nx === "/") break; // 行注释: 本行余下不参与
      if (ch === "/" && nx === "*") {
        inBlockComment = true;
        j += 2;
        continue;
      }
      if (ch === '"') {
        inStr = true;
        j++;
        continue;
      }
      /* `'` 有两种含义: 字符字面量 `'x'` 与生命周期 `'a`。只有形如
       * `'x'`(两个 `'` 夹一个字符、且中间不是转义)才算字符字面量 —— 生命周期
       * 不计数,否则 `&'a str` 会让状态机错位。 */
      if (ch === "'") {
        if (nx === "\\") {
          inChar = true;
          j++;
          continue;
        }
        if (line[j + 1] !== undefined && line[j + 2] === "'") {
          inChar = true;
          j++;
          continue;
        }
        j++;
        continue;
      }
      if (ch === "{" || ch === "(" || ch === "[") depth++;
      else if (ch === "}" || ch === ")" || ch === "]") depth--;
      j++;
    }
    depthAtLine[i] = depth;
  }
  return depthAtLine;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const relOf = (p) =>
  p.split(path.sep).join("/").replace(ROOT.split(path.sep).join("/") + "/", "");

/* ── 采集 ────────────────────────────────────────────────── */

const longFunctions = [];
for (const abs of walk(path.join(ROOT, SCAN_DIR))) {
  const rel = relOf(abs);
  if (!SOURCE_EXT.test(rel) || isTestFile(rel)) continue;
  const lines = fs.readFileSync(abs, "utf8").split("\n");
  const depthAtLine = bracketDepths(lines);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(DECLARATION);
    if (!m) continue;
    const name = m[1];
    const startDepth = depthAtLine[i - 1] ?? 0;
    let end = -1;
    for (let j = i; j < lines.length; j++) {
      if (depthAtLine[j] <= startDepth) {
        end = j;
        break;
      }
    }
    /* 声明行本身不跨行(如 trait 方法签名 / 单行 fn)时 end === i,跳过,
     * 否则会把「下一行的第 1 行」误算成巨型函数。 */
    if (end <= i) continue;
    const size = end - i + 1;
    if (size < HINT_LINES) {
      i = end;
      continue;
    }
    longFunctions.push({ rel, line: i + 1, name, lines: size });
    i = end;
  }
}

longFunctions.sort((a, b) => b.lines - a.lines || a.rel.localeCompare(b.rel));

/** 棘轮口径: **按文件的超阈值函数数**记账(与 JS 侧 §12.13 同构)。
 *  用函数名做键会让「改名」被当成新增;用数量则只关心「这个文件里还有几个
 *  超长函数」,拆掉一个就少一个。 */
const counts = {};
for (const f of longFunctions) counts[f.rel] = (counts[f.rel] ?? 0) + 1;

const fmt = (f) => `  · ${f.lines} 行  ${f.rel}:${f.line}  ${f.name}`;

/* ── 报告 / 棘轮 ────────────────────────────────────────── */

if (REPORT_ONLY) {
  console.log(
    `[rust-function-length] 扫描 ${SCAN_DIR}/**：超过 ${HINT_LINES} 行的函数 ${longFunctions.length} 个：`,
  );
  console.log(longFunctions.map(fmt).join("\n") || "  （无）");
  console.log("[rust-function-length] --report 模式：只出清单，不判失败 ✓");
  process.exit(0);
}

const prev = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : null;
const baseFiles = prev?.files ?? null;

if (UPDATE) {
  const before = baseFiles ? Object.values(baseFiles).reduce((a, b) => a + b, 0) : 0;
  const after = longFunctions.length;
  if (baseFiles && after > before) {
    console.error(
      `[rust-function-length] 拒绝放宽基线：${before} → ${after} 个超长函数（棘轮只许下降）。\n` +
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
          `超过 ${HINT_LINES} 行的 Rust 函数计数（规范 §12.13）。棘轮只许下降：` +
          "新增超长函数须先拆分，再收紧基线。",
        total: after,
        files: counts,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `[rust-function-length] 基线已更新：${before} → ${after}（scripts/.rust-function-length-baseline.json）`,
  );
  process.exit(0);
}

if (!baseFiles) {
  console.error(
    "[rust-function-length] 基线文件缺失：先执行 node scripts/check-rust-function-length.cjs --update",
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
  `[rust-function-length] 超过 ${HINT_LINES} 行的函数 ${longFunctions.length} 个 ` +
    `（基线 ${Object.values(baseFiles).reduce((a, b) => a + b, 0)} 个）`,
);

if (increased.length) {
  console.error(
    "[rust-function-length] 基线外新增超长函数（规范 §12.13）：\n" +
      increased.map((i) => `  ✗ ${i.file}：${i.from} → ${i.to} 个`).join("\n") +
      "\n" +
      longFunctions
        .filter((f) => increased.some((i) => i.file === f.rel))
        .map(fmt)
        .join("\n") +
      "\n  判据：函数体超过 " +
      HINT_LINES +
      " 行即应拆分（按职责切子函数），\n" +
      "  不是靠「在一个函数里加注释分段」。",
  );
  process.exit(1);
}

if (dropped.length) {
  const msg =
    `[rust-function-length] ${dropped.length} 个文件的超长函数已减少（治理有进展）：\n` +
    dropped.map((d) => `  · ${d.file}：${d.from} → ${d.to}`).join("\n") +
    "\n  建议执行 node scripts/check-rust-function-length.cjs --update 收紧基线。";
  if (STRICT) {
    console.error(msg + "\n  --strict 模式：未收紧基线即失败。");
    process.exit(1);
  }
  console.log(msg);
}

if (longFunctions.length) {
  console.log(
    "[rust-function-length] 拆分候选（按行数降序）：\n" + longFunctions.map(fmt).join("\n"),
  );
}

console.log("[rust-function-length] OK");
