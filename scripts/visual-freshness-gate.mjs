#!/usr/bin/env node
/**
 * visual-freshness-gate.mjs — 「每一档像素基线都有主」的提交门禁（规范 §11.8）
 *
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
 * ⚠️ **刻意不做墙钟阻断**（阈值不在判据里）：像素回归的结论只在**录过基线的那台机器上**
 * 成立，而本仓库的自动化执行环境都是 linux —— win32 档的复核只能在 Windows 开发机上做。
 * 拿墙钟阻断等于让所有人卡在一个**只有少数人能解**的账上（§11.8 里 `PENDING_PLATFORMS`
 * 「只提醒、不阻断」已经判过这味药）。所以纪律收在**可观测的形状**上：「有主、写清、
 * 不挂空档」是判据，「多久没跑算旧」是人看着读数定的。
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
  FRESHNESS_LEDGER,
  PENDING_PLATFORMS,
  SUPPORTED_PLATFORMS,
  checkFreshnessLedger,
  freshnessAge,
} from "./visual-baselines.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/**
 * 读新鲜度账（不存在 / 读不出 → `{}`，由判决把它当成「一档都没记」）。
 *
 * @param {string} [root]
 * @returns {Record<string, unknown>}
 */
export function readFreshnessLedger(root = ROOT) {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(root, FRESHNESS_LEDGER), "utf8"),
    );
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

/**
 * 判决本体：给定新鲜度账，决定退出码与理由。
 *
 * 抽成纯入口是为了让**判决可被执行**（同 `visual-gate.mjs` 的 `runGate` 先例）：
 * 不接输入的话，「永远说没问题」这一层静默退化不会有任何东西红。
 *
 * @param {{ledger: Record<string, unknown>, platforms?: string[], pending?: string[], now?: Date}} input
 * @returns {{exitCode: number, problems: string[], ages: string[]}}
 */
export function runGate({
  ledger,
  platforms = SUPPORTED_PLATFORMS,
  pending = Object.keys(PENDING_PLATFORMS),
  now = new Date(),
}) {
  /* 两张表各管一件事：`PENDING_PLATFORMS` 管**数量**（那一档缺几张、只能在那档机器上补录），
   * 新鲜度管**时效**（那一档上次被实证跑绿是什么时候）。缺基线的档连一套完整的 PNG 都没有，
   * 「上次自证」对它是句不成立的话 —— 强行要求一条只会逼人填假读数。所以：
   *   · 新鲜度只要求**不在 pending 里的登记档**（`required`）；
   *   · 孤儿检查仍打在**全部登记档**上（账不许挂在任何非登记档上）。
   * `pending` 可注入（默认真表）：不接输入的话，「哪些档不需要记录」这层静默退化不会有
   * 任何东西红 —— 而它恰好是「有人把 win32 从 pending 摘掉」时第一个该有反应的地方。
   */
  const required = platforms.filter((p) => !pending.includes(p));
  const problems = checkFreshnessLedger(ledger, { required, registered: platforms });
  const ages = required.map(
    (p) => `${p}：${freshnessAge(ledger[p], now) ?? "无记录"}`,
  );
  for (const p of platforms.filter((p) => pending.includes(p))) {
    ages.push(`${p}：待补录（PENDING_PLATFORMS）`);
  }
  return { exitCode: problems.length === 0 ? 0 : 1, problems, ages };
}

function main() {
  const ledger = readFreshnessLedger();
  const result = runGate({ ledger, platforms: SUPPORTED_PLATFORMS });
  const stamp = `上次自证 —— ${result.ages.join("；")}`;
  if (process.argv.includes("--ledger")) {
    process.stdout.write(`[visual-freshness] ${stamp}\n`);
    return 0;
  }
  if (result.exitCode !== 0) {
    process.stderr.write(
      "[visual-freshness-gate] ✗ 像素基线的新鲜度账不完整：\n      · " +
        result.problems.join("\n      · ") +
        "\n        记账：在那一档跑一次 `pnpm check:visual`（跑绿即记，见 scripts/pixel-run.mjs），" +
        `\n              或在 ${FRESHNESS_LEDGER} 里手工补一条。\n` +
        "        规范：docs/standards/11-测试与可观测性.md §11.8\n",
    );
    return 1;
  }
  process.stdout.write(`  [ok] 像素基线新鲜度：每档都有主（${stamp}）\n`);
  return 0;
}

if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) ===
    fs.realpathSync(fileURLToPath(import.meta.url))
) {
  process.exit(main());
}
