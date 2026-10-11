#!/usr/bin/env node
/**
 * check-pending-merge-loss.mjs — 「双亲在、内容丢了一侧」的**提交前档**
 * （规范 §11.23.6 / §13.6.1 / ISSUE #1618，与 1-1 共用内核）。
 *
 * ── 立案现场：形态全对的合并照样丢东西 ────────────────────────────────
 *
 * `check-merge-parents.mjs`（#1594）判的是**形态**：消息声明是合并时，本次提交
 * 必须真有两个父。它堵的是「合并落成单亲」那一种事故。而实测丢东西的那两次
 * （`ad81a912` / `bdabd26f`）**形态全对** —— 双亲在、消息也像样，只是某个文件
 * **整份取了非 HEAD 那一侧**，把 HEAD 侧已合入的成果一笔退回。
 *
 * 这一档就是补那一格，且落在**提交前**：合并还在进行中（`MERGE_HEAD` 在场、
 * 结果在索引里），当场判「结果里这一版是不是整份取了非 HEAD 侧某一版」。
 *
 * ── 判什么（三条合起来才算命中，缺一条都会误报）──────────────────────
 *
 * 对 `HEAD` 与索引之间有差异的每个路径：
 *
 *   ① 结果版（索引里那一版）**不等于** `HEAD` 侧那一版 —— 否则是正常前移；
 *   ② 结果版**等于** `MERGE_HEAD` 侧历史上（对那个文件）出现过的某一版；
 *   ③ `HEAD` 侧在该文件上**确有还没被取代的改动**（`HEAD` 那一版与「HEAD 与
 *      MERGE_HEAD 的 merge-base 那一版」不同）—— 这一条把「三方里大家都一样的
 *      文件」排除掉，只留下「你这一侧确实动过它」的。
 *
 * 三条合起来才是「你动了它、对方也有一版、结果取了对方那版」= 整份取一侧。
 *
 * ── 边界（都取保守放行，与 §13.6.1 同口径）──────────────────────────
 *
 *   · `source=commit`（`--amend` / cherry-pick / revert / `-c` / `-C`）→ 放行：
 *     这些形态的父提交不从 MERGE_HEAD 来，「两侧」无从谈起；
 *   · 非合并提交（`MERGE_HEAD` 不在）→ **零输出、零耗时**（第一行就返回）；
 *   · 浅克隆 / 取不到 merge-base / 取不到 MERGE_HEAD 历史 → 放行并说明，
 *     不误报（判据无从命中时不该拦人）；
 *   · 生成物（`docs/api/**`、`docs/generated/**`）→ 不判（退回即常态，同 1-1）。
 *
 * ── 它跑在哪 ──────────────────────────────────────────────────────────
 *
 * `.githooks/prepare-commit-msg`（与 `check-merge-parents.mjs` **同一个入口**，
 * 一前一后两条判据）。为什么是 `prepare-commit-msg` 而不是 `pre-commit`：
 * `pre-commit` 时 `COMMIT_EDITMSG` 仍停在上一条信息上、也看不到 `$2`（source），
 * 而这一档要靠 source 干净地排除 amend —— 同 `check-merge-parents.mjs` 的理由。
 *
 * 用法：
 *   node scripts/check-pending-merge-loss.mjs [source]   # 由 .githooks/prepare-commit-msg 调用
 *   node scripts/check-pending-merge-loss.mjs --status   # 只体检，不阻断
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { findEarlierVersion, isGenerated } from "./merged-side-loss-core.mjs";
import { historyByFile, resolveBlobs } from "./merged-side-loss-git.mjs";

/** 在仓库内跑一条 git 命令；失败回 `null`（取不到 ≠ 空值，据此保守放行）。 */
function git(args, input) {
  try {
    return execFileSync("git", ["-c", "core.quotepath=false", ...args], {
      encoding: "utf8",
      stdio: input === undefined ? ["ignore", "pipe", "ignore"] : ["pipe", "pipe", "ignore"],
      input,
      maxBuffer: 1 << 28,
    }).trim();
  } catch {
    return null;
  }
}

