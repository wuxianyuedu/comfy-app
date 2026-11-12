#!/usr/bin/env node
/**
 * `ship-pr-body.mjs` —— `pnpm ship` 的**PR 正文注入那一格**（`--pr-body-file`）。
 *
 * ## 它要回答的那一格
 *
 * 建 PR 时注入人写的正文（根因 / 改动 / 验证），并在复用已有 PR 时**把整篇正文
 * 更新成同一份拼装结果**。此前这些内容都是 PR 建完之后用平台 `patch-pull` 手工补的
 * —— #3021 在合并前补、#2997 在合并后补，顺序上两套做法，谁也不保证正文在
 * 「等 CI」那段时间里已经是对的。
 *
 * ## 三条口径
 *
 * 1. **给了旗标就更新整篇；不给就一个字节都不动。** 不选「只更新自动段」的理由是
 *    漂移：同一份正文里一半来自这一跑、另一半来自上一跑，读者分不出哪句是现在的。
 *    整篇 == 人写的正文 + 自动事实段（`buildPullBody` 的 `userBody`），两段之间
 *    有分隔线与一句说明。
 * 2. **写后独立回读、逐字比对**（与 §13.10.17 评论那一格同一条纪律：回执不算结论）。
 *    平台会吞掉文件末尾那一个换行（评论侧实测 1818 发出去、1817 读回来），所以比对前
 *    两边各去掉**一个**末尾换行；除此之外任何差异都退 `1`（有写入但没落地是红），
 *    回读没跑起来 / 缺 `body` 键退 `2`（没有读数，不当作「没落地」）。
 * 3. **不自动加 `Closes`**：注入的是原文，脚本不改写判断。原文里本来有 `Closes` 时
 *    由调用方念一行提示（项目口径是统一关单，单条 PR 不自己关）。
 *
 * ## 与 `ship-pull-body.mjs` 的分工
 *
 * 那边是**纯拼装**（给定事实 → 正文文本，零依赖、可单测）；本层是**取数与写平台**
 * （基线、diffstat、`patch-pull` + 回读）。拆开是 900 行硬闸的直接结果：`ship-platform.mjs`
 * 在加这一格之前已 899 行，把拼装与写动作各留一半在原地都会顶穿。
 *
 * 入参直接吃 `ship-platform.mjs` 的 ctx（`run` / `root` / `frags` / `handle` / `prBody`
 * 等）：这一族是本仓的私有伴生模块，不对外承诺形状；多一层手抄字段只会多一处漂移。
 */
import { CODE, readPullVerdict } from "./ship-core.mjs";
import { normalizeImageAssetLinks } from "./ship-comment.mjs";
import { cnbJson } from "./ship-exec.mjs";
import { buildPullBody, PULL_BODY_LIMIT } from "./ship-pull-body.mjs";
import { diffBaseRef } from "./ship-title.mjs";

/**
 * 从 `get-pull -v` 的应答里读正文。
 *
 * 缺 `data.body` 键与「回读没跑起来」是两件事，但对调用方是同一档：**没有落地证明**。
 * 所以这里缺键回 `null`，由调用方按「没跑起来」收 —— 不把 `undefined` 读成空串
 * （那会让「平台没给我们读数」与「平台说正文是空的」长得一样）。
 *
 * @param {any} json `cnb pulls get-pull -v` 解析后的 JSON
 * @returns {string | null} 正文；缺键时 null
 */
export function readPullBody(json) {
  const d = json?.data;
  if (!d || typeof d !== "object" || typeof d.body !== "string") {
    return null;
  }
  return d.body;
}

/**
 * 一份要交给平台的正文长度是否还在硬上限里。
 *
 * @param {string} body 拼装结果
 * @param {string | null} userBody 注进来的那份原文（只用于把长度念清楚）
 * @param {string} verb 这一格的出口话术（`不建 PR` / `不更新 PR 正文`）
 * @returns {{body: string, stop: number | null, reason: string}}
 */
