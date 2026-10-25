#!/usr/bin/env node
/**
 * check-skip-probe-readings.mjs — 「按环境跳过的那一组，得说得出**为什么**」的判据
 * （ISSUE #2316，D 组）
 *
 * 现场：`tests/check-file-structure.test.ts` 的 PowerShell 探测只认「spawn 成不成功」，
 * 于是一台机器上只要存在一个同名的冒牌可执行文件（发行版附带的 shell 别名之类），
 * 探测就会把它认成 PowerShell —— 这一组用例不再跳过，转以 `Test timed out in 20000ms`
 * 红掉。同一份种子在另一台 Linux 上给出**相反**的结论（整组 skipped）。
 *
 * 修法分两半，缺一即回到原样：
 *   ① 判据那一半 —— 探测要「起得来**且**解释得了参数」，失败形态分三条
 *      （`src/lib/process/probe-exe.ts`）；
 *   ② **看得见**那一半 —— 每个候选探完都留一条原因，一次性打出来。没有 ②，下一次
 *      只能看到一片 `skipped`，说不出「安静地跳过了」还是「安静地判错了」。
 *
 * 本判据守的就是 ②：**凡是「这台机器上没有某个工具 ⇒ 这一组跳过」的站点，都必须把
 * 逐候选的读数打出来**。它判的是**形状**（纯文本、零网络、零子进程、< 0.1s），
 * 不判「写得对不对」—— 那由 `src/lib/process/probe-exe.test.ts` 守。
 *
 * 为什么这条不能只写在散文里：条件性 skip 早有一份登记表
 * （`tests/conditional-skip-registry.test.ts`），但它只记「有几条会暗、为什么暗」，
 * 管不到「暗的时候说不说得清是哪一种暗」。而这两种暗的下一动作完全不同
 * （去装 vs. 改探测）—— 与 `check-app-port-vectors.cjs` 把 `missing` / `malformed`
 * 分成两档是同一条口径，只是那一份判在执行时，这一份判在形状上。
 *
 * 判据（扫描面 `tests/**` 与 `src/**` 下的 `*.test.ts(x)`）：
 *   文件里出现 `const X = firstRunnable(` 形式的探测，而该文件里**没有任何**
 *   `describeProbeMisses(` 调用 ⇒ 红。
 *
 * 刻意不做的：
 *   · 不判「每个候选各自一行」（那是排版，不是判据）；
 *   · 不扫 `.mjs` / `.ts` 的非测试源码（那边的话术由各自的出口负责）；
 *   · 不做基线、不给 `--update`（存量是 0：两处探测都已带上读数，见
 *     `tests/check-file-structure.test.ts`）。
 *
 * 用法：
 *   node scripts/check-skip-probe-readings.mjs            # 判据（供 pre-commit D 组）
 *   node scripts/check-skip-probe-readings.mjs --report   # 只出清单不判失败（盘点用）
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  dirExists,
  readForScan,
  vanishedNote,
  walkForScan,
} from "./gate-scan-read.cjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** 扫描面：与 `vitest.config.ts` 的 `include` 同口径（`src/**` + `tests/**`）。 */
const SCAN_DIRS = ["src", "tests"];
const TEST_FILE_RE = /\.test\.tsx?$/;
/** 「这台机器上有没有」的探测站点（`firstRunnable` 是那条判据的唯一入口）。 */
const PROBE_SITE_RE = /\b(?:const|let)\s+\w+\s*=\s*firstRunnable\(/;
/** 「逐候选为什么没成」的出口。 */
const READING_RE = /\bdescribeProbeMisses\(/;

/**
 * 判一个文件（纯函数，用例可以逐格钉住，不必造磁盘布局）。
 *
 * @param {string} rel 仓库相对路径（只用于话术）
 * @param {string} src 源码原文（未去注释）
 * @returns {{ok: boolean, problems: string[]}} 判决
 */
export function judgeSkipProbeReadings(rel, src) {
  if (!PROBE_SITE_RE.test(src)) return { ok: true, problems: [] };
  if (READING_RE.test(src)) return { ok: true, problems: [] };
  return {
    ok: false,
    problems: [
      `${rel}: 有「这台机器上有没有」的探测站点（\`firstRunnable(\`），却没有把逐候选的` +
        `读数打出来（\`describeProbeMisses(\`）—— 跳过时只剩一片 skipped，` +
        "说不出「安静地跳过了」还是「安静地判错了」（ISSUE #2316）",
    ],
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  const reportOnly = new Set(process.argv.slice(2)).has("--report");
  const problems = [];
  let sites = 0;
  let vanished = 0;
  for (const dir of SCAN_DIRS) {
    if (!dirExists(path.join(ROOT, dir))) {
      problems.push(`${dir}/ 不存在 —— 扫描根缺一个，这一轮不是「没有站点」`);
      continue;
    }
    for (const abs of walkForScan(path.join(ROOT, dir), /\.test\.tsx?$/, {
      skipHiddenDirs: true,
    })) {
      const src = readForScan(abs);
      if (src === null) {
        vanished += 1;
        continue;
      }
      const rel = path.relative(ROOT, abs).replaceAll("\\", "/");
      if (PROBE_SITE_RE.test(src)) sites += 1;
      problems.push(...judgeSkipProbeReadings(rel, src).problems);
    }
  }
  /* 「量具没坏」：扫描面一个探测站点都没有时，这条判据什么也没保住 —— 那说明
   * 扫描面或正则坏了（同 `check-declaration-readers.cjs` 的地板口径）。 */
  if (sites === 0) {
    problems.push(
      "扫描面里一个探测站点都没有 —— 判据可能是空转（正则/扫描面坏了），" +
        "而不是「仓库里没有这种站点」",
    );
  }
  /* 清单走 **stdout**、与结论行同一条流：这是本仓门禁脚本的既有约定
   * （`--report` 那一档被调用点直接 `toContain` 读形状），而 `console.error` 走的是
   * 另一条流 —— 混着用会让「有没有拦住」与「拦下了什么」落在两个地方。 */
  if (problems.length > 0) {
    console.log("[skip-probe-readings] ✗");
    for (const p of problems) console.log(`  ✗ ${p}`);
    if (!reportOnly) process.exitCode = 1;
  } else {
    console.log(
      `  [ok] ${sites} 个「这台机器上有没有」的探测站点都带着逐候选读数` +
        vanishedNote(vanished),
    );
  }
}
