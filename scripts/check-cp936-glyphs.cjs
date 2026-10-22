#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:CP936 字形登记判据(供 .githooks/pre-commit 的 D 组调用)
/**
 * 判据：**会进 CI 日志的面**里，不许出现「CP936 编不出来、且没有登记替代」的字符。
 *
 * ## 它守的是什么
 *
 * 平台抓取 stage 输出那一跳读的是 **CP936**，而 CP936 只有两万多个字形 ——
 * 落在字表之外的字符，.NET 的编码器默认 fallback 会把它写成**一个问号**
 * （单字节 `0x3F`），而那个问号与「原文里本来就有的问号」逐字同形。
 *
 * 那一层已经有解法了（`scripts/ci-cp936-exit.mjs` + `scripts/ci-cp936-glyphs.mjs`：
 * 转码之前把没有字形的字符换成读得出来的等价写法）。**本判据守的是那层解法的入口**：
 *
 *   · 换过的字符在日志里**看得见**（`√` 而不是问号），但作者**不知道**自己写的那
 *     个符号在日志里长什么样 —— 除非有人告诉他；
 *   · 表外的字符走 `\uXXXX` 兜底 —— **信息不丢**，但那是「如实记下」而不是「好好显示」，
 *     而它在日志里是个需要读者自己解码的东西。
 *
 * ⇒ 所以口径是：**每一个会进日志的坏字符，都必须在替代登记表里有一行**。
 * 登记了一行，就是**明知故犯**（作者知道它在日志里长什么样）；没登记 ⇒ 判红。
 *
 * ## 扫描面：只有这些地方的字符会进平台日志
 *
 *   · `scripts/**`、`tests/**`、`tools/**`（门禁脚本、测试、工具）；
 *   · `src/**` 里的 `*.test.*` / `*.spec.*`（**测试名**会进 vitest 输出）；
 *   · `.cnb.yml`（stage 的 `script:` 内容会被回显）。
 *
 * `src/**` 里其它文件（界面文案）**不进 CI 日志**（它们进浏览器）⇒ 不扫 ——
 * 把它们也扫进来会让这条判据去管一件它管不着的事。
 *
 * ## 判定口径
 *
 * 「这个字符在 CP936 里有没有字形」由 **.NET 那一侧的编码器**说了算。本脚本用
 * `scripts/ci-cp936-glyphs.mjs` 里那张**同一来源**的表（Node 侧自建的 GBK 双字节区）
 * 判定 —— 判据与执行**同源**，不各判各的。
 *
 * 三种字符算「已处理」：
 *
 *   · 在 `GLYPH_REPLACEMENTS`（替代登记表）里 ⇒ 登记过，日志里显示成登记的那个写法；
 *   · 在 `GLYPH_DROPPED` 里 ⇒ 零宽类，直接删掉；
 *   · 在 `GLYPH_KEPT` 里 ⇒ 明确保留（`.NET` 能编、Node 那张表判不出来的那两个）。
 *
 * 用法:
 *   node scripts/check-cp936-glyphs.cjs             # 检查(硬闸:命中即退 1)
 *   node scripts/check-cp936-glyphs.cjs --report    # 只出清单不判失败(盘点用)
 */
const path = require("node:path");
const { readForScan, walkForScan } = require("./gate-scan-read.cjs");

/** 门禁脚本所在仓库的根。 */
const ROOT = path.resolve(__dirname, "..");

/** 扫描面里的目录（整目录进去）。 */
const LOGGED_DIRS = ["scripts", "tests", "tools"];

/** 扫描面里的单文件。 */
const LOGGED_FILES = [".cnb.yml"];

/** 扫描面里 `src/**` 的那部分：**只有测试文件**（测试名会进 vitest 输出）。 */
const SRC_TEST_RE = /^src[/\\].*\.(test|spec)\.[cm]?[jt]sx?$/;

/** 目录扫描认的扩展名。 */
const SCAN_EXT = /\.(mjs|cjs|js|jsx|ts|tsx|json|md|mdx|yml|yaml|ps1)$/;

/** 不进去的目录：依赖与产物。 */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "target",
  "dist",
  "build",
  "coverage",
  "log",
  "logs",
  "python-venv",
]);

/**
 * 列出扫描面上的文件（绝对路径）。
 *
 * @returns {string[]}
 */
