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
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  FRESHNESS_TRACKS,
  PENDING_PLATFORMS,
  SUPPORTED_PLATFORMS,
  checkFreshnessLedger,
  freshnessAge,
  freshnessTrack,
  dirtiesTrack,
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
 * 两份账各自的判决口径 —— **从登记表派生，不是分支、也不是一张手抄的清单**。
 *
 * 这里有几件东西是**只有像素档才有**的：多个平台、`PENDING_PLATFORMS`、`SUPPORTED_PLATFORMS`。
 * 其余每档的唯一「平台」就是它自己的 `key`（`e2e` / `full` / `artifact`）。
 *
 * ⚠️ 这段**曾经是手抄的**（`{kind: "e2e", platforms: ["e2e"], pending: []}`），于是：
 *   · 「新增一档却忘了在这里加一行」⇒ 那一档**谁都不判**（判据的覆盖面与它自称的不符，
 *     正是本节立案现场 #1451 的那条病）—— 而新增档这件事本身不会有任何东西变红；
 *   · 「像素档的 key 改了名」（`FRESHNESS_TRACKS.visual.key` 在
 *     `scripts/.visual-baseline-freshness.json` 里被改成 `darwin`）⇒ 手抄的
 *     `SUPPORTED_PLATFORMS` 照旧要求 `linux` 那一档，于是**账里那条记录变成孤儿**、
 *     而真正要求的档显示「无记录」：两端都红，红的却不是真问题。
 * 现在两处都由 `FRESHNESS_TRACKS` 现算：新增一档自动被纳入判决面，`key` 也只有一个出处。
 *
 * 为什么不是「在 `main` 里 `if (kind === "visual")`」：那样「第三档」会变成三分支，
 * 而三处分支里若只有一处忘了减 pending，表现是**那一档永远被判红**（或永远被判绿），
 * 不会有任何东西告诉你哪一处漏了。
 *
 * @returns {Array<{kind: string, platforms: string[], pending: string[]}>}
 */
export function trackScopes() {
  return Object.keys(FRESHNESS_TRACKS).map((kind) => {
    const track = freshnessTrack(kind);
    /* 像素档是唯一「按平台分档、且有待补录状态」的那一档 —— 这两件事都是由那张表
     * （`PLATFORM_RECORDING` / `PENDING_PLATFORMS`）定义的，而不是由档名定义的。 */
    const byPlatform = kind === "visual";
    return {
      kind,
      platforms: byPlatform ? SUPPORTED_PLATFORMS : [track.key],
      pending: byPlatform ? Object.keys(PENDING_PLATFORMS) : [],
    };
  });
}

/**
 * 判决本体：给定新鲜度账，决定退出码与理由。
 *
 * 抽成纯入口是为了让**判决可被执行**（同 `visual-gate.mjs` 的 `runGate` 先例）：
 * 不接输入的话，「永远说没问题」这一层静默退化不会有任何东西红。
 *
 * @param {{ledger: Record<string, unknown>, kind?: string, platforms?: string[], pending?: string[], now?: Date, dirtySince?: Date | null}} input
 * @returns {{exitCode: number, problems: string[], ages: string[]}}
 */
export function runGate({
  ledger,
  kind = "visual",
  platforms,
  pending,
  now = new Date(),
  dirtySince = null,
}) {
  const track = freshnessTrack(kind);
  /* 缺省值与 `trackScopes()` **同源**（那里是判决面的唯一出处）：两个地方各自写一份
   * 「这一档有哪些平台」时，`main`（走 `trackScopes`）与直接调 `runGate` 的调用方
   * （走缺省值）会对同一档给出不同答案 —— 而默认值那一侧错了不会红（调用方几乎总是
   * 显式传，缺省那条路径只在用例里走）。`visual` 缺省是为了兼容既有调用方（它们
   * 一律省略 `kind`），其余档由 `platforms`/`pending` 的缺省从这一档自身派生。 */
  const scope = trackScopes().find((s) => s.kind === kind);
  const [requiredPlatforms, pendingPlatforms] = [
    platforms ?? scope?.platforms ?? [track.key],
    pending ?? scope?.pending ?? [],
  ];
  /* 两张表各管一件事：`PENDING_PLATFORMS` 管**数量**（那一档缺几张、只能在那档机器上补录），
   * 新鲜度管**时效**（那一档上次被实证跑绿是什么时候）。缺基线的档连一套完整的 PNG 都没有，
   * 「上次自证」对它是句不成立的话 —— 强行要求一条只会逼人填假读数。所以：
   *   · 新鲜度只要求**不在 pending 里的登记档**（`required`）；
   *   · 孤儿检查仍打在**全部登记档**上（账不许挂在任何非登记档上）。
   * `pending` 可注入（默认真表）：不接输入的话，「哪些档不需要记录」这层静默退化不会有
   * 任何东西红 —— 而它恰好是「有人把 win32 从 pending 摘掉」时第一个该有反应的地方。
   */
  const required = requiredPlatforms.filter((p) => !pendingPlatforms.includes(p));
  const problems = checkFreshnessLedger(ledger, {
    required,
    registered: requiredPlatforms,
    track,
    kind,
    now,
    dirtySince,
  });
  const ages = required.map(
    (p) => `${p}：${freshnessAge(ledger[p], now) ?? "无记录"}`,
  );
  for (const p of requiredPlatforms.filter((p) => pendingPlatforms.includes(p))) {
    ages.push(`${p}：待补录（PENDING_PLATFORMS）`);
  }
  return { exitCode: problems.length === 0 ? 0 : 1, problems, ages };
}