function cappedPlan(body, userBody, verb) {
  /* 平台拒的是 UTF-8 字节数，不是字符数：纯中文正文用 `.length` 会低估到三分之一，
   * 于是「本地说在上限内」而平台回 2000003。`buildPullBody` 也按同一把尺子降级。 */
  if (Buffer.byteLength(body, "utf8") <= PULL_BODY_LIMIT) {
    return { body, stop: null, reason: "" };
  }
  /* 与 #2248 同一条出口：超上限时一次网络往返都不发。清单本身不裁（漏报这次带了什么），
   * `buildPullBody` 内部已经把 diffstat 与碎片原文预算都减到 0；仍然超，说明
   * 正文本体自己就装不下 —— 说清它有多大、该由人裁哪一段。 */
  const mine = userBody ?? "";
  const mineNote = mine
    ? `（其中 \`--pr-body-file\` ${Buffer.byteLength(mine, "utf8")} 字节）`
    : "";
  const outlet = mine
    ? "先裁掉正文里那一段（清单、碎片原文与 diffstat 已经裁到最小），或把变更拆小。"
    : "这一格没有执行者（不是「已建」）。出口是把这次变更拆小，或自己写正文手工建一条。";
  return {
    body,
    stop: CODE.NOT_RUN,
    reason: `[ship] PR 正文拼出来 ${Buffer.byteLength(body, "utf8")} 字节${mineNote}，超过上限 ${PULL_BODY_LIMIT} ⇒ ${verb}：${outlet}`,
  };
}

/**
 * 建 PR 那一跳的正文：diffstat 是摘要，区间由调用方解析好的 `baseForDiff` 给。
 *
 * 区间不在这里自己 `diffBaseRef` 一次：建 PR 的调用方已经为标题解析过同一个区间，
 * 再取一次就是两次 `fetch` + 两次 `rev-parse`，而两处结果还可能不同。
 *
 * @param {{run:any, root:string, frags:string[], baseForDiff:string|null, handle?:string|null, prBody?:string|null, verb?:string}} ctx
 * @returns {{body: string, stop: number | null, reason: string}}
 */
export function planCreateBody({
  run,
  root,
  frags,
  baseForDiff,
  handle,
  prBody = null,
  verb = "不建 PR",
}) {
  /* 基线取不到时这一格就是空 —— 宁缺：拿 `HEAD...HEAD` 会得到一份「什么都没有」
   * 的 diffstat，而 PR 正文里那句「这次改了哪些文件」正是读者判断成本的入口。 */
  const diffstat = baseForDiff
    ? run("git", ["diff", "--stat", `${baseForDiff}...HEAD`]).stdout.trim()
    : "";
  return cappedPlan(
    buildPullBody({ root, fragments: frags, diffstat, handle, userBody: prBody }),
    prBody,
    verb,
  );
}

/**
 * 复用 PR 那一跳的正文：比对区间跟着**平台上这条 PR 的目标分支**（ISSUE #3021）。
 *
 * 复用可能是栈式 PR（目标不是本地 trunk）；拿本地 upstream 去算 diffstat，正文里
 * 「改了哪些文件」就会算进上游那一段别人的提交。目标分支回读不到时退回调用方给的
 * `baseBranch`，并照实念一句 —— 不静默。
 *
 * @param {{run:any, log:any, root:string, slug:string, number:any, frags:string[], baseRef:string|null, baseBranch:string|null, handle?:string|null, prBody?:string|null}} ctx
 * @returns {{body: string, stop: number | null, reason: string}}
 */
export function planUpdateBody(ctx) {
  const { run, log, slug, number, baseRef, baseBranch } = ctx;
  const pr = cnbJson(run, ["pulls", "get-pull", "--repo", slug, "--number", String(number), "-v"]);
  const pv = pr ? readPullVerdict(pr.json) : null;
  if (!pv?.baseBranch) {
    log(
      `[ship] 复用 PR #${number} 时目标分支回读${pv ? "缺 `base.ref`" : "没跑起来"}` +
        ` ⇒ 正文里的 diffstat 退回本地基线 ${baseRef ?? "(取不到)"}：这一格没有跟随 \`base.ref\`，` +
        "栈式 PR 会算进上游那一段别人的提交。",
    );
  }
  const baseForDiff = diffBaseRef({
    run,
    log,
    baseRef,
    targetBranch: pv?.baseBranch || baseBranch,
    remote: baseRef ? (baseRef.split("/")[0] ?? null) : null,
  });
  return planCreateBody({ ...ctx, baseForDiff, verb: "不更新 PR 正文" });
}

