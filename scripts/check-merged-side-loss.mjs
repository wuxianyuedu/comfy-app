#!/usr/bin/env node
/**
 * check-merged-side-loss.mjs — 「合并取错一侧 / 整份退回」的事后复算执行者
 * （规范 §11.23.5 / §13.6.1 / ISSUE #1617，承接 #1605 §3 的窄形态）。
 *
 * ── 立案现场 ──────────────────────────────────────────────────────────
 *
 * 同一仓库里连着发生三次「合并取错一侧、把 master 已合入的改动整体退回去」：
 *
 *   · `ad81a912`（PR #1580 的 squash）—— 62 份文件被退，其中判据本体
 *     （`scripts/check-ps1-consistency.mjs` 的 −239 行三向判据整段）被退之后
 *     **它仍然报 OK**（少了半张靶子，读数照样是绿的）；
 *   · `bdabd26f`（PR #1581 的 squash）—— 对着 41 份文件**整份取了分支侧**，
 *     把 `ad81a912` 和它之前的几批又退一遍；
 *   · `b9bedd37`（PR #1597）—— 同一形态。
 *
 * 已有的两条判据都**盖不住它**：`check-commit-claims.mjs`（#1605）只核提交信息里
 * 「§x.y 照旧保留」那一格；`check-merge-parents.mjs`（#1594）只核「合并提交是不是双亲」。
 * 真正丢东西的那两次，**拓扑形态全对**（双亲在、消息也像样）—— 只是某个文件整份取
 * 了非祖先分支那一侧。**没有任何判据会问「你丢掉的那一侧里有没有还没被取代的成果」。**
 *
 * ── 判据形状（来自 #1604 实测有效的那一版）───────────────────────────
 *
 * 「**结果提交里某文件的内容，等于基线之前某次提交里的同一文件；而基线之后该文件
 * 在主干线上被改过**」—— 即它**退回成了基线之前的版本**。
 *
 * 三条口径都是实测定的，不是设计出来的：
 *
 * 1. **必须给基线**（`--baseline <sha>`）。「非祖先分支上的某一版」在 squash 之后
 *    常常**已经不可达**（实测：`998d33d6` 这个真实合并对象已 GC，`git cat-file` 报
 *    `Not a valid object name`）—— 所以判据不能自己「算」出那一侧是谁，只能由人给一个
 *    **已知好的参照点**（#1604 用的是 `bfeb33f0`）。这不是缺陷，是这条判据的输入。
 * 2. **基线必须是待查提交的祖先**。实测反例：`0c38dce0` vs `af589681` 落在**两条分叉线**
 *    上（后者不是前者祖先），逐文件比下来会有 3 份「疑似退回」，全是**正当的并线差异**。
 *    加了「祖先」这道闸之后该反例归零。
 * 3. **生成物排除**（`docs/api/**`、`docs/generated/**`）：它们由 `pnpm docs` /
 *    `doc:render` 生成，「退回成旧版」是常态而非事故（实测同一份扫描里 109 份命中里
 *    有 23 份是产物）。留着它们会把真信号淹掉。
 *
 * 取证怎么取（逐文件遍历 → 两次批量读）与为什么必须批量，记在 `merged-side-loss-git.mjs`
 * 的模块头；那一份还写清了「候选历史改用一次 `--name-only` 遍历」与逐文件读法的**唯一**
 * 差别：单路径遍历会在合并处剪枝、漏掉只存在于被并进来那条线上的版本（= 旧读法会漏报）。
 *
 * ── 它判什么 ──────────────────────────────────────────────────────────
 *
 * 对基线到结果提交之间改动的每一个文件，判断结果版是否「等于基线的某个祖先版本」：
 *
 *   · 命中 ⇒ 该文件**疑似整份退回**（需要人工看，**不等于**「确定丢了」——blob 相等性
 *     有巧合：空文件、逐字相同的正当改动）；
 *   · 未命中 ⇒ 无事。
 *
 * 退出码三态，与 `base-check.mjs` / `check-commit-claims.mjs` 同口径：
 *
 *   · `0` = 没有命中（或 `--report` 盘点档）；
 *   · `1` = 有疑似退回（这是本脚本要**报告**的事实，不是「它坏了」）；
 *   · `2` = **复算过程本身没跑起来**（不在 git 检出 / 基线取不到 / 基线不是祖先 /
 *     历史不全）—— 与「跑了且红」必须分开，否则前者会被读成后者。
 *
 * ── 它跑在哪（为什么不进钩子）─────────────────────────────────────────
 *
 * **不进 `pre-commit`**：本地钩子天然看不到平台侧 squash（§11.23.5 的「不做什么」），
 * 硬塞进钩子只会让人学会绕开它。它按 §13.5.4 的**按需召唤**那一层跑 —— 事后盘点某次
 * 合并、复核一条 PR 时，人点一次；或在平台侧合并前唤起一轮评审（§13.6.2）。
 *
 * ── 刻意不做（都写进 §11.23.5 了）─────────────────────────────────────
 *
 *   · 不核提交信息全文（自然语言理解，误报一片）；
 *   · 不判「取了几侧」（有些冲突的正确答案就是取一侧 —— 要判的是「丢的那一侧里有没有
 *     还没被取代的成果」）；
 *   · 不自己「推算」出被丢的那一侧是谁（squash 之后那条线常常不可达）；
 *   · 不新写启发式扫描器塞进 pre-commit（本仓库最怕的就是「判据在场、却什么都不做」）。
 *
 * 用法：
 *   node scripts/check-merged-side-loss.mjs <sha> --baseline <good-sha>   # 盘点一次提交
 *   node scripts/check-merged-side-loss.mjs <sha> --baseline <good-sha> --report
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { findEarlierVersion, isGenerated } from "./merged-side-loss-core.mjs";
import { historyByFile, resolveBlobs } from "./merged-side-loss-git.mjs";

/** 一条 git 命令；失败回 `null`（取不到 ≠ 空值，调用方据此判 `2`）。
 * @param {string[]} args
 * @param {string} [input] 给标准输入喂内容时传（`git cat-file --batch` 那一路）
 * @returns {string | null} */
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
export function inGitRepo() {
  return git(["rev-parse", "--git-dir"]) !== null;
}

