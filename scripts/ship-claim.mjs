#!/usr/bin/env node
/**
 * ship-claim.mjs —— 单子的**领取 / 结束释放 / 我的领取列表**（规范 §13.10.11）。
 *
 * 三件事都靠同一枚标签 `处理人:<短名>` 承重，而标签**不是锁**：平台没有 compare-and-set，
 * 两个会话可以同时读到「没有处理人」再各自打上。所以这里做的是「写后独立回读 + 冲突当场
 * 报出来」，而不是承诺互斥 —— 把标签说成锁，比没有这一格更危险（有人会依赖它）。
 *
 * 平台侧的取证（本轮实测）：
 *   · 原生 assignee **用不了**：`can-user-be-assigned-to-issue` 对 `yuedu-win` 回 400
 *     `has not permission to be assigned`；而账号名本身跨并行检出逐字相同（#2175）。
 *   · `post-issue-labels` / `delete-issue-label` 可写、`get-issue` 回读得到 `labels`。
 *   · 评论走 `post-issue-comment --body-file`，`list-issue-comments --sort -created` 回读。
 *
 * 三条与 `ship-close.mjs` 同一族的纪律：
 *   1. **回执不算结论**。打标签、发评论、撤标签三处都各自再问平台一次。
 *   2. **取不到读数就落 2**（没有结论），不把「读不到」念成「没有」或「已经做完」。
 *   3. **不替别人说话**：单子在别人名下时既不领取、也不代发「开发结束」。
 */

import path from "node:path";

import { asArray, CODE } from "./ship-core.mjs";
import { cnbJson } from "./ship-exec.mjs";
import {
  DEV_HANDLE_ENV_KEY,
  handlerLabel,
  handlerSignature,
  ISSUE_LABEL_ROLES,
  labelValues,
} from "./ship-ticket.mjs";

/**
 * 单子评论的第一行 —— 回读时按它认「这一条是不是这个动作写的」。
 *
 * @param {string} handle 留痕短名
 * @returns {string}
 */
export function claimComment(handle) {
  return `开发者 ${handle} 已接单，正在开发中。\n\n${handlerSignature(handle)}`;
}

/** @param {string} handle 留痕短名 */
export function releaseComment(handle) {
  return `开发者 ${handle} 开发结束。\n\n${handlerSignature(handle)}`;
}

/**
 * 最新一条**属于这个人的状态评论**是哪一种。
 *
 * 为什么不是「有没有出现过」：同一张单可以「领取 → 结束 → 再领取」，而两轮的文案逐字相同。
 * 只看出现过就会把上一轮那句「开发结束」当成这一轮的结论 —— 于是重领之后第一次 release
 * 不再发评论。`list-issue-comments` 按 `-created` 取，所以第一条命中的就是最新状态。
 *
 * @param {string[]} bodies 评论正文（**新到旧**）
 * @param {string} handle 留痕短名
 * @returns {"claim"|"release"|null}
 */
export function handleCommentState(bodies, handle) {
  const claim = claimComment(handle).split("\n", 1)[0] ?? "";
  const release = releaseComment(handle).split("\n", 1)[0] ?? "";
  for (const body of Array.isArray(bodies) ? bodies : []) {
    const text = String(body ?? "");
    if (text.includes(claim)) return "claim";
    if (text.includes(release)) return "release";
  }
  return null;
}

/**
 * 「这张单能不能领取」—— 纯判断，不起进程。
 *
 * 三种不许领：不在 open（状态已定）、已在别人名下、我和别人同时挂着（冲突要人裁定）。
 * 已经在我名下是**幂等**（`act:true, already:true`）：重跑只补可能缺的那条评论。
 *
 * @param {{number:number, state:string, labels:any[], handle:string|null}} input
 * @returns {{act:boolean, code:number|null, already:boolean, others:string[], reason:string}}
 */
