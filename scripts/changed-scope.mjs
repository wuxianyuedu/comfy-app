#!/usr/bin/env node
/**
 * changed-scope.mjs — 「这次改动面」的**唯一出处**
 *
 * ── 它收的是哪一件事 ───────────────────────────────────────────────────
 *
 * 「这次改动改了哪些文件」这件事，本仓现在有**两个消费点**：
 *
 *   · `scripts/ci-affected-tests.mjs`（「受影响用例」那一格）—— 拿改动面选用例；
 *   · `scripts/shell-gate.mjs`（桌面壳门禁）—— 拿改动面判「这次碰没碰壳」。
 *
 * 两者问的是**同一个问题**，而答案的形态必须一致：一条 PR 的改动面在两处各算一次，
 * 两处的口径就会在某一次改动里漂开（改名的旧路径算不算？三点 diff 还是两点？）。
 * ⇒ 本模块把「算改动面」这一跳收成一处，两边各调它。
 *
 * ── 口径（三条，逐条都有出处）──────────────────────────────────────────
 *
 *   ① **基线怎么来**：PR 事件上平台给 `CNB_PULL_REQUEST_TARGET_SHA`（官方
 *      `build-in-env.md`；`.cnb.yml` 的分支守卫一格早已在用同一族变量）；
 *      非 PR 事件 / 手工触发时退回「要并进去的那条」（各 remote 的 `master`，
 *      再退回本地 `master`）与 HEAD 的分叉点。
 *   ② **diff 形态**：一律**三点**（`<base>...HEAD` = 与基线的 merge-base 之差）。
 *      基线是分叉点时三点与两点等价，所以两档能并成一条命令。
 *   ③ **改名怎么读**：`--name-status -M`，改名的 **R 行两侧都进面**（只给新路径时，
 *      按旧路径读文件的用例会随改名整条漏跑，ISSUE #2226）。
 *   ④ **路径必须原样**：`git diff` 默认（`core.quotePath=true`，git 的默认值）把**含非 ASCII
 *      字符**的路径按 C 风格转义并**加引号** —— 实测输出是
 *      `M\t"docs/standards/15-\351\231\204\345\275\225.md"`。本仓**38 份被跟踪文件的
 *      文件名带非 ASCII**（全在 `docs/` 下）⇒ 不关掉它，改动面里那一条与真实路径对不上。
 *      而机器之间还**各不相同**：本机全局配了 `core.quotepath=false`，CI runner 是 git
 *      默认值 ⇒ **同一份代码在平台与本机是两种判决**（ISSUE #2272）。
 *      ⇒ 本模块的每一条 `git diff` 都带 `-c core.quotePath=false`。
 *
 * ── 拿不到基线 / 拿不到清单 ⇒ 「没判」而不是「空」 ─────────────────────
 *
 * 两者都返回 `{ok:false, reason}`，由调用方按**各自那一档的退出码**处理
 * （`ci-affected-tests.mjs` 退 2；`shell-gate.mjs` 在 `--base` 形态下退 2）。
 * 刻意**不**返回空清单冒充「这次没改任何东西」—— 空清单若放行，
 * 「受影响用例」那一格会把 vitest 跑成全量，而全量绿在 PR 这一跳上是被否掉的读数。
 *
 * ── 口径 ⑤：同一件事在**平台合成的 merge 提交**上会算错 ─────────────────
 *
 *   ⑤ **平台合成的 merge 提交上，三点 diff 会退化成两点**：平台检出的是
 *      「本 PR 并进目标分支（那一刻）」的 merge 提交，而基线是
 *      `CNB_PULL_REQUEST_TARGET_SHA` —— 两者不同步时（平台给的基线比合成的目标侧旧），
 *      merge 提交与那条基线的 merge-base 就是**基线自己**，于是「目标分支在基线之后
 *      自己落地的改动」被算成「这个 PR 改了什么」（ISSUE #2325 的现场：与壳无关的 PR
 *      被判成改了 `src-tauri/src/**`，然后要求 cargo，而那台 runner 没有）。
 *      ⇒ 这一形态下对一次账（`reconcileSyntheticMergeFace()`）：`<基线>..第一父`
 *      （目标分支自己落地的）与 `第一父..HEAD`（PR 带进来的）都算得出来时，改动面取后者
 *      —— 它与 `<基线>...HEAD` **逐字相等**才是常态，多出来的那些就是「别人的改动」。
 *      两个清单一条都不重合（多半是浅克隆、两份历史不相交）⇒ **不做减法，照旧判并把
 *      这件事说出来**：静默丢改动面比误报一条红更贵。
 *
 * ── 口径 ⑥：「这个 PR 什么都没改」是一个**结论**，不是「没判」────────────────
 *
 *      PR 的目标分支已经包含源分支的**全部**提交时（同步 master / 冲突只在源分支那侧、
 *      解完与目标逐字节相同），平台仍会合成一个 merge 提交，而 `<基线>...HEAD` 是**空**的。
 *      早先这一形态落进「改动面为空 ⇒ 退 2」，读起来是「这一格没跑起来」——
 *      可那一跑真的判过了，答案是「零个文件」：受影响面 = 固定清单，一个文件都不必挑
 *      （ISSUE #3026 的现场：PR #3023 的 `受影响用例` 因此红，而取消重建的那一跑连
 *      `Prepare` 都没起来 —— 修这一格才拿得回那一跑的读数）。
 *      判据是**空集**，不是「容忍空」：合成提交上**两个父的对称差**也得是空的，两半
 *      都空才叫「真没有改动」；有一半取不到 ⇒ 照旧退 2（拿不到测量 ≠ 测量结果是 0）。
 *      ⚠️ 那一半**不能**写成 `<第一父>..HEAD`：#3000 的冲突以目标分支那一侧解掉之后，
 *      源分支只同步了目标分支，第一父（= 平台给的基线）带着自己的历史坐在那条历史里，
 *      两点 diff 读到的是同步带进来的那批**别人落地的**改动 —— 「一处没改」永远证不出来。
 *
 * 用法（一般不直接跑）：
 *   · `resolveBaseRef(deps)`        ⇒ 「基线是哪一条」
 *   · `changedFilesForBaseRef(ref)` ⇒ 「相对那条基线改了哪些文件」
 *   · `resolveChangedFiles(deps)`   ⇒ 前两件事合起来（按环境选基线）
 *   · `reconcileSyntheticMergeFace(ref, deps)` ⇒ 平台合成 merge 提交上的对账（口径 ⑤）
 *   · `confirmEmptyChangeFace(ref, deps)` ⇒ 「真的一处都没改」的两半读法（口径 ⑥）
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

import { changedPathsFromNameStatus } from "./git-name-status.mjs";
import { resolveMergeBaseRef } from "./base-check/git-ref.mjs";

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, "..");

/**
 * 跑一条 git 命令（`{ ok, stdout }`：失败与「空输出」必须分得开 —— `git diff`
 * 没有差异时也是空输出，而那不是故障）。
 *
 * @param {string[]} args
 * @param {{cwd?: string, runGit?: (args: string[], cwd: string) => {ok: boolean, stdout: string}}} [deps]
 * @returns {{ok: boolean, stdout: string}}
 */