/**
 * 基线是不是待查提交的祖先 —— 见文件头口径 2。
 *
 * 分叉线上的两次提交逐文件比下来会有一片「疑似退回」，而它们全是**正当的并线差异**
 * （实测反例 `0c38dce0` vs `af589681`）。所以这不是「可选的严格性」，是判据正确性的前提。
 * @param {string} ancestor @param {string} descendant @returns {boolean} */
export function isAncestor(ancestor, descendant) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 扫一次：返回「疑似整份退回」的文件清单。
 *
 * 对 `baseline..sha` 之间改动的每个文件，判它 `sha` 那一版是否 == 基线的某个**祖先**
 * 版本（即退回了）。判据与本文件头「判据形状」一节逐字对应。
 *
 * @param {{sha: string, baseline: string}} target 待查的那一笔与它对照的基线那一笔
 * @returns {{ok: true, lost: string[]} | {ok: false, reason: string}} 取不到事实时给 `ok:false`
 */
export function scan({ sha, baseline }) {
  if (!inGitRepo()) {
    return { ok: false, reason: "不在 git 检出里" };
  }

  /** 成对遍历写成元组数组，不写裸字面量：后者被推成 `string[][]`，解构出的
   *  `ref` / `label` 各带 `| undefined`（与批 9 / 批 10 同一形，第三次撞上）。 */
  /** @type {Array<[string, string]>} */
  const refs = [
    [sha, "待查提交"],
    [baseline, "基线提交"],
  ];
  for (const [ref, label] of refs) {
    if (git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) === null) {
      return { ok: false, reason: `${label}取不到：${ref}` };
    }
  }

  if (!isAncestor(baseline, sha)) {
    return {
      ok: false,
      reason: `基线 ${baseline} 不是 ${sha} 的祖先（分叉线上比较会产生一片正当差异）`,
    };
  }

  const changed = (git(["diff", "--name-only", "-z", `${baseline}..${sha}`]) ?? "")
    .split("\0")
    .filter(Boolean);
  /* 生成物先摘掉（口径 3），剩下的才是这一轮要取证的面。 */
  const files = changed.filter((f) => !isGenerated(f));
  if (files.length === 0) {
    return { ok: true, lost: [] };
  }

  /* 取证只要两次遍历：候选历史一次、全部 blob 一次（逐文件 / 逐条历史各起一个 git
   * 进程的话，成本是「变更文件数 ×（1 + 该文件历史条目数）」，实测约 2–3s/文件，
   * 一次大 diff 能把这条判据拖到几分钟 —— 见 `merged-side-loss-git.mjs` 的实测表）。
   * 任一次没跑起来就整体退 2：不许拿半份事实给出「没命中」这种绿。 */
  const hist = historyByFile(git, { ref: baseline, files });
  if (!hist) {
    return { ok: false, reason: "批量取候选历史没跑起来" };
  }

  /* 候选集里不含基线那一版自己（与逐文件读法同口径：判的是「退回成**更早**的某一版」，
   * 而「等于基线版」在上面已按正常前移放过）。 */
  /** @type {Map<string, string[]>} */
  const candidates = new Map();
  /** @type {string[]} */
  const specs = [];
  for (const f of files) {
    specs.push(`${sha}:${f}`, `${baseline}:${f}`);
    /* `historyByFile` 建表时就按 `files` 逐份预置了空数组，所以这个键必在；
     * `?? []` 是写给类型看的（`Map.get` 在 `noUncheckedIndexedAccess` 下是 `| undefined`），
     * 与批 7 那处「取一次 + 兜底并说明键必在」同一形。 */
    const older = (hist.get(f) ?? []).filter((s) => s !== baseline);
    candidates.set(f, older);
    for (const h of older) {
      specs.push(`${h}:${f}`);
    }
  }
  const blob = resolveBlobs(git, specs);
  if (!blob) {
    return { ok: false, reason: "批量解析 blob 没跑起来（`cat-file --batch-check`）" };
  }

  const lost = [];
  for (const f of files) {
    const result = blob.get(`${sha}:${f}`);
    const atBaseline = blob.get(`${baseline}:${f}`);
    // 结果里没有这个文件（删除）、或与基线同版（正常前移）→ 不是「取了一侧」。
    if (!result || !atBaseline || result === atBaseline) {
      continue;
    }

    /* 基线的历史上，这个文件有没有过**逐字节相同**的版本 —— 有 = 退回了那一版。
     * 判定核心取自共用内核（与 1-2 的提交前档同一份实现，见模块头）；
     * `blobAt` 现在是查已取回的表，不再起进程。 */
    const hit = findEarlierVersion({
      result,
      historyShas: candidates.get(f) ?? [], // 同一圈 `files` 刚逐个 set 过，键必在（见上面那句注释）
      blobAt: (older) => blob.get(`${older}:${f}`) ?? null,
    });
    if (hit) {
      lost.push(f);
    }
  }
  return { ok: true, lost };
}

