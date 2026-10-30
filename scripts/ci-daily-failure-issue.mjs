#!/usr/bin/env node
/**
 * `ci-daily-failure-issue.mjs` —— 每日那一跑**真失败**时，把它变成一张单（ISSUE #2274）。
 *
 * ## 补的是哪一格：判据在场、执行者不在场
 *
 * 「昨天那一跑到底有没有执行、红在哪一格」早有判据：`scripts/check-daily-attendance.mjs`
 * （0 出勤 / 1 缺勤 / 2 没结论）与 `scripts/ci-build-readout.mjs` 的 `classifyBuildOutcome()`。
 * 但那条判据**要有人去跑**才出结论 —— 它按 §13.5.13 同一口径刻意不发网络请求（「什么时候问平台」
 * 是人的动作）。于是「没人问」在这一格等于「没有结论」：红了不响、不进账、第二天也没人知道。
 * 成本不是少一句话：`每日生产构建` 一红，后面四格整片 `skipped`，而 `每日单元测试` 与
 * `每日全量E2E` 的**唯一执行者**就在这条链上（§13.5.21）⇒ 一天红 = 主干一天没有行为面读数，
 * 而账面全绿。
 *
 * ## 落点在**开头**，不在末尾
 *
 * 这一格判的是**上一跑**（此刻这一跑还没跑完，它自己的结论不存在）。写在末尾会被前面那次红
 * 一起 skip 掉 —— 那正是本单要治的形态。也不依赖任何没验证过的平台条件语法（本仓 `.cnb.yml`
 * 今天只有 `ifModify`，没有一处 `when:` / `fail()` ⇒ 别猜它有）。
 *
 * ## 判决链一个字都不另立（§12.18 / §12.12）
 *
 * 取数 = `fetchBuildsCoveringWindow()`（按**时间窗**翻页，不是按条数 —— ISSUE #2392）
 * / `isDailyDispatch()` / `fetchDailyDetails()`；
 * 定性 = `classifyBuildOutcome()`；被带下去的格 = `downstreamSkipped()`；
 * 失败行摘录 = `describeFailedStages()`；仓库 slug = `resolveRepoSlug()`；
 * 写单 = `runNewIssue()`（建 → 补 `提单人:` → **独立回读**，那份实现只有一处）；
 * 执行身份 = `dailyHandle()`（`ci-daily` 打头；**不取** `CNB_BUILD_USER_NICKNAME` —— 那是人的
 * 昵称，#2355 的现场是每日建的单被读成「月读提的」）。
 * 这里只新增两件事：**「哪一跑算上一跑」** 与 **「同一格不许天天建一张」**。
 *
 * ## 去重键是**标题里的格名**，不是标签
 *
 * 只用一个键 `红在「<格名>」`（`titleKey()`）：动态标签词表要先在平台侧存在
 * 才落得下来，而「按标签筛单」这件事需要一个读者 —— 本档自己用标题就能查，加一枚没人筛的标签
 * 就是 §11.23 点名的「写了没有读者」。同一格再次红 ⇒ 在旧单下评论一条新读数，**不新建**
 * （硬规则 29 那条「一条诉求一张单」；号一关，欠着的东西连可见性都没了）。
 *
 * 键取的是**格名**而不是整条标题：人工写的那张单只要带同一串，就自动进这一族、
 * 被同一套去重接住（现场：#2273 是人按 §13.5.4 的读数手写的，标题对齐后机器不再重复建单）。
 * **构建号 / 事件 / 时刻不进键**（#2399）：它们让标题能自证「是哪一跑」，进键就等于
 * 「同一格每天都是新的一张」—— 那正是去重那道坎要挡的形状。
 *
 * ## 三态退码，但平台那一跳**不拦路**（取舍写在明处）
 *
 * 缺省按仓内口径三态：`0` 有结论（写了 / 无需写）、`1` 该写的没写成、`2` 取不到读数。
 * 平台那一格带 `--no-block`：非零都改成「退 0 + 把那句红话原样打在屏幕上」。理由是一条链上的
 * 两难 —— 这一格自己坏掉时，拦路是用「四格没有读数」换「红被承认」，而那四格正是每天唯一的
 * 执行者。**不拦路不等于静默**：失败时打印可粘贴的手工出口，这条决定由用例钉住
 * （哪天有人把它改成静默 `return`，那一条就红）。
 *
 * ## 机器建单只报事实，不代写因果
 *
 * 正文 = 症状 + 当场读数 + 出处 + 出口，并明写「根因未判定」。把判断自动化正是 §13.5.4 与
 * ISSUE #2149 否掉过的形状（「净差小于 N 就自动抬 + 留痕」被否的那一条是同一家族）：
 * 这一格的价值是**看得见**，不是替有人说「这是谁的错」。
 *
 * ## `--lane`：事件名认不出「这是哪一档」（ISSUE #2595）
 *
 * 「每日类派发」是按**事件名**认的（`crontab:` 前缀 / `web_trigger_daily` /
 * `api_trigger_daily`），而 02:00 那条流水线（桌面成品包）的事件名同样是 `crontab:` 前缀
 * （`.cnb.yml` 的 `"crontab: 0 2 * * *"`）。于是「上一跑」这条链会把**桌包那一跑**挑进来：
 * 2026-10-28 的现场是 `cnb-7g8-1k60e2jk5` 红在 `打包·壳工具链自证`、后面三格 `skipped`，
 * 标题却写成 `ci(daily): … 红在「打包·壳工具链自证」`，正文还替它说「其中
 * `每日单元测试` / `每日全量E2E` 的唯一执行者就在这条链上」。
 *
 * 归属不再靠事件名猜一次：`--lane` 给出**这一档的流水线名**，`pickPreviousDaily()` 拿
 * 平台自己写进 `get-build-status -v` 的 `pipelinesStatus[*].name` 再核一次。给不出
 * （名字写错）就退 2「没有结论」——**不许**退化成「不过滤」，那正是上面那一形。
 *
 * ## 预算账陈旧度触发器（ISSUE #2639）
 *
 * 预算闸（`check-bundle-budget.cjs`）判红时自己念得出「基线修订号 dd8d4647 · 其后 35 次提交」，
 * 却没有任何一格说「陈旧到什么程度就该有人出面」—— 六次同类账（#2219 / #2273 / #2464 /
 * #2512 / #2518 / #2634）全靠碰巧有个正在修别的单子的人读到它。所以这一格在**判红**时把那笔
 * 账升成一句点名：基线其后提交数 ≥ `BUNDLE_BASELINE_STALE_COMMITS`、或预算闸连续红
 * ≥ `BUNDLE_GATE_RED_STREAK_DAYS` 天，正文就多一节「该有人出面了」+ §13.5.4 的两条出口
 * （认账 / 压回）。**它不改判据的判定**（棘轮只许降不许升照旧），只把「该有人出面」从
 * 「碰巧被读到」变成「被念出来」。
 *
 * 三条边界：
 *   · **只认判据自己打的那两句判决行**（`BUNDLE_GATE_MARKERS`），不重算金额 —— 重算就是
 *     第二个量具，两处会开始各说各话（§13.5.4）；
 *   · **撤档期间不响**（#2634 把 `TOTALS_ENFORCED` 改成 false）：判据照打差额、但明说
 *     「今天没判」，那种读数**不是红**，升它就是替业主的暂撤决定编一条催办。撤档也不静默：
 *     这一格每次都把「今天没判」这句打出来；
 *   · **读不出 ≠ 没到门限**（§13.6.4.1）：连续天数没盖住窗口 / 日志没取到 / 中间有一跑没判，
 *     一律不升并念出是哪一档 —— 不把它读成「还没满 M 天」。
 *
 * 整段实现（判决行解析 / 门限 / 连续天数 / 正文那一节）在 `ci-daily-bundle-escalation.mjs`
 * —— 拆成模块是为了让本文件留在 900 行硬闸之内；本文件只把这一跑的读数递过去、把结论念出来。
 *
 * ## 用法
 *
 * ```text
 * node scripts/ci-daily-failure-issue.mjs                      # 上网问平台，该写就写
 * node scripts/ci-daily-failure-issue.mjs --dry-run            # 只打印将要写什么，一条都不写
 * node scripts/ci-daily-failure-issue.mjs --from <列表 JSON>    # 离线复现（强制只读，不写平台）
 * node scripts/ci-daily-failure-issue.mjs --no-block           # 平台那一跳：失败也不拦路
 * node scripts/ci-daily-failure-issue.mjs --lane 每日生产构建    # 平台那一跳必给：这一档的流水线名
 * ```
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { cnbJson, makeRunner, writeScratch } from "./ship-exec.mjs";
import {
  classifyBuildOutcome,
  describeFailedStages,
  downstreamSkipped,
  enrichStageErrors,
  resolveRepoSlug,
} from "./ci-build-readout.mjs";
import {
  BUNDLE_GATE_STAGE,
  judgeBundleStageReading,
} from "./ci-daily-bundle-escalation.mjs";
import { machineHandle } from "./dev-handle.mjs";
import {
  DEFAULT_WINDOW_HOURS,
  fetchBuildsCoveringWindow,
  fetchDailyDetails,
  isDailyDispatch,
} from "./check-daily-attendance.mjs";
import { runAppendIssueComment, runNewIssue } from "./ship-issue-new.mjs";
import { commentHeader } from "./ship-ticket.mjs";

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, "..");

/** 三态与仓内其余档同口径（`0` 有结论 / `1` 该写的没写成 / `2` 取不到读数）。 */
export const CODE = { DONE: 0, WRITE_FAILED: 1, NO_FACT: 2 };