/**
 * 复用路径上的整段动作：给了正文就整篇更新并回读，没给就什么都不做。
 *
 * @param {{run:any, log:any, mkTmp:any, root:string, slug:string, number:any, frags:string[], baseRef:string|null, baseBranch:string|null, handle?:string|null, prBody?:string|null}} ctx
 * @returns {number | null} `null` = 不需更新或已更新且回读一致；否则是这一格的收口码
 */
export function updatePullBodyOnReuse(ctx) {
  if (!ctx.prBody) {
    return null;
  }
  const plan = planUpdateBody(ctx);
  if (plan.stop !== null) {
    ctx.log(plan.reason);
    return plan.stop;
  }
  return writePullBody({
    run: ctx.run,
    log: ctx.log,
    mkTmp: ctx.mkTmp,
    slug: ctx.slug,
    number: ctx.number,
    body: plan.body,
  });
}

/**
 * 把整篇正文写到已有 PR 上，并独立回读逐字比对。
 *
 * @param {{run:any, log:any, mkTmp:(name:string,text:string)=>string|null, slug:string, number:any, body:string}} ctx
 * @returns {number | null} `null` = 已更新且回读一致；否则是这一格的收口码
 */
export function writePullBody({ run, log, mkTmp, slug, number, body }) {
  /* 正文可能上千行，`--body <串>` 会撞 Windows 的 32k argv 上限 ⇒ 只能走文件
   * （与建 PR 那一格同一条理由，`ship-platform.mjs` 有同一句注释）。 */
  const bf = mkTmp("ship-pr-body", body);
  if (!bf) {
    log("[ship] 取不到 git 目录 ⇒ 更新正文没有落点，这一格没有执行者（不是「不需要」）。");
    return CODE.NOT_RUN;
  }
  const patched = cnbJson(run, [
    "pulls",
    "patch-pull",
    "--repo",
    slug,
    "--number",
    String(number),
    "--body-file",
    bf,
    "-v",
  ]);
  if (!patched) {
    log(
      "[ship] 更新 PR 正文没拿到可解析的响应 ⇒ 不念「已更新」，这一格按「没跑起来」处理" +
        `（exit ${CODE.NOT_RUN}）。`,
    );
    return CODE.NOT_RUN;
  }
  const read = cnbJson(run, [
    "pulls",
    "get-pull",
    "--repo",
    slug,
    "--number",
    String(number),
    "-v",
  ]);
  const back = read ? readPullBody(read.json) : null;
  if (back === null) {
    log(
      `[ship] 更新 PR #${number} 正文的**回读${read ? "缺 `body` 键" : "没跑起来"}**` +
        ` ⇒ 有没有落地没有读数，不念「已更新」（exit ${CODE.NOT_RUN}）。`,
    );
    return CODE.NOT_RUN;
  }
  /* 平台会吞掉文件末尾那一个换行（§13.10.17 评论侧实测）；两边各去掉一个再比，
   * **除此之外任何差异都退 1**。长度一起念出来：少了几个字与「末尾换行差一个」
   * 在终端里长得一样，读数要能分开。图片资产链接同评论那一格归一（ISSUE #3655）：
   * 平台会把相对形态改写成绝对地址，不归一 ⇒ 带图正文恒假红。 */
  /**
   * @param {string} s 回读或发出的正文
   * @returns {string} 归一末尾换行（与 CRLF）与图片资产链接之后的文本
   */
  const norm = (s) => normalizeImageAssetLinks(s.replaceAll("\r\n", "\n").replace(/\n$/, ""));
  if (norm(back) !== norm(body)) {
    log(
      `[ship] ✗ PR #${number} 正文**回写后回读不一致**（发 ${body.length} 字节 / 读回 ${back.length} 字节；` +
        `归一末尾换行后 ${norm(body).length} vs ${norm(back).length}）⇒ 写入没有落地（exit ${CODE.RED}）。`,
    );
    return CODE.RED;
  }
  log(`[ship] ✓ PR #${number} 正文已更新并回读一致（${body.length} 字节）`);
  return null;
}