export function decideClaim({ number, state, labels, handle }) {
  const name = String(handle ?? "").trim();
  const empty = { act: false, already: false, others: [], reason: "" };
  if (!name) {
    return { ...empty, code: CODE.NOT_RUN, reason: "没配留痕短名 ⇒ 写不出「谁接单」" };
  }
  if (state !== "open") {
    return {
      ...empty,
      code: CODE.RED,
      reason: `#${number} 的状态是 ${state || "(取不到)"}，不是 open ⇒ 不领取。`,
    };
  }
  const handlers = labelValues(labels, ISSUE_LABEL_ROLES.handler);
  const mine = handlers.includes(name);
  const others = handlers.filter((x) => x !== name);
  if (mine && others.length > 0) {
    return {
      ...empty,
      code: CODE.RED,
      others,
      reason:
        `#${number} 同时挂着 处理人:${name} 与 处理人:${others.join("、")} ⇒ 冲突，` +
        "这一格要人裁定（本脚本不替谁撤标签）。",
    };
  }
  if (others.length > 0) {
    return {
      ...empty,
      code: CODE.RED,
      others,
      reason:
        `#${number} 已在 处理人:${others.join("、")} 名下 ⇒ 不领取、不开工。` +
        "你仍然可以在单子上评论（评论不经过这一格）。",
    };
  }
  return { act: true, code: null, already: mine, others: [], reason: "" };
}

/**
 * 「这张单能不能释放」—— 纯判断。
 *
 * 不在我名下：单子开着就是红（不能替别人释放）；单子已关闭且没有我的标签就是**无需动作**
 * （绿）—— 关单那一路收尾已经做过这件事。
 *
 * @param {{number:number, state:string, labels:any[], handle:string|null}} input
 * @returns {{act:boolean, code:number|null, others:string[], reason:string}}
 */
export function decideRelease({ number, state, labels, handle }) {
  const name = String(handle ?? "").trim();
  if (!name) {
    return {
      act: false,
      code: CODE.NOT_RUN,
      others: [],
      reason: "没配留痕短名 ⇒ 不知道要释放哪一枚标签",
    };
  }
  const handlers = labelValues(labels, ISSUE_LABEL_ROLES.handler);
  const mine = handlers.includes(name);
  const others = handlers.filter((x) => x !== name);
  if (!mine) {
    if (state === "open") {
      return {
        act: false,
        code: CODE.RED,
        others,
        reason:
          `#${number} 不在你名下（当前 处理人:${others.join("、") || "无"}）` +
          " ⇒ 不替你释放别人的单子。",
      };
    }
    return {
      act: false,
      code: CODE.GREEN,
      others,
      reason:
        `#${number} 的状态是 ${state || "(取不到)"}，而你名下没有 处理人:${name}` +
        " ⇒ 无需释放。",
    };
  }
  return { act: true, code: null, others, reason: "" };
}

/**
 * `get-issue` 的回读 → 这一层要的四件原值。
 *
 * @param {{run:any, slug:string, number:number}} ctx
 * @returns {{number:number,state:string,title:string,priority:string,labels:any[]} | null} 取不到回 null
 */
export function readIssue({ run, slug, number }) {
  const got = cnbJson(run, [
    "issues",
    "get-issue",
    "--repo",
    slug,
    "--number",
    String(number),
    "-v",
  ]);
  const d = got?.json?.data;
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  return {
    number: Number(d.number ?? number),
    state: String(d.state ?? ""),
    title: String(d.title ?? ""),
    priority: String(d.priority ?? "?"),
    labels: Array.isArray(d.labels) ? d.labels : [],
  };
}

/**
 * 评论正文（**新到旧**）。取不到回 null —— 空数组会被读成「查过了、没有」，
 * 而 null 才是「没拿到列表」。
 *
 * @param {{run:any, slug:string, number:number}} ctx
 * @returns {string[] | null}
 */
export function readCommentBodies({ run, slug, number }) {
  const got = cnbJson(run, [
    "issues",
    "list-issue-comments",
    "--repo",
    slug,
    "--number",
    String(number),
    "--sort",
    "-created",
    "--page-size",
    "100",
    "-v",
  ]);
  if (!got) return null;
  const list = asArray(got.json);
  if (!list) return null;
  return list.map((c) => String(c?.body ?? ""));
}

/**
 * 写一条状态评论，并**独立回读**确认它是这个人的最新状态。
 *
 * 已经是最新状态就不重复发（幂等）；写出去之后回读里看不到也落 2 —— 回执不是结论。
 *
 * @param {{run:any, log:(s:string)=>void, slug:string, number:number, handle:string, kind:"claim"|"release", mkTmp:(name:string,text:string)=>string|null}} ctx
 * @returns {number} `CODE` 之一
 */
