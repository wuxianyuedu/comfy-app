#!/usr/bin/env node
/**
 * `ci-pr-failure-issue.mjs` —— PR 那一跑红了、而**没人正在等它**时，把红变成看得见的东西
 * （ISSUE #2332）。
 *
 * ## 补的是哪一格：「PR 红了没人知道」
 *
 * PR 流水线（`.cnb.yml` 的 `质量门禁`）跑红之后，今天知道这件事的只有两种人：
 * 当场盯着 `pnpm ship` 的那个（它轮询到终态才结束）、以及事后想起来去翻构建列表的那个。
 * 而 `pull_request` 事件**不产生任何通知**：平台没有「构建结束 → 主动打你」的通用回调
 * （`cnb event get-events` 只能主动拉、且不含 build 事件类型），所以外部想知道终态只有
 * 轮询一条路 —— 那就等于「没人在轮询 ⇒ 等于没发生」。
 *
 * ## 为什么不选「流水线尾部挂个 IM 推送插件」
 *
 * `runner.namespace: group` 这条件路径上**没有 Docker**：`.cnb.yml` 头注第 1 条记着实测
 * 读数（带 `image:` 的 stage 70ms 就红，`Runner does not enable Docker`），且插件镜像
 * 默认还要出网。所以「推给某个群」这一档在本仓今天**没有执行者**，写进配置就是写一条
 * 会红或永远不响的格。这条走的是同一件事的另一个落点：**平台自己的 Issue 就是通知面**
 * —— 它进列表、有未读、能 @ 人，而且不需要任何新凭据。
 *
 * ## 判决链一个字都不另立（§12.18 / §12.12）
 *
 * 取 `cnb` 通道 = `cnbJson`；取构建列表 = `fetchBuildList()`（`ci-build-readout.mjs`）；
 * 取逐格详情 = `fetchBuildDetails()`（`check-daily-attendance.mjs`，与每日档同一个取法）；
 * 定性 = `classifyBuildOutcome()`；被带下去的格 = `downstreamSkipped()`；
 * 失败行摘录 = `describeFailedStages()`；仓库 slug = `resolveRepoSlug()`；
 * 写单 / 评论 = `runNewIssue()` 与那条「写后独立回读」的实现（每日档里各有一份）。
 * 这里新增的只有三件：**这一跑是谁**（带 `CNB_BUILD_ID` 就不猜）、**去重键**、
 * **落点**（PR 评论 vs 建单）。
 *
 * ## 「一条诉求一张单」在 PR 档上的形状
 *
 * 硬规则 29 那条「一条诉求一张单」落到这里是一条**取舍**：PR 每次都红 ⇒ 每次都建一张单，
 * 等于把单子变成噪声，而噪声的代价是下一次真红也没人看。所以落点按「有没有人能收」
 * 分两档，两档都**看得见**：
 *
 *   · `CNB_PULL_REQUEST_IID` 在场上（人推了 PR 才会有它）⇒ **评论在那张 PR 下**；
 *   · 不在场上（人从本地推分支触发的 `pull_request` 一类）⇒ `eventUrl` 指向
 *     `/pull/<iid>` 就从里面取 iid；都没有 ⇒ **建一张单**（去重键是「格名」）。
 *
 * `push` 事件的构建进不来看（那个 sha 压根没有 PR）——它不是「PR 红了」。
 *
 * ## 三态退码，但平台那一跳**不拦路**（与每日档同一口径，理由也同一句）
 *
 * 缺省：`0` 有结论（写了 / 无需写）、`1` 该写的没写成、`2` 取不到读数。
 * 平台那一格带 `--no-block`：非零都改成「退 0 + 把那句红话原样打在屏幕上」。
 * 这一格自己写着**上一跑**的红，它一坏不该把自己也变成一条红 —— 但**也不许静默**
 * （失败时打出可粘贴的手工出口，由用例钉住）。
 *
 * ## 用法
 *
 * ```text
 * node scripts/ci-pr-failure-issue.mjs                     # 平台那一格：认 CNB_BUILD_ID
 * node scripts/ci-pr-failure-issue.mjs --dry-run           # 只打印将写什么，一条都不写
 * node scripts/ci-pr-failure-issue.mjs --from <读数 JSON>   # 离线复现（强制只读）
 * node scripts/ci-pr-failure-issue.mjs --no-block          # 平台那一跳：失败也不拦路
 * node scripts/ci-pr-failure-issue.mjs --lane package --no-block  # 桌面成品包那一档
 * ```
 *
 * `--lane` 是 ISSUE #2550 加的：同一份读写链今天也被桌面成品包那两个触发口
 * （`crontab: 0 2 * * *` / `web_trigger_package`）引用，而那一档**没有 PR 可挂**。
 * 不给它就照旧只认 `pull_request` 那一族（那一族今天因为令牌限制写不动，见 #2339），
 * 给了它这一格才把非 PR 事件也算进来，并且标题 / 去重键按档分开。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  classifyBuildOutcome,
  describeFailedStages,
  downstreamSkipped,
  enrichStageErrors,
  fetchBuildList,
  resolveRepoSlug,
} from "./ci-build-readout.mjs";
import { fetchBuildDetails } from "./check-daily-attendance.mjs";
import { commentHeader } from "./ship-ticket.mjs";
import { cnbJson, makeRunner, writeScratch } from "./ship-exec.mjs";
import { runAppendIssueComment, runNewIssue } from "./ship-issue-new.mjs";
import { machineHandle } from "./dev-handle.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

/** 三态与仓内其余档同口径（`0` 有结论 / `1` 该写的没写成 / `2` 取不到读数）。 */
export const CODE = { DONE: 0, WRITE_FAILED: 1, NO_FACT: 2 };

