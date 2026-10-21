#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:用例存量一致性(磁盘 ⇄ vitest.config.ts 的收集面,供 .githooks/pre-commit 调用)
/**
 * 「在盘上、但一条用例都不会被收集」的测试文件，必须当场红。
 *
 * 立案现场（2026-10-21 盘点）：全仓 794 份 `*.test.ts(x)` 逐份确认「`vitest list`
 * 真的为它打了行」。那次是**人**跑的，读数全绿；但「全绿」只对那一天成立 ——
 * 配置里 `DOM_TEST_GLOBS` 加一条目录、`projects` 改一次 include / exclude、
 * 或有人把用例放进任何 glob 都没覆盖的位置，效果是同一件事：
 * **那份文件从此不在任何 project 的收集面上**，而它不会让任何东西变红。
 * 它照样在盘上、照样被 eslint / tsc / prettier 扫、照样出现在 PR 的 diff 里 ——
 * 只是再也没有人跑它。这正是本仓库反复踩的那一族（§11.13.1「判据在场 ≠ 判据在跑」、
 * §11.7「写着 100、报告里查无此文件」）：**失效的方向是静默的**。
 *
 * 判据与姊妹判据 `check-test-environment.cjs` 的分工（那一份**刻意不判**下面这两条，
 * 它的注释写明了理由：配置自己有缝时在那里报「冗余」会把人带偏）：
 *
 *   · **漏收**：一个档都没命中（`include` 没盖住，或被 `exclude` 排掉）⇒ 本判据拦；
 *   · **重叠**：两个档都命中（同一条用例会被收集两遍 / glob 写重）⇒ 本判据拦。
 *
 * 为什么**不跑** `vitest list` 而是从同一份配置离线算：`vitest list` 要起一次 vite
 * （本机实测冷启 60s 量级），而 D 组与 A/B/C 并行、按墙钟取最大 —— 把它挂进每次提交
 * 等于让全组等它。收集面的**权威**定义就是 `vitest.config.ts` 的 `include` / `exclude`
 * （`vitest list` 只是它的执行结果），所以这里与 `check-test-environment.cjs`
 * **共用同一份解析**（`vitest-projects.cjs`）：配置改了，两份判据同时跟着改。
 *
 * ⚠️ **已知边界**（别把它读成它不防的东西）：本判据判「glob 收不收」，
 * **判不出「收了但零条用例」**（整份 `describe.skipIf(false)`、只剩类型导出）。
 * 那一层归既有机制：条件跳过由 `tests/conditional-skip-registry.test.ts` 登记、
 * `test.todo` 由 `scripts/check-test-todo.cjs` 判。要连那一层一起核，人工跑一次
 * `pnpm exec vitest list` 与 `git ls-files "*.test.ts*"` 对差（口径见规范 §11.17.1.1）。
 *
 * 用法：
 *   node scripts/check-test-inventory.cjs            # 检查
 *   node scripts/check-test-inventory.cjs --report   # 只出清单不判失败（盘点用）
 *
 * 退出码 0 = 通过，1 = 阻断。
 */
const path = require("node:path");
const { dirExists, walkForScan } = require("./gate-scan-read.cjs");
const { loadProjects, matchesAny } = require("./vitest-projects.cjs");

const ROOT = path.resolve(__dirname, "..");
const TAG = "[test-inventory]";
const REPORT_ONLY = new Set(process.argv.slice(2)).has("--report");

/** 扫描范围：与 `vitest.config.ts` 里两个档的 `include` 同口径（都是 `src` 与 `tests`）。 */
const SCAN_DIRS = ["src", "tests"];
const TEST_FILE_RE = /\.test\.tsx?$/;

/**
 * 期望解析出几个档。少于这个数 ⇒ **判失败**，不许退回「没有目录档」——
 * 那等于这条判据静默消失（与 `check-test-environment.cjs` 同一条 fail-closed）。
 * 配置真的加减档时，同批改这里与那一份（改的是「读没读出来」，不是「档该有几个」）。
 */
const EXPECTED_TIERS = 2;

/**
 * 枚举扫描面。**点开头的目录**不进去，但点开头的**文件**照收 —— 并发探针
 * （`tests/.setup-cleanup-probe-*.test.tsx`）正是后者，跳掉它等于判据在最该看着它的
 * 那一刻转身不看。消失容错的口径见 `gate-scan-read.cjs`。
 */
