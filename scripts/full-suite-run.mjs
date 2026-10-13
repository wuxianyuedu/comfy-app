#!/usr/bin/env node
/**
 * full-suite-run.mjs — 全量单测 + 覆盖率门槛那一档的**记账通道**（规范 §13.5.4 / §13.5.12）。
 *
 * 为什么它需要一条账（而不是继续靠一句「记得按需跑」）：`pnpm run test:coverage` 是
 * 平台流水线删掉（ISSUE #623）之后**唯一没有自动执行者**的判定档之一 —— 覆盖率门槛
 * （`vitest.config.ts` 的 `coverage.thresholds`）写了几十条按实测定的数，而它们只在
 * 这一档里判。此前它的执行者是文档里那句「按需手动跑」（§13.5.3 的欠账表），
 * 而那句话**没有任何东西在守**：真正会踩的形态是「改了 `src/lib/**` 的覆盖率相关分支、
 * 门槛悄悄跌破了」—— 提交门槛（C 组）只跑固定清单 + 受影响用例，**不跑覆盖率**。
 *
 * 它判什么、以及为什么不是「每天一次仪式」：
 *   · 这一档吃 `src/` 与 `tests/`（`FRESHNESS_TRACKS.full.dirty`）。**改了就当天跑**
 *     是它真正的语义 —— 没碰这两个目录的一天跑一遍全量，换来的是十分钟墙钟与一个
 *     不会变的结论，而那正是「按需召唤」当初被发明出来要避免的东西。
 *   · 所以判据分两层（`checkFreshnessLedger` 的 `track.dirty` 那一档）：
 *     当天动过输入面 ⇒ **今天必须自证**；没动过 ⇒ 以 `graceMs`（7 天）为宽限。
 *     两层都有出路：跑一次，或 `--dirty "<理由>"` 声明「这次改动确实不吃这一档」。
 *
 * 记账语义与另外三档**逐字同一份实现**（`writeFreshness` / `writeSkipRecord`，
 * `scripts/freshness-ledger.mjs`）：只有绿了才记、红着不记（跑过 ≠ 跑绿过）。
 * `--skip` / `--dirty` 的解析与落账走 `scripts/daily-run.mjs`（四档共用，§12.12）。
 *
 * 用法：
 *   node scripts/full-suite-run.mjs --dry-run       只打印本次会跑什么（无副作用）
 *   node scripts/full-suite-run.mjs                 跑全量单测 + 覆盖率，绿了记一笔账
 *   node scripts/full-suite-run.mjs --skip "<理由>"  今天不跑，记一条写明理由的豁免
 *   node scripts/full-suite-run.mjs --dirty "<理由>" 这次改动不吃这一档，记一条
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseLedgerFlag, writeLedgerNote } from "./daily-run.mjs";
import {
  abortedAdvice,
  classifyOutcome,
  runPnpmSync,
} from "./launcher-core/shell.mjs";
import {
  freshnessTrack,
  gitUser,
  writeFreshness,
} from "./freshness-ledger.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** 本档的登记（账文件 / 键 / 名字 / 「怎么跑」那条命令）。 */
export const TRACK = freshnessTrack("full");

/**
 * 本次要跑的那条命令 —— 抽成纯函数是为了让「跑的是什么」可被判据核。
 *
 * 与 `pnpm run test:coverage` 逐字同形（`package.json` 里那一行是这条命令的历史入口）：
 * 覆盖率门槛**只在这一档判**，单文件跑 `--coverage` 会把其余路径按 0% 算（§11.7）。
 *
 * @param {string[]} [extra] 透传的额外参数
 * @returns {{label: string, args: string[]}}
 */
export function planRun(extra = []) {
  return {
    label: "全量单测 + 覆盖率棘轮（vitest run --coverage）",
    args: ["run", "test:coverage", ...extra],
  };
}

/**
 * 这一跑该不该记账 —— 抽成纯入口，好让「红了不记」这条边界能被真跑一次。
 *
 * @param {{exitCode: number, dryRun: boolean}} input
 * @returns {boolean}
 */
export function shouldRecord({ exitCode, dryRun }) {
  return exitCode === 0 && !dryRun;
}