/**
 * 标题前缀（`ci(daily): `）—— 它**不进键**，只有下面 `titleKey()` 那一段进键。
 *
 * 前缀从「`ci(daily): 每日档红在「`」收成「`ci(daily): `」是因为标题里要塞进
 * 构建号 / 事件 / 时刻（#2399）：「每日档红在」那五个字之后紧跟的不再是格名，
 * 留着它就成了「前缀 + 半句话」的拼接。人工按旧形状写的单照样认（键只认格名那一段）。
 */
export const TITLE_PREFIX = "ci(daily): ";

/** 优先级是判断，这一格只带一个**写死并说明**的值：每日档红挡住的是全链唯一的执行者。 */
export const AUTO_PRIORITY = "P1";

/**
 * @param {string} stageName 红的那一格的格名
 * @returns {string} 去重键 —— 标题里必须带它（人工写的单只要带它，就自动进这一族）
 */
export function titleKey(stageName) {
  return `红在「${stageName}」`;
}

/**
 * 标题：**去哪儿看**（构建号）+ **哪一跑**（事件 + 时刻）+ **红在哪一步**（格名）。
 *
 * 为什么这三件必须进标题（#2399）：同一格红了五六次，列表里五张标题逐字相同 ——
 * 想回答「这张是哪一跑的」只能点进去看正文第一行。三件**只进标题，不进键**：
 * 进键就等于「同一格每天都是新的一张」，那正是 `titleKey()` 那道去重坎要挡的形状。
 *
 * @param {{sn:string, event:string, at:string, stage:string}} input 三件原值与格名
 * @returns {string} 标题
 */
