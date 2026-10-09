#!/usr/bin/env node
/**
 * freshness-gate.mjs — 「每一档都有主」的提交门禁（规范 §11.8 / §13.5.4）
 *
 * 守**两份同形的账**（`FRESHNESS_TRACKS`）：像素基线（`scripts/.visual-baseline-freshness.json`，
 * 键 `linux`）与**全量 e2e**（`scripts/.e2e-freshness.json`，键 `e2e`，ISSUE #1547）。
 * 两份都由本脚本在 pre-commit 的 D 组判，命令名仍是 `visual-freshness-gate.mjs`
 * （改名要同批动钩子、§13.1 清单与引用它的文档，而这一步的语义没有变——
 * 它判的一直是「这一档上次被实证跑绿是什么时候」，只是现在有第二档要判）。
 * 补的是本轮实测翻出来的另一条：**「录过一次」与「一直绿」是两件事**，而 linux 档
 * 此前的状态是「录过就算数」—— 入库的 `-linux.png` 有 4 张与当次环境差 1 像素
 * （文字整体下移一行），而没有任何东西记着这一档上一次被跑绿是什么时候、下一次该由谁跑。
 * 前一档（win32 缺几张）的账有 `PENDING_PLATFORMS` 那条**有主的欠条**，这一档却一条都没有。
 *
 * 判据的形状（与 `visual-gate.mjs` / `shell-gate.mjs` 同族：触发面窄、判决可执行）：
 *   · 每一**登记**档都要有一条新鲜度记录（`scripts/.visual-baseline-freshness.json`），
 *     写清「谁 / 什么时候 / 按哪条命令复核的」—— 缺一条 = 这一档还停在「录过就算数」；
 *   · **例外**：`PENDING_PLATFORMS` 里那一档（缺几张、且只能在那档机器上补录）由那张
 *     表自己顶着，不要求新鲜度记录 —— 它现在连一套完整基线都没有，记「上次跑绿」是
 *     一句不存在的话。这两张表各管一件事（新鲜度管**时效**、pending 管**数量**）；
 *   · 记录**不许**挂在非登记档上（删了平台的档，账要同批抹掉）；
 *   · 每次提交顺带打印各档「上次自证距今多久」——账的价值在于被**看见**。
 *
 * ⚠️ **「多久没跑算旧」不进判据**（像素档）：像素回归的结论只在**录过基线的那台机器上**
 * 成立，而本仓库的自动化执行环境都是 linux —— win32 档的复核只能在 Windows 开发机上做。
 * 拿墙钟阻断等于让所有人卡在一个**只有少数人能解**的账上（§11.8 里 `PENDING_PLATFORMS`
 * 「只提醒、不阻断」已经判过这味药）。所以像素档的纪律只收在**可观测的形状**上：
 * 「有主、写清、不挂空档」是判据，「多久没跑算旧」是人看着读数定的。
 *
 * 唯一例外是 `track.daily` 那一档（全量 e2e）：它多一条「**今天**自证过没有」的判据
 * （ISSUE #1282）。它不是把像素档的取舍推翻 —— 那一档卡不住的原因是「只有少数人跑得动」，
 * 而全量 e2e 恰恰是**人人都跑得动的按需入口**（`pnpm test:e2e`），缺的只是「有人跑」。
 * 所以它按本地日历日判「今天的第一次提交带没带凭证」，并有两条配套出路：
 * `pnpm test:e2e` 跑绿即记，或 `node scripts/e2e-run.mjs --skip "<理由>"` 记一条
 * 写明理由的豁免（占位理由被拦 —— 豁免不是绕过）。账文件还没入库时**只提醒、不阻断**。
 *
 * **不在这里跑像素**：`pixel-run.mjs` 要起 webServer + 浏览器，与钩子里的 A/B/C/D 抢资源
 * （§13.5 的并行预算是实测敏感项）。钩子只做它做得到的那件事 —— **每一档都得有主**；
 * 记账仍走 `pnpm check:visual`（跑绿即记，见 `scripts/pixel-run.mjs`）。
 *
 * 用法：`node scripts/visual-freshness-gate.mjs`（由 `.githooks/pre-commit` 的 D 组调用）
 *      `node scripts/visual-freshness-gate.mjs --ledger` 打印当前账（无判决，给人看）
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  PENDING_PLATFORMS,
  SUPPORTED_PLATFORMS,
  checkFreshnessLedger,
  freshnessAge,
  freshnessTrack,
  readFreshnessLedgerAt,
} from "./visual-baselines.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/**
 * 读一份新鲜度账（不存在 / 读不出 → `{}`，由判决把它当成「一档都没记」）。
 *
 * 读写语义都在 `visual-baselines.mjs`（`readFreshnessLedgerAt` / `writeFreshness`）：
 * 两条账各写一份「读不出怎么办」时，一边会把坏 JSON 当成空账（判红，话术正确）、
 * 另一边会静默放行 —— 而后者不报错，只是少守一条。
 *
 * @param {string} kind `FRESHNESS_TRACKS` 的键
 * @param {string} [root]
 * @returns {Record<string, unknown>}
 */
export function readFreshnessLedger(kind = "visual", root = ROOT) {
  return readFreshnessLedgerAt(root, freshnessTrack(kind).ledger);
}

