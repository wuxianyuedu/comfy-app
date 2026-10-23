#!/usr/bin/env node
/**
 * ship-core.mjs —— `pnpm ship` 的**纯判定层**（规范 §13.6）。
 *
 * 这一层只做一件事：**把外部执行者（平台 PR / git 输出）的原文读成三态结论**，
 * 不产生副作用。拆出来不是为了行数好看，而是因为它的输入是**外部形状** ——
 * 平台改字段、加一档状态、把 `data` 从对象换成数组，红都该落在这一层，
 * 而不是落在「编排有没有按顺序走」那一半上。两层的判据因此各自独立：
 * `tests/ship.test.ts` 判这里的取数，`ship.mjs` 的 `main()` 判顺序。
 *
 * 三条贯穿本层的纪律（与 `ship.mjs` 文件头同一条）：
 *   · 只读 `data.*`，**绝不**读信封上的 `status`（那是 HTTP 状态码，与流水线无关）；
 *   · 「取不到」一律回 `null` / `unknown`，**不猜方向** —— 空数组会被读成
 *     「查过了，里面没有我的」，而 null 读成「没拿到列表」，后者才是事实；
 *   · 不抛异常：畸形输入走到 `unknown` 那一档，由调用方退 2。
 *
 * 「单子」那一族（碎片读数、提单人留痕、优先级词表）不在这里 —— 它在 `ship-ticket.mjs`：
 * 那些判的不是「外部执行者的形状」，而是碎片与单子的口径，变化方向不同，而两份叠在一起
 * 已经越过 `check-infra-file-size.cjs` 那 900 行硬闸（AGENTS 硬规则 22）。本文件只从它取
 * `fragmentHead`（首行的读法一处，PR 正文与单子读数共用）。
 *
 * 「build 读数」那一族（按 sha 归属构建 / 轮询签名 / 三态判定 / `asArray`）同样按这条线
 * 分了出去，在 `ship-build.mjs`：它服务的是一条 build 自己的读法，与 PR / git 的形状各自
 * 独立变化，放在同一份文件里只会在下一次加字段时再撞一次 900 行。
 */
import fs from "node:fs";
import path from "node:path";

import { resolveGitDir } from "./git-dir.mjs";
import { commentHeader, fragmentHead } from "./ship-ticket.mjs";

/** 退出码三态（与 `premerge-check.mjs` 逐字同口径）。 */
export const CODE = { GREEN: 0, RED: 1, NOT_RUN: 2 };

/** 阶段顺序表。**可反转**：新增/摘掉一段只改这张表 + 对应的 `run*`，不动判决逻辑。
 * `clean-branch` 排在最后：它要的是「合并已经验真」这件事，而那是 `merge` 那一段的产物。 */
export const PHASES = [
  "preflight",
  "commit",
  "push",
  "pull-request",
  "poll",
  "verdict",
  "merge",
  "close-issue",
  "clean-branch",
];

/**
 * 合并多个阶段的退出码：**`2` 压过 `1`，`1` 压过 `0`**。
 *
 * @param {number[]} codes 已跑过的各段结论
 * @returns {number} 合并后的进程退出码
 */
export function combineShipCodes(codes) {
  if (codes.includes(CODE.NOT_RUN)) return CODE.NOT_RUN;
  if (codes.includes(CODE.RED)) return CODE.RED;
  return CODE.GREEN;
}

/**
 * 一个命令行 token 是不是合法的 issue 号（`2179` 或 `#2179`）。不是就回 `null`。
 *
 * 「像不像号」只在这一处判：`--close-issue 2179` 与 `--close-issue=2179,2186` 两种写法共用它 ——
 * 各写一份正则的漂移形态是「一种写法能关、另一种不能，而两边都不报错」。
 * 两位是刻意下限：`--close-issue 1` 那种一眼就是打错的输入应当被点名，而不是被当成
 * 「存在一张一号单子」（个位数在本仓是早期真 issue，猜错的代价比多问一句高）。
 *
 * @param {string} token 命令行上的一个 token
 * @returns {number | null}
 */