function ensureComment(ctx) {
  const { run, log, slug, number, handle, kind, mkTmp } = ctx;
  const bodies = readCommentBodies({ run, slug, number });
  if (!bodies) {
    log(
      `[ship] #${number} 取不到评论列表 ⇒ 不写评论（写出去也证明不了它落地）`,
    );
    return CODE.NOT_RUN;
  }
  if (handleCommentState(bodies, handle) === kind) {
    log(
      `[ship] #${number} 最新一条状态评论已经是「${kind === "claim" ? "已接单" : "开发结束"}」` +
        "（同一个人，不重复发）",
    );
    return CODE.GREEN;
  }
  const text = kind === "claim" ? claimComment(handle) : releaseComment(handle);
  const file = mkTmp("ship-issue-comment", text);
  if (!file) {
    log(`[ship] #${number} 取不到 git 目录 ⇒ 评论正文没有落点，这一格没有执行者`);
    return CODE.NOT_RUN;
  }
  cnbJson(run, [
    "issues",
    "post-issue-comment",
    "--repo",
    slug,
    "--number",
    String(number),
    "--body-file",
    file,
    "-v",
  ]);
  const back = readCommentBodies({ run, slug, number });
  if (!back) {
    log(`[ship] #${number} 评论写后回读没跑起来 ⇒ 不念「已评论」`);
    return CODE.NOT_RUN;
  }
  if (handleCommentState(back, handle) !== kind) {
    log(
      `[ship] #${number} 评论写后回读里看不到刚写的那条 ⇒ 不念「已评论」` +
        "（可能是并发写了别的状态，先去看一眼评论）",
    );
    return CODE.NOT_RUN;
  }
  log(`[ship] ✓ #${number} 评论已回读（list-issue-comments）：${text.split("\n", 1)[0]}`);
  return CODE.GREEN;
}

/**
 * 打上 `处理人:<我>` 并回读。回读里出现第二个处理人 ⇒ 红（冲突），不念「已打上」。
 *
 * @param {{run:any, log:(s:string)=>void, slug:string, number:number, handle:string}} ctx
 * @returns {{code:number, others:string[]}}
 */
function applyHandlerLabel(ctx) {
  const { run, log, slug, number, handle } = ctx;
  const label = handlerLabel(handle);
  if (!label) return { code: CODE.NOT_RUN, others: [] };
  cnbJson(run, [
    "issues",
    "post-issue-labels",
    "--repo",
    slug,
    "--number",
    String(number),
    "--labels",
    label,
    "-v",
  ]);
  const back = readIssue({ run, slug, number });
  if (!back) {
    log(
      `[ship] #${number} 标签写后回读没跑起来 ⇒ 不念「已打上」` +
        "（下一动作：再跑一次 `pnpm ship --claim`，已在名下时是幂等）",
    );
    return { code: CODE.NOT_RUN, others: [] };
  }
  const handlers = labelValues(back.labels, ISSUE_LABEL_ROLES.handler);
  const others = handlers.filter((x) => x !== handle);
  if (!handlers.includes(handle)) {
    log(`[ship] #${number} 的回读里没有 ${label} ⇒ 不念「已打上」`);
    return { code: CODE.NOT_RUN, others };
  }
  if (others.length > 0) {
    log(
      `[ship] ✗ #${number} 回读里同时有 处理人:${handle} 与 处理人:${others.join("、")}` +
        " ⇒ 冲突：标签不是锁，这一格要人裁定（不要直接开工）",
    );
    return { code: CODE.RED, others };
  }
  log(`[ship] ✓ #${number} 已打上 ${label}（get-issue 回读）`);
  return { code: CODE.GREEN, others };
}

/**
 * 撤掉 `处理人:<我>` 并回读。回读里还在 ⇒ 红。
 *
 * @param {{run:any, log:(s:string)=>void, slug:string, number:number, handle:string}} ctx
 * @returns {number} `CODE` 之一
 */
