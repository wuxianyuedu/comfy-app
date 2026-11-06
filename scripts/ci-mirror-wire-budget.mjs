#!/usr/bin/env node
/**
 * `ci-mirror-wire-budget.mjs` —— 镜像格「探活 + wire 推送」**共用一份墙钟预算**（ISSUE #3234）。
 *
 * 立案现场：墙钟预算此前只挂在 `git push` 那一跳，探活 `git ls-remote` 仍是「3 次 +
 * 固定 5s/10s 退避」的旧口径。一次 PR 档镜像同步实测撞上 `Recv failure: Connection was
 * reset`，每次约 0.3s 就败，探活跑满 3 次、约 16s 便交账；而探活失败会**短路**掉后面的
 * 推送，于是 4 分钟预算一秒都没花。用户要的「起码试 3–5 分钟」实际只覆盖了三跳里的第二跳。
 *
 * 这里的形状是「一个起点、两跳共用」：探活与推送各自把 `wireBudget()` 的当前值交给
 * `runGitWithRetry` 的 `budgetMs`。那个函数以**自己被调用的时刻**为起点扣时间，所以传
 * 「剩余量」正好等价于两跳共享同一个 deadline，而不是各领一份预算叠成两倍。
 *
 * 最坏墙钟随之从「探活 105s + 推送 240s + LFS 首刀 240s」降到「wire 档 240s + LFS
 * 首刀 240s = 480s」，仍在 `.cnb.yml` 的 10m 外框内，且比改动前更宽松。`gitTimeoutFor`
 * 会把有预算的重试裁到剩余量，探活首刀仍吃 30s 上限，慢但正常的那一读不会被掐死。
 *
 * 纯函数、零副作用；`now` 可注入，用例不必真等 4 分钟。
 *
 * @module scripts/ci-mirror-wire-budget — 探活与 wire 推送共享的墙钟预算
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