export function gitRun(args, deps = {}) {
  const cwd = deps.cwd ?? ROOT;
  const runGit =
    deps.runGit ??
    ((/** @type {string[]} */ a, /** @type {string} */ c) => {
      /* `stdout` / `stderr` 实测在 git 起不来（ENOENT）时是 `undefined`
       * （`@types/node` 按 `encoding` 声明成 `string`）⇒ `?? ""` 是给运行时兜的。 */
      const r = /** @type {{ status: number | null, stdout?: string, stderr?: string }} */ (
        spawnSync("git", a, {
          cwd: c,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        })
      );
      return {
        ok: r.status === 0,
        stdout: r.status === 0 ? String(r.stdout ?? "") : String(r.stderr ?? ""),
      };
    });
  return runGit(args, cwd);
}

/**
 * 基线是哪一条 —— 「这次改动面」的那一端。
 *
 * 两档的顺序不能换：PR 事件上**平台给的**目标 sha 才是「这个 PR 要并进去的那条」，
 * 而本地的 `master` 在 PR 事件上可能已经前进（跑完这一格时它常常已经含了别的 PR）。
 *
 * `dots` 那一格是**逐字沿用**既有实现的两档形态（PR 三点 / 兜底两点）：那两档在
 * 语义上等价（兜底档的基线本身就是分叉点），但形态是既有用例钉着的判据 —— 改它
 * 等于改判决链（§12.18「不改判据」）。
 *
 * @param {{env?: Record<string, string | undefined>, cwd?: string, runGit?: (args: string[], cwd: string) => {ok: boolean, stdout: string}, fallbackRef?: string | null}} [deps]
 * @returns {{ok: true, ref: string, via: string, dots: "..." | ".."} | {ok: false, reason: string}}
 */