/** 去重键的前缀：只在「没有 PR 可挂、只能建单」那一支用得上（格名进标题）。 */
export const TITLE_PREFIX = "ci(pr): PR 档红在「";

/**
 * 每一档自己的标题前缀（`--lane` 的值 → 前缀）。
 *
 * 为什么多这一张表（ISSUE #2550）：这一份实现最早只服务于 PR 那一档，而
 * **同一份读写链**现在也被桌面成品包那一档（`crontab: 0 2 * * *` / `web_trigger_package`）
 * 引用 —— 那一档的红挂在 `ci(pr): PR 档红在「…」` 这个标题下会直接误导读者
 * （那一跑根本没有 PR）。前缀同时也是**去重键的一部分**，所以它顺手把两档的单子
 * 分开：同一格在两档各红一次，是两件事（欠的东西不同，要去找的人也不同）。
 */
export const LANE_PREFIX = /** @type {Record<string,string>} */ ({
  pr: TITLE_PREFIX,
  package: "ci(package): 桌包档红在「",
});

/** @param {string | null | undefined} lane @returns {string} 未知档一概落到 PR 那一档（不发明第二份默认） */
export function lanePrefix(lane) {
  return LANE_PREFIX[String(lane ?? "").trim()] ?? TITLE_PREFIX;
}

/** 优先级：PR 档红挡的是「这一笔能不能进 master」，所以与每日档同档。 */
export const PRIORITY = "P1";

/** 平台侧认不出的构建级状态（在跑 / 排队）：这些不去取逐格详情，先不判。 */
const NOT_FINAL = new Set(["pending", "running", "queued", "created", "waiting", ""]);

/**
 * @param {string} stage 格名
 * @param {string} [lane] 这一格服务哪一档（`pr` / `package`；缺省 `pr`）
 * @returns {string} 去重键 —— 标题里必须以它开头
 */
export function titleKey(stage, lane = "pr") {
  return `${lanePrefix(lane)}${stage}」`;
}

/**
 * @param {string} stage 格名
 * @param {string} [lane] 这一格服务哪一档（同上）
 * @returns {string} 建单时的标题（去重靠 `titleKey`，后缀只是给读者看的说明）
 */
export function issueTitle(stage, lane = "pr") {
  return `${titleKey(stage, lane)}—— 自动立案（只含读数，不含因果）`;
}