/** 从 argv 里取一条 `--key value` 形式的选项。
 * @param {string[]} argv @param {string} key @returns {string} */
function optionValue(argv, key) {
  const i = argv.indexOf(key);
  return i === -1 ? "" : (argv[i + 1] ?? "");
}

function main() {
  const argv = process.argv.slice(2);
  const reportOnly = argv.includes("--report");
  const positional = argv.filter((a, i) => {
    if (a.startsWith("--")) {
      return false;
    }
    // `--baseline <value>` 的 value 不是位置参数。
    return argv[i - 1] !== "--baseline";
  });
  const sha = positional[0] || "HEAD";
  const baseline = optionValue(argv, "--baseline");

  if (!baseline) {
    console.error(
      "[merged-side-loss] 缺少 --baseline <good-sha>：这条判据需要一个已知好的参照点 ——\n" +
        "  「非祖先分支上的某一版」在 squash 之后常常已不可达（实测 998d33d6 已 GC），\n" +
        "  所以那一侧是谁无法自行算出。取最近一次「确认无回退」的 master 提交即可。\n" +
        "  例：node scripts/check-merged-side-loss.mjs ad81a912 --baseline bfeb33f0",
    );
    process.exit(2);
  }

  const result = scan({ sha, baseline });
  if (!result.ok) {
    console.error(`[merged-side-loss] 没跑起来：${result.reason}（不构成「判据红了」）`);
    process.exit(2);
  }

  const { lost } = result;
  if (reportOnly) {
    console.log(`[merged-side-loss] ${sha} vs ${baseline}：疑似整份退回 ${lost.length} 份`);
    lost.forEach((f) => console.log(`  · ${f}`));
    return;
  }

  if (lost.length === 0) {
    console.log(`[merged-side-loss] OK（${sha} vs ${baseline} 无整份退回）`);
    return;
  }

  console.error(
    `[merged-side-loss] ${sha} vs ${baseline}：${lost.length} 份文件疑似整份退回 ——\n${
      lost.map((f) => `  · ${f}`).join("\n")
      }\n\n⚠️ 命中 = **需要人工看**，不等于「确定丢了」：blob 相等性有巧合（空文件、\n` +
      `逐字相同的正当改动）。逐份核对后，真丢的那批按原提交重放（cherry-pick）补回，\n` +
      `**别整份 goback**（会二次回退该文件上分支侧的正当增补）。`,
  );
  process.exit(1);
}

// 只在被直接运行时执行 CLI（被 import 时不跑）。判「是不是直接运行」用路径解析后比较 ——
// 拼 `file://${argv[1]}` 在 Windows 上恒不相等，那会让 main() 一次都不跑、退出码恒 0。
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