/**
 * 本档的**墙钟预算** —— `runPnpmSync` 的 `timeoutMs`。
 *
 * 为什么必须显式给（ISSUE #1834）：缺省是 600_000（`launcher-core/shell.mjs` 的
 * `runPnpmSync`），而本档在 win32 检出上无争抢时实测就要 ~10 分钟（
 * `Test Files 3 failed | 695 passed`），只要有任何并发（叠一次运行、机器被别人占着）
 * 就正好撞在那个默认值上 —— 子进程在 600s 处被砍，`res.status` 为 null。
 *
 * 而 600_000 那个数是**别的调用方**的合理默认（单条 `pnpm exec …` 门禁），不该由它
 * 替本档背书：本档跑的是 698 份用例文件 + 覆盖率。
 *
 * 取 1800_000（30 分钟）而不是「实测值 + 一点余量」：它要挡的是**真挂死**，
 * 不是「机器慢」；20 分钟余量足够让一次并发的全量跑完（实测 10 分钟量级），
 * 又远小于「挂死」该被检出的时间（钩子那侧的时间型判据见 §13.6.4，那一条不在这里）。
 */
export const FULL_SUITE_TIMEOUT_MS = 30 * 60_000;

/* 「被预算砍 vs 判据红」的分流在 `launcher-core/shell.mjs` 的 `classifyOutcome()` /
 * `abortedAdvice()` —— **那件事只有一份实现**（§12.12）：本档、`artifact-run` 与
 * 未来的档都读它，各写一份就会在「谁把 `status ?? 1` 又写回去」上分叉。 */

/**
 * @param {string[]} argv
 * @returns {number}
 */
function main(argv) {
  const dryRun = argv.includes("--dry-run");
  /* 两条「不跑」的出路互斥地先处理：给了它们就不该再去起 vitest。 */
  for (const flag of /** @type {const} */ (["--skip", "--dirty"])) {
    const parsed = parseLedgerFlag(argv, flag);
    if (parsed.mode === "run") continue;
    if (parsed.reason === null) {
      process.stderr.write(
        `[full-suite-run] ✗ 理由（"${String(argv[argv.indexOf(flag) + 1] ?? "").trim()}"）` +
          "不算「有人回答过」—— 写清为什么（占位词与过短的理由都被拦）。\n" +
          `        用法：node scripts/full-suite-run.mjs ${flag} "本次只改文档，不动 src/"\n`,
      );
      return 2;
    }
    if (dryRun) {
      process.stdout.write(
        `[full-suite-run] 本次不跑、只记一条（${parsed.mode}）：${parsed.reason}\n`,
      );
      return 0;
    }
    return writeLedgerNote({
      root: ROOT,
      kind: "full",
      mode: parsed.mode,
      reason: parsed.reason,
    });
  }
  const extra = argv.filter((a) => a !== "--dry-run");
  const run = planRun(extra);
  if (dryRun) {
    process.stdout.write(
      `[full-suite-run] ${run.label} → pnpm ${run.args.join(" ")}\n`,
    );
    process.stdout.write(
      `[full-suite-run] 记账文件：${TRACK.ledger}（键 \`${TRACK.key}\`，跑法 \`${TRACK.run}\`）\n`,
    );
    return 0;
  }
  const res = runPnpmSync(run.args, {
    cwd: ROOT,
    stdio: "inherit",
    timeoutMs: FULL_SUITE_TIMEOUT_MS,
  });
  /* 三态分流：**「被预算砍」与「判据红」必须长得不一样**（`classifyOutcome`）。
   * 旧写法 `res.status ?? 1` 把两者都读成 1，于是「这次没测成」会被当成
   * 「这批用例红了」，下一个人去查用例、查一整天。 */
  if (classifyOutcome(res) === "aborted") {
    process.stderr.write(
      "[full-suite-run] ✗ " +
        abortedAdvice({
          label: "全量单测 + 覆盖率",
          timeoutMs: FULL_SUITE_TIMEOUT_MS,
        }) +
        `        （读数：退出码 ${res.status ?? "信号"}，` +
        `error=${res.error ? String(res.error.code ?? res.error.message) : "无"}）\n` +
        "        规范：docs/standards/13-提交与-code-review.md §13.5.4\n",
    );
    return 1;
  }
  const exitCode = res.status ?? 1;
  if (!shouldRecord({ exitCode, dryRun })) {
    process.stderr.write(
      `[full-suite-run] ✗ 全量单测 / 覆盖率未通过（退出码 ${res.status ?? "信号"}）—— **不记账**：\n` +
        "        这条账记的是「上一次真跑绿」，红着记一条「我跑过」会把两件事混成一件。\n" +
        "        红的定性先按 §11.13 隔离重跑那条走，别把红当成「账没记上」。\n" +
        `        规范：docs/standards/13-提交与-code-review.md §13.5.4 / §11.7\n`,
    );
    return exitCode;
  }
  const { note } = writeFreshness({
    root: ROOT,
    kind: "full",
    who: gitUser(TRACK.key),
  });
  process.stdout.write(
    `[full-suite-run] ✓ 全量单测 + 覆盖率通过\n[full-suite-run] ${note}\n`,
  );
  return 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exit(main(process.argv.slice(2)));
}
