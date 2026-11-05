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
 * 命中里有**三道正当减除**，各有各的读数（安静地少判与「本来没事」在屏幕上长得一样）：
 *
 *   · **本笔自身的增补**（ISSUE #3004）：一笔 N 行改动反向应用必回上一版 —— 那是
 *     恒等式不是退回（`ownDiffExplains()`）；
 *   · **同内容的另一种排版**（ISSUE #2999 / #3208）：结果版与基线版剥掉全部空白、
 *     再去掉尾随逗号后逐字相等 —— printWidth 迁移把 80 列链式改回 100 列单行，
 *     逐字节正好等于格式化之前的某一版；相对基线内容一个字没少，不是退回
 *     （`sameModuloLayout()`）；
 *   · **台账类文件的空态**（ISSUE #2994）：结果版是 `entries: []` 的台账 —— 清零是
 *     棘轮判据（只许降）自己要求的收紧，而空台账逐字节等于建表那一刻的版本，
 *     在这一格上必然命中（`isLedgerZeroState()`）。
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
import { historyByFile, readBlobText, resolveBlobs } from "./merged-side-loss-git.mjs";

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
 * 两个 blob 的**内容**是否逐字相同（忽略排版差异；ISSUE #2999 / #3208 的判别件）。
 *
 * 为什么不用 `git diff -w`：那条只忽略**行内**空白，而 printWidth 迁移改的恰恰是
 * **断行结构**（链式拆行 ⇄ 单行）—— 行数都变了，`-w` 下仍是 9+/27- 的实差，
 * 治不了现场。把两侧内容各剥掉全部空白再比，链式与单行就折成同一个串；
 * 真退回（少了一段代码）剥完仍不等。
 *
 * **尾随逗号也属于排版**（ISSUE #3208）：80 列形态在列表最后一个元素后留逗号再
 * 折行，100 列单行则整条去掉（`"文生图",\n)` ⇄ `"文生图")`）。#2999 只剥空白，
 * 逗号不是空白 —— `call(1,)` 剥完是 `call(1,)`，与 `call(1)` 不等，于是真实现场
 * （`src/lib/project-canvas/history-panel-types.test.ts`，结果版与 `4ac1816e3` 那一版
 * 逐字节相同）被误判成「整份退回」。#3204 因此推不上去。
 *
 * 归一只在**逗号前面是能收尾表达式的记号**时成立：`[,]`（稀疏数组的洞）与
 * `[1,,]` 里逗号前面是 `[` / `,`，删掉会抹平**语义差异**（数组长度变了），不归一。
 * 字符串字面量里恰好出现 `,)` 的极端形态会跟着漏 —— 这是取值域的代价，不是
 * 判据面放宽（命中仍要点名、仍算「需要人工看」）。
 *
 * 只在**命中之后**对命中的那几份调用；内容读数在 `scan()` 的命中环里取一次、
 * 与 #2994 的台账空态判别共用（那边见 `isLedgerZeroState()`）。
 *
 * @param {string} aText 结果版内容（`cat-file blob` 的原文，取不到时调用方不会走到这）
 * @param {string} bText 基线版内容
 * @returns {boolean}
 */
function sameModuloLayout(aText, bText) {
  return normalizeLayout(aText) === normalizeLayout(bText);
}

/** 剥掉全部空白，再去掉列表收尾处的尾随逗号（`sameModuloLayout()` 的实现件）。
 * @param {string} text @returns {string} */
function normalizeLayout(text) {
  return text
    .replaceAll(/\s+/g, "")
    .replaceAll(/,(?<closer>[)\]}])/g, (pair, closer, offset, whole) => {
      /* 逗号前面是开括号或另一个逗号 ⇒ 那是**稀疏数组的洞**（`[,]` 长度 1、`[1,,]`
       * 长度 2），删掉就把语义差异抹平了 —— 原样留下，让判据照旧命中。 */
      const prev = offset > 0 ? whole.charAt(offset - 1) : "";
      return ",([{".includes(prev) ? pair : closer;
    });
}