export function resolveBaseRef(deps = {}) {
  const env = deps.env ?? process.env;
  /* ① PR 事件：平台给的目标分支 sha。 */
  const target = String(env.CNB_PULL_REQUEST_TARGET_SHA ?? "").trim();
  if (target !== "") {
    return {
      ok: true,
      ref: target,
      via: "CNB_PULL_REQUEST_TARGET_SHA（三点 diff）",
      dots: "...",
    };
  }
  /* ② 非 PR 事件 / 手工触发：退回「要并进去的那条」的 merge-base。 */
  const remoteRef =
    deps.fallbackRef === undefined ? resolveMergeBaseRef(deps.cwd ?? ROOT) : deps.fallbackRef;
  if (!remoteRef) {
    return {
      ok: false,
      reason:
        "取不到 PR 目标 sha、也取不到要并进去的那条（各 remote 的 master / 本地 master）—— 先 fetch 再跑",
    };
  }
  const mb = gitRun(["merge-base", remoteRef, "HEAD"], deps);
  if (!mb.ok || mb.stdout.trim() === "") {
    return {
      ok: false,
      reason: `算不出 ${remoteRef} 与 HEAD 的分叉点（浅克隆 / 历史不全）`,
    };
  }
  return {
    ok: true,
    ref: mb.stdout.trim(),
    via: `${remoteRef} 的分叉点`,
    dots: "..",
  };
}

/**
 * 相对给定基线改了哪些文件（含改名的旧路径）。
 *
 * 读法 `--name-status -M`：改名的 **R 行两侧都进面** —— 只给新路径时，
 * 按旧路径消费该文件的用例与判据会随改名整条漏掉（ISSUE #2226）。
 *
 * @param {string} ref 基线（一条 ref 或一个 sha）
 * @param {{cwd?: string, runGit?: (args: string[], cwd: string) => {ok: boolean, stdout: string}}} [deps]
 * @param {"..." | ".."} [dots] diff 形态：三点（`ref...HEAD`）/ 两点（`ref..HEAD`）
 * @returns {{ok: true, files: string[], renamedFrom: string[]} | {ok: false, reason: string}}
 */
export function changedFilesForBaseRef(ref, deps = {}, dots = "...") {
  /* `-c core.quotePath=false` 是**必须的**（ISSUE #2272，机制写在本文件头「口径 ④」）：
   * 不带它，git 会把非 ASCII 路径转义加引号（`"docs/standards/15-\351\231\204..."`），
   * 改动面里那一条与真实路径对不上 ⇒ 「改了文档源、镜像没同批带上」在平台上永远判不出来，
   * 而本机（全局配了 `core.quotepath=false`）看不出来 —— 同一份代码两种判决。 */
  const got = gitRun(
    ["-c", "core.quotePath=false", "diff", "--name-status", "-M", `${ref}${dots}HEAD`],
    deps,
  );
  if (!got.ok) {
    return {
      ok: false,
      reason: `${ref} 的 diff 没跑起来` + "（浅克隆 / 该 sha 不在本地对象库里；先 fetch 再跑）",
    };
  }
  const parsed = changedPathsFromNameStatus(got.stdout);
  return { ok: true, files: parsed.paths, renamedFrom: parsed.renamedFrom };
}

