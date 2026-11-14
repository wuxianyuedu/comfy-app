// ── 单子的**释放与收尾**：--release（含 --misclaim 误领释放）与关单后的
// finishIssueWork（自 ship-claim.mjs 按职责拆出，规范 §12.6 R5）。
// 判据（decideRelease）在 ship-claim-rules.mjs；平台读写（readIssue /
// ensureComment）在 ship-issue-io.mjs。
import { CODE } from "./ship-core.mjs";
import { appendComment, readCommentBodies } from "./ship-comment.mjs";
import {
  handlerLabel,
  ISSUE_LABEL_ROLES,
  labelValues,
  participantLabel,
  withCommentHeader,
} from "./ship-ticket.mjs";
import { commentSentence, decideRelease } from "./ship-claim-rules.mjs";
import { dropHandlerLabel, dropLabelsFor, ensureComment, readIssue } from "./ship-issue-io.mjs";

/**
 * `--release`：先发「开发结束」评论，**再**撤标签。
 *
 * 顺序与 claim 相反：撤标签是「别人可以接了」的开关，而公开的结束声明必须先成立。
 * 评论没落地就保留标签并落 2 —— 不能出现「标签没了、单子上也没人说结束了」。
 *
 * @param {{run:any, log:(s:string)=>void, slug:string, handle:string, number:number, dryRun?:boolean, mkTmp:any, misclaim?:boolean}} ctx
 * @returns {number} `CODE` 之一
 */
export function runRelease(ctx) {
  const { run, log, slug, handle, number, dryRun = false, mkTmp, misclaim = false } = ctx;
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
    if (misclaim) {
      log(
        `[ship] --dry-run：#${number} 将评论「${commentSentence("release-misclaim", handle)}」，` +
          `再撤 ${handlerLabel(handle)} 与 ${participantLabel(handle)}（误领释放，两枚都撤）；一条都没写。`,
      );
    } else {
      log(
        `[ship] --dry-run：#${number} 将评论「开发者 ${handle} 开发结束。」，` +
          `再撤 ${handlerLabel(handle)}（${participantLabel(handle)} 保留）；一条都没写。`,
      );
    }
    return CODE.GREEN;
  }
  if (plan.others.length > 0) {
    log(
      `[ship] #${number} 同时挂着 处理人:${plan.others.join("、")} —— ` +
        "这一跑只撤你自己那枚，不动别人。",
    );
  }
  if (misclaim) {
    /* 误领释放（ISSUE #3809）：评论用误领文案（不是「开发结束」），两枚标签
     * 都撤 —— 误领者没有经手过这张单，不留 参与人 噪声。幂等：评论已在场就
     * 不再发，直接进入撤标签。 */
    const sentence = commentSentence("release-misclaim", handle);
    const bodies = readCommentBodies({ run, slug, number });
    if (!bodies) {
      log(`[ship] #${number} 取不到评论列表 ⇒ 不写评论（写出去也证明不了它落地）`);
      return CODE.NOT_RUN;
    }
    if (!bodies.some((body) => String(body ?? "").includes(sentence))) {
      const wrote = appendComment({
        run,
        log,
        slug,
        number,
        body: withCommentHeader(sentence, handle),
        mkTmp,
      });
      if (!wrote.posted) {
        log(`[ship] #${number} 误领释放评论写那一步没跑起来 ⇒ 标签保留`);
        return CODE.NOT_RUN;
      }
      const back = readCommentBodies({ run, slug, number });
      if (!back || !back.some((body) => String(body ?? "").includes(sentence))) {
        log(`[ship] #${number} 误领释放评论写后回读里看不到 ⇒ 标签保留`);
        return CODE.NOT_RUN;
      }
    }
    log(`[ship] ✓ #${number} 误领释放评论已回读（list-issue-comments）`);
    return dropLabelsFor(
      { run, log, slug, number },
      [handlerLabel(handle), participantLabel(handle)],
      "误领释放不留经手记录",
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

/** `opt.*Bad` 字段的运行时形状（`opt` 由各入口传进来，静态类型是 `any`）。
 * @param {unknown} value
 * @returns {value is string[]} */
