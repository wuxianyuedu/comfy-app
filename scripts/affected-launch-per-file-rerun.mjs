#!/usr/bin/env node
/**
 * affected-launch-per-file-rerun.mjs — 「第 2 遍的读数认不出自己」时的**有界逐文件补跑**
 *
 * 职责：第 2 遍（`--no-file-parallelism`）仍红、而 junit 读数按文件分不开时，一份一次
 * spawn、一份自己一个退出码 —— 把判决粒度拿回来（不解析块）。跑出来的结论并回
 * `verdict`（`mergePerFileReads()`）。
 *
 * 为什么单独一份：`scripts/run-affected-tests.mjs` 贴着 `check-infra-file-size.cjs` 的
 * 900 行硬闸（#3251 的 oxfmt 迁移后 905 行，ISSUE #3254 立案），拆的是**职责**不是
 * 行数 —— 这一段与「起第 2 遍 / 收尾话术」变化方向不同：它只回答「哪几份还没被定性、
 * 买不买得起再跑」。搬走之后判决链、退出码与话术一个字没改（`runChunk` 只换调用点）。
 *
 * 上限 `PER_FILE_RERUN_MAX` 跟着搬过来：它只属于这一格（`scripts/.gate-thresholds.json`
 * 里 `file` 一栏同步改到本文件，数值与 `kind` 不变）。
 *
 * @module scripts/affected-launch-per-file-rerun.mjs — 机制层（逐文件补跑）
 */
import {
  affordablePerFileCount,
  perFileBudgetStopReport,
  remainingWallClockMs,
} from "./affected-launch-wallclock.mjs";
import { mergePerFileReads } from "./affected-launch-retry-verdict.mjs";

/**
 * 「分不出哪份是超时」时逐文件补跑的**上限**（份数）。
 *
 * 为什么要有上限：逐文件补跑是一份一次进程启动（约 1–3s），而这条路只在
 * 「第 2 遍仍红且第 2 遍的 junit 认不出这些文件」这条稀有路径上走 —— 上限之内
 * 用几十秒换回判决粒度，值得；上限之外（典型是第 1 遍崩在 suite 之前、整块都被
 * 拉去复跑）逐文件跑等于把整块再跑一遍，而那块本来就是因为跑不动才红的。
 * 超过上限就停在这一档并把名单点出来（退 2），**不**冒充「整块只是超时形态」。
 *
 * 8 = 实测「一次改一个 feature」时组 C 失败文件数的常见上界再留一倍余量。
 * 这一条与 `affected-launch-scope-advice.mjs` 那份 `SCOPE_ADVICE_MIN` 都在 `scripts/.gate-thresholds.json` 里按 `report`
 * 入账（不是松紧量：调它只改变「要不要多花那几十秒」，不改变任何一条断言的判定）。
 */
const PER_FILE_RERUN_MAX = 8;

/**
 * 第 2 遍的读数认不出自己 ⇒ 有界逐文件补跑，把判决粒度拿回来。
 *
 * 只处理 `kind === "unattributed"` 且认不出的份数在 `PER_FILE_RERUN_MAX` 之内的那一档；
 * 其余情形**原样返回** `verdict`（调用点无条件调用，判据不在这两份文件之间分叉）。
 *
 * 单价 = 上一份补跑的真实墙钟；买不起就停，剩下的退回调用点既有那条「退 2 并点名」
 * 出口 —— 不新造一档结论，也不把没跑的那份算进「已确认只是超时」（ISSUE #2364）。
 *
 * @param {{verdict: {kind: string, timedOut: string[], hardFail: string[], unknown: string[]}, spawn: (entry: string, args: string[]) => {status: number | null, output: string}, entry: string, stageBudget?: {deadline: number, budgetMs: number}}} input
 * @returns {{kind: string, timedOut: string[], hardFail: string[], unknown: string[]}} 并回补跑读数之后的 `verdict`
 */
export function rerunUnknownFiles({ verdict, spawn, entry, stageBudget }) {
  if (
    verdict.kind !== "unattributed" ||
    verdict.unknown.length === 0 ||
    verdict.unknown.length > PER_FILE_RERUN_MAX
  ) {
    return verdict;
  }
  process.stderr.write(
    `[affected-launch] ${verdict.unknown.length} 份文件在第 2 遍的读数里认不出自己` +
      " ⇒ 逐文件各跑一次把判决粒度拿回来（不解析块，一份自己一个退出码）…\n",
  );
  /** @type {{file: string, status: number | null, output: string}[]} */
  const perFile = [];
  let perFileMs = 0;
  for (const file of verdict.unknown) {
    const pending = verdict.unknown.length - perFile.length;
    const affordable = affordablePerFileCount({
      budget: stageBudget,
      perFileMs,
      pending,
    });
    if (affordable <= 0) {
      process.stderr.write(
        perFileBudgetStopReport({
          remainingMs: remainingWallClockMs(stageBudget) ?? 0,
          perFileMs,
          left: pending,
        }),
      );
      break;
    }
    const oneStartedAt = Date.now();
    const one = spawn(entry, ["run", "--no-file-parallelism", file]);
    perFileMs = Date.now() - oneStartedAt;
    perFile.push({ file, status: one.status, output: one.output });
  }
  return mergePerFileReads(verdict, perFile);
}