export function parseIssueNumberToken(token) {
  const bare = String(token ?? "").replace(/^#/, "");
  return /^\d{2,}$/.test(bare) ? Number(bare) : null;
}

/**
 * 解析命令行。未知旗标**不静默忽略** —— 拼错的旗标会被读成「没要那个动作」，
 * 而这里最贵的误读是「以为会合、其实没合」或反之。
 *
 * **`--close-issue` 的两种写法**（ISSUE #2199）：
 *   · 裸旗标 = 从本轮落地那一行的标题本体取号（#2070 那批的口径，一字未改）；
 *   · `--close-issue 2179` / `--close-issue #2179` / `--close-issue=2179,2186` = 人点名。
 *     紧跟的 token 只要不像号就停手并把它记进 `closeIssueBad` —— 既不许当未知旗标静默收下
 *     （那会被读成「没要那个动作」），也不许往后吃掉本该属于别的旗标的参数。
 *
 * @param {string[]} argv 参数（不含 node 与脚本名）
 * @returns {{message:string|null,messageFile:string|null,title:string|null,branch:string|null,adds:string[],merge:boolean,closeIssue:boolean,closeIssueNumbers:number[],closeIssueBad:string[],cleanBranch:boolean,reap:boolean,dryRun:boolean,wait:boolean,whoami:boolean,claim:number|null,claimBad:string[],release:number|null,releaseBad:string[],claims:boolean,newIssue:string|null,newIssueBad:string[],issueBodyFile:string|null,priority:string|null,diagnose:boolean,diagnoseSn:string|null,only:string|null,unknown:string[]}} 解析结果
 */
export function parseArgs(argv) {
  /** @type {{message:string|null,messageFile:string|null,title:string|null,branch:string|null,adds:string[],merge:boolean,closeIssue:boolean,closeIssueNumbers:number[],closeIssueBad:string[],cleanBranch:boolean,reap:boolean,dryRun:boolean,wait:boolean,whoami:boolean,claim:number|null,claimBad:string[],release:number|null,releaseBad:string[],claims:boolean,newIssue:string|null,newIssueBad:string[],issueBodyFile:string|null,priority:string|null,diagnose:boolean,diagnoseSn:string|null,only:string|null,unknown:string[]}} */
  const out = {
    message: null,
    messageFile: null,
    title: null,
    branch: null,
    adds: [],
    merge: false,
    closeIssue: false,
    closeIssueNumbers: [],
    closeIssueBad: [],
    cleanBranch: false,
    reap: false,
    dryRun: false,
    wait: true,
    whoami: false,
    claim: null,
    claimBad: [],
    release: null,
    releaseBad: [],
    claims: false,
    newIssue: null,
    newIssueBad: [],
    issueBodyFile: null,
    priority: null,
    diagnose: false,
    diagnoseSn: null,
    only: null,
    unknown: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? "";
    if (a === "--merge") out.merge = true;
    else if (a === "--whoami") out.whoami = true;
    else if (a === "--claims") out.claims = true;
    /* `--diagnose` 的构建号是**可选**的：不给就按 HEAD 的 sha 归属（红灯现场最常用的
     * 那一形）。所以下一个 token 只在不像旗标时才当构建号收下。 */
    else if (a === "--diagnose") {
      out.diagnose = true;
      const tok =
        i + 1 < argv.length && !String(argv[i + 1]).startsWith("-")
          ? String(argv[++i] ?? "")
          : "";
      if (tok !== "") out.diagnoseSn = tok;
    } else if (a === "--new-issue") {
      const tok =
        i + 1 < argv.length && !String(argv[i + 1]).startsWith("-")
          ? String(argv[++i] ?? "")
          : "";
      if (tok.trim() === "") out.newIssueBad.push("(缺标题)");
      else out.newIssue = tok;
    } else if (a === "--issue-body-file") {
      out.issueBodyFile = argv[++i] ?? "";
    } else if (a === "--priority") {
      out.priority = argv[++i] ?? "";
    } else if (a.startsWith("--diagnose=")) {
      out.diagnose = true;
      const tok = a.slice("--diagnose=".length);
      if (tok !== "") out.diagnoseSn = tok;
    } else if (a.startsWith("--new-issue=")) {
      const tok = a.slice("--new-issue=".length);
      if (tok.trim() === "") out.newIssueBad.push("(缺标题)");
      else out.newIssue = tok;
    } else if (a.startsWith("--issue-body-file=")) {
      out.issueBodyFile = a.slice("--issue-body-file=".length);
    } else if (a.startsWith("--priority=")) {
      out.priority = a.slice("--priority=".length);
    } else if (a === "--claim" || a === "--release") {
      const isClaim = a === "--claim";
      const tok =
        i + 1 < argv.length && !String(argv[i + 1]).startsWith("-")
          ? String(argv[++i] ?? "")
          : "";
      const n = parseIssueNumberToken(tok);
      if (n === null) {
        if (isClaim) out.claimBad.push(tok || "(缺号)");
        else out.releaseBad.push(tok || "(缺号)");
      } else if (isClaim) {
        /* 第二次 `--claim` 不静默覆盖第一张：那会把「领两张」读成「领最后那张」，
         * 而屏幕上不会有任何提示。记进 bad，由执行层点名后停手。 */
        if (out.claim !== null) {
          out.claimBad.push(`重复的 --claim（前一张 #${out.claim}）`);
        } else out.claim = n;
      } else if (out.release !== null) {
        out.releaseBad.push(`重复的 --release（前一张 #${out.release}）`);
      } else out.release = n;
    } else if (a === "--close-issue") {
      out.closeIssue = true;
      while (i + 1 < argv.length && !String(argv[i + 1]).startsWith("-")) {
        const tok = String(argv[++i] ?? "");
        const n = parseIssueNumberToken(tok);
        if (n === null) {
          out.closeIssueBad.push(tok);
          break;
        }
        out.closeIssueNumbers.push(n);
      }
    } else if (a === "--clean-branch") out.cleanBranch = true;
    else if (a === "--reap") out.reap = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--no-wait") out.wait = false;
    else if (a === "--message" || a === "-m") out.message = argv[++i] ?? "";
    else if (a === "--message-file") out.messageFile = argv[++i] ?? "";
    else if (a === "--title") out.title = argv[++i] ?? "";
    else if (a === "--branch") out.branch = argv[++i] ?? "";
    else if (a === "--add") out.adds.push(argv[++i] ?? "");
    else if (a.startsWith("--message="))
      out.message = a.slice("--message=".length);
    else if (a.startsWith("--message-file="))
      out.messageFile = a.slice("--message-file=".length);
    else if (a.startsWith("--title=")) out.title = a.slice("--title=".length);
    else if (a.startsWith("--branch="))
      out.branch = a.slice("--branch=".length);
    else if (a.startsWith("--add=")) out.adds.push(a.slice("--add=".length));
    else if (a.startsWith("--only=")) out.only = a.slice("--only=".length);
    else if (a.startsWith("--claim=") || a.startsWith("--release=")) {
      const isClaim = a.startsWith("--claim=");
      const tok = a.slice(a.indexOf("=") + 1);
      const n = parseIssueNumberToken(tok);
      if (n === null) {
        if (isClaim) out.claimBad.push(tok || "(缺号)");
        else out.releaseBad.push(tok || "(缺号)");
      } else if (isClaim) {
        /* 第二次 `--claim` 不静默覆盖第一张：那会把「领两张」读成「领最后那张」，
         * 而屏幕上不会有任何提示。记进 bad，由执行层点名后停手。 */
        if (out.claim !== null) {
          out.claimBad.push(`重复的 --claim（前一张 #${out.claim}）`);
        } else out.claim = n;
      } else if (out.release !== null) {
        out.releaseBad.push(`重复的 --release（前一张 #${out.release}）`);
      } else out.release = n;
    } else if (a.startsWith("--close-issue=")) {
      out.closeIssue = true;
      for (const tok of (a.slice("--close-issue=".length) || "").split(
        /[,\s]+/,
      )) {
        if (tok === "") continue;
        const n = parseIssueNumberToken(tok);
        if (n === null) out.closeIssueBad.push(tok);
        else out.closeIssueNumbers.push(n);
      }
    } else out.unknown.push(a);
  }
  return out;
}

/**
 * 「这次要不要先把分支建出来」—— 判断与效应分家（与 `decideCloseIssue` 同一形状）。
 *
 * 四条口径：
 *   · **名字只能由人给**。`feat/…`、`fix/<issue号>-…` 是本仓习惯，不是脚本能推的事实；
 *     从 issue 标题或提交信息里"造"一个名字，等于替这次变更决定它对外叫什么（§13.10.9
 *     同一条纪律：机械的那一半归脚本，判断的那一半归人）。
 *   · **只补那一格拒绝的**：这一格原本只会打印「先 `git checkout -b …`」然后退 1，
 *     于是脚本在「人还没分支」的时刻是旁观者。给了 `--branch` 才动 ref。
 *   · **不把人正在干的活搬走**：已经在**另一条**分支上时停（退 2）—— 那种情形里"建分支"
 *     多半是打错了旗标，而 `git checkout -b` 会把工作树与未提交改动一起带走。
 *   · **幂等**：已经在同名分支上就是「已经做过」，不动 ref、不落红。
 *
 * @param {{requested?: string | null, current: string, existsLocal?: boolean, existsRemote?: boolean}} input
 * @returns {{requested: boolean, act: boolean, code: number | null, branch: string, reason: string}}
 */
export function decideCreateBranch({
  requested = null,
  current,
  existsLocal = false,
  existsRemote = false,
}) {
  const name = (requested || "").trim();
  if (!name) {
    return {
      requested: false,
      act: false,
      code: null,
      branch: "",
      reason: "未要求建分支（--branch）。",
    };
  }
  if (name === "master" || name === "HEAD") {
    return {
      requested: true,
      act: false,
      code: CODE.RED,
      branch: name,
      reason: `分支名是「${name}」⇒ 停：本仓不许直连主干（硬规则 6），换一个名字。`,
    };
  }
  if (current === name) {
    return {
      requested: true,
      act: false,
      code: CODE.GREEN,
      branch: name,
      reason: `已经在 ${name} 上 ⇒ 这一格是幂等（不动 ref）。`,
    };
  }
  if (existsLocal || existsRemote) {
    return {
      requested: true,
      act: false,
      code: CODE.NOT_RUN,
      branch: name,
      reason:
        `${name} 已经存在（${existsLocal ? "本地" : "远端"} ref 查得到）⇒ 不覆盖、不切换：` +
        "接着那条分支干就先 `git checkout " +
        name +
        "` 再跑；要新开一条就换一个名字。",
    };
  }
  if (current && current !== "master" && current !== "HEAD") {
    return {
      requested: true,
      act: false,
      code: CODE.NOT_RUN,
      branch: name,
      reason:
        `当前在 ${current} 上，而 --branch 指的是 ${name} ⇒ 停：` +
        "本脚本不在分支之间搬工作树（那一步该由人看着未提交的改动做）。",
    };
  }
  return { requested: true, act: true, code: null, branch: name, reason: "" };
}

/**
 * 「这次跑完要不要把分支清掉」—— 同样只跟在**验真的合并**之后。
 *
 * 为什么默认关、且必须有 `landed.verified`：合并之后本地那条分支是这些提交**唯一的对象**
 * （squash 落进主干的是另一笔），删错了只能靠 reflog 或平台 PR 找回。而 `ship` 在合并那一跳
 * 已经拿到两件独立事实（PR 的 `is_merged` + 碎片真在主干顶端），只有拿着这两件才谈得上删。
 *
 * 只删**这一次跑的那条分支**：「把所有已合并分支一次清掉」需要另一套判据（squash 形态下
 * `git branch -d` 的祖先判据恒假，实测六条已合并分支全部不肯删），那不在本脚本的动作面里。
 *
 * @param {{requested: boolean, landedVerified: boolean, branch: string}} input
 * @returns {{act: boolean, code: number | null, branch: string, reason: string}}
 */
export function decideCleanBranch({ requested, landedVerified, branch }) {
  if (!requested) {
    return {
      act: false,
      code: null,
      branch: "",
      reason: "未要求清理分支（--clean-branch）。",
    };
  }
  if (!landedVerified) {
    return {
      act: false,
      code: CODE.NOT_RUN,
      branch,
      reason:
        "这一跳没有**验真的合并**（is_merged + 碎片在主干顶端）⇒ 本地那条分支是这些提交" +
        "唯一的对象，不许删",
    };
  }
  const name = (branch || "").trim();
  if (!name || name === "master" || name === "HEAD") {
    return {
      act: false,
      code: CODE.NOT_RUN,
      branch: name,
      reason: `要删的分支名不可用（「${name || "(空)"}」）⇒ 不猜名字、不删别的东西`,
    };
  }
  return { act: true, code: null, branch: name, reason: "" };
}

/**
 * PR 标题 / squash 那一行的取数 —— 只从给它的读数里推，不起进程。
 *
 * 为什么不是 `git log -1 --pretty=%s`：那一格取的是**这条分支当前顶端**那一笔，而本仓
 * 两条已上主干的行就是被它写坏的 —— 「先把 master 合进来再 `--merge`」把主干那一行写成
 * `Merge branch 'master' into fix/…`（#2057），「最后补一笔碎片」把它写成
 * `docs(changelog): 碎片按合流后的实际落地面重写`（#2055）。squash 之后读者看到的标题
 * 与这次变更的内容无关，而评审的第一件事就是读标题。
 *
 * 优先级（每一档都是可反转的一处，加旗标不改其余）：
 *   ① `--title` —— 人是权威：标题是判断，不该由拓扑决定；
 *   ② 这条分支相对主干带进来的**第一笔非常规提交** —— 一次 PR 一件事，那件事在
 *      分支开口那一笔就说清了；后面的碎片补笔 / 复核样本都是它的尾巴；
 *   ③ HEAD 那一笔 —— 分支上只剩合并节点时的退路，**读得出是退的**；
 *   ④ 空串 —— 两处都没有，交回空由调用方按「没跑起来」处理（不许编一个标题，
 *      也不许把 `--title ""` 发给平台建出一条没有标题的 PR）。
 *
 * @param {{subjects?: string[], head?: string, explicit?: string | null}} input
 *   `subjects` 是按 `git log --no-merges --reverse` 排好的分支自带提交 subject
 * @returns {{title: string, source: "flag" | "branch-first" | "head" | "none"}} 标题与它的来源
 */
export function deriveTitle({ subjects = [], head = "", explicit = null }) {
  const flag = (explicit || "").trim();
  if (flag) return { title: flag, source: "flag" };
  const first = subjects.map((s) => (s || "").trim()).filter(Boolean)[0] ?? "";
  if (first) return { title: first, source: "branch-first" };
  const h = (head || "").trim();
  if (h) return { title: h, source: "head" };
  return { title: "", source: "none" };
}

/**
 * 从 `git remote get-url origin` 里取 `org/repo`。
 *
 * 支持 https 与 ssh 两种形态；取不到就回 `null`，由调用方判「没跑起来」而不是
 * 猜一个仓库名 —— 猜错的代价是把 PR 开到别的仓库上。
 *
 * @param {string} remoteUrl `get-url` 的原文
 * @returns {string | null} 形如 `moon-read/comfy-app-t3`
 */
export function parseSlug(remoteUrl) {
  const s = (remoteUrl || "").trim().replace(/\/+$/, "");
  if (!s) return null;
  const m = s.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  return m ? (m[1] ?? null) : null;
}

/**
 * 「远端叫什么、主干基线是哪条」的推导 —— 唯一一份。
 *
 * 为什么要有这一件：这一版此前两处**写死 `origin`**（`git remote get-url origin` 与
 * `git diff origin/master...HEAD -- changelog.d`）。远端名与默认分支**都是每台克隆
 * 机器自己的事实**（`docs/audits/2026-10-12-architecture-risk-review.md` R12-01 记的
 * 正是这一格：并行检出里实测见过 `cnb`，而本检出 `git remote -v` 只有 `origin`）
 * ⇒ 写死哪一边都会在另一边失败。后果不是「少一句提示」：
 * 两条 git 命令都**失败**，而失败在这里长得与「答案为空」一模一样 ——
 * 碎片那一查拿到空串 ⇒ preflight 判「没有 changelog.d 碎片」⇒ **`pnpm ship` 在那台
 * 检出上从第一次跑起就没工作过**，且报的还是一条听起来正当的理由。
 *
 * ── 「上游」与「主干」不是同一件事（这一版栽过的第二格）──────────────
 *
 * `@{u}` 回答的是「这条分支在跟踪谁」。而 `git push -u origin feat/x` 把上游设成
 * **这条分支自己在远端的副本**（`origin/feat/x`）—— 于是拿 `@{u}` 当基线就是
 * `feat/x...HEAD`＝**自己与自己比** ⇒ 恒空 ⇒ 碎片那一查报 0 份 ⇒
 * 「每次推送之后重新跑都被拒」，而 `pnpm ship --merge` 正是推送之后的那一次跑。
 * 所以顺序是「先问它是不是自己」，再退回主干那三条事实。
 *
 * 四档来源，顺序有理由：
 *   ① `@{u}` **且它的分支段不是本地分支自己** —— 那是人显式设的比较目标
 *      （往 release 线开 PR 就是这一形），最贴事实，不许被默认分支顶掉；
 *   ② `refs/remotes/<远端>/HEAD` —— 远端默认分支，git 本地就有这条符号引用，零网络；
 *   ③ 唯一远端 + `<远端>/master` —— 新建分支还没上游、且这台克隆没设过 remote HEAD
 *      时的合理推法，**打印时标明是推的**（默认分支不叫 master 时它会偏，但偏了会被
 *      下面那条「基线引用不存在 ⇒ 退 2」的判据当场抓住，不会静默变成「没有碎片」）；
 *   ④ 多个远端且没有上游 ⇒ 交回 `origin`（历史习惯），再没有就给 `null` ——
 *      调用方必须按「没有执行者」处理，不许拿空 diff 冒充结论。
 *
 * @param {{
 *   upstream?: string | null,
 *   remotes?: string[],
 *   localBranch?: string | null,
 *   remoteHead?: string | null,
 * }} input 四条读数（后两条可缺）
 * @returns {{remote: string | null, base: string | null, source: "upstream" | "remote-head" | "sole-remote" | "origin" | "none"}}
 */
export function resolveUpstream({
  upstream,
  remotes = [],
  localBranch = null,
  remoteHead = null,
}) {
  const named = remotes.map((r) => (r || "").trim()).filter(Boolean);
  const u = (upstream || "").trim();
  const slash = u.indexOf("/");
  const remoteFromUpstream = slash > 0 ? u.slice(0, slash) : null;
  const upstreamBranch = slash > 0 ? u.slice(slash + 1) : "";
  if (remoteFromUpstream && upstreamBranch) {
    /* 上游分支段 == 本地分支名 ⇒ 那是这条分支在远端的副本，不是比较目标。
     * `localBranch` 取不到时按①处理：那是「不知道」，不是「相等」，
     * 不该把一份缺的读数升级成一条否定。 */
    const selfCopy = Boolean(localBranch) && upstreamBranch === localBranch;
    if (!selfCopy) {
      return {
        remote: remoteFromUpstream,
        base: u,
        source: "upstream",
      };
    }
    const trunk = trunkFromRemoteHead(remoteFromUpstream, remoteHead);
    if (trunk)
      return { remote: remoteFromUpstream, base: trunk, source: "remote-head" };
    return {
      remote: remoteFromUpstream,
      base: `${remoteFromUpstream}/master`,
      source: "sole-remote",
    };
  }
  const sole =
    named.length === 1
      ? (named[0] ?? null)
      : named.includes("origin")
        ? "origin"
        : null;
  if (!sole) return { remote: null, base: null, source: "none" };
  const trunk = trunkFromRemoteHead(sole, remoteHead);
  if (trunk) return { remote: sole, base: trunk, source: "remote-head" };
  return {
    remote: sole,
    base: `${sole}/master`,
    source: named.length === 1 ? "sole-remote" : "origin",
  };
}

/**
 * 从 `refs/remotes/<远端>/HEAD` 那条符号引用里取出主干 ref。
 *
 * 只认「前缀对得上这个远端」的那一条：拿另一台远端的默认分支当基线，比对的是
 * 别的仓库的历史，而这一格的失败形态又是一条空 diff（不是报错）。
 *
 * @param {string} remote 远端名
 * @param {string | null | undefined} remoteHead `git symbolic-ref` 的原文
 * @returns {string | null} 形如 `cnb/master`；取不到时 null
 */
function trunkFromRemoteHead(remote, remoteHead) {
  const prefix = `refs/remotes/${remote}/`;
  const s = (remoteHead || "").trim();
  if (!s.startsWith(prefix)) return null;
  const branch = s.slice(prefix.length);
  return branch ? `${remote}/${branch}` : null;
}

/**
 * 读 PR JSON 的判决字段（同样只读 `data.*`）。
 *
 * @param {{data?:{number?:number|string,mergeable_state?:string,blocked_on?:string,is_merged?:boolean,state?:string}} | null} json 解析结果
 * @returns {{number:number|null,mergeableState:string,blockedOn:string,isMerged:boolean,state:string}} 归一后的字段
 */
export function readPullVerdict(json) {
  const d = (json && json.data) || {};
  return {
    number: d.number === undefined ? null : Number(d.number),
    mergeableState: String(d.mergeable_state ?? "unknown"),
    blockedOn: String(d.blocked_on ?? ""),
    isMerged: d.is_merged === true,
    state: String(d.state ?? "unknown"),
  };
}

/**
 * 从 `cnb pulls list-pulls -v` 的 JSON 里按 head 分支名找已存在的 PR（幂等用）。
 *
 * @param {any} json 解析结果（外部形状，可能是裸数组也可能是 `{data:[…]}`）
 * @param {string} branch 源分支名（不含 `refs/heads/`）
 * @returns {number | null} 命中则给 PR 号
 */
export function findPullForBranch(json, branch) {
  const raw = json && json.data;
  const list = Array.isArray(raw)
    ? raw
    : raw && Array.isArray(raw.data)
      ? raw.data
      : [];
  for (const p of list) {
    const ref = String((p && p.head && p.head.ref) || "");
    if (ref === `refs/heads/${branch}`) return Number(p.number);
  }
  return null;
}

/**
 * 把 `changelog.d/` 里的碎片标题拼成 PR 正文的**事实部分**。
 *
 * 只搬「盘上已有的字」：段落标题 + 碎片文件名。不写因果、不写「已验证」那类声明
 * （`check-commit-claims.mjs` 会拿提交树复核句式，而 PR 正文迟早会被抄进合并信息）。
 *
 * @param {{root:string,fragments:string[],diffstat:string,handle?:string|null}} input 量到的事实
 *   与这一跑的留痕短名（ISSUE #2204：正文开头一行 `**[评论人：<短名>]**`，未配写「未配」）
 * @returns {string} 正文
 */
export function buildPullBody({ root, fragments, diffstat, handle = null }) {
  const lines = [
    commentHeader(handle),
    "",
    "## 本 PR 带的变更碎片（`changelog.d/`）",
    "",
  ];
  for (const f of fragments) {
    // 首行的读法只有一处（`fragmentHead`）：两处各读各的，就会开始对同一份碎片给两种答案。
    lines.push(`- \`${f}\` → ${fragmentHead(root, f) || "(读不到)"}`);
  }
  lines.push(
    "",
    "## 改动量（`git diff --stat` 对上游）",
    "",
    "```",
    diffstat || "(空)",
    "```",
    "",
  );
  lines.push(
    "> 本段由 `pnpm ship` 拼装，内容全部是它当场量到的事实（碎片标题与 diffstat）。",
    "> 判断、读数与因果请写在下面的正文里 —— 脚本不代写；开头那行「评论人」只是" +
      "这一跑的留痕，不是对正文的判断背书。",
  );
  return lines.join("\n");
}

/**
 * 识别「这条提交信息已经被 `pnpm run` 压成一行」的形状 —— 只判形状，不判内容。
 *
 * 形状从哪来的（本仓实测，两个出口行为不同）：
 *   · `pnpm exec node -e …  "一行<换行>二行"` ⇒ 收到**真换行**；
 *   · `pnpm ship --message "一行<换行>二行"`（即 `pnpm run ship`）⇒ node 手里已成
 *     字面量 `\n`，屏幕上那条回显 `node scripts/ship.mjs "--message" "一行\n二行"` 就是证据。
 * 后果不是「排版难看」：整条信息变成**一行 subject**，而 PR 标题取的就是
 * `git log -1 --pretty=%s` —— 实测那样一份标题被平台拒（响应可解析、`data` 里没有号）。
 *
 * 判据故意保守：**必须**同时满足「没有真换行」与「出现字面量 `\n`」。
 * 单行且不含 `\n` 的正常提交信息不受影响；真换行在的信息（`--message-file` 读出来的、
 * `pnpm exec` 传进来的）也不受影响。代价是一种误判：一行散文里恰好写了字面量 `\n`
 * 且没有真换行 —— 那会被拦下，而拦下的话术直接给出两条出口，不是死路。
 *
 * @param {string | null | undefined} msg 拿到的提交信息原文
 * @returns {boolean} 命中改写形状时为 true
 */
export function looksNewlineMangled(msg) {
  if (!msg) return false;
  return !msg.includes("\n") && msg.includes("\\n");
}

/**
 * `--dry-run` 的命令计划。它打印的就是真跑时会执行的同一份 argv ——
 * 这是量具自证：计划与执行分叉，说明有人在两处各写一遍（`tests/ship.test.ts`
 * 拿「模块+工具对同集合」逐条对账钉着这件事）。
 *
 * ⚠️ 它**不**保证恒退 0：dry-run 免掉的是「执行写动作」，不免掉「报出阻塞」。
 * 正在 `master` 上、或缺 `changelog.d/` 碎片时照样退 1 —— 一个会藏掉阻塞事实的
 * 预览比不预览更糟。
 *
 * @param {{branch:string,sha:string,slug:string,adds:string[],hasMessage:boolean,merge:boolean,closeIssue?:boolean,cleanBranch?:boolean,reap?:boolean,handle?:string|null,claim?:number|null,release?:number|null,claims?:boolean,newIssue?:boolean,diagnose?:boolean,createBranch?:string|null,remote?:string|null,baseBranch?:string|null}} st 当前状态
 * @returns {string[]} 逐条命令
 */
export function planCommands(st) {
  const p = [];
  const remote = st.remote || "origin";
  const trunk = st.baseBranch || "master";
  /* 建分支排在最前面：它是 `--branch` 唯一能改变形状的一格（不在分支上时，后面每一跳
   * 的分支名都取自它）。给了旗标才出现 —— 与合并/关单同一档：默认那份计划里没有这一步。 */
  if (st.createBranch) p.push(`git checkout -b ${st.createBranch}`);
  p.push("git rev-parse --abbrev-ref HEAD");
  p.push("git status --porcelain");
  /* 碎片那一查的**两条**取数都要在计划里出现：执行面是「分支相对主干已提交的 ∪
   * 还没提交的」（#2034 收到并集后就没有 `git ls-files` 这一查了）。计划里留着那条
   * 已经没人执行的命令，等于让 dry-run 教给读者一个取数面 —— 而它恰恰是那次误判的
   * 来源（`ls-files` 数的是目录存量 118 份，恒真）。 */
  p.push(`git diff --name-only ${remote}/${trunk}...HEAD -- changelog.d`);
  p.push("git status --porcelain -- changelog.d");
  p.push("node scripts/check-deps-freshness.mjs");
  for (const a of st.adds) p.push(`git add -- ${a}`);
  if (st.hasMessage) p.push("git commit --message=<提交信息原文>");
  /* 远端名与主干分支都来自解析（`resolveUpstream`），不写死 `origin` / `master` ——
   * 两处都是每台克隆自己的事实，写死时计划与执行两头一起错。 */
  p.push(`git push -u ${remote} ${st.branch}`);
  p.push(`cnb pulls list-pulls --repo ${st.slug} --state open -v`);
  p.push(
    `cnb pulls post-pull --repo ${st.slug} --base ${trunk} --head ${st.branch} --head-repo ${st.slug} --title … --body-file <git目录>/comfy-ship-tmp/ship-pr-body-<pid>.tmp -v`,
  );
  /* 标签与回读是**一对**：只写「打标签」就把「回执即结论」教给读者，而这一族
   * 从不采信回执（ISSUE #2204）。未配留痕时这两条都不执行，所以按 handle 出现。
   * PR 上的角色是「处理人」（谁在推进这条 PR），与单子上的「提单人」分成两个前缀。 */
  if (st.handle) {
    p.push(
      `cnb pulls post-pull-labels --repo ${st.slug} --number <n> --labels 处理人:${st.handle} -v`,
    );
    p.push(`cnb pulls list-pull-labels --repo ${st.slug} --number <n> -v`);
  }
  /* 单子的领取 / 结束 / 列表是三条**独立动作**（`ship.mjs` 在 preflight 之前就分出去），
   * 这里的计划只服务于「源码里每一个 cnb 工具都有一条对应的计划行」那本账：
   * 对账用例把三个旗标一起拨上，任何一侧新增调用而另一侧没跟都会红。
   * 写标签 / 评论一律**后跟独立回读** —— 回执不算结论。 */
  if (st.claim != null) {
    const who = st.handle || "<短名>";
    p.push(
      `cnb issues get-issue --repo ${st.slug} --number ${st.claim} -v`,
    );
    p.push(
      `cnb issues post-issue-labels --repo ${st.slug} --number ${st.claim} --labels 处理人:${who} -v`,
    );
    p.push(
      `cnb issues post-issue-labels --repo ${st.slug} --number ${st.claim} --labels 参与人:${who} -v（只增不删的经手记录）`,
    );
    p.push(
      `cnb issues get-issue --repo ${st.slug} --number ${st.claim} -v（写后回读：两枚标签都看得见才念「已打上」）`,
    );
    p.push(
      `cnb issues post-issue-comment --repo ${st.slug} --number ${st.claim} --body-file <git目录>/comfy-ship-tmp/ship-issue-comment-<pid>.tmp -v`,
    );
    p.push(
      `cnb issues list-issue-comments --repo ${st.slug} --number ${st.claim} --sort -created --page-size 100 -v`,
    );
  }
  if (st.release != null) {
    const who = st.handle || "<短名>";
    p.push(
      `cnb issues get-issue --repo ${st.slug} --number ${st.release} -v`,
    );
    p.push(
      `cnb issues list-issue-comments --repo ${st.slug} --number ${st.release} --sort -created --page-size 100 -v`,
    );
    p.push(
      `cnb issues post-issue-comment --repo ${st.slug} --number ${st.release} --body-file <git目录>/comfy-ship-tmp/ship-issue-comment-<pid>.tmp -v`,
    );
    p.push(
      `cnb issues list-issue-comments --repo ${st.slug} --number ${st.release} --sort -created --page-size 100 -v`,
    );
    p.push(
      `cnb issues delete-issue-label --repo ${st.slug} --number ${st.release} --name 处理人:${who} -v`,
    );
    p.push(
      `cnb issues get-issue --repo ${st.slug} --number ${st.release} -v（撤后回读：看不见那枚才念「已释放」）`,
    );
  }
  if (st.claims) {
    const who = st.handle || "<短名>";
    p.push(
      `cnb issues list-issues --repo ${st.slug} --labels 处理人:${who} --state open --page <p> --page-size 100 -v`,
    );
  }
  /* 建单是**两条**命令：实测 `create-issue --labels` 不落地（回读 labels 为空），
   * 标签只能在建完之后按。两条都进计划，单子上才不会出现「只建了单、没留痕」的出口。 */
  if (st.newIssue) {
    p.push(
      `cnb issues create-issue --repo ${st.slug} --title … --body-file <git目录>/comfy-ship-tmp/ship-issue-body-<pid>.tmp --priority <P0|P1|P2|P3> -v`,
    );
    if (st.handle) {
      p.push(
        `cnb issues post-issue-labels --repo ${st.slug} --number <n> --labels 提单人:${st.handle} -v`,
      );
    }
    p.push(`cnb issues get-issue --repo ${st.slug} --number <n> -v（建后回读：标题 / 优先级 / 标签）`);
  }
  p.push(`cnb build get-build-logs --repo ${st.slug} -v`);
  p.push(`cnb build get-build-status --repo ${st.slug} --sn <sn> -v`);
  /* 红格的日志正文只有按格取得到（`get-build-stage` 的 `data.content`）。它只在
   * `--diagnose` 下被执行 —— 默认那份计划里不出现，否则 dry-run 教的执行面比请求的大。 */
  if (st.diagnose) {
    p.push(
      `cnb build get-build-stage --repo ${st.slug} --sn <sn> --pipelineId <pipelineId> --stageId <stageId> -v`,
    );
  }
  p.push(`cnb pulls get-pull --repo ${st.slug} --number <n> -v`);
  if (st.merge)
    p.push(
      `cnb pulls merge-pull --repo ${st.slug} --number <n> --merge-style squash --commit-title "… (#<n>)" -v`,
    );
  /* 阶段 7 也是**伸手改世界**的那一类，所以它在计划里必须看得见 —— 与合并同一档：
   * 不显式给 `--close-issue` 就不出现。`get-issue` 那一条是回读（独立一问），
   * 它不在 WRITE_SHAPES 里，但同样要出现在计划中，否则 dry-run 教的执行面是缺一块的。 */
  if (st.closeIssue) {
    p.push(
      `cnb issues update-issue --repo ${st.slug} --number <n> --state closed --state-reason completed -v`,
    );
    p.push(`cnb issues get-issue --repo ${st.slug} --number <n> -v`);
  }
  /* 清理那一跳的**四条**都要出现在计划里：两条是动作，两条是回读。只写动作不写回读，
   * dry-run 就把「回执即结论」这个形状教给读者 —— 而这一族从不采信回执。 */
  if (st.cleanBranch) {
    p.push(`git push ${remote} --delete ${st.branch}`);
    p.push(`git ls-remote --heads ${remote} ${st.branch}`);
    p.push(`git branch -D ${st.branch}`);
    p.push(`git show-ref --verify --quiet refs/heads/${st.branch}`);
  }
  /* 收尾回收也在计划里看得见。pid 是当场从归属判据取的，所以这一行按**形状**写 ——
   * 计划教的是「这一跳会发哪类命令、收完还要回读哪一句」，不是假装预先知道 pid。 */
  if (st.reap) {
    p.push(
      "node scripts/reap-process.mjs <pid>（逐个；pid 只取 runningAppInstances 里 via port 那批）",
    );
    p.push(
      "再读一次 runningAppInstances 作为回读 —— 回读说还在 ⇒ 红；via session ⇒ 这一格不收、落 2",
    );
  }
  return p;
}

/**
 * 读 pre-push 落的合并前证明（机器本地、**不入库**，见 `premerge-proof.mjs`）。
 *
 * @param {string} root 仓库根
 * @param {(cwd?:string)=>string | null} [resolve] git 目录解析器 —— 默认那份唯一实现；
 *   调用方注入了自己的解析器时**必须一起传进来**，否则这一格读的是这台机器的真实 `.git`
 * @returns {{headSha?:string,upstreamSha?:string,verifiedAt?:string,baselineRed?:string[]} | null} 取不到回 null
 */
export function readProof(root, resolve = resolveGitDir) {
  /* git 目录的解析不在这里重做 —— 唯一实现见 `scripts/git-dir.mjs`。
   * 这里此前自己判「`.git` 是文件就当指针读」，只覆盖 worktree 那一种，
   * `GIT_DIR` 与裸仓库一个都不认；手写一份弱化的同一件事，比不写更难被发现。
   *
   * `resolve` 是这一次跑**已经注入的那一份**解析器：证明的读取也归它管，否则
   * 注入只覆盖临时文件那一半，另一半点的是这台机器真实的 `.git` —— 「同一次跑里
   * git 目录指哪儿」就会有两套答案（用例里表现为本地绿、节点红）。 */
  const gitDir = resolve(root);
  if (!gitDir) return null;
  try {
    return JSON.parse(
      fs.readFileSync(path.join(gitDir, "comfy-premerge-proof.json"), "utf8"),
    );
  } catch {
    return null;
  }
}