/**
 * 平台**合成 merge 提交**上的对账（口径 ⑤，ISSUE #2325）。
 *
 * ## 它治的是哪一件事
 *
 * 平台检出的是「本 PR 并进目标分支（那一刻）」的 merge 提交，与 `CNB_COMMIT`
 * （源分支 head）**不是同一个提交** —— 读数上表现为 `HEAD` 是个不在源分支上的 sha。
 * 而基线取的是 `CNB_PULL_REQUEST_TARGET_SHA`，它未必等于合成时的那个目标侧：
 * 平台给了 `1ec32465`，PR 的 `base.sha` 却已是 `098b860e`。两者错位的窗口里，
 * 三点 diff 的 merge-base 就是**基线自己** ⇒ 「目标分支在基线之后自己落地的改动」
 * 进了本 PR 的改动面。PR #2283 的现场就是这条：`b69beea8` 改了
 * `src-tauri/src/*.rs`，于是「与壳无关的 PR」被判成改了壳。
 *
 * 这与 `shell-gate.mjs` 文件头已经写明、`dropAdoptedShellInputs()` 负责的**本地**合并态
 * 是同一个病：本地的做法是「只被原样采纳、不是本次创作 ⇒ 不触发」，但那一半读的是
 * `MERGE_HEAD`；平台侧**没有** `MERGE_HEAD`，合成提交的父关系才是证据。
 *
 * ## 判据
 *
 * `git diff <基线>...HEAD` 在合成提交上恒等于 `<基线>..第一父` ∪ `第一父..HEAD`：
 * 前者是**目标分支自己落地的**，后者是**这个 PR 带进来的**。所以：
 *
 * - `HEAD` 有两个父、且 `CNB_COMMIT` 是第一父之一 ⇒ 这是合成提交，对账；
 * - 拿不到 `CNB_COMMIT` / 拿不到父关系 / `HEAD` 只有零或一个父 / `CNB_COMMIT`
 *   对不上任何一父 ⇒ **不是这一形态**，`used: false`，调用方照旧判（一个字也不改）；
 * - 对上了但两段清单**一条都不重合** ⇒ 那是「这份检出拿不出第二父那一侧的历史」
 *   （浅克隆 / 两份历史不相交），`used: false` 并说明 —— **不做减法**：
 *   静默丢改动面比误报一条红更贵（本仓最贵的形态是「判据在场、结论静默变成放行」）。
 *
 * `deduped` 是「`<基线>...HEAD` 里有、而 `第一父..HEAD` 里没有」的那些 ——
 * 也就是**别人的改动**。它是读数，调用方拿去念，不参与判决。
 *
 * `ref` **允许为空**（`null` / `undefined` / `''`）：单看拓扑的那一半（合成提交认不认得出来、
 * 第一父是谁）与「有没有一个合用的基线」是两件事。早先这里第一句就是 `没有基线可比 ⇒
 * used: false`，于是平台**给了**基线、而那一对合起来没用（基线比 `第一父^1` 新）时，
 * 调用方连「这说明对方分支在我基线之后自己落过东西」都念不出来 —— 口径 ⑥ 就是靠这个缺口
 * 活到 ISSUE #3026 的。现在没有基线也照样给拓扑，`theirs` 取不到就只是把
 * `<基线>..第一父` 那一半跳过（`deduped` 从三点 diff 读，它本来就不需要这一段）。
 *
 * @param {string | null | undefined} ref 基线（`CNB_PULL_REQUEST_TARGET_SHA` 或分叉点）；
 *   空 = 「这一跑没有合用基线」，只做拓扑那一半
 * @param {{cwd?: string, env?: Record<string, string | undefined>,
 *   runGit?: (args: string[], cwd: string) => {ok: boolean, stdout: string}}} [deps]
 * @returns {MergeFace}
 * @typedef {{used: false, why: string}
 *   | {used: true, files: string[], renamedFrom: string[], deduped: string[],
 *      firstParent: string, head: string, base: string}} MergeFace
 */