function dropHandlerLabel(ctx) {
  const { run, log, slug, number, handle } = ctx;
  const label = handlerLabel(handle);
  if (!label) return CODE.NOT_RUN;
  cnbJson(run, [
    "issues",
    "delete-issue-label",
    "--repo",
    slug,
    "--number",
    String(number),
    "--name",
    label,
    "-v",
  ]);
  const back = readIssue({ run, slug, number });
  if (!back) {
    log(`[ship] #${number} 撤标签后回读没跑起来 ⇒ 不念「已释放」`);
    return CODE.NOT_RUN;
  }
  if (labelValues(back.labels, ISSUE_LABEL_ROLES.handler).includes(handle)) {
    log(`[ship] ✗ #${number} 的回读里 ${label} 还在 ⇒ 撤没掉`);
    return CODE.RED;
  }
  log(`[ship] ✓ #${number} 已撤掉 ${label}（get-issue 回读）`);
  return CODE.GREEN;
}

/**
 * `--claim`：先打标签（排除别人后到的人）再发评论，两件都独立回读。
 *
 * 顺序是有理由的：标签先落地，别人刷新时立刻看得见；评论晚一步失败时，标签还在，
 * 重跑一次会**只补评论**（幂等），不会出现「评论说在开发、但谁都能抢」的窗口。
 *
 * @param {{run:any, log:(s:string)=>void, slug:string, handle:string, number:number, dryRun?:boolean, mkTmp:any}} ctx
 * @returns {number} `CODE` 之一
 */
function runClaim(ctx) {
  const { run, log, slug, handle, number, dryRun = false, mkTmp } = ctx;
  const issue = readIssue({ run, slug, number });
  if (!issue) {
    log(`[ship] #${number} 取不到单子 ⇒ 这一格没有结论（不是「已领取」）`);
    return CODE.NOT_RUN;
  }
  const plan = decideClaim({
    number,
    state: issue.state,
    labels: issue.labels,
    handle,
  });
  if (!plan.act) {
    log(`[ship] ${plan.reason}`);
    return plan.code ?? CODE.RED;
  }
  const label = handlerLabel(handle);
  if (dryRun) {
    log(
      `[ship] --dry-run：` +
        (plan.already
          ? `#${number} 已在 ${label} 名下 ⇒ 只会补一条「已接单」评论`
          : `#${number} 将打上 ${label}，再评论「开发者 ${handle} 已接单，正在开发中。」`) +
        "；一条都没写。",
    );
    return CODE.GREEN;
  }
  if (!plan.already) {
    const put = applyHandlerLabel({ run, log, slug, number, handle });
    if (put.code !== CODE.GREEN) return put.code;
  } else {
    log(`[ship] #${number} 已经挂着 ${label} ⇒ 不重复打标签（幂等）`);
  }
  return ensureComment({ run, log, slug, number, handle, kind: "claim", mkTmp });
}

/**
 * `--release`：先发「开发结束」评论，**再**撤标签。
 *
 * 顺序与 claim 相反：撤标签是「别人可以接了」的开关，而公开的结束声明必须先成立。
 * 评论没落地就保留标签并落 2 —— 不能出现「标签没了、单子上也没人说结束了」。
 *
 * @param {{run:any, log:(s:string)=>void, slug:string, handle:string, number:number, dryRun?:boolean, mkTmp:any}} ctx
 * @returns {number} `CODE` 之一
 */
function runRelease(ctx) {
  const { run, log, slug, handle, number, dryRun = false, mkTmp } = ctx;
  const issue = readIssue({ run, slug, number });
  if (!issue) {
    log(`[ship] #${number} 取不到单子 ⇒ 这一格没有结论（不是「已释放」）`);
    return CODE.NOT_RUN;
  }
  const plan = decideRelease({
    number,
    state: issue.state,
    labels: issue.labels,
    handle,
  });
  if (!plan.act) {
    log(`[ship] ${plan.reason}`);
    return plan.code ?? CODE.RED;
  }
  if (dryRun) {
    log(
      `[ship] --dry-run：#${number} 将评论「开发者 ${handle} 开发结束。」，` +
        `再撤 ${handlerLabel(handle)}；一条都没写。`,
    );
    return CODE.GREEN;
  }
  if (plan.others.length > 0) {
    log(
      `[ship] #${number} 同时挂着 处理人:${plan.others.join("、")} —— ` +
        "这一跑只撤你自己那枚，不动别人。",
    );
  }
  const said = ensureComment({
    run,
    log,
    slug,
    number,
    handle,
    kind: "release",
    mkTmp,
  });
  if (said !== CODE.GREEN) {
    log(
      `[ship] #${number} 的结束评论没有落地 ⇒ **保留** ${handlerLabel(handle)} 标签` +
        "（先有公开的结束声明，再撤标签）。",
    );
    return said;
  }
  return dropHandlerLabel({ run, log, slug, number, handle });
}