/**
 * 是不是「台账类文件」的**空态**（ISSUE #2994 的判别件）。
 *
 * 形状取自 #1400 建的那份依赖审计台账自己（`{"ruleVersion":N,"entries":[…]}`）：
 * JSON 可解析、有 `entries` 字段且是**空数组**。这一态是棘轮判据自己的成功态 ——
 * `--update` 只许降，清零是它要求的结果；而它逐字节等于建表那一刻的版本，
 * 在这一格上必然命中。代价是别的空形态巧合会跟着漏（单子 ② 写明的取舍）。
 * 非 JSON / 解析不过 ⇒ `false`（保持命中，fail-closed）。
 *
 * @param {string} text 结果版内容
 * @returns {boolean}
 */
function isLedgerZeroState(text) {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed?.entries) && parsed.entries.length === 0;
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
 * `own` 非空时，命中的那份还要过一道「本笔自身」的减除（见 `ownDiffHits()`）——
 * 一笔 3 行的改动反向应用必然回基线版，那不是退回（ISSUE #3004）。
 *
 * @param {{sha: string, baseline: string, own?: {from: string} | null}} target
 *   待查的那一笔、它对照的基线那一笔，以及（可选）本笔要减掉的那一段起点
 * @returns {{ok: true, lost: string[], reverted: string[], relaidOut: string[], ledgerZero: string[]} | {ok: false, reason: string}}
 *   取不到事实时给 `ok:false`；`reverted` 是**留在了命中清单里**的那一批（本笔自身的增补
 *   反向应用对不上），`lost` 是扣掉它们之后的结论。
 */
export function scan({ sha, baseline, own = null }) {
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
    return { ok: true, lost: [], reverted: [], relaidOut: [], ledgerZero: [] };
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
  /** 命中但被「同内容另一种排版」减掉的（ISSUE #2999，读数在 main 里念）。 */
  const relaidOut = [];
  /** 命中但被「台账空态 = 棘轮成功态」减掉的（ISSUE #2994，读数在 main 里念）。 */
  const ledgerZero = [];
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
    if (!hit) {
      continue;
    }
    /* **「同内容的另一种排版」不是退回**（ISSUE #2999）：现场是 printWidth 迁移 ——
     * 结果版（100 列单行）与基线版（80 列链式）逐字节不同、却与**格式化之前**的
     * 某一版逐字节相同，于是被读成「退回了基线之前的版本」。判据要抓的是
     * 「丢了别线的成果」，而相对基线，结果版的**内容一个字没少** —— 命中只是
     * 排版巧合。判别：两个 blob 去掉全部空白与收尾处的尾随逗号后逐字相等 ⇒ 减掉
     * （尾随逗号那一格是 #3208 补的：只剥空白时 `call(1,)` 与 `call(1)` 不等）。
     *
     * **台账类文件的空态是棘轮自己的成功态**（ISSUE #2994）：`.dependency-audit-baseline.json`
     * 那一族（`{"ruleVersion":…,"entries":[…]}`）由它自己的判据管方向 ——
     * `--update` 判「台账只许降」。于是「清零」（结果版 `entries: []`，逐字节等于
     * 建表那一刻的空台账）是**正当的收紧**，而它在这一格上**必然**命中（那份文件的
     * 历史上只出现过空与有条目两种内容）。判别：结果版是「entries 为空数组」的
     * JSON ⇒ 减掉。代价（单子 ② 写明的）：别的空形态巧合会跟着漏 —— 换来的是
     * 棘轮要求的每一次收紧都不再被这一格拦死。
     *
     * 两道判别共用**同一份内容读数**（每份命中各取结果 / 基线两次 `cat-file blob`，
     * 常规零命中的跑一次也不多付）；读不到 ⇒ 两道都不成立、保持命中 ——
     * fail-closed：没读到不许被读成扣过了（与 `own` 那一道同一条铁律）。 */
    const resultText = readBlobText(git, result);
    const baselineText = resultText === null ? null : readBlobText(git, atBaseline);
    if (resultText !== null && baselineText !== null) {
      if (sameModuloLayout(resultText, baselineText)) {
        relaidOut.push(f);
        continue;
      }
      if (isLedgerZeroState(resultText)) {
        ledgerZero.push(f);
        continue;
      }
    }
    lost.push(f);
  }
  /* 本笔自身的减除（ISSUE #3004）：见 `ownDiffExplains()` 那段。`own` 取不到 ⇒ 不扣 ——
   * 「没读到」不许被读成「扣过了」。 */
  if (own && lost.length > 0) {
    const explained = ownDiffExplains({ sha, from: own.from, files: lost });
    if (explained === null) {
      return { ok: false, reason: "取本笔自身的 diff 没跑起来" };
    }
    if (explained) {
      return { ok: true, lost: [], reverted: lost, relaidOut, ledgerZero };
    }
  }
  return { ok: true, lost, reverted: lost, relaidOut, ledgerZero };
}