function walk(dir) {
  return walkForScan(dir, TEST_FILE_RE, { skipHiddenDirs: true });
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

/**
 * 判决内核：**磁盘上的用例文件** 对 **档配置给出的收集面**。
 *
 * 抽成纯函数（而不是在 `main()` 里边扫边判）是为了让它能被自证测试**进程内**喂夹具：
 * 判据自己跑在临时仓库上，而「磁盘有、收集面没有」这种输入在真仓库上造不出来
 * （造出来就真红）。同 `check-known-failed-stale.mjs` 的 `judgeStillFailing()` 那一形。
 *
 * @param {string[]} diskRel 磁盘上真实存在的用例文件（仓库根相对 POSIX 路径）
 * @param {Array<{name: string, include: string[], exclude: string[]}>} tiers 各档的 glob
 * @returns {{dead: string[], overlap: Array<{rel: string, tiers: string[]}>}}
 *   `dead` = 一个档都没接住的（漏收）；`overlap` = 被两个以上档接住的（重叠）。
 */
function judgeCoverage(diskRel, tiers) {
  const dead = [];
  const overlap = [];
  for (const rel of diskRel) {
    const hits = [];
    for (const t of tiers) {
      const included = matchesAny(rel, t.include);
      const excluded = matchesAny(rel, t.exclude);
      if (included && !excluded) hits.push(t.name);
    }
    if (hits.length === 0) dead.push(rel);
    else if (hits.length > 1) overlap.push({ rel, tiers: hits });
  }
  return { dead, overlap };
}

function main() {
  /* 扫描根本身不在 ⇒ 判失败。与「条目在扫描途中消失」是两件事：后者是并发、
   * 那一支由 walkForScan 降级并计数；前者是仓库被切了一半 / 跑错工作目录，
   * 静默跳过等于让判据在「一份输入都没读」的情况下报绿（gate-scan-read.cjs 的口径）。 */
  for (const d of SCAN_DIRS) {
    if (!dirExists(path.join(ROOT, d))) {
      console.error(
        `${TAG} [ERROR] 扫描根 \`${d}/\` 不存在（cwd=${process.cwd()}）。\n` +
          `${TAG}   那是判据没跑成，不是「没有问题」—— 按 fail-closed 判红。`,
      );
      return 1;
    }
  }

  const { tiers, found, configText } = loadProjects(ROOT);
  if (configText === null || found < EXPECTED_TIERS) {
    console.error(
      `${TAG} [ERROR] 解析 \`vitest.config.ts\` 的 \`projects\` 失败` +
        `（读到 ${configText === null ? "0 份配置" : found + " 个档"}，期望 ${EXPECTED_TIERS}）。\n` +
        `${TAG}   本判据的收集面就是那两个档的 \`include\` / \`exclude\`；\n` +
        `${TAG}   配置形状改了就要同批改这里 —— 静默退回「没有档」等于这条判据消失。`,
    );
    return 1;
  }

  const listed = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)))
    .map((abs) => toPosix(path.relative(ROOT, abs)))
    .sort((a, b) => a.localeCompare(b));

  /* 一个用例文件都没有 ⇒ 同样是判据没跑成（glob 写错 / 扫描面被改窄），
   * 不是「全仓没有测试」。 */
  if (listed.length === 0) {
    console.error(
      `${TAG} [ERROR] ${SCAN_DIRS.join(" 与 ")} 下一个用例文件都没枚举到。\n` +
        `${TAG}   空扫描面对本判据等于「没有输入」，按 fail-closed 判红。`,
    );
    return 1;
  }

  const tierList = [...tiers.entries()].map(([name, g]) => ({
    name,
    include: g.include,
    exclude: g.exclude,
  }));
  const { dead, overlap } = judgeCoverage(listed, tierList);
  const globCount = tierList.reduce(
    (n, t) => n + t.include.length + t.exclude.length,
    0,
  );
  const problems = dead.length + overlap.length;

  if (problems === 0) {
    /* 这一层只枚举文件名、不读内容，所以没有「扫描途中条目消失」那一计数
     * （那条口径属于 readForScan，见 gate-scan-read.cjs）。 */
    const line =
      `${TAG} OK —— ${listed.length} 份用例全部恰好落在一个档的收集面上` +
      `（${tierList.map((t) => t.name).join(" / ")}，共 ${globCount} 条 glob）。`;
    console.log(line);
    return 0;
  }

  /* 输出通道按档位分：`--report` 是**盘点**，清单走 stdout（它是给人看的正向输出，
   * 而 `repo.run()` 成功时只把 stdout 交回来）；判定模式的问题走 stderr。
   * 混用会让「盘点档明明列出了死文件、调用方却读到空输出」——
   * 那种判据看起来跑了，实际谁也没看见它的读数。 */
  const emit = REPORT_ONLY ? console.log : console.error;

  emit(
    `${REPORT_ONLY ? `${TAG} 盘点：` : `${TAG} [ERROR] `}${problems} 处收集面问题` +
      `（漏收 ${dead.length} / 重叠 ${overlap.length}）：\n`,
  );
  for (const rel of dead) {
    emit(`  · ${rel}  [漏收]`);
    emit(
      `      没有任何档的 include 命中它（或被 exclude 排掉）—— 它在盘上，但一条用例都不会被收集。`,
    );
  }
  for (const o of overlap) {
    emit(`  · ${o.rel}  [重叠：${o.tiers.join(" + ")}]`);
    emit(
      `      两个档都接住了它 —— 同一条用例会被收集两遍（或 glob 写重了）。`,
    );
  }
  emit(
    "\n修法：" +
      "\n  · 「漏收」：先确认这份用例**想**跑在哪一档。要 DOM 就把它加进 " +
      "`vitest.config.ts` 的 `DOM_TEST_GLOBS`（整目录一致时）或写文件头 " +
      "`// @vitest-environment happy-dom`（只加几份时）；要 node 档就什么也别做 —— " +
      "它本来就该被 `src/**` / `tests/**` 收住，收不住说明 glob 被改窄了。" +
      "\n  · 「重叠」：两个档的 include 出现了交叠。DOM 档的 include 与 node 档的 exclude " +
      "必须是同一份 `DOM_TEST_GLOBS` —— 一边改了另一边没改就会同时命中或同时落空。" +
      "\n  口径见 docs/standards/11-测试与可观测性.md §11.17；" +
      "同源的姊妹判据：node scripts/check-test-environment.cjs",
  );
  return REPORT_ONLY ? 0 : 1;
}

module.exports = { judgeCoverage };

/* 判据被 import（自证测试喂 `judgeCoverage`）时不许跑 main —— 那会把承载它的
 * vitest 进程一起 exit 掉。同 `check-docs-api.cjs` 的守卫。 */
if (require.main === module) {
  process.exit(main());
}
