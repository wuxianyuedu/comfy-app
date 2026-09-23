#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:ui/ 定制标记与台账一致性(供 .githooks/pre-commit 调用)
/**
 * `ui/` 定制标记 ⟺ 台账 —— 规范见 docs/standards/16-shadcn-ui与表单校验.md §16.8。
 *
 * 背景:`src/components/ui/**` 是 shadcn 的**工具生成目录**(§16.7 要求不手工编辑),
 * 但本仓库确实在若干基元上做过**有意改动**(button 的语义色变体与 ButtonLink、
 * dialog 的 backdrop 收敛与 popupClassName…)。这些改动此前没有任何地方记着 ——
 * 于是 `shadcn add <comp>` 的 `⚠ N files will be overwritten` 一出来,只能靠人
 * 事先记得哪个不能覆盖。实测:`shadcn add command` 会顺手覆盖 button / input /
 * textarea / dialog 四个文件,其中两个的定制被冲掉会让全库编译不过、或让浮层不再
 * 让出标题行。
 *
 * 本脚本把这件事机器化(**零网络**,不判断"差异内容",只保证"改过的地方留了痕"):
 *   ① 与官方版有语义差异的 ui/ 文件,文件头带一行标记(`ui-customized:`);
 *   ② 台账(docs/standards/16 §16.8)逐个登记这些文件;
 *   ③ 两侧必须一一对应 —— 少一边都报错,并给出**照抄级**的修法。
 *
 * 判定口径:
 *   检查  = 扫 `src/components/ui/**.tsx|ts`(排除 `*.test.*`)的**文件头**找标记,
 *           与台账表格第一列的文件名求双向差集;
 *   失败  = 任一方向有差集,或台账小节/文档读不到;
 *   退出码 0 = 通过,1 = 阻断。
 *
 * 用法:node scripts/check-ui-customizations.cjs
 *      node scripts/check-ui-customizations.cjs --report   # 只出清单不判失败(盘点用)
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
/** 被扫描的目录:shadcn 基元目录(唯一家园,见 tests/ui-kit-single-home.test.ts)。 */
const UI_DIR = "src/components/ui";
/** 台账所在文档。 */
const LEDGER_DOC = "docs/standards/16-shadcn-ui与表单校验.md";
/** 台账小节标题 —— 解析范围是它到下一个同级(`## `)标题之间。 */
const LEDGER_HEADING = "## 16.8";
/**
 * 标记行必须落在文件头这几行之内。
 *
 * 为什么要卡位置:标记是给「覆盖前先看一眼」的人读的,埋在几百行下面等于没写;
 * 卡在头部还能让 `grep -l ui-customized src/components/ui/*.tsx` 一次列全。
 */
const MARKER_MAX_LINE = 3;
/** 标记行的形状(只认标记本身,不认正文里的引用)。 */
const MARKER_RE = /ui-customized\s*:/;
/** 台账表格行的第一列:`| `button.tsx` | …`。 */
const LEDGER_ROW_RE = /^\|\s*`([^`]+)`/;

const REPORT_ONLY = new Set(process.argv.slice(2)).has("--report");

/** 扫描范围内的 ui/ 文件(相对仓库根,正斜杠)。 */
function listUiFiles() {
  const dir = path.join(ROOT, UI_DIR);
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => /\.(tsx|ts)$/.test(name) && !/\.test\./.test(name))
    .map((name) => `${UI_DIR}/${name}`)
    .sort();
}

/**
 * 从「文件头」找标记。
 * @param {string} text 文件全文
 * @returns {boolean} 头部几行里有没有标记
 */
function hasHeaderMarker(text) {
  const head = text.split("\n").slice(0, MARKER_MAX_LINE);
  return head.some((line) => MARKER_RE.test(line));
}

/**
 * 解析台账小节里的文件名集合。
 *
 * 只认 §16.8 到下一个 `## ` 之间的表格第一列 —— 别的章节(§16.2.4 那些台账)
 * 里也常有 `` `xxx.tsx` `` 形式的文件名,不圈范围就会把它们当成登记。
 * @param {string} markdown 文档全文
 * @returns {Set<string>} 文件名(如 `button.tsx`)
 */