function collectFiles() {
  const files = [];
  for (const dir of LOGGED_DIRS) {
    const abs = path.join(ROOT, dir);
    for (const file of walkForScan(abs, SCAN_EXT, {
      skipDirs: SKIP_DIRS,
      skipHiddenDirs: true,
    })) {
      files.push(file);
    }
  }
  for (const rel of LOGGED_FILES) {
    files.push(path.join(ROOT, rel));
  }
  /* `src/**` 里的测试文件单独挑：只有它们的字符会进 vitest 输出。 */
  for (const file of walkForScan(path.join(ROOT, "src"), SCAN_EXT, {
    skipDirs: SKIP_DIRS,
    skipHiddenDirs: true,
  })) {
    const rel = path.relative(ROOT, file);
    if (SRC_TEST_RE.test(rel)) files.push(file);
  }
  return files;
}

/**
 * 扫一个文件：找出「不可编码且没登记」的字符，带行号。
 *
 * 按**行**扫（不按码点）—— 要报「哪一行」；跨行的代理对不会漏：一个代理对的
 * 两个码元各自落在某一行里，而它们**都不是** CP936 字形 ⇒ 都会被报出来
 * （而 emoji 在登记表之外 ⇒ 会被要求登记，这是有意的）。
 *
 * @param {string} abs
 * @returns {Array<{line: number, ch: string}>}
 */
function scanFile(abs, isBad) {
  const raw = readForScan(abs);
  if (raw === null) return [];
  const hits = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch.codePointAt(0) < 0x80) continue;
      if (!isBad(ch)) continue;
      hits.push({ line: i + 1, ch });
    }
  }
  return hits;
}

/** 把一个字符写成「U+XXXX 字符」的样子，便于在终端里认。 */
function label(ch) {
  const cp = ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
  return `U+${cp} ${ch}`;
}

async function main() {
  const reportOnly = process.argv.includes("--report");
  const { isCp936Encodable, GLYPH_REPLACEMENTS, GLYPH_DROPPED, GLYPH_KEPT } =
    await import("./ci-cp936-glyphs.mjs");

  /** 「不可编码 **且** 没登记」才算命中。 */
  const isBad = (ch) => {
    if (GLYPH_KEPT.has(ch)) return false;
    if (GLYPH_DROPPED.has(ch)) return false;
    if (GLYPH_REPLACEMENTS.has(ch)) return false;
    /* **emoji 不要求逐个登记**：它们有**通用兜底**（写成 `\uXXXX`，纯 ASCII，
     * 信息不丢）。逐个登记会让表随 emoji 家族一起涨 —— 而 CP936 的四字节区
     * 本来就不收这一段，于是每一个 emoji 都是「坏的」，那张表会长成一张
     * emoji 名录。口径是：**表收的是「有专门写法」的字符**，emoji 走通用兜底。 */
    if (ch.codePointAt(0) >= 0x1f000) return false;
    return !isCp936Encodable(ch);
  };

  const problems = [];
  let scanned = 0;
  for (const abs of collectFiles()) {
    scanned++;
    const hits = scanFile(abs, isBad);
    if (!hits.length) continue;
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    /* 同一个文件里同一个字符只报一次（带处数）—— 报告要能读完。 */
    const byChar = new Map();
    for (const hit of hits) {
      const prev = byChar.get(hit.ch);
      if (prev) {
        prev.count++;
        prev.firstLine = Math.min(prev.firstLine, hit.line);
      } else {
        byChar.set(hit.ch, { ch: hit.ch, count: 1, firstLine: hit.line });
      }
    }
    for (const item of byChar.values()) {
      problems.push({ rel, ...item });
    }
  }

  if (!problems.length) {
    console.log(
      `[cp936-glyph] 扫描面 ${scanned} 个文件：没有「CP936 编不出来且没登记」的字符`,
    );
    return 0;
  }

  console.log(
    `[cp936-glyph] ${problems.length} 种字符在 CP936 里没有字形、且没有登记替代：`,
  );
  for (const p of problems) {
    console.log(`  ${p.rel}:${p.firstLine}  ${label(p.ch)}  x${p.count}`);
  }
  console.log(
    "  处置：登记到 scripts/ci-cp936-glyphs.mjs 的 GLYPH_REPLACEMENTS（写下它在日志里\n" +
      "  显示成什么），或换一个 CP936 编得出来的字符。",
  );
  return reportOnly ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error("[cp936-glyph] 判据自己出错了：", err);
    process.exit(1);
  },
);