export function issueTitle({ sn, event, at, stage }) {
  return (
    `${TITLE_PREFIX}构建 ${sn} · 事件 ${event || "(无事件)"} · 时刻 ${at || "(无时刻)"}` +
    ` · ${titleKey(stage)}`
  );
}

/**
 * 从「每日类派发」里挑**上一跑**：最近一条已有终态的。
 *
 * 为什么不能直接用 `latestDailyDispatch()`：这一格跑在每日链的**开头**，此刻列表里最新那条
 * 就是**正在跑的这一跑** —— 拿它立案等于给一条还没出结果的链写红字。判据取「分类结果不是
 * `running` / `unknown`」，而不是「不是这一跑的 sn」：`CNB_BUILD_ID` 与列表里 `sn` 是否逐字相等
 * **未核**，靠状态判既不需要那个前提，也顺带把「被取消」留在集合里（由调用方按 `cancelled` 不写）。
 *
 * ⚠️ **事件名不足以认「这是哪一档」**（ISSUE #2595）：02:00 那条流水线（桌面成品包）
 * 的事件名同样是 `crontab:` 前缀，只按事件名挑，就会把桌包那一跑的红记到每日档头上 ——
 * 现场是 `cnb-7g8-1k60e2jk5` 红在 `打包·壳工具链自证`，标题却写成
 * `ci(daily): … 红在「打包·壳工具链自证」`。所以给了 `lanes` 之后，还要再问一次
 * 「这一跑的流水线名在不在这一档的名单里」—— 流水线名是平台自己写进
 * `get-build-status -v` 的归属，不必猜事件与档的对应关系。
 *
 * @param {{list:any[], details:Array<{sn:string,json:any}>, lanes?:string[]}} input
 *   两份原样读数；`lanes` 是这一档的流水线名（空 ⇒ 退回「只按事件认」，只为旧调用点保留）
 * @returns {{build:any, sn:string, outcome:ReturnType<typeof classifyBuildOutcome>} | {none:string}} 挑不着时给一句原因
 */