/**
 * 「今天动过这一档的输入面」的那个提交时刻（没有则 null）。
 *
 * 只有 `track.dirty` 非空的档读它，而它们对**谁该在什么时候跑**的答案与全量 e2e 不同：
 * 那两档的代价是十分钟量级，**没必要每天都跑** —— 真正要的是「改了就当天跑」。
 * 于是判据要能回答「今天这个工作区有没有提交动过 `src/`（或产物链那几个文件）」。
 *
 * 用**提交时间**而不是文件 mtime：mtime 会被 `git checkout` / `stash` / 拉取整体刷新
 * （`--cache-strategy metadata` 那件事的同源坑），于是「今天动过」会变成「今天 checkout 过」。
 *
 * ⚠️ 拿不到答案时返回 `null`（**不是**「今天没动过」）：`git` 不在 PATH 上、这不是一个
 * git 检出、或命令超时 —— 三者都让「改了就当天跑」这条判据**无话可说**，而把「问不出来」
 * 当成「没动过」正是 §9.2 第 3 条禁止的静默失败。退回按 `graceMs` 判（宽松但仍有时限），
 * 且这一档的账文件不在时另有宽限期兜底。
 *
 * @param {{dirty: string[]}} track
 * @param {Date} now
 * @returns {Date | null}
 */
export function dirtySinceToday(track, now = new Date()) {
  if (!track.dirty || track.dirty.length === 0) return null;
  /* 只看**当天**的提交：`--since` 给午夜，配合 `%cI` 的严格 ISO 时刻。本地日历日
   * 与 `isSameLocalDay` 同源 —— 两处用不同日界时会出现「账说今天动过、判据说没动」。 */
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  /* `--format=%cI` 与 `--name-only` 的实际形状是「时刻行 · **空行** · 文件行…」：
   * 空行分隔的是**时刻与它的文件清单**，不是两次提交（实测 `git log` 的输出字节：
   * `…T14:10:05+08:00\n\nsrc/a.ts\n…`）。所以「遇空行就收段」是错的 ——
   * 那样 `stamp` 会在文件行到达**之前**被清掉，于是**每一次**都判成「今天没动过这一档」，
   * 而话术里一个字都不会提（判据静默失效，正是本条要防的形态）。
   * 正确的状态机：新时刻出现时才把上一段收掉，空行一律忽略。 */
  const res = spawnSync(
    "git",
    ["log", "--since", midnight.toISOString(), "--format=%cI", "--name-only", "--"],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (res.error || res.status !== 0 || typeof res.stdout !== "string") return null;
  let earliest = null;
  let stamp = null;
  let hit = false;
  const flush = () => {
    if (hit && stamp) {
      const at = new Date(stamp);
      if (!Number.isNaN(at.getTime()) && (!earliest || at < earliest)) earliest = at;
    }
    hit = false;
  };
  for (const line of res.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
      flush();
      stamp = trimmed;
      continue;
    }
    if (dirtiesTrack(track, [trimmed.replace(/\\/g, "/")])) hit = true;
  }
  flush();
  return earliest;
}

function main() {
  const ledgerOnly = process.argv.includes("--ledger");
  const now = new Date();
  let failed = 0;
  for (const scope of trackScopes()) {
    const track = freshnessTrack(scope.kind);
    const ledger = readFreshnessLedger(scope.kind);
    const result = runGate({
      ledger,
      kind: scope.kind,
      platforms: scope.platforms,
      pending: scope.pending,
      now,
      dirtySince: dirtySinceToday(track, now),
    });
    const stamp = `上次自证 —— ${result.ages.join("；")}`;
    if (ledgerOnly) {
      process.stdout.write(`[freshness] ${track.label}：${stamp}\n`);
      continue;
    }
    /* 宽限期：账文件**还没入库**时只提醒、不阻断。这份账是随提交进来的（平台侧 squash
     * 合并不跑本地钩子，硬规则 6），所以「文件不在」是一个**本人做不到**的状态 ——
     * 无条件阻断会拦住从它分出的每一次提交。宽限期里那一步照样把「今天该跑一次」打在
     * 台面上：账面缺席与「这件事已经有人管」不该长得一样。
     * 这一条对**四档一视同仁**（`track.daily` 只是「这一档按日历日/改动面判」，
     * 与「账还没入库」是两件事 —— 此前把两者写在一起，于是新加的非 daily 档
     * 在账文件缺席时会直接走 `runGate` 报「没有记录」并阻断本人做不到的事）。 */
    if (!fs.existsSync(path.join(ROOT, track.ledger))) {
      process.stdout.write(
        `  [warn] ${track.label}：还没有账文件（${track.ledger}）—— 宽限期只提醒、不阻断。` +
          `跑一次 \`${track.run}\` 会留下第一条凭证。\n`,
      );
      continue;
    }
    if (result.exitCode !== 0) {
      failed = 1;
      /* 判决自己已经把「跑哪条命令 / 记哪条豁免」写进每一条问题里了（它要能独立
       * 被执行 —— `runGate` 的调用方直接读 `problems`）。这里只补它给不出的那一句
       * **落点**（账文件路径），不再把「记账」整段复述一遍 —— 复述的形态是同一段话
       * 在同一屏里出现两次，而第二次读起来像两件不同的事。 */
      process.stderr.write(
        `[freshness-gate] ✗ ${track.label} 的新鲜度账不完整：\n      · ` +
          result.problems.join("\n      · ") +
          `\n        账文件：${track.ledger}（手工补一条也可以，但要写全 who / how / verifiedAt）。\n` +
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