export function reconcileSyntheticMergeFace(ref, deps = {}) {
  const env = deps.env ?? process.env;
  const baseRef = String(ref ?? "").trim();
  const source = String(env.CNB_COMMIT ?? "").trim();
  if (source === "") {
    /* 本地 / 手工触发时没有这个变量 ⇒ 无从对账（那边也没有合成提交）。 */
    return {
      used: false,
      why: "没有 CNB_COMMIT，判不出这一跑是不是平台合成的 merge 提交",
    };
  }
  const parents = gitRun(
    ["-c", "core.quotePath=false", "rev-list", "--parents", "-n", "1", "HEAD"],
    deps,
  );
  if (!parents.ok) {
    return { used: false, why: "读不出 HEAD 的父提交（不是 git 检出？）" };
  }
  const row = parents.stdout.trim().split(/\s+/).filter(Boolean);
  const head = row[0] ?? "";
  const firstParent = row[1] ?? "";
  if (row.length < 3) {
    /* 零父（还没有提交）/ 一父（普通提交）⇒ 没有「目标侧」可言，三点 diff 就是答案。 */
    return {
      used: false,
      why: "HEAD 不是 merge 提交（这一跑没有平台合成的目标侧）",
    };
  }
  if (!row.slice(1).includes(source)) {
    return {
      used: false,
      why: `HEAD 的父提交里没有 CNB_COMMIT ${source.slice(0, 8)}（合成形态认不出来）`,
    };
  }
  /* `<基线>..第一父` 与 `第一父..HEAD` —— 后者必须真算得出来才谈得上对账（它才是
   * 「这个 PR 带进来的」）。前者的作用只是「证明它是空的那条」`crosses`：
   * 没有基线时不跳过对账，只是少一条证据 —— 见口径 ⑥ 与上面 `ref` 那段。 */
  const theirs = baseRef === "" ? null : changedFilesForBaseRef(baseRef, deps, "..");
  const mine = changedFilesForBaseRef(firstParent, deps, "..");
  if (!mine.ok) {
    return {
      used: false,
      why: "算不出「本 PR 带进来的」那一段清单（第一父..HEAD）",
    };
  }
  const seen = gitRun(
    ["-c", "core.quotePath=false", "diff", "--name-only", `${baseRef}...HEAD`],
    deps,
  );
  if (!seen.ok) {
    return {
      used: false,
      why: `${baseRef} 的三点 diff 跑不起来（与 HEAD 不在同一部历史里？浅克隆？）—— 不做减法`,
    };
  }
  const seenFiles = seen.stdout.split(/\r?\n/).filter(Boolean);
  const mineAll = new Set([...mine.files, ...mine.renamedFrom]);
  /* 后半条判据：两点结果必须落在三点结果里 —— 常态下两者逐字相等；一条都不落说明
   * 这一份检出拼不出那条等式（浅克隆最常见），此时不许相信减法。 */
  if (!mine.files.every((f) => seenFiles.includes(f))) {
    return {
      used: false,
      why: "两点结果落不进三点结果（多半是浅克隆：取不到第二父那一侧）⇒ 不做减法",
    };
  }
  if (theirs !== null) {
    /* 前半条：两段历史相交 —— 否则「第一父..HEAD」只是一段与基线无关的历史，
     * 拿它当改动面等于把 PR 自己的改动丢了。**基线不可用（上面 `theirs === null`）
     * 时这一半没法证明，`used` 也不成立**：那一格由 `confirmEmptyChangeFace()` 接手
     * （它多一个「两份清单都是空」的判据），调用方念的是那把更细的话。
     *
     * `theirs.ok === false` 是「基线那一侧的 diff 没跑起来」（sha 不在对象库里 / 浅克隆）
     * —— 与「算得出来但对不上」分开念：两者的下一动作不同（前者先 fetch）。 */
    const theirsOk = theirs.ok;
    if (!theirsOk) {
      return {
        used: false,
        why: "算不出「目标分支落地的」那一段（基线那一侧取不到）⇒ 不做减法",
      };
    }
    const crosses =
      theirs.files.some((f) => mineAll.has(f)) ||
      mine.files.some((f) => new Set([...theirs.files, ...theirs.renamedFrom]).has(f));
    if (!crosses) {
      return {
        used: false,
        why: "两段历史不相交（基线那一侧对不上第一父）⇒ 不做减法",
      };
    }
  }
  const deduped = seenFiles.filter((f) => !mineAll.has(f));
  return {
    base: baseRef,
    deduped,
    files: mine.files,
    firstParent,
    head,
    renamedFrom: mine.renamedFrom,
    used: true,
  };
}