/** 是不是 git 检出。 */
function inGitRepo() {
  return git(["rev-parse", "--git-dir"]) !== null;
}

/** 合并进行中要合进来的那些父（`MERGE_HEAD` 的每一行）；不在合并中给 `[]`。 */
export function mergeHeads() {
  const rev = git(["rev-parse", "MERGE_HEAD"]);
  if (rev === null) return [];
  return rev.split(/\s+/).filter(Boolean);
}

/**
 * 扫一次「待提交的合并」：返回疑似整份取一侧的文件清单。
 *
 * 判定与文件头「判什么」三条逐字对应，检测核心取自共用内核
 * （`merged-side-loss-core.mjs` 的 `findEarlierVersion`）。
 *
 * @param {{source?: string}} [input] `prepare-commit-msg` 的 `$2`。
 * @returns {{ok: true, lost: string[]} | {ok: false, reason: string}}
 */
export function scanPendingMerge({ source = "" } = {}) {
  // ① amend / cherry-pick / revert：父提交不从 MERGE_HEAD 来，不判。
  if (source === "commit") {
    return { ok: false, reason: `source=${source}（父提交不从 MERGE_HEAD 来，不判）` };
  }
  if (!inGitRepo()) return { ok: false, reason: "不在 git 检出里" };

  const heads = mergeHeads();
  if (heads.length === 0) return { ok: false, reason: "不是合并提交（MERGE_HEAD 不在）" };

  // ② 三条事实的公共前提：merge-base 必须取得到（浅克隆里取不到 → 保守放行）。
  const head = git(["rev-parse", "HEAD"]);
  const base = git(["merge-base", "HEAD", "MERGE_HEAD"]);
  if (!head || !base) return { ok: false, reason: "取不到 merge-base（浅克隆？）" };

  /* HEAD 与索引之间改动的路径 —— 合并结果相对本侧动了哪些文件。
   * 用 `--name-only -z` 一次取完。 */
  const changed = (git(["diff", "--name-only", "-z", "HEAD"]) || "")
    .split("\0")
    .filter(Boolean);
  const files = changed.filter((f) => !isGenerated(f));
  if (files.length === 0) return { ok: true, lost: [] };

  /* 取证批量做（两个执行者共用 `merged-side-loss-git.mjs`，理由与实测表都在那一份的
   * 模块头）：候选历史对每个合并父各一次遍历，blob 一次批量解析。
   * 这里不能「先逐文件判①③、只对留下的那些再取历史」—— 那正是把 spawn 数还回来的写法。
   * 任一次没跑起来就整单放行并说明：这一档的边界口径本来就是保守放行（文件头「边界」一节），
   * 但**不许**把「没取证」说成「没命中」。 */
  const perHead = [];
  for (const mh of heads) {
    const hist = historyByFile(git, { ref: mh, files });
    if (!hist) return { ok: false, reason: `批量取 ${mh} 的候选历史没跑起来（浅克隆？）` };
    perHead.push(hist);
  }

  /* 候选序与旧实现逐字同：先第一个合并父那条线、再第二个，并排除 HEAD 自己那一版。 */
  const candidates = new Map();
  const specs = [];
  for (const f of files) {
    specs.push(`:${f}`, `HEAD:${f}`, `${base}:${f}`);
    const older = [];
    for (const hist of perHead) {
      for (const s of hist.get(f)) if (s !== head) older.push(s);
    }
    candidates.set(f, older);
    for (const s of older) specs.push(`${s}:${f}`);
  }
  const blob = resolveBlobs(git, specs);
  if (!blob) return { ok: false, reason: "批量解析 blob 没跑起来（`cat-file --batch-check`）" };

  const lost = [];
  for (const f of files) {
    // ① 结果版（索引）≠ HEAD 版，否则是正常前移。
    const result = blob.get(`:${f}`);
    const atHead = blob.get(`HEAD:${f}`);
    if (!result || !atHead || result === atHead) continue;

    /* ③ HEAD 侧确有「还没被取代的改动」：HEAD 那一版与 merge-base 那一版不同。
     * 两边都动过、或只有 HEAD 动过的都在这里留下；「三方一致」的被排除。 */
    const atBase = blob.get(`${base}:${f}`);
    if (atBase && atHead === atBase) continue;

    /* ② 结果版 == MERGE_HEAD 侧历史上出现过的某一版 —— 整份取了非 HEAD 侧。
     * 判定核心取自共用内核；`blobAt` 查已取回的表，不再起进程。 */
    const hit = findEarlierVersion({
      result,
      historyShas: candidates.get(f),
      blobAt: (older) => blob.get(`${older}:${f}`) ?? null,
    });
    if (hit) lost.push(f);
  }
  return { ok: true, lost };
}