export function pickPreviousDaily({ list, details, lanes = [] }) {
  const daily = (Array.isArray(list) ? list : []).filter(isDailyDispatch);
  if (daily.length === 0)
    return { none: "列表里没有每日类派发（定时 / 手点 / API 三种事件都没有）" };
  const bySn = new Map((details ?? []).map((d) => [String(d.sn), d.json]));
  /** 与 `ci-pr-failure-issue` 的 `--lane` 同一口径：名单为空 = 不按档过滤。 */
  const wanted = new Set(
    (Array.isArray(lanes) ? lanes : []).map((l) => String(l ?? "").trim()),
  );
  let stray = 0;
  for (const build of daily) {
    const sn = String(build.sn ?? "");
    const json = bySn.get(sn);
    if (!json) continue;
    const outcome = classifyBuildOutcome(json);
    if (outcome.state === "running" || outcome.state === "unknown") continue;
    if (wanted.size > 0 && !outcome.pipelines.some((p) => wanted.has(p.name))) {
      stray += 1;
      continue;
    }
    return { build, sn, outcome };
  }
  if (stray > 0) {
    return {
      none:
        `每日类派发有 ${daily.length} 条，最近那条有终态的属于别的档` +
        `（流水线不在 ${[...wanted].join(" / ")} 里 —— 桌包那一档的定时口事件名同样是 ` +
        "`crontab:` 前缀，按事件名认就会把它的红记到这一档头上）",
    };
  }
  return {
    none:
      `每日类派发有 ${daily.length} 条，但没有一条拿得到**终态**的逐格读数` +
      "（在跑的那一跑排除在外；取不到 ≠ 没红，也 ≠ 绿）",
  };
}

/**
 * `--lane` 的值 → 这一档的流水线名（`get-build-status -v` 的 `pipelinesStatus[*].name`）。
 *
 * 与 `ci-pr-failure-issue.mjs` 的 `--lane` 是**同一个形状**（那一档用它分 PR / 桌包）：
 * 区别是那一档靠它决定「认不认非 PR 事件」，这一档靠它决定「这一跑是不是我的」。
 * 两边都只有一个显式声明口，没有一处按事件名去猜档。
 *
 * 缺省（不给 `--lane`）= 空名单 = 不按档过滤，只为旧调用点与 `--from` 离线复现保留。
 */
export const LANE_STAGES = /** @type {Record<string, string[]>} */ ({
  [BUNDLE_GATE_STAGE]: [BUNDLE_GATE_STAGE],
});

/**
 * @param {string | null | undefined} lane `--lane` 的原值
 * @returns {string[]} 这一档的流水线名；认不出时给空数组（⇒ 不按档过滤，且由调用方念出来）
 */
export function laneStages(lane) {
  const key = String(lane ?? "").trim();
  return key === "" ? [] : (LANE_STAGES[key] ?? []).slice();
}

/**
 * 当前这一族开着的单（去重与「往哪张单评论」的事实来源）。
 *
 * @param {(cmd:string,args:string[])=>any} run
 * @param {string} slug
 * @returns {Array<{number:number,title:string}> | null} 取不到 ⇒ null（调用方据此**不新建**）
 */
export function openDailyIssues(run, slug) {
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
  if (!res) return null;
  const d = res.json?.data;
  const arr = Array.isArray(res.json)
    ? res.json
    : Array.isArray(d?.data)
      ? d.data
      : Array.isArray(d)
        ? d
        : null;
  if (!arr) return null;
  return arr.map((/** @type {any} */ i) => ({
    number: Number(i?.number ?? 0),
    title: String(i?.title ?? ""),
  }));
}

/**
 * 这一次要做什么。**纯函数**（不碰网络），所以每种失效形态都能被用例直接钉住。
 *
 * @param {{state:string, failedNames:string[], existing:Array<{number:number,title:string}>|null}} input
 * @returns {{action:"none"|"no-fact"|"write", reason?:string, stages:Array<{stage:string,number?:number}>}}
 */
