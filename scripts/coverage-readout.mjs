#!/usr/bin/env node
/**
 * coverage-readout.mjs — 覆盖率「实况 vs 登记值」的**只读**读数（ISSUE #2689）。
 *
 * ## 它解决什么
 *
 * #2669 把整体 / 目录级覆盖率从「拦 CI」改成「只上报」：默认档下覆盖率门槛不参与退码，
 * 红着不记 ⇒ 从上游四格解锁以来那份账一次都没刷新过。撤掉判定的副作用是：**撤了判定
 * 就没了读数** —— 「哪几维低于登记值、差多少」现在只能靠一次分钟级全量才看得见（而那
 * 一次全量本身又是另一档的事）。本脚本把这份读数**永久留在场**，且**只读不判红**。
 *
 * ## 为什么是只读（期望 #4）
 *
 * 按门槛判红的执行者**只有一处**：`--enforce-coverage`（`scripts/full-suite-run.mjs` 的
 * 硬档 / `pnpm check:all` 的 `test` 条目，见 §13.5.4）。读数入口再开一个判红口子，等于
 * 把「同一件事两个执行者」那一类分叉又造出来一份；所以本脚本**默认退 0**，判红仍归硬档。
 *
 * ## 登记处是单一事实源（期望 #2）
 *
 * `vitest.config.ts` 的 `COVERAGE_THRESHOLDS`（149 条）是本脚本与判据**共用同一份导入**
 * 的来源 —— Node 26 默认类型擦除，纯 Node 的 `.mjs` 直接 `import()` 它即可拿到，
 * **不引第二份解析、不抄正则**（`coverage-targets-exist.test.ts` 也从同一处取）。
 * 早先「纯 Node 不能 import .ts」那句读数已过时（#2540 同族：tsx 留任；Node 原生 type
 * stripping 不解析 `paths`，但 `vitest.config.ts` 自身只用到可擦除语法，能直接被 Node 吃）。
 *
 * ## 三态（期望 #3）
 *
 *   · 没报告 —— `coverage/coverage-summary.json` 不在盘：告诉怎么产出（跑一次
 *     `pnpm test:coverage` / 每日那一跑的覆盖率阶段）+ provenance（这份报告由谁、何时写）。
 *   · 报告在、但旧 —— provenance 行点名报告 mtime 与「距现在多久」，避免拿旧数当新结论。
 *   · 报告新鲜 —— 逐条登记项显示「实测 % / 登记值 / gap」，按 gap 降序，前 N 名最该治。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { globToRegExp } = require("../scripts/check-format.cjs");

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, "..");

const DIMENSIONS = /** @type {const} */ (["lines", "statements", "functions", "branches"]);

/** @typedef {{lines:number, statements:number, functions:number, branches:number}} CovDim */

/**
 * 读登记处（vitest.config.ts 的具名导出 COVERAGE_THRESHOLDS，四个维度都是百分比数）。
 * @returns {Promise<Record<string, {lines:number,statements:number,functions:number,branches:number}>>}
 */
export async function readRegisteredThresholds() {
  const cfg = await import(pathToFileURL(path.join(ROOT, "vitest.config.ts")).href);
  const reg = cfg.COVERAGE_THRESHOLDS ?? {};
  /** @type {Record<string, {lines:number,statements:number,functions:number,branches:number}>} */
  const out = {};
  for (const [k, v] of Object.entries(reg)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = {
        lines: Number(v.lines ?? 0),
        statements: Number(v.statements ?? 0),
        functions: Number(v.functions ?? 0),
        branches: Number(v.branches ?? 0),
      };
    }
  }
  return out;
}

/** 配置里的 glob 是 gitignore 风格转义（圆括号），磁盘路径不是 —— 比之前先脱转义（§11.7 坑）。 */
const unescapeGlob = /** @param {string} g @returns {string} */ (g) => g.replaceAll("\\", "");

/**
 * 把一条登记 glob 落到报告里的文件并聚合四个维度的实际覆盖率（covered / total 求和后算 pct）。
 * @param {string} glob 登记处的 glob 键
 * @param {Record<string, any>} files 报告里的 files 表（键是相对仓根的路径）
 * @returns {{matched:number, pct?:CovDim}}
 */
export function aggregateForGlob(glob, files) {
  const re = globToRegExp(unescapeGlob(glob));
  const matched = Object.keys(files).filter((f) => f !== "total" && re.test(f));
  if (matched.length === 0) {
    return { matched: 0 };
  }
  const acc = { lines: 0, statements: 0, functions: 0, branches: 0 };
  const tot = { lines: 0, statements: 0, functions: 0, branches: 0 };
  for (const f of matched) {
    const d = files[f] ?? {};
    for (const dim of DIMENSIONS) {
      acc[dim] += Number(d[dim]?.covered ?? 0);
      tot[dim] += Number(d[dim]?.total ?? 0);
    }
  }
  /** @type {CovDim} */
  const pct = /** @type {any} */ ({});
  for (const dim of DIMENSIONS) {
    pct[dim] = tot[dim] === 0 ? 100 : (acc[dim] / tot[dim]) * 100;
  }
  return { matched: matched.length, pct };
}