function parseLedger(markdown) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.trim().startsWith(LEDGER_HEADING));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  const section = end === -1 ? rest : rest.slice(0, end);
  const names = new Set();
  for (const line of section) {
    const m = LEDGER_ROW_RE.exec(line.trim());
    if (m) names.add(m[1].trim());
  }
  return names;
}

/**
 * 双向差集。
 * @param {Set<string>} marked 带标记的文件名
 * @param {Set<string>} ledger 台账登记的文件名
 * @returns {{ unregistered: string[], unmarked: string[] }}
 */
function compareLedger(marked, ledger) {
  return {
    unregistered: [...marked].filter((n) => !ledger.has(n)).sort(),
    unmarked: [...ledger].filter((n) => !marked.has(n)).sort(),
  };
}

const MARKER_TEMPLATE =
  "/* ui-customized: 覆盖前先看 docs/standards/16 §16.8（本文件在 shadcn 官方版之上有改动） */";

function main() {
  const docPath = path.join(ROOT, LEDGER_DOC);
  if (!fs.existsSync(docPath)) {
    console.error(`\n[ui-customizations] ✗ 台账文档不存在:${LEDGER_DOC}\n`);
    process.exit(1);
  }
  const ledger = parseLedger(fs.readFileSync(docPath, "utf8"));
  if (ledger === null) {
    console.error(
      `\n[ui-customizations] ✗ 在 ${LEDGER_DOC} 里找不到台账小节「${LEDGER_HEADING}」` +
        ` —— 小节标题被改名了?判据与文档必须同源(§16.8)。\n`,
    );
    process.exit(1);
  }

  const files = listUiFiles();
  const marked = new Set();
  for (const rel of files) {
    if (hasHeaderMarker(fs.readFileSync(path.join(ROOT, rel), "utf8"))) {
      marked.add(path.basename(rel));
    }
  }

  const { unregistered, unmarked } = compareLedger(marked, ledger);

  if (REPORT_ONLY) {
    console.log(
      `[ui-customizations] 带标记 ${marked.size} 个 / 台账 ${ledger.size} 个`,
    );
    for (const n of [...marked].sort()) console.log(`  · 标记 ${n}`);
    for (const n of [...ledger].sort()) console.log(`  · 台账 ${n}`);
    return;
  }

  if (unregistered.length === 0 && unmarked.length === 0) {
    console.log(
      `[ui-customizations] ✓ ${marked.size} 个定制基元与台账一致（${LEDGER_DOC} §16.8）`,
    );
    return;
  }

  console.error("\n[ui-customizations] ✗ 标记与台账不一致（规范 §16.8）：\n");
  for (const name of unregistered) {
    console.error(
      `  · ${UI_DIR}/${name} 带了标记，但台账里没有它\n` +
        `      → 在 ${LEDGER_DOC} §16.8 的表里加一行（照抄其它行的四列）\n`,
    );
  }
  for (const name of unmarked) {
    console.error(
      `  · 台账登记了 ${name}，但文件头没有标记\n` +
        `      → 在 ${UI_DIR}/${name} 头部加一行（\`"use client"\` 文件放在指令行之后）：\n` +
        `        ${MARKER_TEMPLATE}\n`,
    );
  }
  console.error(
    `共 ${unregistered.length + unmarked.length} 项。口径见 docs/standards/16 §16.8` +
      "（只在 import 别名 / class 顺序 / 注释上与官方不同的文件**不登记**）。\n",
  );
  process.exit(1);
}

module.exports = {
  UI_DIR,
  LEDGER_DOC,
  LEDGER_HEADING,
  MARKER_MAX_LINE,
  MARKER_RE,
  hasHeaderMarker,
  parseLedger,
  compareLedger,
  listUiFiles,
};

if (require.main === module) main();
