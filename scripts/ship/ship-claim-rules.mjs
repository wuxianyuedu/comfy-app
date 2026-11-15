// ── 单子领取 / 释放的**纯判断**与状态评论文案（自 ship-claim.mjs 按职责拆出，
//  规范 §12.6 R5：文件超 900 行即拆）。这一层不起任何进程 —— 判据吃数据、出结论；
//  平台读写（get-issue / 打标签 / 发评论）在 ship-issue-io.mjs。
import { CODE } from "./ship-core.mjs";
import { ISSUE_LABEL_ROLES, labelValues, withCommentHeader } from "./ship-ticket.mjs";

/**
 * 状态评论里那句人话。领取 / 结束共用一处生成 —— **回读判据也用它**：
 * 署名对两种动作逐字相同（只有「谁写的」），拿它判动作会把两条都认成第一条。
 *
 * @param {"claim"|"release"|"release-misclaim"} kind 动作
 * @param {string} handle 留痕短名
 * @returns {string}
 */
export function commentSentence(kind, handle) {
  if (kind === "claim") {
    return `开发者 ${handle} 已接单，正在开发中。`;
  }
  if (kind === "release-misclaim") {
    /* 误领释放（ISSUE #3809）：文案与「开发结束」刻意不同 —— 这不是收尾，
     * 是把一次错误领取的痕迹撤干净；误领者没有经手过这张单。 */
    return `误领释放：开发者 ${handle} 误领了这一单，已立即退出处理；本单未被该开发者做任何改动。`;
  }
  return `开发者 ${handle} 开发结束。`;
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
 * 误领释放的评论（ISSUE #3809）：撤两枚标签 + 这条说明，恢复到误领前。
 *
 * @param {string} handle 留痕短名
 * @returns {string}
 */
export function misclaimReleaseComment(handle) {
  return withCommentHeader(commentSentence("release-misclaim", handle), handle);
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
