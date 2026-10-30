#!/usr/bin/env node
/**
 * daily-run.mjs — 「每天首次自证」那几档共用的**记账通道**（规范 §11.8 / §13.5.4）。
 *
 * 本文件把三件在四档里逐字重复的事收成一份实现（§12.12 / §12.18：不造第二轮子）：
 *
 *   ① **`--skip "<理由>"` 的解析与落账** —— 「今天不跑，但理由有人回答过」；
 *   ② **`--dirty "<理由>"` 的解析与落账** —— 「这次改动确实不吃这一档」；
 *   ③ **跑完之后按退出码决定记不记账** —— 只有绿了才记。
 *
 * 四档各自还剩下的是**它们自己那一条命令**（`pnpm test:e2e` / `pnpm run test:coverage`
 * / `pnpm run build`），以及「红的定性怎么读」—— 那两件事四档确实不同，留在各自脚本里
 * （把它们也合进来会得到一份带四个 `if` 的实现，正是本条要拦的形态）。
 *
 * ⚠️ 别把这段抄进每一个跑法脚本：`--skip` 的理由下限（`isUsableSkipReason`）、
 * `runGate` 的 `dirtySince` 口径、以及「绿才记」这三条已经各被一条用例钉住，
 * 抄一份就多一处可以悄悄漂的地方，而漂了**不会红**（账面上仍是合法的日期 + 人名 + 命令）。
 */
import process from "node:process";

import {
  freshnessTrack,
  isUsableSkipReason,
  writeSkipRecord,
  gitUser,
} from "./freshness-ledger.mjs";

/**
 * 从 argv 里读出「这次是不是记一条豁免 / 一条『不吃这一档』」—— 抽成纯入口，
 * 好让「给了 `--skip` 就不再起子进程」与「理由不合用就退回去」这两条边界能被真跑一次。
 *
 * 三条形状（`--dirty` 与 `--skip` 同形，只是写进账里的栏不同）：
 *   · 没有那个开关 ⇒ `{mode: "run"}`；
 *   · 给了**可用**理由 ⇒ `{mode: "skip" | "dirty", reason}`；
 *   · 给了缺失 / 占位 / 过短的理由 ⇒ `{mode, reason: null}`（调用方按退出码 2 处理）。
 *
 * 参数收 `unknown[]` 而不是 `string[]`：四档的入口都在这一处（`e2e-run.mjs` 的
 * `parseSkip` 就是薄薄一层映射），而「开关后面什么都没给」时那一格读出来是 `undefined`
 * —— 正是要覆盖的形状。声明成 `string[]` 会把这条边界挪到每个调用方去绕。
 *
 * @param {unknown[]} argv
 * @param {"--skip" | "--dirty"} flag
 * @returns {{mode: "run" | "skip" | "dirty", reason: string | null}}
 */
export function parseLedgerFlag(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return { mode: "run", reason: null };
  }
  const mode = flag === "--skip" ? "skip" : "dirty";
  const raw = argv[index + 1];
  return { mode, reason: isUsableSkipReason(raw) ? String(raw).trim() : null };
}

/**
 * 记一条豁免 / 一条「不吃这一档」，并给出台面上那句话。
 *
 * 两者都能让「每天首次」那条判据放行，但**读起来不一样** —— 账面上因此看得出
 * 「今天跑过」「今天说好不跑」「这次改动不吃它」是三件不同的事。
 *
 * @param {{root: string, kind: string, mode: "skip" | "dirty", reason: string, platform?: string}} input
 * @returns {number} 退出码（写账失败按 2，与「理由不合用」同档：两件事都没留下可复核的账）
 */
export function writeLedgerNote({ root, kind, mode, reason, platform }) {
  const track = freshnessTrack(kind);
  try {
    const { note } = writeSkipRecord({
      root,
      kind,
      who: gitUser(platform ?? track.key),
      reason,
      /* `--dirty` 记的是**另一种**语义（「这次改动不吃这一档」），落账时用
       * `dirtyReason` 那一栏 —— 与「今天故意不跑」分开，否则账面上两者长得一样。 */
      field: mode === "dirty" ? "dirtyReason" : "skippedReason",
    });
    process.stdout.write(`[daily-run] ✓ 已记一条${mode === "dirty" ? "「不吃这一档」" : "豁免"}\n`);
    process.stdout.write(`[daily-run] ${note}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`[daily-run] ✗ ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
}