/**
 * 合成提交的**两个父**之间的对称差 —— 「只在某一父之下」的那批文件。
 *
 * 它是「这个 PR 带进来的」与「目标分支自己落地的」之间唯一站得住的切法：
 * `第一父..HEAD` 只在第一父恰好是分叉点时才等于前者，而平台那一跑的基线
 * （`CNB_PULL_REQUEST_TARGET_SHA`）带着自己的历史、第一父通常就坐在那条历史里 ——
 * 那时两点 diff 读到的是同步带进来的那批**别人落地的**改动（PR #3023 的现场）。
 *
 * 对称差在这里的含义是「只在一边之下」：父 A 有、父 B 没有的（本 PR 带进来的），
 * 与父 B 有、父 A 没有的（目标分支自己落地的）**都进面**。面为空 ⇔ 两个父的树逐字相同
 * ⇔ 这次合并没有带进任何改动。
 *
 * `-M` 与 `core.quotePath=false` 同 `changedFilesForBaseRef()` 一档（改名两侧都要看得到）。
 *
 * ⚠️ 它回答的是「两父是否同树」，**不**替代 `reconcileSyntheticMergeFace()` 的判决：
 * 那边要的是「本 PR 带进来的」那一半，`deduped` 是另一半 —— 两个答案不同，别合并。
 *
 * @param {string} firstParent
 * @param {string} secondParent
 * @param {{cwd?: string, runGit?: (args: string[], cwd: string) => {ok: boolean, stdout: string}}} [deps]
 * @returns {{ok: true, files: string[]} | {ok: false, reason: string}}
 */
function inheritFaceFromParents(firstParent, secondParent, deps = {}) {
  const got = gitRun(
    [
      "-c",
      "core.quotePath=false",
      "diff",
      "--name-status",
      "-M",
      `${firstParent}...${secondParent}`,
    ],
    deps,
  );
  if (!got.ok) {
    return {
      ok: false,
      reason:
        `算不出两个父之间的分叉清单（${firstParent.slice(0, 8)}...${secondParent.slice(0, 8)}）`,
    };
  }
  return { ok: true, files: changedPathsFromNameStatus(got.stdout).paths };
}

/**
 * 「这个 PR 真的一处都没改」—— 口径 ⑥ 的读法（ISSUE #3026）。
 *
 * ## 它治的是哪一件事
 *
 * 目标分支已经包含源分支的全部提交时（同步 master 之后逐字节相同），平台仍会合成一个
 * merge 提交，而 `<基线>...HEAD` 是**空**的。早先这一形态被读成「改动面为空 ⇒ 没判」，
 * 于是 `受影响用例` 那一格红 —— 而它其实判过了，答案是「零个文件」。
 *
 * ## 判据：两半都空才算数
 *
 *   · `<基线>...HEAD` 空（调用方刚读到的那一份，这里重复算一次是刻意的：
 *     这一把的结论必须由**它自己的**两条 git 读数支撑，不继承调用方那次的结果）；
 *   · 合成提交上**两个父的对称差**也空（`第一父...第二父`）。它才是「这个 PR 带进来的」
 *     —— `第一父..HEAD` 只在第一父恰好是分叉点时才等价，而平台那一跑的基线带着自己的
 *     历史，第一父通常就在那条历史里面（PR #3023 的现场）。
 *
 * 有一半**取不到**（diff 跑不起来 / 认不出合成提交 / 没有第一父）⇒ `ok: false` 并说清
 * 哪一半缺 —— 「拿不到测量 ≠ 测量结果是 0」（§13.6.4.1）。调用方照旧退 2。
 *
 * ⚠️ 这里**只回答「面是不是真的空」**，不改任何一条判决：「空面 ⇒ 受影响面 = 固定清单」
 * 那句在 `ci-affected-tests.mjs`，本模块不替它决定跑什么。
 *
 * @param {{cwd?: string, env?: Record<string, string | undefined>,
 *   runGit?: (args: string[], cwd: string) => {ok: boolean, stdout: string},
 *   fallbackRef?: string | null}} [deps]
 * @returns {{ok: true, via: string, firstParent: string | null, lead: string[]}
 *   | {ok: false, reason: string}}
 */