/**
 * 两份账各自的判决口径 —— **数据，不是分支**。
 *
 * `scopeOf` 是唯一与「这一档有哪些平台」有关的部分：像素档按平台分档，而「哪几档要
 * 有记录」还要减去 `PENDING_PLATFORMS`（那一档缺几张基线，记「上次跑绿」是句不成立的
 * 话）；全量 e2e 只有一档、也没有「待补录」这个状态，所以 `pending` 恒空。
 *
 * 这么写而不是在 `main` 里 `if (kind === "visual")`：那样「第三档」会变成三分支，
 * 而三处分支里若只有一处忘了减 pending，表现是**那一档永远被判红**（或永远被判绿），
 * 不会有任何东西告诉你哪一处漏了。
 *
 * @returns {Array<{kind: string, platforms: string[], pending: string[]}>}
 */
function trackScopes() {
  return [
    {
      kind: "visual",
      platforms: SUPPORTED_PLATFORMS,
      pending: Object.keys(PENDING_PLATFORMS),
    },
    { kind: "e2e", platforms: ["e2e"], pending: [] },
  ];
}

/**
 * 判决本体：给定新鲜度账，决定退出码与理由。
 *
 * 抽成纯入口是为了让**判决可被执行**（同 `visual-gate.mjs` 的 `runGate` 先例）：
 * 不接输入的话，「永远说没问题」这一层静默退化不会有任何东西红。
 *
 * @param {{ledger: Record<string, unknown>, kind?: string, platforms?: string[], pending?: string[], now?: Date}} input
 * @returns {{exitCode: number, problems: string[], ages: string[]}}
 */
export function runGate({
  ledger,
  kind = "visual",
  platforms = SUPPORTED_PLATFORMS,
  pending = Object.keys(PENDING_PLATFORMS),
  now = new Date(),
}) {
  const track = freshnessTrack(kind);
  /* 两张表各管一件事：`PENDING_PLATFORMS` 管**数量**（那一档缺几张、只能在那档机器上补录），
   * 新鲜度管**时效**（那一档上次被实证跑绿是什么时候）。缺基线的档连一套完整的 PNG 都没有，
   * 「上次自证」对它是句不成立的话 —— 强行要求一条只会逼人填假读数。所以：
   *   · 新鲜度只要求**不在 pending 里的登记档**（`required`）；
   *   · 孤儿检查仍打在**全部登记档**上（账不许挂在任何非登记档上）。
   * `pending` 可注入（默认真表）：不接输入的话，「哪些档不需要记录」这层静默退化不会有
   * 任何东西红 —— 而它恰好是「有人把 win32 从 pending 摘掉」时第一个该有反应的地方。
   */
  const required = platforms.filter((p) => !pending.includes(p));
  const problems = checkFreshnessLedger(ledger, {
    required,
    registered: platforms,
    track,
    kind,
    now,
  });
  const ages = required.map(
    (p) => `${p}：${freshnessAge(ledger[p], now) ?? "无记录"}`,
  );
  for (const p of platforms.filter((p) => pending.includes(p))) {
    ages.push(`${p}：待补录（PENDING_PLATFORMS）`);
  }
  return { exitCode: problems.length === 0 ? 0 : 1, problems, ages };
}

function main() {
  const ledgerOnly = process.argv.includes("--ledger");
  let failed = 0;
  for (const scope of trackScopes()) {
    const track = freshnessTrack(scope.kind);
    const ledger = readFreshnessLedger(scope.kind);
    const result = runGate({
      ledger,
      kind: scope.kind,
      platforms: scope.platforms,
      pending: scope.pending,
    });
    const stamp = `上次自证 —— ${result.ages.join("；")}`;
    if (ledgerOnly) {
      process.stdout.write(`[freshness] ${track.label}：${stamp}\n`);
      continue;
    }
    /* 宽限期：账文件**还没入库**时只提醒、不阻断。这份账是随提交进来的（平台侧 squash
     * 合并不跑本地钩子，硬规则 6），所以「文件不在」是一个**本人做不到**的状态 ——
     * 无条件阻断会拦住从它分出的每一次提交。宽限期里那一步照样把「今天该跑一次」打在
     * 台面上：账面缺席与「这件事已经有人管」不该长得一样。 */
    if (track.daily && !fs.existsSync(path.join(ROOT, track.ledger))) {
      process.stdout.write(
        `  [warn] ${track.label}：还没有账文件（${track.ledger}）—— 宽限期只提醒、不阻断。` +
          `跑一次 \`${track.run}\` 会留下第一条凭证。\n`,
      );
      continue;
    }
    if (result.exitCode !== 0) {
      failed = 1;
      process.stderr.write(
        `[freshness-gate] ✗ ${track.label} 的新鲜度账不完整：\n      · ` +
          result.problems.join("\n      · ") +
          `\n        记账：跑一次 \`${track.run}\`（跑绿即记），` +
          (track.skipHow ? `\n              或记一条写明理由的豁免：\`${track.skipHow}\`，` : "") +
          `\n              或在 ${track.ledger} 里手工补一条。\n` +
          "        规范：docs/standards/11-测试与可观测性.md §11.8\n",
      );
      continue;
    }
    process.stdout.write(`  [ok] ${track.label}：每档都有主（${stamp}）\n`);
  }
  return failed;
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) ===
    fs.realpathSync(fileURLToPath(import.meta.url))
) {
  process.exit(main());
}
