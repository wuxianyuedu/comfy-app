#!/usr/bin/env node
/**
 * ship-claim.mjs —— 单子的**领取 / 结束释放 / 我的领取列表**（规范 §13.10.11）。
 *
 * 三件事靠两枚标签分工：`处理人:<短名>` 是**当前状态**（领取时打、结束即撤），
 * `参与人:<短名>` 是**只增不删的经手记录**（结束、关单都不撤）。两者都不是锁：
 * 平台没有 compare-and-set，两个会话可以同时读到「没有处理人」再各自打上。所以这里
 * 做的是「写后独立回读 + 冲突当场报出来」，而不是承诺互斥 —— 把标签说成锁，比没有
 * 这一格更危险（有人会依赖它）。
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

import { asArray } from "./ship-build.mjs";
import { appendComment, readCommentBodies } from "./ship-comment.mjs";
import { CODE } from "./ship-core.mjs";
import { cnbJson } from "./ship-exec.mjs";
import {
  withCommentHeader,
  handlerLabel,
  ISSUE_LABEL_ROLES,
  labelValues,
  participantLabel,
} from "./ship-ticket.mjs";

/**
 * 状态评论里那句人话。领取 / 结束共用一处生成 —— **回读判据也用它**：
 * 署名对两种动作逐字相同（只有「谁写的」），拿它判动作会把两条都认成第一条。
 *
 * @param {"claim"|"release"} kind 动作
 * @param {string} handle 留痕短名
 * @returns {string}
 */
function commentSentence(kind, handle) {
  return kind === "claim" ? `开发者 ${handle} 已接单，正在开发中。` : `开发者 ${handle} 开发结束。`;
}

/**
 * 单子评论 —— 开头一行粗体署名，正文那句人话由 `commentSentence` 统一给。
 * 回读认的是**正文那句**，不是第一行。
 *
 * @param {string} handle 留痕短名
 * @returns {string}
 */
export function claimComment(handle) {
  return withCommentHeader(commentSentence("claim", handle), handle);
}

/** @param {string} handle 留痕短名 */
export function releaseComment(handle) {
  return withCommentHeader(commentSentence("release", handle), handle);
}

/**
 * 最新一条**属于这个人的状态评论**是哪一种。
 *
 * 为什么不是「有没有出现过」：同一张单可以「领取 → 结束 → 再领取」，而两轮的文案逐字相同。
 * 只看出现过就会把上一轮那句「开发结束」当成这一轮的结论 —— 于是重领之后第一次 release
 * 不再发评论。`list-issue-comments` 按 `-created` 取，所以第一条命中的就是最新状态。
 *
 * 判据取正文那句（`commentSentence`）而不是首行署名：两种动作的署名逐字相同，
 * 用它判会把 release 认成 claim。旧格式（末尾 `处理人:`）的评论同样含这句，仍认得出。
 *
 * @param {string[]} bodies 评论正文（**新到旧**）
 * @param {string} handle 留痕短名
 * @returns {"claim"|"release"|null}
 */
export function handleCommentState(bodies, handle) {
  const claim = commentSentence("claim", handle);
  const release = commentSentence("release", handle);
  for (const body of Array.isArray(bodies) ? bodies : []) {
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- bodies 是平台评论正文（外部数据），元素运行时可为 null
    const text = String(body ?? "");
    if (text.includes(claim)) {
      return "claim";
    }
    if (text.includes(release)) {
      return "release";
    }
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
    return {
      ...empty,
      code: CODE.NOT_RUN,
      reason: "没配留痕短名 ⇒ 写不出「谁接单」",
    };
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
        `#${number} 的状态是 ${state || "(取不到)"}，而你名下没有 处理人:${name}` + " ⇒ 无需释放。",
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
  if (!d || typeof d !== "object" || Array.isArray(d)) {
    return null;
  }
  return {
    number: Number(d.number ?? number),
    state: String(d.state ?? ""),
    title: String(d.title ?? ""),
    priority: String(d.priority ?? "?"),
    labels: Array.isArray(d.labels) ? d.labels : [],
  };
}

/**
 * 评论的**写 + 回读**只有一份（`ship-comment.mjs`）：`--comment` 那一格用的是同一条链，
 * 各写一份就回到 #2719 收掉之前那种「一边补了回读、另一边没有」。
 */

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
    log(`[ship] #${number} 取不到评论列表 ⇒ 不写评论（写出去也证明不了它落地）`);
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
  const wrote = appendComment({
    run,
    log,
    slug,
    number,
    body: text,
    mkTmp,
  });
  if (!wrote.posted) {
    log(`[ship] #${number} 评论写那一步没跑起来 ⇒ 不念「已评论」`);
    return CODE.NOT_RUN;
  }
  if (!wrote.bodies) {
    log(`[ship] #${number} 评论写后回读没跑起来 ⇒ 不念「已评论」`);
    return CODE.NOT_RUN;
  }
  if (handleCommentState(wrote.bodies, handle) !== kind) {
    log(
      `[ship] #${number} 评论写后回读里看不到刚写的那条 ⇒ 不念「已评论」` +
        "（可能是并发写了别的状态，先去看一眼评论）",
    );
    return CODE.NOT_RUN;
  }
  log(`[ship] ✓ #${number} 评论已回读（list-issue-comments）：${commentSentence(kind, handle)}`);
  return CODE.GREEN;
}