/**
 * 命中的那份文件里，哪些是「本笔自己的增补被反向应用后正好回到基线版」。
 *
 * ── 为什么需要这一道（ISSUE #3004 的现场）───────────────────────────
 *
 * 判据的命中条件是「结果版 == 某个更早版本」，而**一笔 N 行的改动反向应用就必然
 * 回到上一版** —— 这是恒等式，不是巧合：这一笔的全貌 = 基线 + 本笔 diff，所以
 * 从结果里减掉本笔 diff 一定等于基线。于是任何一笔纯 `src/**` 的机械改动
 * （`a && a.b` → `a?.b` 那一种）都会被判成「整份退回」，`pre-push` 因此拦下推送。
 *
 * ⚠️ **不能用「结果版 == 基线版」判**（`scan()` 里那条 `result === atBaseline`
 * 已经放过了正常前移）：被误判的正是「改了东西」的那一批，它们与基线版**不相等**。
 * 用「本笔 diff 反向应用后得到的 blob」去比，才是与命中条件对称的探针。
 *
 * 真事故（#1617 那三次）不受影响：它们被退的文件里，那笔 diff 的反向应用**对不上**
 * —— 丢的是别人的与更早的增补，本笔自己并没有增补过那些行。
 *
 * 做法：把逐个文件的补丁喂给**一次** `git apply -R --cached --check`（只判不改），
 * 全过就整批算「本笔自身」。用 `--check` 而不是真往索引里写：判据可能在脏树上跑，
 * 不该留下任何痕迹。
 *
 * @param {{sha: string, from: string, files: string[]}} input 待查提交、本笔 diff 的起点、候选文件
 * @returns {boolean | null} 这一批能否被本笔自身的 diff 整批解释；取不到给 `null`
 */