export function decideAction({ state, failedNames, existing }) {
  if (state === "green")
    return { action: "none", stages: [], reason: "上一跑是绿的 ⇒ 无事可立" };
  if (state === "cancelled")
    return {
      action: "none",
      stages: [],
      reason:
        "上一跑是被取消的 —— 这一跑没有结论，**不是产物坏了**（把它写成红就是替平台编一个不存在的故障）",
    };
  if (state !== "failed")
    return {
      action: "no-fact",
      stages: [],
      reason: `判定是「${state}」，不构成结论 ⇒ 不写`,
    };
  if (failedNames.length === 0)
    return {
      action: "no-fact",
      stages: [],
      reason:
        "整跑判成真失败，却认不出是哪一格红的 ⇒ 不知道往哪张单上记，先不动账（认不出格名 = 判据没跑起来，不是「没有红」）",
    };
  if (!existing)
    return {
      action: "no-fact",
      stages: [],
      reason:
        "开着的单列表取不到 —— 「查不到已有单」不等于「没有已有单」，据它新建就是每天多一张重复单",
    };
  return {
    action: "write",
    stages: failedNames.map((stage) => {
      const hit = existing.find((e) => e.title.includes(titleKey(stage)));
      return hit ? { stage, number: hit.number } : { stage };
    }),
  };
}

/**
 * 拼正文：只有事实与出口。
 *
 * @param {{slug:string, build:any, sn:string, stage:string, skipped:string[],
 *   readout:string[], handle:string, escalation?:string}} input
 * @returns {string}
 */
export function composeBody({
  slug,
  build,
  sn,
  stage,
  skipped,
  readout,
  handle,
  escalation = "",
}) {
  return [
    commentHeader(handle),
    "",
    "## 症状（由每日那一跑自动立案，正文只含读数）",
    "",
    `- 构建：\`${sn}\` · 事件 \`${String(build.event ?? "(无)")}\` · 时刻 ${String(
      build.createTime ?? "(无)",
    )}`,
    `- 红在：**「${stage}」**`,
    skipped.length > 0
      ? `- 被它带下去、**根本没跑**的格：${skipped.join("、")}` +
        "（其中 `每日单元测试` / `每日全量E2E` 的唯一执行者就在这条链上，§13.5.21）"
      : "- 这一跑没有「被带下去没跑」的格。",
    "",
    "## 当场读数（平台原样摘录）",
    "",
    "```",
    readout.join("\n").trim() ||
      "(这一格的日志正文没取到 —— 那句不是「日志里没有失败行」，是**取不到**)",
    "```",
    ...(escalation ? ["", escalation] : []),
    "",
    "## 根因：**未判定**",
    "",
    "这一格只把「红了」变成一张单，不替任何人判「是谁的错、为什么红」。定性走既有出口：",
    "",
    `- \`pnpm ship --diagnose ${sn}\` —— 只读取回失败格与失败行（本正文的读数就来自同一条链）`,
    "- `node scripts/base-check.mjs <那条门禁>` —— 分清「红是我的还是主干的」（§13.6.2）",
    "- 拿不到的测量按**没有结论**处理：`2` 不算绿，也不算红（#1747 那条口径）",
    "",
    `日志出处：https://cnb.cool/${slug}/-/build/logs/${sn}`,
    "",
    "> 本单由 `scripts/ci-daily-failure-issue.mjs` 建。判据链复用既有那几份" +
      "（`check-daily-attendance` 取派发、`ci-build-readout` 定性与取逐格），没有第二套判决。",
    "> 同一格再次红时**不新建**，在这张单下追加一条读数 —— 号一关，欠着的东西连可见性都没了。",
  ].join("\n");
}

/**
 * 写一条评论（同一格已有 open 单那一支）。
 *
 * 实现只有一份（`ship-issue-new.mjs` 的 `runAppendIssueComment`）：PR 档那一格要的是
 * **逐字相同**的一条写后回读，抄一份就得到「两份回读各自漂」（§12.12 / ISSUE #2332）。
 *
 * @param {{run:any, log:(s:string)=>void}} io
 * @param {string} slug
 * @param {number} number
 * @param {string} body
 * @param {string} sn 用于「写后独立回读」时认出是不是这一条
 * @returns {boolean}
 */
export function appendReading(io, slug, number, body, sn) {
  return runAppendIssueComment({
    run: io.run,
    log: (line) =>
      io.log(`[daily-failure-issue] ${line.replace(/^\[ship\]\s*/, "")}`),
    slug,
    number,
    body,
    marker: sn,
    mkTmp: (name, text) => writeScratch(ROOT, name, text),
  });
}

/**
 * 入口。
 *
 * @param {{argv?:string[], run?:any, log?:(s:string)=>void, slug?:string|null}} [io]
 * @returns {number} `CODE` 之一（带 `--no-block` 时非零都落 0，话术照打）
 */