/**
 * `--claims`：列出自己领取中（`state=open`）的单子。
 *
 * 分页上限 10 页（1000 张）是刻意的：它是「看一眼手头」的读数，不是报表；
 * 到顶会明说「只看了前 N 张」，不把截断念成全部。
 *
 * @param {{run:any, log:(s:string)=>void, slug:string, handle:string}} ctx
 * @returns {number} `CODE` 之一
 */
function runClaims(ctx) {
  const { run, log, slug, handle } = ctx;
  const label = handlerLabel(handle);
  if (!label) return CODE.NOT_RUN;
  const pageSize = 100;
  /** @type {{number:number, priority:string, title:string}[]} */
  const rows = [];
  let pages = 0;
  let truncated = false;
  for (let page = 1; page <= 10; page += 1) {
    const got = cnbJson(run, [
      "issues",
      "list-issues",
      "--repo",
      slug,
      "--labels",
      label,
      "--state",
      "open",
      "--page",
      String(page),
      "--page-size",
      String(pageSize),
      "-v",
    ]);
    if (!got) {
      log(`[ship] 取不到单子列表（第 ${page} 页）⇒ 这一格没有结论，不念「没有领取中的单子」`);
      return CODE.NOT_RUN;
    }
    const list = asArray(got.json);
    if (!list) {
      log(`[ship] 单子列表的形状认不出来（第 ${page} 页）⇒ 这一格没有结论`);
      return CODE.NOT_RUN;
    }
    for (const item of list) {
      rows.push({
        number: Number(item?.number ?? 0),
        priority: String(item?.priority ?? "?"),
        title: String(item?.title ?? ""),
      });
    }
    pages = page;
    if (list.length < pageSize) break;
    if (page === 10) truncated = true;
  }
  log(
    `[ship] 你领取中的单子（${label} · state=open）：${rows.length} 张` +
      (truncated ? `（只看了前 ${pages * pageSize} 张，分页到顶）` : ""),
  );
  if (rows.length === 0) {
    log("[ship] 没有你领取中的单子。");
    return CODE.GREEN;
  }
  for (const r of rows) {
    log(`[ship]   #${r.number} · ${r.priority} · ${r.title}`);
  }
  return CODE.GREEN;
}

/**
 * 关单之后那一步：补「开发结束」评论、撤自己的处理人标签（`ship-close.mjs` 调用）。
 *
 * 三条边界：
 *   · **不替别人说话**：处理人不是我（或没有这枚标签）就不发评论、不动标签 ——
 *     单子可能是别人在收尾，代发一句「开发结束」等于替别人宣布了状态。
 *   · 评论失败就保留标签（与 `runRelease` 同一条顺序理由）。
 *   · 未配留痕是**读数**：不阻断关单，只是这一格没有可留的痕。
 *
 * @param {{run:any, log:(s:string)=>void, slug:string, handle:string|null, number:number, mkTmp:any}} ctx
 * @returns {number} `CODE` 之一
 */
export function finishIssueWork(ctx) {
  const { run, log, slug, handle, number, mkTmp } = ctx;
  const name = String(handle ?? "").trim();
  if (!name) {
    log(`[ship] #${number}：未配留痕 ⇒ 不代发结束评论、不动 处理人 标签。`);
    return CODE.GREEN;
  }
  const issue = readIssue({ run, slug, number });
  if (!issue) {
    log(`[ship] #${number} 关单后取不到单子 ⇒ 结束评论与标签这一格没有结论`);
    return CODE.NOT_RUN;
  }
  const handlers = labelValues(issue.labels, ISSUE_LABEL_ROLES.handler);
  if (!handlers.includes(name)) {
    log(
      `[ship] #${number} 的处理人${
        handlers.length > 0 ? `是 ${handlers.join("、")}` : "标签不在场"
      } ⇒ 不代发「开发结束」、不动标签。`,
    );
    return CODE.GREEN;
  }
  const others = handlers.filter((x) => x !== name);
  if (others.length > 0) {
    log(
      `[ship] #${number} 同时挂着 处理人:${others.join("、")} —— 只结束你自己的那一份。`,
    );
  }
  const said = ensureComment({
    run,
    log,
    slug,
    number,
    handle: name,
    kind: "release",
    mkTmp,
  });
  if (said !== CODE.GREEN) {
    log(
      `[ship] #${number} 的结束评论没有落地 ⇒ **保留** ${handlerLabel(name)} 标签。`,
    );
    return said;
  }
  return dropHandlerLabel({ run, log, slug, number, handle: name });
}