/**
 * 领取时写两枚标签，写完**一次**独立回读同时验证三件：
 *   · `处理人:<我>` 在场 —— 它是「当前谁在做」的唯一锁，结束即撤；
 *   · `参与人:<我>` 在场 —— 只增不删的经手记录，结束后仍留着；
 *   · 没有第二个 `处理人:` —— 标签不是锁，冲突要人裁定。
 *
 * 只写回读里缺的那几枚：已经在场的不重复发（`--claim` 重跑是幂等）。
 *
 * @param {{run:any, log:(s:string)=>void, slug:string, number:number, handle:string, needHandler:boolean, needParticipant:boolean}} ctx
 * @returns {{code:number, others:string[]}}
 */
function applyClaimLabels(ctx) {
  const { run, log, slug, number, handle, needHandler, needParticipant } = ctx;
  const label = handlerLabel(handle);
  const participant = participantLabel(handle);
  if (!label || !participant) {
    return { code: CODE.NOT_RUN, others: [] };
  }
  for (const [needed, name] of /** @type {[boolean, string][]} */ ([
    [needHandler, label],
    [needParticipant, participant],
  ])) {
    if (!needed) {
      continue;
    }
    cnbJson(run, [
      "issues",
      "post-issue-labels",
      "--repo",
      slug,
      "--number",
      String(number),
      "--labels",
      name,
      "-v",
    ]);
  }
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
  if (!labelValues(back.labels, ISSUE_LABEL_ROLES.participant).includes(handle)) {
    log(`[ship] #${number} 的回读里没有 ${participant} ⇒ 不念「已打上」`);
    return { code: CODE.NOT_RUN, others };
  }
  if (others.length > 0) {
    log(
      `[ship] ✗ #${number} 回读里同时有 处理人:${handle} 与 处理人:${others.join("、")}` +
        " ⇒ 冲突：标签不是锁，这一格要人裁定（不要直接开工）",
    );
    return { code: CODE.RED, others };
  }
  log(`[ship] ✓ #${number} 已打上 ${label} 与 ${participant}（get-issue 回读：两枚都看得见）`);
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
  if (!label) {
    return CODE.NOT_RUN;
  }
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
  log(
    `[ship] ✓ #${number} 已撤掉 ${label}（get-issue 回读；${participantLabel(handle)} 保留 —— 经手记录只增不删）`,
  );
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
  const participant = participantLabel(handle);
  /* 两枚标签的生命周期不同：`处理人:` 结束即撤，`参与人:` 只增不删。所以「要不要写」
   * 分开判 —— 旧单（本功能之前领的）只有 `处理人:`，重跑一次要把 `参与人:` 补齐。 */
  const haveHandler = labelValues(issue.labels, ISSUE_LABEL_ROLES.handler).includes(handle);
  const haveParticipant = labelValues(issue.labels, ISSUE_LABEL_ROLES.participant).includes(handle);
  if (dryRun) {
    const planned = [
      ...(haveHandler ? [] : [`打上 ${label}`]),
      ...(haveParticipant ? [] : [`打上 ${participant}`]),
    ];
    log(
      `[ship] --dry-run：${
        planned.length === 0
          ? `#${number} 已在 ${label} 与 ${participant} 名下 ⇒ 只会补一条「已接单」评论`
          : `#${number} 将 ${planned.join("、")}，再评论「开发者 ${handle} 已接单，正在开发中。」`
        }；一条都没写。`,
    );
    return CODE.GREEN;
  }
  if (!haveHandler || !haveParticipant) {
    const put = applyClaimLabels({
      run,
      log,
      slug,
      number,
      handle,
      needHandler: !haveHandler,
      needParticipant: !haveParticipant,
    });
    if (put.code !== CODE.GREEN) {
      return put.code;
    }
  } else {
    log(`[ship] #${number} 已经挂着 ${label} 与 ${participant} ⇒ 不重复打标签（幂等）`);
  }
  return ensureComment({
    run,
    log,
    slug,
    number,
    handle,
    kind: "claim",
    mkTmp,
  });
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
        `再撤 ${handlerLabel(handle)}（${participantLabel(handle)} 保留）；一条都没写。`,
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
  if (!label) {
    return CODE.NOT_RUN;
  }
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
    if (list.length < pageSize) {
      break;
    }
    if (page === 10) {
      truncated = true;
    }
  }
  log(
    `[ship] 你领取中的单子（${label} · state=open）：${rows.length} 张${
      truncated ? `（只看了前 ${pages * pageSize} 张，分页到顶）` : ""}`,
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
 *   `handleExplicit` 是「`handle` 是不是**人填的**」（`resolveDevHandle().explicit`；ISSUE #2833）——
 *   `false` 时「不代发」那格要念出「取的名字」这条因，不许让它长得像「处理人真是别人」。
 * @param {{run:any, log:(s:string)=>void, slug:string, handle:string|null, handleExplicit?: boolean, number:number, mkTmp:any}} ctx
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
    /* 「不代发」背后是**两件不同的事**（ISSUE #2833 的现场）：处理人真是别人，与
     * 「这份检出的我是谁」落到了**取的**名字上（链接 worktree 不带 `.gitignore` 掉的
     * `.env` ⇒ 取值链跌到 git config user.name）。后者要修的是留痕通道（回主检出 /
     * 补 COMFYAPP_DEV_HANDLE），不是「等一个不存在的换名」—— 话术必须把两件分开，
     * 否则读的人会照着「别人在收尾」那条路走。 */
    if (ctx.handleExplicit === false) {
      log(
        `[ship]   ⚠️ 而这份检出的「我是谁」是**取的**（非显式配置）—— 链接 worktree 不带 .env 时` +
          `就会落到这一格（ISSUE #2833）：回主检出、或补上 COMFYAPP_DEV_HANDLE 后再跑 --release。`,
      );
    }
    return CODE.GREEN;
  }
  const others = handlers.filter((x) => x !== name);
  if (others.length > 0) {
    log(`[ship] #${number} 同时挂着 处理人:${others.join("、")} —— 只结束你自己的那一份。`);
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
    log(`[ship] #${number} 的结束评论没有落地 ⇒ **保留** ${handlerLabel(name)} 标签。`);
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
 *   handleSource?:string|null,
 *   explicitHandle?:string|null,
 *   root:string,
 *   opt:any,
 *   mkTmp:(name:string,text:string)=>string|null,
 *   createIssue?:any,
 *   commentIssue?:any,
 *   dryRun?:boolean,
 * }} ctx
 * @returns {number} `CODE` 之一
 */
