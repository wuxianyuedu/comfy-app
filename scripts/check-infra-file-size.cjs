#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:基础设施层文件长度棘轮(供 .githooks/pre-commit 调用)
/**
 * 基础设施层的文件长度棘轮 —— 规范见 docs/standards/12-代码组织与文件结构.md §12.6 R5 / §12.13
 *
 * 背景：R5（`check-file-structure.cjs`）的扫描根**只有 `src`**，`check-function-length.cjs`、
 * `check-non-null-assertions.cjs`、`check-code-duplication.cjs` 也一样（`SCAN_DIR = "src"`）。
 * 于是「判据自己」这一层 —— `scripts/**` 的 152 份 `.cjs/.mjs` 与 `tools/**` 的 26 份 `.ps1`
 * （合计约 43k 行，与它管的 `src` 非测试代码同量级）—— 落在它自己立的硬闸之外：
 * `src` 侧超 900 行的文件现在**基线为 0**，而同一把尺子在判据层上是 6 个文件、最大一份 4,820 行。
 * 这不是「基础设施天生可以长」：判据是**被执行的那部分代码**，它读不懂的时候表现为
 * 「这条判据恒绿」，而不是表现为报错。
 *
 * 为什么另立脚本 + 另立基线（而不是给 R5 加 `--root`）：
 *   · R5 的行数口径带 `baselineRev`「按基线修订号同口径重数」的机制，那套机制存在的唯一理由
 *     是 `src/**` 会被全库 prettier 治理刷新（同一份内容在不同「格式时代」行数不同，棘轮会把
 *     格式变化读成「这次又变大了」）。而这一层**双重不在格式档里**：`check-format.cjs:87`
 *     的 `GLOBS` 只覆盖 `{ts,tsx,js,jsx,mdx}`，而 `:90-93` 的 `IGNORE_GLOBS` 又把 `scripts/**`
 *     与 `tools/**` 整目录列成白名单 —— 不存在两种「格式时代」，
 *     把 rev 机制一起拖过来等于给一条不需要它的判据背一份复杂度，还会让 R5 的
 *     `R5_RULE_VERSION` 因这次扩面而重记基线（那是口径变更，与本意无关）。
 *   · 同一维度分档在仓里有先例：Rust 壳的函数长度就是「另立脚本 + 另立基线」
 *     （`check-rust-function-length.cjs` / `.rust-function-length-baseline.json`）。
 *
 * 阈值取 **900，与 R5 同一个数**：一条维度只许有一个数。两处各写一个迟早漂开，
 * 而漂开之后「哪个是真判据」没人说得清。
 *
 * 排除清单刻意**不设**：一份「这些文件不受本条约束」的白名单正是最容易静默失效的形状
 * （改名 / 挪目录就看不见 = 假绿）。新增超限文件走的是正当出口 —— 拆，或者按
 * `--update` 记录**下降**后的值。
 *
 * 用法：
 *   node scripts/check-infra-file-size.cjs           # 检查(棘轮)
 *   node scripts/check-infra-file-size.cjs --strict  # 基线未收紧也失败
 *   node scripts/check-infra-file-size.cjs --update  # 重写基线(须伴随下降)
 *   node scripts/check-infra-file-size.cjs --report  # 只出清单不判失败(盘点用)
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const BASELINE = path.join(__dirname, ".infra-file-size-baseline.json");
const ARGS = new Set(process.argv.slice(2));
const UPDATE = ARGS.has("--update");
const STRICT = ARGS.has("--strict");
const REPORT_ONLY = ARGS.has("--report");

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
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else out.push(abs);
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
    if (!fs.existsSync(base)) continue;
    for (const abs of walk(base)) {
      const rel = relOf(abs);
      if (!ext.test(rel)) continue;
      scanned += 1;
      const lines = countLines(abs);
      if (lines > SPLIT_HINT_LINES) oversized.set(rel, lines);
    }
  }
  return { oversized, scanned };
}

function readBaseline() {
  if (!fs.existsSync(BASELINE)) return null;
  try {
    return JSON.parse(fs.readFileSync(BASELINE, "utf8"));
  } catch {
    return "unreadable";
  }
}

function writeBaseline(oversized) {
  const payload = {
    generatedAt: new Date().toISOString().slice(0, 10),
    ruleVersion: 1,
    note:
      "基础设施层（scripts/** 的 .cjs/.mjs 与 tools/** 的 .ps1）超 900 行的文件。棘轮只许下降：新增超限文件须先拆分，再收紧基线。与 src 侧的 R5 同阈值、同计数口径，但另立一档 —— 这一层不在 prettier 格式档里，不存在 R5 那套「按格式时代重数」的需要。",
    threshold: SPLIT_HINT_LINES,
    total: oversized.size,
    files: Object.fromEntries([...oversized.entries()].sort((a, b) => b[1] - a[1])),
  };
  fs.writeFileSync(BASELINE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

function main() {
  const { oversized, scanned } = collect();
  const baseline = readBaseline();

  if (REPORT_ONLY) {
    console.log(
      `[infra-size] 扫描 ${SCAN_ROOTS.map((s) => `${s.dir}/**`).join(" + ")}：${scanned} 个文件，超 ${SPLIT_HINT_LINES} 行 ${oversized.size} 个`,
    );
    for (const [rel, lines] of [...oversized.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(lines).padStart(6)}  ${rel}`);
    }
    return 0;
  }

  if (!baseline) {
    if (UPDATE) {
      const written = writeBaseline(oversized);
      console.log(`[infra-size] 基线已建立：${written.total} 个超限文件`);
      return 0;
    }
    console.error("[infra-size] 基线文件缺失：先执行 node scripts/check-infra-file-size.cjs --update");
    return 1;
  }
  if (baseline === "unreadable") {
    // 读不出基线不等于「没有存量」——静默放行会让这条判据在基线坏掉的那一天起停摆。
    console.error(`[infra-size] 基线读不出来(${BASELINE})：判失败，不当「没有站点要查」`);
    return 1;
  }

  /** @type {Record<string, number>} */
  const prev = baseline.files ?? {};
  const violations = [];
  const shrinkHints = [];

  for (const [rel, lines] of oversized) {
    const before = prev[rel];
    if (before === undefined) {
      violations.push(
        `新增超限文件 ${rel}（${lines} 行 > ${SPLIT_HINT_LINES}）：` +
          "先把这一份拆到位，再跑 node scripts/check-infra-file-size.cjs --update 收紧基线" +
          "（`--update` 在上涨态是拒绝的，它只用于记录下降）",
      );
    } else if (lines > before) {
      violations.push(
        `${rel} 继续变大（${before} → ${lines} 行）：` +
          "先把它拆回不超过基线的长度，再跑 --update 收紧；不要用 `--update` 把上涨收进基线",
      );
    } else if (lines < before) {
      shrinkHints.push(`${rel} 已变短（${before} → ${lines}），可 --update 收紧`);
    }
  }

  for (const rel of Object.keys(prev)) {
    if (!oversized.has(rel)) shrinkHints.push(`${rel} 已不再超限（${prev[rel]} → ≤${SPLIT_HINT_LINES}），可 --update 收紧`);
  }

  if (violations.length > 0) {
    console.error(
      `[infra-size] 阻断：${violations.length} 项。这一层是**被执行的那部分代码** —— 它长到读不动时的表现是「这条判据恒绿」，不是报错（规范 §12.6 R5 / §12.13）。`,
    );
    for (const line of violations) console.error(`  · ${line}`);
    return 1;
  }

  if (UPDATE) {
    const written = writeBaseline(oversized);
    console.log(
      `[infra-size] 基线已重写：${written.total} 个超限文件（上一版 ${Object.keys(prev).length} 个）`,
    );
    return 0;
  }

  if (STRICT && shrinkHints.length > 0) {
    console.error(
      `[infra-size] --strict：基线未收紧（棘轮只许降），本轮本可下降：\n${shrinkHints.map((s) => `  · ${s}`).join("\n")}`,
    );
    console.error("  建议执行 node scripts/check-infra-file-size.cjs --update 收紧基线。");
    return 1;
  }

  for (const hint of shrinkHints) console.log(`[infra-size] ${hint}`);
  console.log(
    `[infra-size] OK（${scanned} 个文件，超 ${SPLIT_HINT_LINES} 行 ${oversized.size} 个，基线 ${Object.keys(prev).length} 个）`,
  );
  return 0;
}

if (require.main === module) process.exit(main());