/**
 * 从平台的 `eventUrl` 里认出 PR 号（`…/pulls/123` / `…/pull/123` 两种形状都认）。
 *
 * @param {string} url 平台给的 `eventUrl`
 * @returns {number | null} PR 号；认不出时 null（不猜）
 */
export function prIidFromUrl(url) {
  const m = /\/pulls?\/(\d+)/.exec(String(url ?? ""));
  if (!m) {
    return null;
  }
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * 「这一跑是谁」与「这一跑是什么」。
 *
 * 两个来源都**只读在场的事实**：环境变量（`CNB_BUILD_ID` / `CNB_PULL_REQUEST_IID`，平台
 * 内置）优先，认不出来时回落到构建列表里那一跑自带的 `event` / `eventUrl`。
 * 回落不是猜：列表那一项就是**同一个 sn** 的记录，它的 `event` 是平台自己写的。
 *
 * @param {{env:Record<string,string|undefined>, list:any[]|null, sn:string,
 *   lane?:string|null}} input
 * @returns {{sn:string, event:string, eventUrl:string, prIid:number|null,
 *   lane:string|null, why:string|null}}
 *   `why` 非空表示「这一跑不归本格管」的原因（不是失败）
 */
export function resolveTarget({ env, list, sn, lane = null }) {
  const fromEnv = String(env.CNB_PULL_REQUEST_IID ?? "").trim();
  const row = (Array.isArray(list) ? list : []).find((b) => String(b?.sn ?? "") === sn);
  const event = String(row?.event ?? env.CNB_BUILD_EVENT ?? "");
  const eventUrl = String(row?.eventUrl ?? "");
  const prIid = /^\d+$/.test(fromEnv) ? Number(fromEnv) : prIidFromUrl(eventUrl);
  /* `--lane` 是「这一档的立案口就是我」的显式声明（ISSUE #2550）：给了它，非
   * `pull_request` 事件同样归本格管 —— 桌面成品包那一档（`crontab: 0 2 * * *` /
   * `web_trigger_package`）没有 PR 可挂，它的红今天是**一点都看不见**的
   * （PR 那一档是另一种形状：格子有、写不动 —— 令牌只有 `repo-code:r`，见 #2339）。
   * 没有 `--lane` 时那些跑仍然一律不写 —— 那一处才知道两种形状的区别。 */
  const declaredLane = lane !== null && String(lane).trim() !== "" ? String(lane).trim() : null;
  const yesPR =
    event.startsWith("pull_request") || prIid !== null || fromEnv !== "" || declaredLane !== null;
  if (!yesPR) {
    return {
      sn,
      event,
      eventUrl,
      prIid: null,
      lane: null,
      why:
        `这一跑的事件是「${event || "(取不到)"}」，不是 pull_request —— ` +
        "「PR 红了」这件事对 push / 定时那几跑不成立（它们的 sha 上没有 PR）",
    };
  }
  return { sn, event, eventUrl, prIid, lane: declaredLane, why: null };
}

/**
 * 这一次要做什么。**纯函数**（不碰网络），每种失效形态都能被用例直接钉住。
 *
 * @param {{state:string, failedNames:string[], prIid:number|null,
 *   existing:Array<{number:number,title:string}>|null, lane?:string|null}} input
 * @returns {{action:"none"|"no-fact"|"recommend"|"write", reason?:string,
 *   stages:Array<{stage:string, number?:number}>}}
 */
export function decideAction({ state, failedNames, prIid, existing, lane = null }) {
  if (state === "green") {
    return { action: "none", stages: [], reason: "这一跑是绿的 ⇒ 无事可立" };
  }
  if (state === "cancelled") {
    return {
      action: "none",
      stages: [],
      reason:
        "这一跑是被取消的 —— 它没有结论，**不是产物坏了**（把它写成红就是替平台编一个不存在的故障）",
    };
  }
  if (state !== "failed") {
    return {
      action: "no-fact",
      stages: [],
      reason: `判定是「${state}」，不构成结论 ⇒ 不写`,
    };
  }
  if (failedNames.length === 0) {
    return {
      action: "no-fact",
      stages: [],
      reason:
        "整跑判成真失败，却认不出是哪一格红的 ⇒ 不知道把红记在哪，先不动账" +
        "（认不出格名 = 判据没跑起来，不是「没有红」）",
    };
  }
  /* 有 PR ⇒ 落点是那张 PR 的评论区（不去查「开着的单」：评论不需要去重，PR 本身就是那张单）。 */
  if (prIid !== null) {
    return {
      action: "recommend",
      stages: failedNames.map((stage) => ({ stage })),
    };
  }
  if (!existing) {
    return {
      action: "no-fact",
      stages: [],
      reason:
        "开着的单列表取不到 —— 「查不到已有单」不等于「没有已有单」，据它新建就是多一张重复单",
    };
  }
  return {
    action: "write",
    stages: failedNames.map((stage) => {
      const hit = existing.find((e) => e.title.includes(titleKey(stage, lane ?? undefined)));
      return hit ? { stage, number: hit.number } : { stage };
    }),
  };
}

/**
 * 拼正文：只有事实与出口。
 *
 * @param {{slug:string, target:{sn:string,event:string,eventUrl:string,
 *   prIid:number|null, lane?:string|null},
 *   stage:string, skipped:string[], readout:string[], handle:string}} input
 * @returns {string}
 */
export function composeBody({ slug, target, stage, skipped, readout, handle }) {
  const lane = target.lane ?? null;
  const where =
    target.prIid === null
      ? lane
        ? `事件 \`${target.event || "(取不到)"}\`（没有 PR 可挂 ⇒ 落到「${lane}」这一族）`
        : "（没有 PR 可挂）"
      : `PR #${target.prIid}`;
  return [
    commentHeader(handle),
    "",
    lane && target.prIid === null
      ? "## 症状（这一跑红了，本段只含读数）"
      : "## 症状（PR 那一跑红了，本段只含读数）",
    "",
    `- 构建：\`${target.sn}\` · 事件 \`${target.event || "(取不到)"}\` · ${where}`,
    `- 红在：**「${stage}」**`,
    skipped.length > 0
      ? `- 被它带下去、**根本没跑**的格：${skipped.join("、")}`
      : "- 这一跑没有「被带下去没跑」的格。",
    "",
    "## 当场读数（平台原样摘录）",
    "",
    "```",
    readout.join("\n").trim() ||
      "(这一格的日志正文没取到 —— 那句不是「日志里没有失败行」，是**取不到**)",
    "```",
    "",
    "## 根因：**未判定**",
    "",
    "这一段只把「红了」变成看得见的东西，不替任何人判「是谁的错、为什么红」。定性走既有出口：",
    "",
    `- \`pnpm ship --diagnose ${target.sn}\` —— 只读取回失败格与失败行（本正文的读数就来自同一条链）`,
    "- `node scripts/base-check.mjs <那条门禁>` —— 分清「红是我的还是主干的」（§13.6.2）",
    "- 拿不到的测量按**没有结论**处理：`2` 不算绿，也不算红",
    "",
    `日志出处：https://cnb.cool/${slug}/-/build/logs/${target.sn}`,
    "",
    "> 本段由 `scripts/ci-pr-failure-issue.mjs` 写。判据链复用既有那几份" +
      "（`ci-build-readout` 定性取逐格、`check-daily-attendance` 取详情），没有第二套判决。",
    target.prIid === null
      ? "> 同一格再次红时**不新建**，在这张单下追加一条读数 —— 号一关，欠着的东西连可见性都没了。"
      : "> 落点是这张 PR（一条诉求一张单）：同一笔改动再红就在同一处追加，不另开单。",
  ].join("\n");
}

/**
 * 写一条 PR 评论并**独立回读**（与每日档 `appendReading` 同一形状：回执不算结论）。
 *
 * 实现只有一份：`runAppendIssueComment()` 的 `path:"pull"` 那一档 —— 与「往单子下追加
 * 读数」逐字同形，差别只是 `issues` / `pulls` 这一个词。此前这里自己抄过一遍
 * （写 → 列 → 认 marker 三步），两处漂开就变成「一边补了回读、另一边没有」。
 *
 * @param {{run:any, log:(s:string)=>void}} io
 * @param {string} slug 仓库路径
 * @param {number} iid PR 号
 * @param {string} body 正文
 * @param {string} sn 构建号（回读时认它）
 * @returns {boolean}
 */
export function commentPull(io, slug, iid, body, sn) {
  return runAppendIssueComment({
    run: io.run,
    log: io.log,
    slug,
    number: iid,
    body,
    marker: sn,
    mkTmp: (name, text) => writeScratch(ROOT, name, text),
    path: "pull",
  });
}

/**
 * 同一格再次红：往那张 open 单下追加一条读数（**不新建**）。
 *
 * @param {{run:any, log:(s:string)=>void}} io
 * @param {string} slug 仓库路径
 * @param {number} number 单号
 * @param {string} body 正文
 * @param {string} sn 构建号（回读时认它）
 * @returns {boolean}
 */
export function appendToIssue(io, slug, number, body, sn) {
  return runAppendIssueComment({
    run: io.run,
    log: (line) => io.log(`[pr-failure-issue] ${line.replace(/^\[ship\]\s*/, "")}`),
    slug,
    number,
    body,
    marker: sn,
    mkTmp: (name, text) => writeScratch(ROOT, name, text),
  });
}

/**
 * 当前开着的单（只在「没有 PR 可挂」那一支用得到）。
 *
 * @param {(cmd:string,args:string[])=>any} run 执行者
 * @param {string} slug 仓库路径
 * @returns {Array<{number:number,title:string}> | null} 取不到 ⇒ null（调用方据此**不新建**）
 */
export function openIssues(run, slug) {
  const res = cnbJson(run, [
    "issues",
    "list-issues",
    "--repo",
    slug,
    "--state",
    "open",
    "--page-size",
    "100",
    "-v",
  ]);
  if (!res) {
    return null;
  }
  const d = res.json?.data;
  const arr = Array.isArray(res.json)
    ? res.json
    : Array.isArray(d?.data)
      ? d.data
      : Array.isArray(d)
        ? d
        : null;
  if (!arr) {
    return null;
  }
  return arr.map((/** @type {any} */ i) => ({
    number: Number(i?.number ?? 0),
    title: String(i?.title ?? ""),
  }));
}

/**
 * 从构建列表里挑**这一次**的那一跑（认 sn，不猜时间顺序）。
 *
 * @param {any[] | null} list 列表
 * @param {string} sn 构建号
 * @returns {any | null}
 */
export function pickSelf(list, sn) {
  return (Array.isArray(list) ? list : []).find((b) => String(b?.sn ?? "") === sn) ?? null;
}

/**
 * 入口。
 *
 * @param {{argv?:string[], env?:Record<string,string|undefined>, run?:any,
 *   log?:(s:string)=>void, slug?:string|null}} [io]
 * @returns {number} `CODE` 之一（带 `--no-block` 时非零都落 0，话术照打）
 */
export function main(io = {}) {
  const argv = io.argv ?? process.argv.slice(2);
  const env = io.env ?? process.env;
  const log = io.log ?? ((s) => console.log(s));
  const run = io.run ?? makeRunner(ROOT);
  const dryRun = argv.includes("--dry-run");
  const noBlock = argv.includes("--no-block");
  const at = argv.indexOf("--from");
  const from = at >= 0 ? argv[at + 1] : undefined;
  /* `--lane <名>`：这一格服务哪一档（缺省 pr）。它是**显式声明**而不是从事件推出来的：
   * 「这一跑归不归本格管」不该由平台给的事件名猜（猜错就是那一档永远不立案，而这一格
   * 自己在记账上还是绿的 —— 桌面成品包那一档今天就是这个形状，见 ISSUE #2550）。 */
  const laneAt = argv.indexOf("--lane");
  const laneArg = laneAt >= 0 ? String(argv[laneAt + 1] ?? "").trim() : "";
  const lane = laneArg === "" ? null : laneArg;

  /**
   * 退码出口：`--no-block` 只改码，不改话术。
   *
   * @param {number} code 本该退的码（`CODE` 之一）
   * @param {string} why 一句话原因（会原样打进日志）
   * @returns {number}
   */
  const finish = (code, why) => {
    if (code !== CODE.DONE && noBlock) {
      log(
        `[pr-failure-issue] ※ 这一格本该以退码 ${code} 结束（${why}），` +
          "但平台那一跳带 `--no-block`：**不拦路**。上面那句就是它的全部出口 —— " +
          "「看不见」才是这一格唯一的失效形态，别把它改成静默 return。",
      );
      return CODE.DONE;
    }
    return code;
  };

  /* 写在 `finish` 之后（`const` 的 TDZ）：这两句退码要靠它把 `--no-block` 那一层套上。 */
  if (laneAt >= 0 && laneArg === "") {
    log(
      "[pr-failure-issue] `--lane` 没给值 ⇒ 不知道这一格服务哪一档，一次都不写" +
        "（档名进标题与去重键，随手写就把两档的单子混成一族）。",
    );
    return finish(CODE.NO_FACT, "--lane 缺值");
  }
  if (lane !== null && !(lane in LANE_PREFIX)) {
    log(
      `[pr-failure-issue] 「${lane}」不在 LANE_PREFIX 那张表里（有：${Object.keys(LANE_PREFIX).join(
        " / ",
      )}）⇒ 一次都不写。` +
        "新加一档要先在同一个常量里登记它，否则去重键会拆成两族 —— 那正是 #2399 记过的形状。",
    );
    return finish(CODE.NO_FACT, `--lane 未登记：${lane}`);
  }

  const slug = io.slug === undefined ? resolveRepoSlug(run) : io.slug;
  if (!slug) {
    log("[pr-failure-issue] 推不出仓库 slug（不在 git 检出里 / 没有远端）⇒ 这一格没有执行者。");
    return finish(CODE.NO_FACT, "推不出仓库 slug");
  }
  /* 同 `ci-daily`：机器自起的账用自己的名字，不取人的昵称（ISSUE #2355）。 */
  const handle = machineHandle("ci-pr", env);

  const offline = Boolean(from);
  /** @type {any[] | null} */
  let list = null;
  /** @type {Array<{sn:string,json:any}>} */
  let details = [];
  /** @type {string} */
  let sn = String(env.CNB_BUILD_ID ?? "").trim();

  if (offline) {
    if (!from || !fs.existsSync(from)) {
      log(
        `[pr-failure-issue] --from 那个路径不存在：${from ?? "(空)"} ⇒ 不构成结论（不是「没有红」）`,
      );
      return finish(CODE.NO_FACT, "--from 读不到");
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(from, "utf8"));
    } catch (error) {
      log(
        `[pr-failure-issue] --from 那份不是能解析的 JSON（${/** @type {Error} */ (error).message}）⇒ 不构成结论`,
      );
      return finish(CODE.NO_FACT, "--from 读不了");
    }
    list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.list) ? parsed.list : null;
    details = Array.isArray(parsed?.details) ? parsed.details : [];
    sn = String(parsed?.sn ?? sn);
    log(
      `[pr-failure-issue] 离线档：列表 ${list ? list.length : 0} 条 · 详情 ${details.length} 跑 · ` +
        `sn=${sn || "(空)"} ⇒ **强制只读**（离线那份不是当场取的，据它写平台就是把过期读数写成事实）`,
    );
  }

  if (!sn) {
    log(
      "[pr-failure-issue] 认不出「这一跑是谁」（`CNB_BUILD_ID` 不在场，离线档也没给 sn）⇒ " +
        "没有结论。**不按时间挑一条**：挑错就是把别人的红记到这一笔上。",
    );
    return finish(CODE.NO_FACT, "认不出这一跑");
  }

  if (!list) {
    /* 带上 `log`：取不到时要念出**哪一种取不到**（退码 / stderr / 信封），
     * 否则现场只留一句「取不到构建列表」，三种原因的下一个动作完全不同。
     *
     * 过滤条件：默认只查 `pull_request`（这一格的出身）；而给了 `--lane`（且不是 pr）
     * 时**不带事件过滤** —— 那一档没有 PR 事件可查，按 PR 过滤就等于查不到自己
     * （ISSUE #2550 的现场：事件念成 `(取不到)`、`self` 为 null，连终态那一道都跳过）。 */
    list = fetchBuildList(run, slug, lane && lane !== "pr" ? "" : "pull_request", 60, { log });
    if (!list) {
      /* 这一句是这一格**唯一**的失效形态（它是 `endStages`，退出码不构成流水线结论），
       * 所以要把「下一次该谁做什么」也写在这里，而不是只留一句「取不到」。
       * 2026-10-25 的现场读数（`cnb-uh5-1k5olev2q`）：平台原话是 `errcode 10023`
       * 加一句 `Missing required scopes: repo-cnb-history:r` —— 即**流水线里的
       * `CNB_TOKEN` 少了「构建历史只读」**这一项。它按事件类型分配
       * （官方 `zh/build/build-in-env.md` §CNB_TOKEN）：`pull_request` 属可信事件本应有，
       * 所以这一行读数是配置面的问题，代码改不动它 —— 出路是让这一跑拿到那份 scope。 */
      log(
        "[pr-failure-issue] 取不到构建列表 ⇒ 没有结论，一次都不写。" +
          "原因见上面 `[build-readout]` 那一行；若是 `Missing required scopes: repo-cnb-history:r`，" +
          "那是这一跑的 `CNB_TOKEN` 权限面（官方 build-in-env.md §CNB_TOKEN 按事件类型分配），" +
          "不是这一格的判据。",
      );
      return finish(CODE.NO_FACT, "取不到构建列表");
    }
  }

  const self = pickSelf(list, sn);
  const target = resolveTarget({ env, list, sn, lane });
  if (target.why) {
    log(`[pr-failure-issue] ${target.why} ⇒ 不写。`);
    return finish(CODE.DONE, target.why);
  }
  if (!offline && self && NOT_FINAL.has(String(self.status ?? "").toLowerCase())) {
    log(
      `[pr-failure-issue] 列表里这一跑（${sn}）的状态是「${self.status}」⇒ 还没到终态，` +
        "这一次读到的不是结论（也不写）。",
    );
    return finish(CODE.NO_FACT, "还没到终态");
  }

  if (!offline) {
    details = fetchBuildDetails(run, slug, [self ?? { sn }]);
  }
  /* 详情取不到 ⇒ 拿**空读数**过同一个分类器（不是手搓一个形状像的「unknown」对象：
   * 那份判决只有一处实现，手搓一份就在下一个人改分类器时静默变成另一个答案）。 */
  const firstDetail = details[0];
  /* 「被取消」与「真失败」的分界那句原话只在 `get-build-stage -v` 的 `data.error` 里
   * ⇒ 分类之前先补（ISSUE #2406）。取不到就照旧按状态判，只是念不出原话。 */
  const outcome = classifyBuildOutcome(
    firstDetail ? enrichStageErrors(run, slug, sn, firstDetail.json) : null,
  );
  const failedNames = outcome.failed.map((/** @type {any} */ f) => f.name || f.id);
  const skipped = downstreamSkipped(outcome).map((/** @type {any} */ s) => s.name || s.id);
  log(
    `[pr-failure-issue] 这一跑 ${sn} · 事件 ${target.event || "(取不到)"} · ` +
      `档 ${target.lane ?? "pr"} · ` +
      `PR ${target.prIid ?? "(无)"} · 判定 ${outcome.state} · ` +
      `红格 ${failedNames.length} 个${failedNames.length ? `（${failedNames.join("、")}）` : ""} · ` +
      `被带下去 ${skipped.length} 格`,
  );

  /** @type {string[]} */
  const readout = [];
  if (!offline && failedNames.length > 0) {
    describeFailedStages(run, {
      slug,
      sn,
      outcome,
      log: (line) => readout.push(line.replace(/^\[build-readout]\s*/, "")),
      prefix: "[build-readout]",
    });
  }

  const existing = offline || target.prIid !== null ? [] : openIssues(run, slug);
  const decision = decideAction({
    state: outcome.state,
    failedNames,
    prIid: target.prIid,
    existing: target.prIid === null ? existing : [],
    lane,
  });
  if (decision.action === "none" || decision.action === "no-fact") {
    const why = decision.reason ?? "(没给出原因)";
    log(`[pr-failure-issue] ${why} ⇒ 不写（没结论既不许落成红字，也不许落成新建单）。`);
    return decision.action === "none" ? CODE.DONE : finish(CODE.NO_FACT, why);
  }

  const willWrite = offline || dryRun;
  let wrote = true;
  for (const s of decision.stages) {
    const body = composeBody({
      slug,
      target,
      stage: s.stage,
      skipped,
      readout,
      handle,
    });
    if (willWrite) {
      log(
        `[pr-failure-issue] ${offline ? "离线档" : "--dry-run"}：` +
          `「${s.stage}」→ ${
          decision.action === "recommend"
            ? `评论在 PR #${target.prIid} 下（不新建单）`
            : s.number
              ? `在 #${s.number} 下追加一条读数（不新建）`
              : `新建一张：${issueTitle(s.stage, lane ?? "pr")}`
          } · 正文 ${body.length} 字 · 一条都没写`,
      );
      continue;
    }
    if (decision.action === "recommend") {
      const ok = commentPull({ run, log }, slug, /** @type {number} */ (target.prIid), body, sn);
      log(
        ok
          ? `[pr-failure-issue] ✓ 已在 PR #${target.prIid} 留下一段读数并回读到`
          : `[pr-failure-issue] ✗ PR #${target.prIid} 的评论没写成或回读不到 ⇒ 手工出口：` +
              `cnb pulls post-pull-comment --repo ${slug} --number ${target.prIid} --body-file <正文文件> -v`,
      );
      if (!ok) {
        wrote = false;
      }
      continue;
    }
    if (s.number) {
      const ok = appendToIssue({ run, log }, slug, s.number, body, sn);
      log(
        ok
          ? `[pr-failure-issue] ✓ 同一格又红了一次 ⇒ 已在 #${s.number} 追加一条读数并回读到（不新建）`
          : `[pr-failure-issue] ✗ #${s.number} 的评论没写成或回读不到 ⇒ 手工出口：` +
              `cnb issues post-issue-comment --repo ${slug} --number ${s.number} --body-file <正文文件> -v`,
      );
      if (!ok) {
        wrote = false;
      }
      continue;
    }
    const file = writeScratch(ROOT, "pr-failure-issue", body);
    if (!file) {
      log("[pr-failure-issue] ✗ 取不到 git 目录 ⇒ 正文没有落点，一条都不写。");
      wrote = false;
      continue;
    }
    const created = runNewIssue({
      run,
      log: (line) => log(`[pr-failure-issue] ${line.replace(/^\[ship\]\s*/, "")}`),
      slug,
      handle,
      root: ROOT,
      mkTmp: (name, text) => writeScratch(ROOT, name, text),
      opt: {
        newIssue: issueTitle(s.stage),
        issueBodyFile: path.relative(ROOT, file),
        priority: PRIORITY,
      },
      dryRun: false,
    });
    if (created !== CODE.DONE) {
      log(`[pr-failure-issue] ✗ 「${s.stage}」那张单没建成（runNewIssue 退 ${created}）`);
      wrote = false;
      continue;
    }
    log(`[pr-failure-issue] ✓ 「${s.stage}」已立案（建 → 补标签 → 独立回读全过）`);
  }
  if (willWrite) {
    return CODE.DONE;
  }
  return wrote ? CODE.DONE : finish(CODE.WRITE_FAILED, "该写的没写成");
}

/* 只在被直接执行时跑 main（被 import 时只暴露纯函数给用例）。 */
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const exit = main();
  if (exit !== CODE.DONE) {
    process.stderr.write(
      `[pr-failure-issue] 退出码 ${exit}（0 有结论 / 1 该写的没写成 / 2 没结论）\n`,
    );
  }
  process.exit(exit);
}
