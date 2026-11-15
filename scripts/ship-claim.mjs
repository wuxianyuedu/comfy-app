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
import { CODE } from "./ship-core.mjs";
import { cnbJson } from "./ship-exec.mjs";
import { handlerLabel, ISSUE_LABEL_ROLES, labelValues, participantLabel } from "./ship-ticket.mjs";

import { runRelease } from "./ship-release.mjs";
import { applyClaimLabels, ensureComment, readIssue } from "./ship-issue-io.mjs";
import { decideClaim } from "./ship-claim-rules.mjs";

/* 纯判断与文案、平台读写自拆出的模块再导出：测试与 ship-close 的既有引用
 * （`../scripts/ship-claim.mjs`）保持不变。 */
export {
  claimComment,
  commentSentence,
  decideClaim,
  decideRelease,
  handleCommentState,
  misclaimReleaseComment,
  releaseComment,
} from "./ship-claim-rules.mjs";
export { readIssue } from "./ship-issue-io.mjs";
export { finishIssueWork, runRelease } from "./ship-release.mjs";

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
  /* 领取对象读数（ISSUE #3809）：把要领的单子先摆出来 —— 号给错（比如把将要
   * 建出的单当成已有的一张）时，这一行让错误在当场可见，而不是事后翻单子。 */
  const claimHandlers = labelValues(issue.labels, ISSUE_LABEL_ROLES.handler);
  log(
    `[ship] 领取对象：#${number} · ${issue.title} · state=${issue.state || "(取不到)"} · 处理人=${
      claimHandlers.join("、") || "无"
    }`,
  );
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
      truncated ? `（只看了前 ${pages * pageSize} 张，分页到顶）` : ""
    }`,
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
 * @param {unknown} value
 * @returns {value is string[]}
 */
function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
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
  /** @type {unknown} */
  const rawClaimBad = opt.claimBad;
  /** @type {unknown} */
  const rawReleaseBad = opt.releaseBad;
  /** @type {unknown} */
  const rawNewIssueBad = opt.newIssueBad;
  /** @type {unknown} */
  const rawCommentBad = opt.commentBad;
  const claimBad = isStringArray(rawClaimBad) ? rawClaimBad : [];
  const releaseBad = isStringArray(rawReleaseBad) ? rawReleaseBad : [];
  const newIssueBad = isStringArray(rawNewIssueBad) ? rawNewIssueBad : [];
  const commentBad = isStringArray(rawCommentBad) ? rawCommentBad : [];
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
  if (
    opt.bodyFile !== null &&
    opt.bodyFile !== undefined &&
    (opt.comment === null || opt.comment === undefined)
  ) {
    log(
      "[ship] [ERROR] --body-file 只跟 --comment <号> 一起用：" +
        "它是评论正文；建单的正文旗标是 --issue-body-file。",
    );
    return CODE.NOT_RUN;
  }
  /* --misclaim 是 --release 的形态开关（ISSUE #3809）：单独出现 = 用法错，当场点名。 */
  if (opt.misclaim === true && (opt.release === null || opt.release === undefined)) {
    log("[ship] [ERROR] --misclaim 只跟 --release <号> 同用：它是误领释放的形态开关。");
    return CODE.NOT_RUN;
  }
  const wantsNewIssue =
    (opt.newIssue !== null && opt.newIssue !== undefined) || newIssueBad.length > 0;
  const wantsComment = (opt.comment !== null && opt.comment !== undefined) || commentBad.length > 0;
  const wanted = [
    opt.claim === null || opt.claim === undefined ? null : "--claim",
    opt.release === null || opt.release === undefined ? null : "--release",
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
    opt.message === null || opt.message === undefined ? null : "--message",
    opt.messageFile === null || opt.messageFile === undefined ? null : "--message-file",
    opt.title === null || opt.title === undefined ? null : "--title",
    opt.adds.length > 0 ? "--add" : null,
    opt.allowStaged === true ? "--allow-staged" : null,
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
  if (opt.claim !== null && opt.claim !== undefined) {
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
    misclaim: opt.misclaim === true,
  });
}
