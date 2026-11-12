#!/usr/bin/env node
/**
 * affected-patch-coverage.mjs — 受影响链的 **patch coverage 数据面**（ISSUE #2687）。
 *
 * `run-affected-tests.mjs` 加上这一格后越过 900 行硬闸（§12.6 R5），而这一小段与
 * 那份编排的其余部分毫不相干 —— 拆的是职责，不是行数（与 `reformat-scan-core.mjs`
 * 同一条理由）。读数侧的判据在 `scripts/check-patch-coverage.mjs`（递归收 *.info、
 * 逐行取最大命中合并——复跑补上的覆盖不丢、首跑数据不被复跑子集覆盖）。
 *
 * @module scripts/affected-patch-coverage — 受影响链的 coverage 参数拼装
 */

/**
 * 逐块的 vitest coverage 参数（`COMFY_PATCH_COVERAGE=1` 才在场）。
 *
 * 落点刻意与全量档分开（`coverage-patch/`，不碰 `coverage/`）—— 两档各写各的目录，
 * 谁也不覆盖谁。隔离复跑（attempt=2）落 `<块号>-retry/`：判据对多份 lcov 逐行取
 * 最大命中合并，复跑补上的覆盖不会丢，首跑数据也不会被复跑子集覆盖。
 *
 * thresholds 不用摘：`vitest.config.ts` 的默认档已经把 thresholds 摘空
 * （`COMFY_COVERAGE_ENFORCE!==1`，ISSUE #2669），受影响链不会撞上那批门槛。
 * `--coverage.all` 保持默认（未加载的 src 文件也进报告 = 0%）——「没被任何用例
 * 加载」恰恰是 patch coverage 要抓的形状之一。
 *
 * @param {number} chunkId 块号
 * @param {1 | 2} attempt 1 = 首跑；2 = 隔离复跑（单独目录）
 * @param {Record<string, string | undefined>} [env] 环境读数（缺省 process.env）
 * @returns {string[]} vitest 实参片段；开关不在场 ⇒ 空数组（行为与改动前逐字一致）
 */
export function patchCoverageArgs(chunkId, attempt, env = process.env) {
  if (env.COMFY_PATCH_COVERAGE !== "1") {
    return [];
  }
  return [
    "--coverage",
    "--coverage.reporter=lcov",
    `--coverage.reportsDirectory=coverage-patch/${chunkId}${attempt === 2 ? "-retry" : ""}`,
  ];
}
