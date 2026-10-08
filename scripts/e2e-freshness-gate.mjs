#!/usr/bin/env node
/**
 * e2e-freshness-gate.mjs — 「全量 e2e 今天跑过了吗」的提交门禁（规范 §11.8）
 *
 * 与 `visual-freshness-gate.mjs` **同族不同职**：那一档判的是「每一档像素基线都有主」
 * （有时效也有数量），这一档判的是**一天一次的自证** —— 今天的第一次提交，必须
 * 伴着一次全量 e2e 的绿（或一条写清理由的豁免）。
 *
 * 为什么这一档值得有一条判据：`pnpm test:e2e` 是 §13.5.4「按需召唤」那一层的成员，
 * 而「按需」这两个字在它身上一直是**一句没有执行者的话** —— 现场（#1282 收尾）是
 * 入库的 linux 档基线被别线的产品改动（`#1327` 改导航顺序）作废，**躺了两天**，
 * 唯一被发现的方式是「有人在 Issue 里点头让 NPC 手动跑一遍」。像素档那边
 * 早就有「每档都有主」的判据，全量 e2e 一条都没有。
 *
 * ## 判据的形状（与 `shell-gate.mjs` / `visual-gate.mjs` 同族：触发面窄、判决可执行）
 *
 *   · **每天只拦第一次提交**：当天已有凭证（跑绿或显式豁免）⇒ 零输出、放行。
 *     于是「一天一次」的代价不会落到同一天的其余每一次提交上。
 *   · 当天没有凭证 ⇒ **阻断**，并给出两条修法（跑一次 / 写明为什么跳过）。
 *   · 宽限期：没有账文件时**不阻断**（历史检出 / 浅克隆里那份账可能还没落地），
 *     只把「今天该跑了」打在输出里。基线为 0 的硬闸一旦无条件上线，会拦住从它
 *     分出的每一次提交 —— 那比漏报更费人（同 `PENDING_PLATFORMS` 那条判断）。
 *   · **不在这里跑 e2e**：它要起 webServer + 真浏览器，与钩子里的 A/B/C/D 抢资源
 *     （§13.5 的并行预算是实测敏感项），而且墙钟是十几分钟量级。钩子只做它做得到
 *     的那件事 —— **把「没人跑」变成「提交被拦下」**。
 *
 * 用法：`node scripts/e2e-freshness-gate.mjs`（由 `.githooks/pre-commit` 的 D 组调用）
 *      `node scripts/e2e-freshness-gate.mjs --ledger`  打印当前账（无判决，给人看）
 *      `node scripts/e2e-freshness-gate.mjs --dry-run` 只打印判决，不用退出码（调试用）
 */
import fs from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  E2E_COMMAND,
  E2E_LEDGER,
  judgeE2eFreshness,
  ledgerExists,
  readE2eLedger,
} from "./e2e-freshness-lib.mjs";

/**
 * 宽限期：账文件不在时**只提醒、不阻断**。
 *
 * 理由与 `visual-gate.mjs` 里那句「不阻断是刻意的」同源：账文件是**新落地**的，
 * 而平台侧 squash 合并不跑本地钩子（AGENTS 硬规则 6）—— 若在这里无条件阻断，
 * 「账还没进 master」的那段时间里，从它分出的每一个提交都会被拦下，而修法是
 * 「等那份文件被合并」这种本人做不到的事。判据的价值在**账在之后**才成立。
 *
 * @param {{ledger: Record<string, unknown>, now?: Date, hasLedger?: boolean}} input
 * @returns {{exitCode: number, problem: string | null, grace: boolean, age: string | null, skipped: string | null}}
 */
export function runGate({ ledger, now = new Date(), hasLedger = true }) {
  if (!hasLedger) {
    return {
      exitCode: 0,
      problem: null,
      grace: true,
      age: null,
      skipped: null,
    };
  }
  return { ...judgeE2eFreshness({ ledger, now }), grace: false };
}

function main() {
  const argv = process.argv.slice(2);
  const ledgerPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    path.basename(E2E_LEDGER),
  );
  const hasLedger = ledgerExists(ledgerPath);
  const ledger = readE2eLedger(ledgerPath);
  const result = runGate({ ledger, hasLedger });

  if (argv.includes("--ledger")) {
    process.stdout.write(
      `[e2e-freshness] ${E2E_LEDGER} —— ` +
        (result.age
          ? `上次自证：${result.age}${result.skipped ? `（本次跳过：${result.skipped}）` : ""}`
          : "无记录") +
        "\n",
    );
    return 0;
  }
  if (argv.includes("--dry-run")) {
    process.stdout.write(
      `[e2e-freshness] 判决：${result.exitCode === 0 ? "放行" : "阻断"}${
        result.grace ? "（宽限期：账文件不在）" : ""
      }\n${result.problem ? `        ${result.problem}\n` : ""}`,
    );
    return 0;
  }
  if (result.exitCode !== 0) {
    process.stderr.write(
      "[e2e-freshness-gate] ✗ 今天的第一次提交还没有全量 e2e 的凭证：\n" +
        `      · ${result.problem}\n` +
        "        规范：docs/standards/11-测试与可观测性.md §11.8\n",
    );
    return 1;
  }
  process.stdout.write(
    `  [ok] 全量 e2e 今天有凭证` +
      (result.grace
        ? "（宽限期：账文件还没落地，只提醒）"
        : `（上次自证：${result.age}）`) +
      "\n",
  );
  /* 宽限期这一档也把「今天该跑了」打在台面上：账面缺席时判据一个字都不说的话，
   * 「账还没落地」会与「这件事已经有人管」长得一模一样。 */
  if (result.grace) {
    process.stdout.write(
      `  [!!] ${E2E_LEDGER} 不在 — 全量 e2e 的每日自证暂不阻断（今天该跑一次：\`${E2E_COMMAND}\`）\n`,
    );
  }
  return 0;
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) ===
    fs.realpathSync(fileURLToPath(import.meta.url))
) {
  process.exit(main());
}
