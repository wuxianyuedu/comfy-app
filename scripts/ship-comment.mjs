/**
 * ship-comment.mjs —— 「往单子 / PR 的评论区写一条评论」的**唯一实现**（ISSUE #2719）。
 *
 * ## 为什么要收成一份
 *
 * 这条链（正文落盘 → `post-*-comment` → 独立回读）此前有两份：
 * `ship-claim.mjs` 的 `ensureComment`（领取 / 结束 / 关单收尾）与
 * `ship-issue-new.mjs` 的 `runAppendIssueComment`（两条 CI 立案链）。
 * 两份各写一遍的漂移形态是「一边补了回读、另一边没有」—— 而漏了回读的那一边念的是
 * 「写成功了」。收成一份之后，**命令形状**只有这里一处。
 *
 * ## 边界
 *
 * 只放**写 + 回读**这一半。「回读拿到之后算什么」由调用方判，三处判据本来就不同：
 *
 *   · 状态评论认正文那句（`handleCommentState`，`ship-claim.mjs`）；
 *   · CI 读数认 marker（构建号，`runAppendIssueComment`）；
 *   · `--comment` 认**逐字相同**（去末尾换行后，见 `sameCommentBody`）。
 */

import { asArray } from "./ship-build.mjs";
import { cnbJson } from "./ship-exec.mjs";

/**
 * 评论落点两档：单子评论区与 PR 评论区。
 *
 * 命令头**写成字面量**而不是从表里拼 —— `tests/ship.test.ts` 的「计划 ⇄ 源码同集合」
 * 对账是从 `cnbJson(run, ["…", "…"` 这段字面量里抽「模块+工具」的；拼出来就抽不到，
 * 计划里那两条会变成「源码里没人调」。参数尾巴共用 `tail`，不抄第二份。
 */

/**
 * 读评论正文（**新到旧**）。取不到回 `null` —— 空数组会被读成「查过了、没有」，
 * 而 `null` 才是「没拿到列表」。
 *
 * @param {{run:any, slug:string, number:number, route?:"issue"|"pull"}} ctx
 * @returns {string[] | null}
 */
export function readCommentBodies({ run, slug, number, route = "issue" }) {
  const head = ["--repo", slug, "--number", String(number)];
  /* 参数尾巴按 route 拼开（ISSUE #3279）：`--sort -created` 只有单子评论区
   * （`issues list-issue-comments`）支持，PR 侧的 `pulls list-pull-comments`
   * 没有这一项 —— 共用一个 tail 时 PR 侧命令直接 `unknown option`，写成功了
   * 也念成「回读没跑起来」，人会去重跑造成重复评论。回读这一格本来就是
   * 逐字找最新那条，PR 侧不带 sort 不承载任何判据。 */
  const tail =
    route === "pull"
      ? ["--page-size", "100", "-v"]
      : ["--sort", "-created", "--page-size", "100", "-v"];
  const got =
    route === "pull"
      ? cnbJson(run, ["pulls", "list-pull-comments", ...head, ...tail])
      : cnbJson(run, ["issues", "list-issue-comments", ...head, ...tail]);
  if (!got) {
    return null;
  }
  const list = asArray(got.json);
  if (!list) {
    return null;
  }
  return list.map((c) => String(c?.body ?? ""));
}

/**
 * 写一条评论并**独立回读**。
 *
 * `posted` 与 `bodies` 分开给，是因为「写那一步没跑起来」与「写成功了、回读没跑起来」
 * 是两件事：前者一条命令都没落地，后者可能已经写上了 —— 把两者念成同一句
 * 「没写上」会让人重复投递（ISSUE #2719 的 ⑤ 记的就是这个方向）。
 *
 * @param {{run:any, log:(s:string)=>void, slug:string, number:number, body:string,
 *   mkTmp:(name:string, text:string)=>string|null, route?:"issue"|"pull"}} ctx
 * @returns {{posted:boolean, bodies:string[] | null}}
 */
export function appendComment({ run, log, slug, number, body, mkTmp, route = "issue" }) {
  const onPull = route === "pull";
  const file = mkTmp(onPull ? "pull-comment" : "issue-comment", body);
  if (!file) {
    log("[ship] ✗ 取不到 git 目录 ⇒ 评论正文没有落点，这一步没有执行者。");
    return { posted: false, bodies: null };
  }
  const tail = ["--repo", slug, "--number", String(number), "--body-file", file, "-v"];
  const res = onPull
    ? cnbJson(run, ["pulls", "post-pull-comment", ...tail])
    : cnbJson(run, ["issues", "post-issue-comment", ...tail]);
  if (res?.code !== 0) {
    return { posted: false, bodies: null };
  }
  return { posted: true, bodies: readCommentBodies({ run, slug, number, route }) };
}

/**
 * 去掉**末尾**一个换行（`\n` 或 `\r\n`）。
 *
 * 平台会把评论正文末尾那个换行收掉：实测同一份 39 行正文，文件 1818 字符、回读 1817 字符，
 * 逐字全等、差的只有末尾这一枚。比对不先归一 ⇒ **写对了也会读回「不一致」**，
 * 而下一个人会去改正文而不是改比对（ISSUE #2719 的 ⑤）。
 *
 * @param {unknown} text
 * @returns {string}
 */
export function stripTrailingNewline(text) {
  return String(text ?? "").replace(/\r?\n$/, "");
}

/**
 * 「发出去的那份」与「回读回来的那份」是不是同一条评论。
 *
 * @param {unknown} sent 落盘发给文件的那份原文
 * @param {unknown} readBack 平台回读回来的正文
 * @returns {boolean}
 */
export function sameCommentBody(sent, readBack) {
  return stripTrailingNewline(sent) === stripTrailingNewline(readBack);
}
