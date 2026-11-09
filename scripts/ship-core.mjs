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
 * 已经越过 `check-infra-file-size.cjs` 那 900 行硬闸（AGENTS 硬规则 22）。
 *
 * 「build 读数」那一族（按 sha 归属构建 / 轮询签名 / 三态判定 / `asArray`）同样按这条线
 * 分了出去，在 `ship-build.mjs`：它服务的是一条 build 自己的读法，与 PR / git 的形状各自
 * 独立变化，放在同一份文件里只会在下一次加字段时再撞一次 900 行。
 *
 * 「PR 正文那一格」（碎片清单 + 碎片原文 + `git diff --stat` 的摘要与封顶）按同一条线分在
 * `ship-pull-body.mjs`：它只回答「发给平台的正文长什么样」，与这里的「外部执行者的形状」
 * 各自变化（ISSUE #2248 落地时这份文件又到了 906 行 —— 那正是上面两段写过的失效形态）。
 */
import fs from "node:fs";
import path from "node:path";

import { resolveGitDir } from "./git-dir.mjs";
import { prBodyPlanLines } from "./ship-pull-body.mjs";
import { CODE } from "./ship-codes.mjs";
import { cnbData, cnbRecords } from "./cnb-fields.mjs";

/* 退出码表的**唯一出处**是 `ship-codes.mjs`（ISSUE #3083：三态扩成 0–7 的分型表，
 * 「没跑起来」细分为冲突 / 排队 / 读数缺失 / 守卫 / 预检五类，2 的压栈语义不变）。
 * 这里只做转口 —— 历史 import 面（`from "./ship-core.mjs"`）一处都不用改。 */
export { CODE, CODE_TABLE, codeTag, combineShipCodes } from "./ship-codes.mjs";

/* 清单类平台接口（`list-pulls` / `get-build-logs`）的翻页口径：**一份**，两处共用 ——
 * `ship-platform.mjs` 的 `scanPullPages`（复用/落地判定，ISSUE #2964）与
 * `ci-build-readout.mjs` 的 `resolveBuildSn`（按 HEAD 归属，ISSUE #2950）。
 * 语义是「有界扫，扫不到照实回，不假装没有」；改这里同时动两处，正是要的效果 ——
 * 分开各写一份时，下次调一处漏一处的形状已经撞过两次。 */
/** 每页条数。 */
export const LIST_PAGE_SIZE = 20;
/** 翻页上界：5 页 = 100 条。到顶会明说「已翻 N 页」，不把截断念成全部。 */
export const LIST_MAX_PAGES = 5;

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
  const name = (requested ?? "").trim();
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
        `接着那条分支干就先 \`git checkout ${name}\` 再跑；要新开一条就换一个名字。`,
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
 * push 失败的**现场分型** —— 只读 push 自己吐回来的原话，不猜。
 *
 * 为什么要分型（ISSUE #2825 的现场）：远端回 `Repository Not Found`（exit 128）的那一跳，
 * pre-push 复算根本没跑过 —— 固定说「多半是 premerge」会把人引去查一条没执行的门禁，
 * 而真因（git 凭据失效）藏在被顶掉的输出里。两类失败的修法完全不同：
 *   · `remote` —— 服务端拒了（凭据 / 仓库可达性）：stderr 带 `remote:` 前缀，或
 *     `Repository Not Found` / `仓库不存在` / `Authentication failed` /
 *     `could not read Username` 这类原话；
 *   · `hook` —— pre-push 钩子拒了：钩子的输出（本仓钩子带 `[pre-push]` 抬头）会
 *     被 git 原样转发到 push 的输出里；
 *   · `unknown` —— 两类特征都没有 ⇒ 不编因，让读的人看原话。
 *
 * 两类特征**同时**在场时按 `remote` 判：钩子跑过但放行、随后传输被服务端拒，
 * 终止原因是服务端那一跳；钩子真拒了就不会走到传输。
 *
 * @param {string | null | undefined} stdout push 的 stdout
 * @param {string | null | undefined} stderr push 的 stderr（远端 / 钩子的原话都在这一侧）
 * @returns {{kind: "remote" | "hook" | "unknown", note: string}} 分型与给人看的下一动作
 */