/** 阻断时打印人类可读的出口（怎么改），不只报错。 */
function printBlockedTip(lost) {
  console.error("");
  console.error(
    "[pending-merge-loss] 阻断:本次合并把某些文件整份取了非 HEAD 侧(规范 §11.23.6)。",
  );
  console.error(`[pending-merge-loss] 疑似整份取一侧 ${lost.length} 份:`);
  lost.forEach((f) => console.error(`  · ${f}`));
  console.error("");
  console.error(
    "[pending-merge-loss] 后果:HEAD 侧在这些文件上已合入的改动被一笔退回,而拓扑与",
  );
  console.error(
    "[pending-merge-loss]   提交信息看起来完全正常(双亲在、消息也像样)——这正是立案现场。",
  );
  console.error("[pending-merge-loss] 出口(逐份核对,别整份 checkout):");
  console.error(
    "[pending-merge-loss]   git checkout HEAD -- <文件>            # 取回本侧那一版",
  );
  console.error(
    "[pending-merge-loss]   git checkout --merge <文件>           # 或重跑一次三向合并,人工解冲突",
  );
  console.error(
    "[pending-merge-loss] 若这确实是「对方那一版就该覆盖本侧」(例如本侧那笔已被对方重做):",
  );
  console.error(
    "[pending-merge-loss]   逐份确认后按原样提交,并在提交信息里写清为什么取对方那一版。",
  );
}

function main() {
  const argv = process.argv.slice(2);
  const statusOnly = argv.includes("--status");
  /* source 是位置参数（git 的 `$2`）；`--status` 这类选项不参与。 */
  const source = argv.find((a) => !a.startsWith("--")) || "";

  const result = scanPendingMerge({ source });

  if (statusOnly) {
    console.log(
      `[pending-merge-loss] source=${source || "(非 git 提供)"} → ${
        result.ok ? `${result.lost.length} 份疑似` : result.reason
      }`,
    );
    return;
  }

  /* 「不是合并提交」是**正常且高频**的形态（普通提交每次都会走到这里）——
   * 按 #1618 验收标准 3，这一档必须**零输出、零耗时**，所以这里静默返回 0。 */
  if (!result.ok) {
    if (result.reason.startsWith("不是合并提交")) return;
    console.log(`[pending-merge-loss] 放行（${result.reason}）`);
    return;
  }

  if (result.lost.length === 0) {
    console.log("[pending-merge-loss] OK（本次合并无整份取一侧）");
    return;
  }

  printBlockedTip(result.lost);
  process.exit(1);
}

// 只在被直接运行时执行 CLI（被 import 时不跑）。
//
// ⚠️ 判「是不是直接运行」用**路径解析后比较**，不是拼 `file://${argv[1]}`：后者在
// Windows 上恒不相等 ⇒ `main()` 一次都不跑而退出码恒 0（判据在场、却什么都不做）。
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main();
}
