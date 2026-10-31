#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:基础设施层文件长度硬闸(供 .githooks/pre-commit 调用)
/**
 * 基础设施层的文件长度**硬闸**（须为 0）—— 规范见 docs/standards/12-代码组织与文件结构.md §12.6 R5 / §12.13
 *
 * 背景：R5（`check-file-structure.cjs`）的扫描根**只有 `src`**，`check-function-length.cjs`、
 * `check-non-null-assertions.cjs`、`check-code-duplication.cjs` 也一样（`SCAN_DIR = "src"`）。
 * 于是「判据自己」这一层 —— `scripts/**` 的 `.cjs/.mjs` 与 `tools/**` 的 `.ps1`
 * （合计约 43k 行，与它管的 `src` 非测试代码同量级）—— 落在它自己立的硬闸之外：
 * 判据是**被执行的那部分代码**，它读不懂的时候表现为「这条判据恒绿」，而不是表现为报错。
 *
 * ## 为什么是硬闸而不是棘轮
 *
 * 本判据此前是棘轮：超限文件记进 `scripts/.infra-file-size-baseline.json`，
 * `--update` 收紧、`--strict` 要求下降，默认档只提示不阻断。存量已拆到 **0 个**
 * （ISSUE #1811 第五刀：`dev-launcher.mjs` 按阶段拆进 `launcher-core/**`，5 份
 * 基础设施超限文件全部清零），于是两层都退化：棘轮无事可收紧、默认档恒绿。判据口径
 * 与扫描面一字未改，只把「有存量、逐批治理」那一层皮收掉 —— **新增一个 900 行以上
 * 的文件即阻断**。
 *
 * 这与 §12.6 R5 同口径（`src` 侧也在 ISSUE #1811 的 R5 项里翻成了硬闸）：
 * 「超限就要拆」不该因为文件住在 `scripts/` 还是 `src/` 而分两种态度。两档现在
 * 完全同形 —— 阈值同一个数（900）、都没有基线、都没有 `--update` / `--strict`。
 * （R5 翻闸前带的 `baselineRev`「按基线修订号同口径重数」机制是**棘轮才需要**的：
 * `src/**` 会被全库 prettier 治理刷新，同一份内容在不同「格式时代」行数不同；
 * 没有基线就没有两个格式时代要拉平。口径与那两次事故记在规范 §12.13.3。）
 *
 * 阈值取 **900，与 R5 同一个数**：一条维度只许有一个数。
 *
 * 排除清单刻意**不设**：一份「这些文件不受本条约束」的白名单正是最容易静默失效的形状
 * （改名 / 挪目录就看不见 = 假绿）。新增超限文件的正当出口只有一个 —— 拆。
 *
 * 用法：
 *   node scripts/check-infra-file-size.cjs           # 检查(硬闸:命中即退 1)
 *   node scripts/check-infra-file-size.cjs --report  # 只出清单不判失败(盘点用)
 *   --staged(钩子用)仅当暂存改动落在扫描面内才扫，口径见 §13.5.8.2
 */
const fs = require("node:fs");
const path = require("node:path");
const { skipUnlessStagedTouches } = require("./gate-scan-read.cjs");

const ROOT = path.resolve(__dirname, "..");
const ARGS = new Set(process.argv.slice(2));
const REPORT_ONLY = ARGS.has("--report");
const STAGED = ARGS.has("--staged");

/** 与 R5 同一把尺子：超过即进拆分候选。 */
const SPLIT_HINT_LINES = 900;

/**
 * 扫描面：判据与入口自己住的两层。扩展名按层分 ——
 * `scripts/` 是 Node 工具脚本区（`.cjs`/`.mjs`），`tools/` 是 Windows 双击入口区（`.ps1`）。
 */
const SCAN_ROOTS = [
  { dir: "scripts", ext: /\.(cjs|mjs)$/ },
  { dir: "tools", ext: /\.ps1$/ },
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") {
      continue;
    }
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(abs, out);
    } else {
      out.push(abs);
    }
  }
  return out;
}

/** 行数口径与 R5 逐字同形：按 `utf8` 读入后数 `split("\n")`。 */
function countLines(abs) {
  return fs.readFileSync(abs, "utf8").split("\n").length;
}

/** 仓库相对路径（正斜杠），与基线里记的键同一口径。 */
function relOf(abs) {
  return path.relative(ROOT, abs).split(path.sep).join("/");
}

function collect() {
  /** @type {Map<string, number>} */
  const oversized = new Map();
  let scanned = 0;
  for (const { dir, ext } of SCAN_ROOTS) {
    const base = path.join(ROOT, dir);
    if (!fs.existsSync(base)) {
      continue;
    }
    for (const abs of walk(base)) {
      const rel = relOf(abs);
      if (!ext.test(rel)) {
        continue;
      }
      scanned += 1;
      const lines = countLines(abs);
      if (lines > SPLIT_HINT_LINES) {
        oversized.set(rel, lines);
      }
    }
  }
  return { oversized, scanned };
}

function main() {
  if (STAGED && !REPORT_ONLY) {
    skipUnlessStagedTouches({
      roots: SCAN_ROOTS.map((r) => r.dir),
      tag: "[infra-size]",
    });
  }

  const { oversized, scanned } = collect();

  if (REPORT_ONLY) {
    console.log(
      `[infra-size] 扫描 ${SCAN_ROOTS.map((s) => `${s.dir}/**`).join(" + ")}：${scanned} 个文件，超 ${SPLIT_HINT_LINES} 行 ${oversized.size} 个`,
    );
    for (const [rel, lines] of [...oversized.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(lines).padStart(6)}  ${rel}`);
    }
    return 0;
  }

  console.log(
    `[infra-size] 扫描 ${SCAN_ROOTS.map((s) => `${s.dir}/**`).join(" + ")}：${scanned} 个文件，超 ${SPLIT_HINT_LINES} 行的文件 ${oversized.size} 个`,
  );
  if (oversized.size === 0) {
    console.log("[infra-size] OK");
    return 0;
  }

  console.error(
    `[infra-size] 阻断：${oversized.size} 个文件超过 ${SPLIT_HINT_LINES} 行。这一层是**被执行的那部分代码** —— 它长到读不动时的表现是「这条判据恒绿」，不是报错（规范 §12.6 R5 / §12.13）。`,
  );
  for (const [rel, lines] of [...oversized.entries()].sort((a, b) => b[1] - a[1])) {
    console.error(`  · ${rel}（${lines} 行）`);
  }
  console.error(
    "  出口只有一个：拆（按职责拆成模块，或把声明层与机制层分开）。存量已清零、无基线可登记。",
  );
  return 1;
}

if (require.main === module) {
  process.exit(main());
}