export function confirmEmptyChangeFace(deps = {}) {
  const base = resolveBaseRef(deps);
  if (!base.ok) {
    return { ok: false, reason: base.reason };
  }
  const face = changedFilesForBaseRef(base.ref, deps, base.dots);
  if (!face.ok) {
    return { ok: false, reason: face.reason };
  }
  if (face.files.length > 0) {
    return {
      ok: false,
      reason: `改动面不是空的（${face.files.length} 个文件）—— 这不是「零个文件」那条形态`,
    };
  }
  const parents = gitRun(
    ["-c", "core.quotePath=false", "rev-list", "--parents", "-n", "1", "HEAD"],
    deps,
  );
  if (!parents.ok) {
    return { ok: false, reason: "读不出 HEAD 的父提交（不是 git 检出？）" };
  }
  const row = parents.stdout.trim().split(/\s+/).filter(Boolean);
  const firstParent = row[1] ?? "";
  if (row.length < 3 || firstParent === "") {
    /* 只有一条提交历史时，三点 diff 就是全部证据，不需要第二半。 */
    return {
      firstParent: null,
      lead: [],
      ok: true,
      via: `${base.via}：单线历史，只有三点 diff 这一半`,
    };
  }
  /* 第二半：**两个父的对称差**（理由见 `inheritFaceFromParents()` 的文件注释）。 */
  const secondParent = row[2] ?? "";
  const mine = inheritFaceFromParents(firstParent, secondParent, deps);
  if (!mine.ok) {
    return mine;
  }
  if (mine.files.length > 0) {
    return {
      ok: false,
      reason: `两个父之间有 ${mine.files.length} 个文件分叉 —— 这不是「零个文件」那条形态`,
    };
  }
  /* 空面 PR 的常见成因之一是「只同步了目标分支」：那一批提交在 `<基线>..HEAD` 里、
   * 却不在两个父的分叉面上。它是读数（调用方念出来），不参与判决。 */
  const carried = changedFilesForBaseRef(base.ref, deps, "..");
  const lead = carried.ok ? carried.files : [];
  return {
    firstParent,
    lead,
    ok: true,
    via: `${base.via} 与第一父 ${firstParent.slice(0, 8)} 对过账：两边都是空清单`,
  };
}

/**
 * 按环境选基线、取出这次的改动面。
 *
 * @param {{env?: Record<string, string | undefined>, cwd?: string, runGit?: (args: string[], cwd: string) => {ok: boolean, stdout: string}, fallbackRef?: string | null}} [deps]
 * @returns {{ok: true, files: string[], renamedFrom: string[], via: string} | {ok: false, reason: string}}
 */
export function resolveChangedFiles(deps = {}) {
  const base = resolveBaseRef(deps);
  if (!base.ok) {
    return { ok: false, reason: base.reason };
  }
  const got = changedFilesForBaseRef(base.ref, deps, base.dots);
  if (!got.ok) {
    return { ok: false, reason: got.reason };
  }
  return {
    ok: true,
    files: got.files,
    renamedFrom: got.renamedFrom,
    via: base.via,
  };
}