/**
 * 组装读数（纯函数，便于判据核）。
 * @param {{root?:string, summaryPath?:string}} [opts]
 */
export async function buildCoverageReadout({ root = ROOT, summaryPath } = {}) {
  const registered = await readRegisteredThresholds();
  const summaryFile = summaryPath ?? path.join(root, "coverage", "coverage-summary.json");
  let summary = null;
  try {
    const st = fs.statSync(summaryFile);
    summary = { mtime: st.mtime, data: JSON.parse(fs.readFileSync(summaryFile, "utf8")) };
  } catch {
    summary = null;
  }
  if (!summary) {
    return {
      state: "no-report",
      registeredCount: Object.keys(registered).length,
      provenance:
        "coverage/coverage-summary.json 不在盘 —— 跑一次全量覆盖率即可产出" +
        "（pnpm test:coverage，或每日那一跑的覆盖率阶段；json-summary reporter 一直在开）。",
      rows: [],
    };
  }
  // istanbul `json-summary` 标准格式：文件路径是**顶层键**（没有 `files` 包裹层），
  // `total` 是汇总的那一条，剔掉它再比。
  const data = summary.data ?? {};
  const files = Object.fromEntries(Object.entries(data).filter(([k]) => k !== "total"));
  /** @type {Array<{glob:string, matched:number, pct:CovDim, reg:CovDim, gap:CovDim, maxGap:number}>} */
  const rows = [];
  for (const [glob, reg] of Object.entries(registered)) {
    const agg = aggregateForGlob(glob, files);
    const pct = agg.pct;
    if (agg.matched === 0 || !pct) continue;
    /** @type {CovDim} */
    const gap = /** @type {any} */ ({});
    let maxGap = 0;
    for (const dim of DIMENSIONS) {
      const g = reg[dim] - pct[dim];
      gap[dim] = g;
      if (g > maxGap) maxGap = g;
    }
    rows.push({ glob, matched: agg.matched, pct, reg, gap, maxGap });
  }
  rows.sort((a, b) => b.maxGap - a.maxGap);
  return {
    state: "fresh",
    registeredCount: Object.keys(registered).length,
    reportMtime: summary.mtime,
    rows,
  };
}

const fmt = /** @param {number} n @returns {string} */ (n) =>
  Number.isFinite(n) ? n.toFixed(1) : "?";
const signed = /** @param {number} n @returns {string} */ (n) => (n >= 0 ? `+${fmt(n)}` : fmt(n));

/** CLI 入口：只读不判红（判红的执行者是 full-suite-run 的 --enforce-coverage，单一出处）。 */
async function main() {
  const r = await buildCoverageReadout();
  if (r.state === "no-report") {
    console.log(`[coverage-readout] **没有报告** —— ${r.provenance}`);
    console.log(
      `[coverage-readout] 登记处共 ${r.registeredCount} 条门槛（vitest.config.ts 的 COVERAGE_THRESHOLDS，` +
        `本脚本与判据共用同一份导入）。`,
    );
    console.log(
      "[coverage-readout] 本读数**只「读」不「判红」；按门槛判红的唯一执行者是 " +
        "`node scripts/full-suite-run.mjs --enforce-coverage`（ISSUE #2669）。",
    );
    return 0;
  }
  const reportMtime = r.reportMtime;
  if (!reportMtime) return 0;
  const ageMin = Math.round((Date.now() - new Date(reportMtime).getTime()) / 60000);
  console.log(
    `[coverage-readout] 实况 vs 登记值（报告 mtime ${reportMtime.toISOString()} ≈ ${ageMin} 分钟前；` +
      `登记处 ${r.registeredCount} 条）。`,
  );
  console.log(
    "[coverage-readout] 维度：L 行 / S 语句 / F 函数 / B 分支；gap = 登记值 − 实测（正值=低于登记，该治）。按 gap 降序：",
  );
  if (r.rows.length === 0) {
    console.log(
      "[coverage-readout] 没有一条登记项对得上报告里的文件（报告可能是增量跑，或登记处口径变了）。",
    );
  }
  for (const row of r.rows) {
    const p = row.pct,
      g = row.gap,
      reg = row.reg;
    console.log(
      `[coverage-readout] ${row.glob}  (${row.matched} 文件)\n` +
        `    L ${fmt(p.lines)}/${reg.lines} (${signed(g.lines)})` +
        `  S ${fmt(p.statements)}/${reg.statements} (${signed(g.statements)})` +
        `  F ${fmt(p.functions)}/${reg.functions} (${signed(g.functions)})` +
        `  B ${fmt(p.branches)}/${reg.branches} (${signed(g.branches)})`,
    );
  }
  if (ageMin > 6 * 60) {
    console.log(
      `[coverage-readout] ⚠️ 报告已 ${ageMin} 分钟未更新，读数可能偏离当前代码树 —— 重跑 pnpm test:coverage 取最新。`,
    );
  }
  console.log(
    "[coverage-readout] 本读数**只「读」不「判红」；按门槛判红的唯一执行者是 " +
      "`node scripts/full-suite-run.mjs --enforce-coverage`（ISSUE #2669）。",
  );
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exit(await main());
}
