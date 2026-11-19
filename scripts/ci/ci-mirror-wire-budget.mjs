#!/usr/bin/env node
/**
 * `ci-mirror-wire-budget.mjs` —— 镜像格推送那一跳的**墙钟预算起点**（ISSUE #3234 / #3252）。
 *
 * 立案现场（#3234）：墙钟预算此前只挂在 `git push` 那一跳，探活 `git ls-remote` 仍是
 * 「3 次 + 固定 5s/10s 退避」的旧口径。一次 PR 档镜像同步实测撞上 `Recv failure: Connection
 * was reset`，每次约 0.3s 就败，探活跑满 3 次、约 16s 便交账；而探活失败会**短路**掉后面的
 * 推送，于是 4 分钟预算一秒都没花。
 *
 * #3252 起推送前不再有探活那一跳（双跳只是把同一次出网试两遍，现场探活 6 次耗 201s、
 * 内容推送一次都没发起），这个模块只剩一个职责：**在推送第一刀之前打个起点**，把
 * 「还剩多少预算」交给 `runGitWithRetry` 的 `budgetMs`。那个函数以**自己被调用的时刻**为
 * 起点扣时间，传「剩余量」正好等价于整档共享同一个 deadline。
 *
 * 最坏墙钟：push 档 240s + LFS 首刀 240s = 480s，仍在 `.cnb.yml` 的 10m 外框内。
 * `gitTimeoutFor` 会把有预算的重试裁到剩余量，首刀仍吃 `PUSH_TIMEOUT_MS` 上限。
 *
 * 纯函数、零副作用；`now` 可注入，用例不必真等 4 分钟。
 *
 * @module scripts/ci-mirror-wire-budget — 推送那一跳的墙钟预算起点
 */
import { PUSH_RETRY_BUDGET_MS } from "./ci-mirror-retry-policy.mjs";

/**
 * 以调用这一刻为 wire 档起点，返回「还剩多少预算」。
 *
 * 不为负：预算用尽时回 0，`runGitWithRetry` 会按「低于一次尝试就不再发起」收口。
 *
 * @param {() => number} [now] 单调时钟（用例注入；缺省 `Date.now`）
 * @returns {() => number} 剩余预算（毫秒）
 */
export function createWireBudget(now = Date.now) {
  const startedAt = now();
  return () => Math.max(0, PUSH_RETRY_BUDGET_MS - (now() - startedAt));
}