export function classifyPushFailure(stdout, stderr) {
  const text = `${stdout ?? ""}\n${stderr ?? ""}`;
  const remoteHit =
    /(?:^|\n)\s*remote:/.test(text) ||
    text.includes("Repository Not Found") ||
    text.includes("仓库不存在") ||
    text.includes("Authentication failed") ||
    text.includes("could not read Username");
  if (remoteHit) {
    return {
      kind: "remote",
      note:
        "远端拒了（凭据 / 仓库可达性那一类）⇒ premerge 与本仓门禁都无关；" +
        "先查 git 凭据与远端权限（cnb：可走 `cnb git-credential` helper），别去翻门禁日志。",
    };
  }
  if (text.includes("[pre-push]")) {
    return {
      kind: "hook",
      note: "pre-push 的合并前复算没放行（钩子原话在上面）。先修，或按 §13.6.2 复算归属。",
    };
  }
  return {
    kind: "unknown",
    note: "输出里没有可分辨的远端 / 钩子特征 ⇒ 看上面的 push 原话定因，不猜。",
  };
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
 *   ② **平台上这条 PR 的现标题**（合并那一跳才给得到，ISSUE #2806）—— 复用一条
 *      已在平台上改过标题的 PR 时，branch-first 推导与 PR 的实际内容早已分家，
 *      squash 那一行照它写，主干上就落一条「标题与内容不符」的历史。平台上读者
 *      第一眼读的就是 PR 标题，它与 squash 那一行本该是同一句；
 *   ③ 这条分支相对主干带进来的**第一笔非常规提交** —— 一次 PR 一件事，那件事在
 *      分支开口那一笔就说清了；后面的碎片补笔 / 复核样本都是它的尾巴；
 *   ④ HEAD 那一笔 —— 分支上只剩合并节点时的退路，**读得出是退的**；
 *   ⑤ 空串 —— 两处都没有，交回空由调用方按「没跑起来」处理（不许编一个标题，
 *      也不许把 `--title ""` 发给平台建出一条没有标题的 PR）。
 *
 * @param {{subjects?: string[], head?: string, explicit?: string | null, platform?: string | null}} input
 *   `subjects` 是按 `git log --no-merges --reverse` 排好的分支自带提交 subject；
 *   `platform` 是平台上这条 PR 的现标题（只有合并那一跳会回读它，建 PR 时没有）
 * @returns {{title: string, source: "flag" | "platform" | "branch-first" | "head" | "none"}} 标题与它的来源
 */
export function deriveTitle({ subjects = [], head = "", explicit = null, platform = null }) {
  const flag = (explicit ?? "").trim();
  if (flag) {
    return { title: flag, source: "flag" };
  }
  const plat = (platform ?? "").trim();
  if (plat) {
    return { title: plat, source: "platform" };
  }
  const first = subjects.map((s) => (s || "").trim()).filter(Boolean)[0] ?? "";
  if (first) {
    return { title: first, source: "branch-first" };
  }
  const h = (head || "").trim();
  if (h) {
    return { title: h, source: "head" };
  }
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
  if (!s) {
    return null;
  }
  const m = s.match(/[:/](?<slug>[^/]+\/[^/]+?)(?:\.git)?$/);
  return m ? (m.groups?.slug ?? null) : null;
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
export function resolveUpstream({ upstream, remotes = [], localBranch = null, remoteHead = null }) {
  const named = remotes.map((r) => (r ?? "").trim()).filter(Boolean);
  const u = (upstream ?? "").trim();
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
    if (trunk) {
      return { remote: remoteFromUpstream, base: trunk, source: "remote-head" };
    }
    return {
      remote: remoteFromUpstream,
      base: `${remoteFromUpstream}/master`,
      source: "sole-remote",
    };
  }
  const sole = named.length === 1 ? (named[0] ?? null) : named.includes("origin") ? "origin" : null;
  if (!sole) {
    return { remote: null, base: null, source: "none" };
  }
  const trunk = trunkFromRemoteHead(sole, remoteHead);
  if (trunk) {
    return { remote: sole, base: trunk, source: "remote-head" };
  }
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
  const s = (remoteHead ?? "").trim();
  if (!s.startsWith(prefix)) {
    return null;
  }
  const branch = s.slice(prefix.length);
  return branch ? `${remote}/${branch}` : null;
}

/**
 * `is_merged` 原值的三态分型（ISSUE #3059）：平台应答间歇缺这一键，
 * `=== true` 会把「没取到」读成「未合并」—— 缺键 / null / 非布尔一律 `unknown`，
 * **不按 false 处理**（与 `classifyPrMergeable` 对 `mergeable_state` 的口径同族）。
 *
 * @param {unknown} v 平台 `data.is_merged` 的原值
 * @returns {"merged"|"not_merged"|"unknown"}
 */
export function classifyIsMerged(v) {
  if (v === true) {
    return "merged";
  }
  if (v === false) {
    return "not_merged";
  }
  return "unknown";
}

/**
 * 读 PR JSON 的判决字段（同样只读 `data.*`）。
 *
 * @param {{data?:{number?:number|string,mergeable_state?:string,blocked_on?:string,is_merged?:boolean,state?:string,title?:string,base?:{ref?:string}}} | null} json 解析结果
 * @returns {{number:number|null,mergeableState:string,blockedOn:string,isMerged:boolean,isMergedTri:"merged"|"not_merged"|"unknown",state:string,title:string,baseBranch:string}} 归一后的字段
 *   `title` 是平台上这条 PR 的**现标题**（合并那一跳取 squash 标题要用它，ISSUE #2806）。
 *   `baseBranch` 是平台 `base.ref` 去 `refs/heads/` 后的分支名（ISSUE #3021：标题与
 *   diffstat 的区间跟它走，不跟本地 upstream）。缺键给空串，调用方按「取不到」处理。
 *   `isMerged` 是 `isMergedTri === "merged"` 的派生展示值；判读走 `isMergedTri`（ISSUE #3059）。
 */
export function readPullVerdict(json) {
  /* 信封解包走单一出处（ISSUE #3060）：「data 缺了」与「拆错层」在这里分型。 */
  /* 信封解包走单一出处（ISSUE #3060）；返回值按 JSDoc 的既有形状收窄。 */
  const d = /** @type {import("./cnb-fields.mjs").CnbPullData | null} */ (cnbData(json)) ?? {};
  const tri = classifyIsMerged(d.is_merged);
  return {
    number: d.number === undefined ? null : Number(d.number),
    mergeableState: String(d.mergeable_state ?? "unknown"),
    blockedOn: String(d.blocked_on ?? ""),
    isMerged: tri === "merged",
    isMergedTri: tri,
    state: String(d.state ?? "unknown"),
    title: String(d.title ?? ""),
    baseBranch: String(d.base?.ref ?? "").replace(/^refs\/heads\//, ""),
  };
}

/**
 * PR 可合并读数的三态分型（ISSUE #3083）。
 *
 * 为什么必须分型：「没有 build」在冲突 PR 上的真因是平台**永远不会**派生构建，
 * 而它与「还在排队」在读数上长得一样（#3075 现场：建 PR 时 `mergeable_state=conflict`，
 * 解完冲突 push 后 CI 才起跑）。`mergeable_state` **缺键**按 #3059 的口径处理 ——
 * `readPullVerdict` 已把它归一为 `"unknown"`，这里落到第三态，既不拿它当「可合并」，
 * 也不拿它当「冲突」（`=== true` 式的误读在缺键读数上给出的全是假结论）。
 *
 * @param {{mergeableState:string, blockedOn:string} | null} pv
 *   `readPullVerdict` 的归一结果（回读本身没跑起来时为 null）
 * @returns {"conflict"|"mergeable"|"unknown"}
 *   `conflict` 与 base 冲突（平台不派生 CI）· `mergeable` 明确可合并 ·
 *   `unknown` 缺键 / 平台还在算 / 取不到 —— 不猜
 */
export function classifyPrMergeable(pv) {
  if (!pv) {
    return "unknown";
  }
  if (pv.mergeableState === "conflict" || pv.blockedOn === "code_conflict") {
    return "conflict";
  }
  if (pv.mergeableState === "mergeable") {
    return "mergeable";
  }
  return "unknown";
}

/**
 * 冲突出口的话术（只有一份，ISSUE #3083）。
 *
 * 五格（建 PR 后 / 轮询 / 判决 / 合并前 / `--diagnose`）念的「下一步」必须是同一
 * 份：各写一份的漂移形态是「改一处漏四处」，而出口命令恰恰是最不能漂移的那一句。
 * 只做引导、不做动作：解冲突是人工取舍（#3075 的 8 份冲突要人判），脚本一次也不
 * 替人 merge / push。
 *
 * @param {{number:any, baseRef:string|null}} ctx
 *   `baseRef` 是解析出的主干基线（如 `origin/master`）；取不到时给占位写法，
 *   不猜一个远端名（远端叫什么、基线是哪条是每台克隆自己的事实）。
 * @returns {string[]} 逐行话术（调用方逐行 log）
 */
export function conflictAdviceLines({ number, baseRef }) {
  const merge = baseRef
    ? `git fetch ${baseRef.split("/")[0]} && git merge ${baseRef}`
    : "git fetch <远端> && git merge <远端>/<主干>   # 基线引用取不到，按你这份检出的事实替换";
  return [
    "[ship]   出口（人工解冲突 —— 取舍要人判，脚本不自动改代码）：",
    `[ship]     ${merge}   # 逐个文件解完，提交`,
    `[ship]     git push   # 推新 sha ⇒ 平台随即为 PR #${number} 派生 CI`,
    "[ship]     pnpm ship  # 重跑：PR 已存在会复用（不重建），接着等 CI",
  ];
}

/**
 * 从「建 PR 的响应」里取**平台自己给的**拒绝理由（`errcode` / `errmsg`）。
 *
 * 为什么要单独念一句：这一格的收尾话术只会说「响应里没有 PR 号 ⇒ 没跑起来」，
 * 而**为什么**没有号写在 `data.errcode` / `data.errmsg` 里（实测 2000003
 * `body length exceeded the limit 65,535`，ISSUE #2248）。响应原文本来也会转述，
 * 但那一句是按**字符**截的 —— 把外部拒绝的理由押在截断窗口里，就是让下一个执行者
 * 重新查一遍已经量到的事。
 *
 * 只认这两个键名，不猜别的（`message` 那类同名字段在成功响应里可能是别的意思）。
 *
 * @param {any} json 响应解析结果
 * @returns {{errcode: string, errmsg: string} | null} 两件都没有时 null（不编一个理由）
 */
export function readPullCreateError(json) {
  if (!json || typeof json !== "object") {
    return null;
  }
  const d = json.data && typeof json.data === "object" ? json.data : {};
  const errcode = json.errcode ?? d.errcode;
  const errmsg = json.errmsg ?? d.errmsg;
  if (errcode === undefined && errmsg === undefined) {
    return null;
  }
  return { errcode: String(errcode ?? ""), errmsg: String(errmsg ?? "") };
}

/**
 * 从 `cnb pulls list-pulls -v` 的 JSON 里按 head 分支名找**那条 PR 记录**。
 *
 * 匹配形状只在这里有一份：平台给的是 **`head.ref = "refs/heads/<分支名>"`**，
 * 拿裸分支名去比会**全条落空**，而那份空读数的长相与「这些分支没提过 PR」逐字相同
 * （实测九条已合并分支第一次就这么被判成「都没找到」—— ISSUE #2427）。
 *
 * @param {any} json 解析结果（外部形状，可能是裸数组也可能是 `{data:[…]}`）
 * @param {string} branch 源分支名（不含 `refs/heads/`）
 * @returns {any | null} 命中的那条记录（`number` / `is_merged` / `state` / `merged_by` 都从它读）
 */
export function pullRecordForBranch(json, branch) {
  const list = cnbRecords(json);
  for (const p of list) {
    /* head 是平台给的（形状不在本仓手里），按信封收窄后取 ref。 */
    const head = /** @type {{ref?: string} | null} */ (
      typeof p.head === "object" && p.head !== null ? p.head : null
    );
    const ref = typeof head?.ref === "string" ? head.ref : "";
    if (ref === `refs/heads/${branch}`) {
      return p;
    }
  }
  return null;
}

/**
 * 从 `cnb pulls list-pulls -v` 的 JSON 里按 head 分支名找已存在的 PR（幂等用）。
 *
 * @param {any} json 解析结果（外部形状，可能是裸数组也可能是 `{data:[…]}`）
 * @param {string} branch 源分支名（不含 `refs/heads/`）
 * @returns {number | null} 命中则给 PR 号
 */
export function findPullForBranch(json, branch) {
  const rec = pullRecordForBranch(json, branch);
  return rec ? Number(rec.number) : null;
}

/**
 * 「这一笔 sha 是不是已经随某条**已合并**的 PR 落进主干」（ISSUE #2250）。
 *
 * 上面那条幂等只认**开放** PR：squash 合并成功那一刻 PR 转 `closed`，于是同一条分支上
 * 再跑一次 ship 会走「没有就建」，长出一条内容已在主干的幽灵 PR（能被再合一次、
 * 白烧一轮 CI）。这一格认的是平台的正面事实：`is_merged === true` 那条上的
 * `head.sha` 与这一笔逐字相等 —— squash 改的是主干那笔的 sha，分支头那笔在 PR 记录里留着。
 *
 * 与 `ship-close.mjs` 的落地反查同一条取法：列表的 `--state` 没有 `merged` 这一档，
 * `closed` 里混着「合了」与「关了没合」，所以只认逐条 `is_merged`，不认状态词。
 *
 * @param {any} json `list-pulls --state closed` 的原样 JSON
 * @param {string} headSha 本地 HEAD 的 sha
 * @param {{unknownPr?: number|null} | null} [sink] 可选出站口：head.sha 逐字相同、
 *   而 `is_merged` **缺键 / null / 非布尔**的那条经它报出（`unknownPr` = 那条的号）——
 *   缺键不按「未合并」处理（ISSUE #3059），判读留给调用方（落地守卫按读数缺失收口）。
 * @returns {number | null} 命中的 PR 号；认不出（含空 sha）时 `null`
 */
export function findMergedPullForHeadSha(json, headSha, sink = null) {
  const sha = String(headSha ?? "").trim();
  if (!sha) {
    return null;
  }
  const raw = json?.data;
  const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.data) ? raw.data : [];
  for (const p of list) {
    if (String(p?.head?.sha ?? "") !== sha) {
      continue;
    }
    if (p?.is_merged === true) {
      return Number(p.number);
    }
    if (typeof p?.is_merged !== "boolean" && sink) {
      sink.unknownPr = Number(p.number) || null;
    }
  }
  return null;
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
  if (!msg) {
    return false;
  }
  return !msg.includes("\n") && msg.includes(String.raw`\n`);
}

/**
 * `--dry-run` 的命令计划。它打印的就是真跑时会执行的同一份 argv ——
 * 这是量具自证：计划与执行分叉，说明有人在两处各写一遍（`tests/ship.test.ts`
 * 拿「模块+工具对同集合」逐条对账钉着这件事）。
 *
 * ⚠️ 它**不**保证恒退 0：dry-run 免掉的是「执行写动作」，不免掉「报出阻塞」。正在
 * `master` 上、或缺 `changelog.d/` 碎片时照样退 1 —— 一个会藏掉阻塞事实的预览比不预览更糟。
 *
 * @param {{branch:string,sha:string,slug:string,adds:string[],hasMessage:boolean,merge:boolean,closeIssue?:boolean,asMerged?:number|null,cleanBranch?:boolean,reap?:boolean,handle?:string|null,claim?:number|null,release?:number|null,claims?:boolean,comment?:boolean,branches?:boolean,newIssue?:boolean,diagnose?:boolean,stageLog?:boolean,createBranch?:string|null,remote?:string|null,baseBranch?:string|null,prBodyFile?:boolean}} st 当前状态
 * @returns {string[]} 逐条命令
 */
export function planCommands(st) {
  const p = [];
  const remote = st.remote ?? "origin";
  const trunk = st.baseBranch ?? "master";
  /* 建分支排在最前面：它是 `--branch` 唯一能改变形状的一格（不在分支上时，后面每一跳
   * 的分支名都取自它）。给了旗标才出现 —— 与合并/关单同一档：默认那份计划里没有这一步。 */
  if (st.createBranch) {
    p.push(`git checkout -b ${st.createBranch}`);
  }
  p.push("git rev-parse --abbrev-ref HEAD");
  p.push("git status --porcelain");
  /* 碎片那一查的**两条**取数都要在计划里出现：执行面是「分支相对主干已提交的 ∪
   * 还没提交的」（#2034 收到并集后就没有 `git ls-files` 这一查了）。计划里留着那条
   * 已经没人执行的命令，等于让 dry-run 教给读者一个取数面 —— 而它恰恰是那次误判的
   * 来源（`ls-files` 数的是目录存量 118 份，恒真）。 */
  p.push(`git diff --name-only ${remote}/${trunk}...HEAD -- changelog.d`);
  p.push("git status --porcelain -- changelog.d");
  p.push("node scripts/check-deps-freshness.mjs");
  for (const a of st.adds) {
    p.push(`git add -- ${a}`);
  }
  if (st.hasMessage) {
    p.push("git commit --message=<提交信息原文>");
  }
  /* 远端名与主干分支都来自解析（`resolveUpstream`），不写死 `origin` / `master` ——
   * 两处都是每台克隆自己的事实，写死时计划与执行两头一起错。 */
  p.push(`git push -u ${remote} ${st.branch}`);
  p.push(`cnb pulls list-pulls --repo ${st.slug} --state open -v`);
  p.push(
    `cnb pulls post-pull --repo ${st.slug} --base ${trunk} --head ${st.branch} --head-repo ${st.slug} --title … --body-file <git目录>/comfy-ship-tmp/ship-pr-body-<pid>.tmp -v`,
    ...(st.prBodyFile ? prBodyPlanLines(st.slug) : []),
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
  if (st.claim !== null && st.claim !== undefined) {
    const who = st.handle ?? "<短名>";
    p.push(`cnb issues get-issue --repo ${st.slug} --number ${st.claim} -v`);
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
  if (st.release !== null && st.release !== undefined) {
    const who = st.handle ?? "<短名>";
    p.push(`cnb issues get-issue --repo ${st.slug} --number ${st.release} -v`);
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
    const who = st.handle ?? "<短名>";
    p.push(
      `cnb issues list-issues --repo ${st.slug} --labels 处理人:${who} --state open --page <p> --page-size 100 -v`,
    );
  }
  if (st.comment) {
    /* `--comment` 与领取 / 结束共用同一份「写 + 回读」原语（`ship-comment.mjs`）。
     * 原语有两档落点：单子评论区与 PR 评论区 —— PR 那一档只由 CI 立案链调用，
     * 走不到 `ship` 的命令行；这里把它一起列出来，理由与上面那三格相同：这本账
     * 要的是「源码里每一个 cnb 工具都有一条对应的计划行」，不是「这一跑会发哪几条」。 */
    p.push(
      `cnb issues post-issue-comment --repo ${st.slug} --number <号> --body-file <git目录>/comfy-ship-tmp/ship-issue-comment-<pid>.tmp -v`,
    );
    p.push(
      `cnb issues list-issue-comments --repo ${st.slug} --number <号> --sort -created --page-size 100 -v`,
    );
    p.push(
      `cnb pulls post-pull-comment --repo ${st.slug} --number <号> --body-file <git目录>/comfy-ship-tmp/pull-comment-<pid>.tmp -v`,
    );
    p.push(
      `cnb pulls list-pull-comments --repo ${st.slug} --number <号> --sort -created --page-size 100 -v`,
    );
  }
  /* 分支落地读数（ISSUE #2427）：计划里连翻带 git 的取数一起念出来 ——
   * `--dry-run` 教的执行面要和真跑的一样大，否则它教的是另一件事。 */
  if (st.branches) {
    p.push(`git for-each-ref --format=… refs/heads`);
    p.push(`git ls-remote --heads ${st.remote ?? "origin"}`);
    p.push(
      `cnb pulls list-pulls --repo ${st.slug} --state all --page <p> --page-size 100 -v（翻页到窗口取满或到顶）`,
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
    p.push(
      `cnb issues get-issue --repo ${st.slug} --number <n> -v（建后回读：标题 / 优先级 / 标签）`,
    );
  }
  p.push(`cnb build get-build-logs --repo ${st.slug} -v`);
  p.push(`cnb build get-build-status --repo ${st.slug} --sn <sn> -v`);
  /* 红格的日志正文只有按格取得到（`get-build-stage` 的 `data.content`）。它只在
   * `--diagnose` 或 `--stage-log` 下被执行 —— 默认那份计划里不出现，否则 dry-run 教的
   * 执行面比请求的大。（`--stage-log`，ISSUE #2455：按格名取也是同一条命令、同一格读。） */
  if (st.diagnose || st.stageLog) {
    p.push(
      `cnb build get-build-stage --repo ${st.slug} --sn <sn> --pipelineId <pipelineId> --stageId <stageId> -v`,
    );
  }
  p.push(`cnb pulls get-pull --repo ${st.slug} --number <n> -v`);
  if (st.merge) {
    p.push(
      `cnb pulls merge-pull --repo ${st.slug} --number <n> --merge-style squash --commit-title "… (#<n>)" -v`,
    );
  }
  /* 阶段 7 也是**伸手改世界**的那一类，所以它在计划里必须看得见 —— 与合并同一档：
   * 不显式给 `--close-issue` 就不出现。`get-issue` 那一条是回读（独立一问），
   * 它不在 WRITE_SHAPES 里，但同样要出现在计划中，否则 dry-run 教的执行面是缺一块的。 */
  if (st.closeIssue) {
    /* 人点名「随哪条 PR 落地」（`--as-merged`，ISSUE #2491）时，这一跳**先去回读那条 PR 的
     * `is_merged`** 再决定关不关 —— 计划里必须看得见这一问，否则 dry-run 教的执行面
     * 又缺了一块（与下面那句 `get-issue` 是同一条理由：只写动作不写回读，就是把
     * 「回执即结论」教给读者）。 */
    if (st.asMerged) {
      p.push(
        `cnb pulls get-pull --repo ${st.slug} --number ${st.asMerged} -v（认 data.is_merged 原值，不当结论直接用）`,
      );
    }
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
  if (!gitDir) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(path.join(gitDir, "comfy-premerge-proof.json"), "utf8"));
  } catch {
    return null;
  }
}
