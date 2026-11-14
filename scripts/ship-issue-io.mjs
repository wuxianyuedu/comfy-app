// ── 单子领取 / 释放的**平台读写**（自 ship-claim.mjs 按职责拆出，规范 §12.6 R5）。
// 判据在 ship-claim-rules.mjs（纯函数）；这里只做三件事：读单子、写标签、
// 写状态评论 —— 每件写动作之后都**独立回读**（回执不算结论）。

import { appendComment, readCommentBodies } from "./ship-comment.mjs";
import { CODE } from "./ship-core.mjs";
import { cnbJson } from "./ship-exec.mjs";
import { cnbData } from "./cnb-fields.mjs";
import { handlerLabel, ISSUE_LABEL_ROLES, labelValues, participantLabel } from "./ship-ticket.mjs";
import {
  claimComment,
  commentSentence,
  handleCommentState,
  releaseComment,
} from "./ship-claim-rules.mjs";

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
  const d = cnbData(got?.json);
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
export function ensureComment(ctx) {
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
export function applyClaimLabels(ctx) {
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
 * 撤掉给定的标签（逐枚发 delete）并回读确认**全部撤没**；回读里还有 ⇒ 红。
 *
 * @param {{run:any, log:(s:string)=>void, slug:string, number:number}} ctx
 * @param {Array<string|null|undefined>} names 要撤的标签全名（如 `处理人:x` / `参与人:x`；空值跳过）
 * @param {string} note 成功日志的补充说明（可为空串）
 * @returns {number} `CODE` 之一
 */
export function dropLabelsFor(ctx, names, note = "") {
  const { run, log, slug, number } = ctx;
  const wanted = names
    .filter((name) => typeof name === "string" && name !== "")
    .map((name) => String(name));
  if (wanted.length === 0) {
    return CODE.NOT_RUN;
  }
  for (const name of wanted) {
    cnbJson(run, [
      "issues",
      "delete-issue-label",
      "--repo",
      slug,
      "--number",
      String(number),
      "--name",
      name,
      "-v",
    ]);
  }
  const back = readIssue({ run, slug, number });
  if (!back) {
    log(`[ship] #${number} 撤标签后回读没跑起来 ⇒ 不念「已释放」`);
    return CODE.NOT_RUN;
  }
  const known = [
    ...labelValues(back.labels, ISSUE_LABEL_ROLES.handler),
    ...labelValues(back.labels, ISSUE_LABEL_ROLES.participant),
  ];
  const left = wanted.filter((name) => known.includes(name));
  if (left.length > 0) {
    log(`[ship] ✗ #${number} 的回读里 ${left.join("、")} 还在 ⇒ 撤没掉`);
    return CODE.RED;
  }
  log(
    `[ship] ✓ #${number} 已撤掉 ${wanted.join(" 与 ")}（get-issue 回读${note ? `；${note}` : ""}）`,
  );
  return CODE.GREEN;
}

/**
 * 撤掉 `处理人:<我>` 并回读。回读里还在 ⇒ 红。
 *
 * @param {{run:any, log:(s:string)=>void, slug:string, number:number, handle:string}} ctx
 * @returns {number} `CODE` 之一
 */
export function dropHandlerLabel(ctx) {
  const { handle } = ctx;
  const label = handlerLabel(handle);
  if (!label) {
    return CODE.NOT_RUN;
  }
  return dropLabelsFor(ctx, [label], `${participantLabel(handle)} 保留 —— 经手记录只增不删`);
}