/**
 * `--claim` / `--release` / `--claims` 的入口：先做**互斥与前置**判断，再分派。
 *
 * 三条独立动作，一次只做一件；也不与主流程（合并 / 关单 / 清分支 / 提交面）同跑 ——
 * 「领一张单」和「把代码合进主干」是两件事，混在一跑里出问题时读不出是哪一半。
 *
 * @param {{
 *   run:any,
 *   log:(s:string)=>void,
 *   slug:string|null,
 *   cnbOk:boolean,
 *   handle:string|null,
 *   root:string,
 *   opt:any,
 *   mkTmp:(name:string,text:string)=>string|null,
 *   dryRun?:boolean,
 * }} ctx
 * @returns {number} `CODE` 之一
 */
export function runIssueAction(ctx) {
  const { run, log, slug, cnbOk, handle, root, opt, mkTmp, dryRun = false } = ctx;
  const claimBad = /** @type {string[]} */ (opt.claimBad ?? []);
  const releaseBad = /** @type {string[]} */ (opt.releaseBad ?? []);
  const bad = [
    ...claimBad.map((x) => `--claim ${x}`),
    ...releaseBad.map((x) => `--release ${x}`),
  ];
  if (bad.length > 0) {
    log(
      `[ship] [ERROR] --claim / --release 收的是一张单的号（2 位以上数字，可写 #2179）；` +
        `这一次这些不能当号用：${bad.join(" ")}`,
    );
    log("[ship] 一个都不认 ⇒ 不动任何单子，也不去猜是哪一张。");
    return CODE.NOT_RUN;
  }
  const wanted = [
    opt.claim != null ? "--claim" : null,
    opt.release != null ? "--release" : null,
    opt.claims ? "--claims" : null,
  ].filter(Boolean);
  if (wanted.length > 1) {
    log(`[ship] [ERROR] 一次只做一件事：拿到 ${wanted.join(" + ")}`);
    return CODE.NOT_RUN;
  }
  if (wanted.length === 0) return CODE.NOT_RUN;
  const clashes = [
    opt.merge ? "--merge" : null,
    opt.closeIssue ? "--close-issue" : null,
    opt.cleanBranch ? "--clean-branch" : null,
    opt.branch ? "--branch" : null,
    opt.message != null ? "--message" : null,
    opt.messageFile != null ? "--message-file" : null,
    opt.title != null ? "--title" : null,
    opt.adds.length > 0 ? "--add" : null,
    opt.only ? "--only" : null,
  ].filter(Boolean);
  if (clashes.length > 0) {
    log(
      `[ship] [ERROR] 单子的 ${wanted[0]} 只做那一件事，不与 ${clashes.join(" / ")} 同跑。` +
        "分成两次：先领取 / 释放，再跑合并那一趟。",
    );
    return CODE.NOT_RUN;
  }
  if (!cnbOk || !slug) {
    log(
      `[ship] 这一格没有执行者（${cnbOk ? "仓库 slug 取不到" : "cnb 不在"}）` +
        " ⇒ 不读写任何单子。",
    );
    return CODE.NOT_RUN;
  }
  const name = String(handle ?? "").trim();
  if (!name) {
    log(
      `[ship] 领取 / 结束 / 列表要 ${DEV_HANDLE_ENV_KEY}（这一份检出没配）` +
        ` ⇒ 现在写不出「谁」。在 \`${path.join(root || ".", ".env")}\` 填一行 ` +
        `\`${DEV_HANDLE_ENV_KEY}="<短名>"\`（整行不在时先跑 \`pnpm env:init\`）。`,
    );
    return CODE.NOT_RUN;
  }
  if (opt.claims) return runClaims({ run, log, slug, handle: name });
  if (opt.claim != null) {
    return runClaim({
      run,
      log,
      slug,
      handle: name,
      number: opt.claim,
      dryRun,
      mkTmp,
    });
  }
  return runRelease({
    run,
    log,
    slug,
    handle: name,
    number: opt.release,
    dryRun,
    mkTmp,
  });
}
