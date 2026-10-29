#!/usr/bin/env node
/**
 * merged-side-loss-core.mjs — 「整份取一侧 / 退回成更早的某一版」的**共用内核**
 * （规范 §11.23.6 / ISSUE #1617 + #1618）。
 *
 * ── 为什么要有这份模块 ────────────────────────────────────────────────
 *
 * 这一族有两个执行者，触发时机不同、问的是同一个问题：
 *
 *   · `check-merged-side-loss.mjs`（事后复算档，ISSUE #1617）：给一个**已知好的
 *     基线**，逐文件判「结果提交里这一版，是不是退回了基线之前的某一版」；
 *   · `check-pending-merge-loss.mjs`（提交前档，ISSUE #1618）：合并进行中、结果
 *     还在索引里时，判「结果里这一版，是不是整份取了**非 HEAD 侧**的某一版，
 *     而 HEAD 侧在该文件上还有没被取代的改动」。
 *
 * 两者的**判定核心是同一件事**：*「结果里这一版的内容，等于某个更早版本的内容」*。
 * 它的取证方式（把两边的内容各自 `hash-object` 成 blob、逐字节比）只有一份实现 ——
 * 抄成第二份就是 §12.12 的字面孪生，而孪生对里那份「顺手改对了」的会静默漂掉。
 *
 * ── 内核里**不放**什么（§18.4 / §12.12 的分工口径）──────────────────
 *
 * 它不知道「基线」「HEAD」「MERGE_HEAD」「候选历史」这些业务名词，只接**已经取好的
 * 事实**（一组 blob、一份历史 sha 清单、一个取某版本 blob 的函数）。谁给的事实、
 * 在哪条线上取，由两个执行者各自决定 —— 传输层 / 任务语义不进内核。
 *
 * @module scripts/merged-side-loss-core — 判据共用内核（无副作用、可被两处 import）
 */

/**
 * 生成物前缀 —— 「退回成旧版」在它们身上是常态（1-1 实测 109 份命中里 23 份是产物）。
 * 留着会把真信号淹掉，所以它是**这一族的共用口径**，只在这里定义一次。
 */
export const GENERATED_PREFIXES = ["docs/api/", "docs/generated/"];

/** 该路径是不是生成物（退回即常态，不判）。
 *
 * @param {string} file 变更清单里的一条路径
 * @returns {boolean}
 */
export function isGenerated(file) {
  return GENERATED_PREFIXES.some((p) => file.startsWith(p));
}

/**
 * 结果版是不是「退回了候选历史里的某一版」。
 *
 * 这就是本族的判定核心：内容层相等（blob 逐字节相同）即命中，与是哪个分支、哪条
 * 时间线无关 —— 那些是调用方给的**输入**（`historyShas` / `blobAt`），内核不分。
 *
 * ⚠️ 命中 = **需要人工看**，不等于「确定丢了」：blob 相等性有巧合（空文件、
 * 逐字相同的正当改动）。这条语义由两个执行者各自在话术里说清。
 *
 * @param {{result: string, historyShas: string[], blobAt: (sha: string) => (string | null)}} input
 *   `result` 是结果版的 blob sha；`historyShas` 是候选历史（**不含** result 本身那一版）；
 *   `blobAt(sha)` 取该 sha 处这个文件的 blob sha，取不到给 `null`。
 * @returns {string | null} 命中的那个历史 sha；未命中给 `null`。
 */
export function findEarlierVersion({ result, historyShas, blobAt }) {
  if (!result) return null;
  for (const older of historyShas) {
    if (!older) continue;
    if (blobAt(older) === result) return older;
  }
  return null;
}