export function ownDiffExplains({ sha, from, files }) {
  if (files.length === 0) {
    return true;
  }
  /* 补丁的 pathspec 收尾：`--` 之后才是路径（否则与选项混淆）。 */
  const END_OF_OPTIONS = "--";
  const specs = files.flatMap((f) => [END_OF_OPTIONS, f]);
  /* 方向：`from..sha` 是**这一笔做的改动**，反向应用它（`apply -R`）才回到 `from`
   * 那一版 —— 这正是与命中条件（「结果版 == 更早某一版」）对称的那个探针。
   * 早先这里写成 `diff -R`，那等于把补丁先反过来、再反向应用一次 = 正向应用，
   * 对着「已经改过」的结果必然 apply 不上（实测：一笔 3 行改动报
   * `patch does not apply`，而真事故 ad81a912 的 README.md 反倒「通过」—— 判据整个反了）。 */
  const patch = git(["diff", "--binary", from, sha, ...specs]);
  if (patch === null) {
    return null;
  }
  return git(["apply", "-R", "--cached", "--check", "--whitespace=nowarn"], `${patch}\n`) !== null;
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
    // `--baseline <value>` / `--own-from <value>` 的 value 不是位置参数。
    return argv[i - 1] !== "--baseline" && argv[i - 1] !== "--own-from";
  });
  const sha = positional[0] || "HEAD";
  const baseline = optionValue(argv, "--baseline");
  /* `--own-from <起点>`（可选，ISSUE #3004）：给了就减掉「本笔自身的增补」——
   * `mergeLoss` 那一段由 `premerge-check.mjs` 显式带上（分叉点），事后盘点不带。
   * 「不给」= 从前默认那一版，行为一字不变。 */
  const ownFrom = optionValue(argv, "--own-from");

  if (!baseline) {
    console.error(
      "[merged-side-loss] 缺少 --baseline <good-sha>：这条判据需要一个已知好的参照点 ——\n" +
        "  「非祖先分支上的某一版」在 squash 之后常常已不可达（实测 998d33d6 已 GC），\n" +
        "  所以那一侧是谁无法自行算出。取最近一次「确认无回退」的 master 提交即可。\n" +
        "  例：node scripts/check-merged-side-loss.mjs ad81a912 --baseline bfeb33f0",
    );
    process.exit(2);
  }

  const result = scan({ sha, baseline, own: ownFrom ? { from: ownFrom } : null });
  if (!result.ok) {
    console.error(`[merged-side-loss] 没跑起来：${result.reason}（不构成「判据红了」）`);
    process.exit(2);
  }

  const { lost, reverted, relaidOut, ledgerZero } = result;
  /* 被减掉的那批要念出来（ISSUE #3004）：安静地少判一批评据，与「那批本来没事」
   * 在屏幕上长得一样。只在真减掉了东西的时候念。 */
  const dropped = reverted.length - lost.length;
  if (dropped > 0) {
    console.log(
      `[merged-side-loss] 减掉 ${dropped} 份：反向应用本笔自身的 diff 后正好回到基线版` +
        "（= 这一笔自己的增补，不是退回；判据要抓的是「丢了别人的成果」）",
    );
  }
  /* 「同内容另一种排版」那一档也要点名（ISSUE #2999）：它没有丢任何东西，
   * 但命中发生过的这件事本身是读数 —— 不念，下一次排版巧合还会无声地走一遍。 */
  if (relaidOut.length > 0) {
    console.log(
      `[merged-side-loss] 减掉 ${relaidOut.length} 份：结果版与基线版**只差空白/断行/尾随逗号**` +
        "（同一种内容的另一种排版，内容一个字没少 —— 不是退回，ISSUE #2999 / #3208）——",
    );
    relaidOut.forEach((f) => {
      console.log(`  · ${f}`);
    });
  }
  /* 「台账空态」那一档同样要点名（ISSUE #2994）：清零是棘轮判据自己的成功态，
   * 但「这一格放过它」这件事要留在屏幕上 —— 不念，下一次清零还会无声地走一遍。 */
  if (ledgerZero.length > 0) {
    console.log(
      `[merged-side-loss] 减掉 ${ledgerZero.length} 份：台账类文件的**空态**` +
        "（entries: [] 是棘轮自己的成功态 —— 清零是正当收紧，不是退回，ISSUE #2994）——",
    );
    ledgerZero.forEach((f) => {
      console.log(`  · ${f}`);
    });
  }
  if (reportOnly) {
    console.log(`[merged-side-loss] ${sha} vs ${baseline}：疑似整份退回 ${lost.length} 份`);
    lost.forEach((f) => {
      console.log(`  · ${f}`);
    });
    return;
  }

  if (lost.length === 0) {
    console.log(`[merged-side-loss] OK（${sha} vs ${baseline} 无整份退回）`);
    return;
  }

  console.error(
    `[merged-side-loss] ${sha} vs ${baseline}：${lost.length} 份文件疑似整份退回 ——\n${lost
      .map((f) => `  · ${f}`)
      .join("\n")}\n\n⚠️ 命中 = **需要人工看**，不等于「确定丢了」：blob 相等性有巧合（空文件、\n` +
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