export function runIssueAction(ctx) {
  const {
    run,
    log,
    slug,
    cnbOk,
    handle,
    handleSource = null,
    explicitHandle = null,
    root,
    opt,
    mkTmp,
    createIssue,
    commentIssue,
    dryRun = false,
  } = ctx;
  const claimBad = /** @type {string[]} */ (opt.claimBad ?? []);
  const releaseBad = /** @type {string[]} */ (opt.releaseBad ?? []);
  const newIssueBad = /** @type {string[]} */ (opt.newIssueBad ?? []);
  const commentBad = /** @type {string[]} */ (opt.commentBad ?? []);
  const bad = [
    ...claimBad.map((x) => `--claim ${x}`),
    ...releaseBad.map((x) => `--release ${x}`),
    ...newIssueBad.map((x) => `--new-issue ${x}`),
    ...commentBad.map((x) => `--comment ${x}`),
  ];
  if (bad.length > 0) {
    log(
      `[ship] [ERROR] --claim / --release / --comment 收的是一张单的号（2 位以上数字，可写 #2179）、` +
        `--new-issue 收的是标题；这一次这些不能当号 / 标题用：${bad.join(" ")}`,
    );
    log("[ship] 一个都不认 ⇒ 不动任何单子，也不去猜是哪一张。");
    return CODE.NOT_RUN;
  }
  /* `--body-file` 是 `--comment` 的正文，单独出现就是在写一个没有会读它的东西 ——
   * 静默退回主流程会让人以为评论已经写了（§13.10.12 对 `--issue-body-file` 同一条处置）。 */
  // oxlint-disable-next-line eqeqeq -- 同时判 null 与 undefined
  if (opt.bodyFile != null && opt.comment == null) {
    log(
      "[ship] [ERROR] --body-file 只跟 --comment <号> 一起用：" +
        "它是评论正文；建单的正文旗标是 --issue-body-file。",
    );
    return CODE.NOT_RUN;
  }
  // oxlint-disable-next-line eqeqeq -- 同时判 null 与 undefined
  const wantsNewIssue = opt.newIssue != null || newIssueBad.length > 0;
  // oxlint-disable-next-line eqeqeq -- 同时判 null 与 undefined
  const wantsComment = opt.comment != null || commentBad.length > 0;
  const wanted = [
    // oxlint-disable-next-line eqeqeq -- 同时判 null 与 undefined
    opt.claim == null ? null : "--claim",
    // oxlint-disable-next-line eqeqeq -- 同时判 null 与 undefined
    opt.release == null ? null : "--release",
    opt.claims ? "--claims" : null,
    wantsNewIssue ? "--new-issue" : null,
    wantsComment ? "--comment" : null,
  ].filter(Boolean);
  if (wanted.length > 1) {
    log(`[ship] [ERROR] 一次只做一件事：拿到 ${wanted.join(" + ")}`);
    return CODE.NOT_RUN;
  }
  if (wanted.length === 0) {
    return CODE.NOT_RUN;
  }
  const clashes = [
    opt.merge ? "--merge" : null,
    opt.closeIssue ? "--close-issue" : null,
    opt.cleanBranch ? "--clean-branch" : null,
    opt.branch ? "--branch" : null,
    // oxlint-disable-next-line eqeqeq -- 同时判 null 与 undefined
    opt.message == null ? null : "--message",
    // oxlint-disable-next-line eqeqeq -- 同时判 null 与 undefined
    opt.messageFile == null ? null : "--message-file",
    // oxlint-disable-next-line eqeqeq -- 同时判 null 与 undefined
    opt.title == null ? null : "--title",
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
  /* 建单**不要求**留痕（`runNewIssue` 会念）；领取 / 结束 / 列表则必须有「谁」—— 那三格的
   * 动作本体就是「谁在做什么」。名字由取值链给（`dev-handle.mjs`，ISSUE #2355）：
   * 人填的 → 平台运行身份 → `git config user.name` → `cnb`。所以这里的空值只可能来自
   * 调用方显式传空（装配层漏传），话术按「没有来源」念，而不是让照提示做过一遍的人再撞一次墙。 */
  if (wantsNewIssue) {
    if (typeof createIssue !== "function") {
      log("[ship] [ERROR] --new-issue 没有接上执行者（装配层漏传）⇒ 没有结论。");
      return CODE.NOT_RUN;
    }
    return createIssue({
      run,
      log,
      slug,
      handle,
      handleSource,
      explicitHandle,
      root,
      opt,
      mkTmp,
      dryRun,
    });
  }
  /* `--comment` 不需要「谁」：写一条读数不是「谁在做什么」，未配留痕时署名会写「未配」
   * 但评论照发（`--new-issue` 同一条边界）。所以它排在下面对 handle 的硬性检查之前。 */
  if (wantsComment) {
    if (typeof commentIssue !== "function") {
      log("[ship] [ERROR] --comment 没有接上执行者（装配层漏传）⇒ 没有结论。");
      return CODE.NOT_RUN;
    }
    return commentIssue({
      run,
      log,
      slug,
      number: opt.comment,
      handle,
      root,
      opt,
      mkTmp,
      dryRun,
    });
  }
  const name = String(handle ?? "").trim();
  if (!name) {
    log(
      "[ship] 领取 / 结束 / 列表要「谁」，而这次一个名字都没取到" +
        "（取值链 `dev-handle.mjs`：人填的 → `CNB_NPC_NAME` / `CNB_TOKEN_USER_NAME` → " +
        "`git config user.name` → `cnb`；走到空只可能是装配层没传） ⇒ 这一格没有执行者。",
    );
    return CODE.NOT_RUN;
  }
  if (opt.claims) {
    return runClaims({ run, log, slug, handle: name });
  }
  // oxlint-disable-next-line eqeqeq -- 同时判 null 与 undefined
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