export function main(io = {}) {
  const argv = io.argv ?? process.argv.slice(2);
  const log = io.log ?? ((s) => console.log(s));
  const run = io.run ?? makeRunner(ROOT);
  const dryRun = argv.includes("--dry-run");
  const noBlock = argv.includes("--no-block");
  const at = argv.indexOf("--from");
  const from = at >= 0 ? argv[at + 1] : undefined;
  const laneAt = argv.indexOf("--lane");
  const laneValue = laneAt >= 0 ? String(argv[laneAt + 1] ?? "").trim() : "";
  const lane = laneValue === "" ? null : laneValue;

  /** @type {(code:number, why:string)=>number} 退码出口：`--no-block` 只改码，不改话术。 */
  const finish = (code, why) => {
    if (code !== CODE.DONE && noBlock) {
      log(
        `[daily-failure-issue] ※ 这一格本该以退码 ${code} 结束（${why}），` +
          "但平台那一跳带 `--no-block`：**不拦路**。上面那句就是它的全部出口 —— " +
          "「看不见」才是这一格唯一的失效形态，别把它改成静默 return。",
      );
      return CODE.DONE;
    }
    return code;
  };

  const slug = io.slug !== undefined ? io.slug : resolveRepoSlug(run);
  if (!slug) {
    log(
      "[daily-failure-issue] 推不出仓库 slug（不在 git 检出里 / 没有远端）⇒ 这一格没有执行者。",
    );
    return finish(CODE.NO_FACT, "推不出仓库 slug");
  }
  /* 机器自起的账用**自己的**名字，不取平台账号昵称（ISSUE #2355）：`gitUser()` 的第一顺位是
   * `CNB_BUILD_USER_NICKNAME`，那是**人**（月读）的昵称 —— 于是每日那几跑建的单挂着
   * `提单人:月读`，而月读根本没写过它们（#2314 / #2310 / #2294 的现场）。署名失真比空着更难查：
   * 读者会顺着那个名字去问人。只在宿主给了 NPC 名字时带上它（`ci-daily:CodeBuddy`），
   * 仍然以 `ci-daily` 开头 —— 这一格首先说的是「这是机器的账」。 */
  const handle = machineHandle("ci-daily", process.env);

  /** @type {any[] | null} */
  let list;
  /** @type {Array<{sn:string,json:any}>} */
  let details;
  /* 离线档里那一跑的**格日志正文**（`stageLogs[sn]`）：预算账触发器要在离线档也能被复现，
   * 否则它只有联网那一条路可测 —— 而那条路上的输入（真红 + 连续几天红）恰恰最难造。 */
  /** @type {Record<string,string> | null} */
  let offlineLogs = null;
  const offline = Boolean(from);
  if (offline) {
    if (!from || !fs.existsSync(from)) {
      log(
        `[daily-failure-issue] --from 那个路径不存在：${from ?? "(空)"} ⇒ 不构成结论（不是「没有红」）`,
      );
      return finish(CODE.NO_FACT, "--from 读不到");
    }
    const parsed = JSON.parse(fs.readFileSync(from, "utf8"));
    /**
     * 认三种形状：裸列表、`{list, details}`（本档自己那两份用例造的）、平台的 `{data:{data:[…]}}`。
     * 一律收成**数组**再往下走 —— 收不成数组就是空列表，读法与「没有每日派发」同一句。
     */
    /** @type {any[]} */
    let rows = [];
    if (Array.isArray(parsed)) rows = parsed;
    else if (Array.isArray(parsed?.list)) rows = parsed.list;
    else if (Array.isArray(parsed?.data?.data)) rows = parsed.data.data;
    else if (Array.isArray(parsed?.data)) rows = parsed.data;
    list = rows;
    details = Array.isArray(parsed?.details) ? parsed.details : [];
    offlineLogs =
      parsed?.stageLogs && typeof parsed.stageLogs === "object"
        ? parsed.stageLogs
        : null;
    log(
      `[daily-failure-issue] 离线档：列表 ${rows.length} 条 · 详情 ${details.length} 跑 · ` +
        `格日志 ${offlineLogs ? Object.keys(offlineLogs).length : 0} 份 ⇒ ` +
        "**强制只读**（离线那份详情与「开着的单」都不是当场取的，据它写平台就是把过期读数写成事实）",
    );
  } else {
    /* 取数按**时间窗**翻，不按条数翻（ISSUE #2392）：60 条在忙的一天只回到约 7.5 小时，
     * 于是列表里唯一的每日类派发就是**正在跑的这一跑**，被排除后得到「有 1 条、无一终态」——
     * 而这一格带着 `--no-block`，平台读数是一格 success，「每日失败自动立案」在最需要它的
     * 那一晚上一个字都没写。盖不住窗口就不构成结论，一次都不写。 */
    const win = fetchBuildsCoveringWindow({
      run,
      slug,
      windowHours: DEFAULT_WINDOW_HOURS,
    });
    if (win.list === null) {
      log("[daily-failure-issue] 取不到构建列表 ⇒ 没有结论，一次都不写。");
      return finish(CODE.NO_FACT, "取不到构建列表");
    }
    if (!win.covered) {
      log(
        `[daily-failure-issue] 取数没盖住 ${DEFAULT_WINDOW_HOURS}h 窗口（${win.note}）⇒ ` +
          "「窗口内没有可立的案」这句话没有依据，一次都不写。",
      );
      return finish(CODE.NO_FACT, `取数没盖住窗口：${win.note}`);
    }
    list = win.list;
    log(`[daily-failure-issue] 取数覆盖自证：${win.note}`);
    details = fetchDailyDetails(run, slug, list);
  }

  /* 形状不对（不是数组）就当空列表：往下那句「列表里没有每日类派发」是它诚实的读法，
   * 比在这里补一条「取不到」的假分支更准 —— 空与坏在这条链上是同一个答案：不动账。 */
  const lanes = laneStages(lane);
  if (lane !== null && lanes.length === 0) {
    /* 认不出的 `--lane` **不许**退化成「不过滤」：那正是 #2595 的形态 —— 名字写错了，
     * 而这一格照样把别的档的红记到自己头上，账面看不出来。宁可没有结论。 */
    const why = `--lane「${lane}」认不出是哪一档（认得的是 ${Object.keys(LANE_STAGES).join(" / ")}）`;
    log(`[daily-failure-issue] ${why} ⇒ 不写。`);
    return finish(CODE.NO_FACT, why);
  }
  if (lanes.length > 0)
    log(`[daily-failure-issue] 这一档的流水线名：${lanes.join(" / ")}`);
  const picked = pickPreviousDaily({
    list: Array.isArray(list) ? list : [],
    details,
    lanes,
  });
  /* 判别靠**字段在不在**，不靠 cast 成 any：cast 会把联合的收窄整条弄丢，
   * 之后每一处 `.sn` / `.outcome` 都变成没人守的自由点。 */
  if ("none" in picked) {
    log(
      `[daily-failure-issue] ${picked.none} ⇒ 这一格没有可立的案，一次都不写。`,
    );
    return finish(CODE.NO_FACT, picked.none);
  }
  const { build, sn } = picked;
  /* 「被取消」与「真失败」的分界那句原话只在 `get-build-stage -v` 的 `data.error` 里，
   * 而 `get-build-status` 的 `stages[]` 没有这一栏 —— 所以「这一跑是被顶掉还是真红」
   * 这件事必须**先补原话再判**（ISSUE #2406）。离线档不联网（那是这一档的规矩），
   * 分类退回只看状态：念得出「被取消」但念不出「谁抢的锁」。
   *
   * `pickPreviousDaily()` 只回答「挑哪一跑」（它用的是**状态**那一层，够用），
   * 判「这一跑该不该立案」用的是下面这一份带原话的分类。 */
  const outcome = offline
    ? picked.outcome
    : classifyBuildOutcome(
        enrichStageErrors(
          run,
          slug,
          sn,
          details.find((d) => String(d.sn) === sn)?.json ?? null,
        ),
      );
  const failedNames = outcome.failed.map((f) => f.name || f.id);
  const skipped = downstreamSkipped(outcome).map((s) => s.name || s.id);
  log(
    `[daily-failure-issue] 上一跑 ${sn} · 事件 ${String(build.event ?? "(无)")} · ` +
      `${String(build.createTime ?? "(无)")} · 判定 ${outcome.state} · ` +
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

  const existing = offline ? [] : openDailyIssues(run, slug);
  const decision = decideAction({
    state: outcome.state,
    failedNames,
    existing,
  });
  if (decision.action === "none" || decision.action === "no-fact") {
    const why = decision.reason ?? "(没给出原因)";
    log(
      `[daily-failure-issue] ${why} ⇒ 不写（没结论既不许落成红字，也不许落成新建单）。`,
    );
    return decision.action === "none" ? CODE.DONE : finish(CODE.NO_FACT, why);
  }

  /* ── 预算账陈旧度触发器（ISSUE #2639）────────────────────────────────
   * 实现（判决行解析 / 门限 / 连续天数 / 正文那一节）整段在
   * `ci-daily-bundle-escalation.mjs`：这里只负责把这一跑的读数递过去、把那句话打出来。
   * 这一段**不参与写不写**：它只给正文多一节 / 少一节，改了预算闸的判定才是越界。 */
  const bundleJudge = judgeBundleStageReading({
    run,
    slug,
    offline,
    offlineLogs,
    outcome,
    sn,
    details,
    lanes,
  });
  const escalation = bundleJudge.section;
  log(
    `[daily-failure-issue] 预算账触发器：${bundleJudge.fired ? "↑ 升级" : "不升级"} —— ${bundleJudge.reason}`,
  );

  const willWrite = offline || dryRun;
  let wrote = true;
  for (const s of decision.stages) {
    const body = composeBody({
      slug,
      build,
      sn,
      stage: s.stage,
      skipped,
      readout,
      handle,
      /* 升级那一节只挂在预算闸那一张单上：别的格的红与这笔账无关，
       * 挂上去就是替它说一句它没有读数支撑的话。 */
      escalation: s.stage === BUNDLE_GATE_STAGE ? escalation : "",
    });
    const title = issueTitle({
      sn,
      event: String(build.event ?? ""),
      at: String(build.createTime ?? ""),
      stage: s.stage,
    });
    if (willWrite) {
      log(
        `[daily-failure-issue] ${offline ? "离线档" : "--dry-run"}：「${s.stage}」` +
          (s.number
            ? `→ 在 #${s.number} 下追加一条读数（不新建）`
            : `→ 新建一张：${title}`) +
          ` · 正文 ${body.length} 字 · 优先级 ${AUTO_PRIORITY} · 一条都没写`,
      );
      continue;
    }
    if (s.number) {
      const ok = appendReading({ run, log }, slug, s.number, body, sn);
      log(
        ok
          ? `[daily-failure-issue] ✓ 同一格又红了一次 ⇒ 已在 #${s.number} 追加一条读数并回读到（不新建）`
          : `[daily-failure-issue] ✗ #${s.number} 的评论没写成或回读不到 ⇒ 手工出口：` +
              `cnb issues post-issue-comment --repo ${slug} --number ${s.number} --body-file <正文文件> -v`,
      );
      if (!ok) wrote = false;
      continue;
    }
    const file = writeScratch(ROOT, "daily-failure-issue", body);
    if (!file) {
      log(
        "[daily-failure-issue] ✗ 取不到 git 目录 ⇒ 正文没有落点，一条都不写。",
      );
      wrote = false;
      continue;
    }
    const code = runNewIssue({
      run,
      log: (line) =>
        log(`[daily-failure-issue] ${line.replace(/^\[ship\]\s*/, "")}`),
      slug,
      handle,
      root: ROOT,
      /* `mkTmp` 是 runNewIssue 要求的「这一次调用的落点」：交给既有那一条 writeScratch ——
       * 它走的是「取 git 目录、取不到就不往工作区猜落点」那套口径，不另写第二份。 */
      mkTmp: (name, text) => writeScratch(ROOT, name, text),
      opt: {
        newIssue: title,
        issueBodyFile: path.relative(ROOT, file),
        priority: AUTO_PRIORITY,
      },
      dryRun: false,
    });
    if (code !== CODE.DONE) {
      log(
        `[daily-failure-issue] ✗ 「${s.stage}」那张单没建成（runNewIssue 退 ${code}）`,
      );
      wrote = false;
      continue;
    }
    log(
      `[daily-failure-issue] ✓ 「${s.stage}」已立案（建 → 补标签 → 独立回读全过）`,
    );
  }
  if (willWrite) return CODE.DONE;
  return wrote ? CODE.DONE : finish(CODE.WRITE_FAILED, "该写的没写成");
}

/* 只在被直接执行时跑 main（被 import 时只暴露纯函数给用例）。 */
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  const exit = main();
  if (exit !== CODE.DONE) {
    process.stderr.write(
      `[daily-failure-issue] 退出码 ${exit}（0 有结论 / 1 该写的没写成 / 2 没结论）\n`,
    );
  }
  process.exit(exit);
}
