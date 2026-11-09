#!/usr/bin/env node
// @ts-nocheck -- 门槛脚本共用件:文件规模「临近硬闸」的提醒读数(被两把尺寸闸共用,自己不判成败)
/**
 * 「临近硬闸」提醒读数的**共用实现**（ISSUE #3473）。
 *
 * 补的是哪一格：R5（`src/**`）与基础设施档（`scripts/**` + `tools/**`）都是 900 行
 * **硬闸** —— 超 1 行即阻断，而 899 行那一刻什么读数都没有：等撞闸才知道要拆，
 * 规划的时机已经迟了（同一批里 `lifecycle-launch.ts` / `freshness-ledger.mjs` 双双
 * 停在 899）。这一份把「临近」变成**可读数**：到提醒线（两把闸各自入账的
 * `PROXIMITY_WARN_LINES`）就点名，让人在还有余量时规划拆分，而不是等硬闸拦下提交。
 *
 * 边界三条：
 *   · **只提醒、不阻断** —— 硬闸是两把尺寸闸自己的事，这里永远不参与退出码；
 *     把提醒做成闸，等于把 800 变成第二个 900（同样的撞闸形态换个数字重来）。
 *   · **阈值不在这份里** —— 两把闸各自的 `PROXIMITY_WARN_LINES` 顶层具名入账
 *     （`scripts/.gate-thresholds.json`），这里只收参数：共享件藏数值，就是
 *     「调松没有任何一格会红」那一族的新形态（#2156 立账要防的正是它）。
 *   · **只渲染、不落盘、无状态** —— 入参出参全是纯数据，两把闸的测试各自喂假值就能判。
 */

/**
 * 过滤出「临近硬闸」的那一档：`warnAt ≤ 行数 ≤ hardAt`。
 *
 * 上界取 `hardAt` 而不是排除它：硬闸判的是「**超过**」（900 行本身不红），
 * 所以 900 恰恰是最需要提醒的那一格 —— 再加一行就撞闸。901 以上的由闸自己
 * 报红，这里不再重复点名。
 *
 * @param {Array<[string, number]>} entries ` [仓库相对路径, 行数] ` 的数组
 * @param {{warnAt: number, hardAt: number}} thresholds
 * @returns {Array<[string, number]>} 同形状，按行数降序
 */
function nearLimitFiles(entries, { warnAt, hardAt }) {
  return [...entries]
    .filter(([, lines]) => lines >= warnAt && lines <= hardAt)
    .sort((a, b) => b[1] - a[1]);
}

/**
 * 渲染提醒读数（**纯函数**：回行数组，打不打、打到哪个流由调用方决定）。
 *
 * @param {{tag: string, near: Array<[string, number]>, warnAt: number, hardAt: number,
 *          scopeNote?: string}} input
 *   `scopeNote` 说明这份清单覆盖了谁（如「本次暂存触碰的文件」），缺席按全量口径念。
 * @returns {string[]} 空清单回 `[]`（一个字都不打 —— 安静是这项读数的常态）
 */
function renderProximityLines({ tag, near, warnAt, hardAt, scopeNote }) {
  if (near.length === 0) {
    return [];
  }
  const scope = scopeNote ? `（${scopeNote}）` : "";
  const sorted = [...near].sort((a, b) => b[1] - a[1]);
  const lines = [
    `${tag} ⚠️ 临近拆分提醒（${warnAt}–${hardAt} 行）${scope}：${near.length} 个 —— ` +
      `只读数、不阻断（#3473）；出口与硬闸同一条：按职责拆` +
      `（规范 §12.6 R5；先例见 ci-mirror-retry-policy / ci-cp936-write 那两刀）`,
  ];
  for (const [rel, count] of sorted) {
    lines.push(`${tag}   · ${rel}（${count} 行）`);
  }
  return lines;
}

module.exports = {
  nearLimitFiles,
  renderProximityLines,
};
