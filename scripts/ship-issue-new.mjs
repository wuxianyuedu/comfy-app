#!/usr/bin/env node
/**
 * ship-issue-new.mjs —— `pnpm ship --new-issue "<标题>" --issue-body-file <正文> --priority <P0..P3>`
 * 的「一步建单」（ISSUE #2217，规范 §13.10.12）。
 *
 * ── 为什么要有这一格 ────────────────────────────────────────────
 *
 * 建一张单在文档里是**两条**命令：`create-issue` 之后还要补一次
 * `post-issue-labels` —— 因为实测 `create-issue --labels` **不落地**（回读 `labels: []`）。
 * 两步靠人抄时漏的恰好是第二步，而漏了不报错：单子建出来了，只是「谁提的」这一格
 * 空着，平台账号又分不出人（`docs/guides/git-identity.md` §4）。这一格把那两步
 * 串成一条，并且**回读之后才念结论**。
 *
 * ── 它代做哪一半、不代做哪一半 ─────────────────────────────────
 *
 * 代做的是机械那一半：建单 → 按 `提单人:<短名>` → 独立 `get-issue` 回读
 * （标题 / 优先级 / 标签三件原值）。**不写正文**：标题与正文是判断（症状 / 读数 /
 * 根因），必须由人给（`--new-issue` + `--issue-body-file`）。正文开头保证有且只有一行
 * 署名（`withCommentHeader` —— 正文文件里自己写了的不再重复补，#2258 就是那两行），
 * 与 PR 正文同一口径 —— 那一行是留痕，不是判断。
 *
 * `--priority` 不代填：不给就走平台默认（P2），并把这句念出来；词表只认平台原生的
 * `P0|P1|P2|P3`（`ISSUE_PRIORITIES`）。给了一个词表外的值 ⇒ 停手，别让平台替我们
 * 猜一个「差不多」的优先级。
 *
 * 写后回读三件：标题不一致 ⇒ 红（公开状态与请求的不是一件事）；标签没落地 /
 * 回读没跑起来 ⇒ 2（没拿到测量，不念「已建好」）；优先级读回来不一致 ⇒ 红。
 */
import fs from "node:fs";
import path from "node:path";

import { CODE } from "./ship-core.mjs";
import { cnbJson } from "./ship-exec.mjs";
import {
  authorLabel,
  ISSUE_LABEL_ROLES,
  ISSUE_PRIORITIES,
  labelValues,
  withCommentHeader,
} from "./ship-ticket.mjs";
import { readIssue } from "./ship-claim.mjs";

/** `--priority` 的词表（平台原生字段；不认别的写法）。 */
const PRIORITY_WORDS = ISSUE_PRIORITIES.split("|");

/**
 * 往一张**已有的** open 单下追加一条读数，并独立回读（ISSUE #2332）。
 *
 * 为什么收在这里：这条动作（写 → 回读里认 marker）此前是 `ci-daily-failure-issue.mjs`
 * 的私有函数 `appendReading`，而 PR 档那一格需要的是**逐字相同**的一条 —— 抄一份就得到
 * 「两份回读各自漂」（§12.12）。所以实现只留这一处：`ship-issue-new` 已经是「单子这一侧
 * 的写入口」（建单那三步也在这里），追加评论与它同一族。
 *
 * 回执不算结论：写完之后列一次最新评论，认的是「最新的自己那条里含 marker」
 * （marker 通常是构建号 —— 它让「同一条读数写了两遍」与「写成功了」区分得开）。
 *
 * @param {{run:any, log:(s:string)=>void, slug:string, number:number, body:string,
 *   marker:string, mkTmp:(name:string,text:string)=>string|null}} input
 * @returns {boolean} 写成且回读到 ⇒ true
 */
export function runAppendIssueComment({
  run,
  log,
  slug,
  number,
  body,
  marker,
  mkTmp,
}) {
  const file = mkTmp("issue-comment", body);
  if (!file) {
    log("[ship] ✗ 取不到 git 目录 ⇒ 评论没有落点，这一步没有执行者。");
    return false;
  }
  const res = cnbJson(run, [
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
  if (!res || res.code !== 0) return false;
  const back = cnbJson(run, [
    "issues",
    "list-issue-comments",
    "--repo",
    slug,
    "--number",
    String(number),
    "--sort",
    "-created",
    "--page-size",
    "20",
    "-v",
  ]);
  const d = back ? back.json?.data : null;
  const rows = Array.isArray(d?.data) ? d.data : Array.isArray(d) ? d : [];
  return rows.some((/** @type {any} */ c) =>
    String(c?.body ?? "").includes(marker),
  );
}

/**
 * 建单前的三道判断 —— 纯函数，不起进程。
 *
 * @param {{title?: string|null, body?: string|null, priority?: string|null}} input
 * @returns {{ok:boolean, code:number|null, title:string, priority:string|null, reason:string}}
 */
export function decideNewIssue({ title = null, body = null, priority = null }) {
  const t = String(title ?? "").trim();
  const b = String(body ?? "");
  const p = String(priority ?? "")
    .trim()
    .toUpperCase();
  if (t === "") {
    return {
      ok: false,
      code: CODE.NOT_RUN,
      title: "",
      priority: null,
      reason:
        "--new-issue 后面要跟标题。标题是判断（这张单在说什么），本脚本不替你写；" +
        '写法：--new-issue "fix(ship): …"',
    };
  }
  if (b.trim() === "") {
    return {
      ok: false,
      code: CODE.NOT_RUN,
      title: t,
      priority: null,
      reason:
        "建单要 --issue-body-file <正文文件>：正文是问题报告的本体（症状 / 当场读数 / 根因），" +
        "不由脚本生成。没有正文的单子会退化成「为了让读数念出个号」而挂的那一种（§13.10.9）。",
    };
  }
  if (p !== "" && !PRIORITY_WORDS.includes(p)) {
    return {
      ok: false,
      code: CODE.NOT_RUN,
      title: t,
      priority: null,
      reason: `--priority 只认平台原生词表 ${ISSUE_PRIORITIES}（收到「${priority}」）⇒ 不猜一个近似的值。`,
    };
  }
  return { ok: true, code: null, title: t, priority: p || null, reason: "" };
}

/**
 * 读正文文件并在开头补署名行（正文本身一字不改）。
 *
 * @param {string} root 仓库根
 * @param {string} file 正文文件（相对路径按仓库根解析）
 * @param {string | null} handle 留痕短名
 * @returns {{ok:boolean, text:string, where:string}} 读不到时 `ok:false`
 */
export function readIssueBody(root, file, handle) {
  const where = path.resolve(root || ".", file);
  let text = "";
  try {
    text = fs.readFileSync(where, "utf8");
  } catch {
    return { ok: false, text: "", where };
  }
  return {
    ok: true,
    /* 幂等：正文文件里自己已经写了署名行的（#2258 那单就是），不再前插第二遍。 */
    text: withCommentHeader(text, handle),
    where,
  };
}

/**
 * `get-issue` 回读的标签名（平台两种形状都收）。
 *
 * @param {any[]} labels
 * @returns {string[]}
 */
function labelNames(labels) {
  return (Array.isArray(labels) ? labels : [])
    .map((l) => (typeof l === "string" ? l : String(l?.name ?? "")))
    .filter(Boolean);
}

/**
 * `--new-issue` 的入口。
 *
 * @param {object} ctx
 * @param {any} ctx.run 执行者
 * @param {(s: string) => void} ctx.log 输出通道
 * @param {string} ctx.slug 仓库路径
 * @param {string | null} ctx.handle 留痕短名（未配时不阻断，只是没有 `提单人:`）
 * @param {string} ctx.root 仓库根
 * @param {any} ctx.opt 解析后的参数
 * @param {(name: string, text: string) => string | null} ctx.mkTmp 临时文件落点
 * @param {boolean} [ctx.dryRun] 只打印计划
 * @returns {number} `CODE` 之一
 */
export function runNewIssue({
  run,
  log,
  slug,
  handle,
  root,
  opt,
  mkTmp,
  dryRun = false,
}) {
  const bodyFile = String(opt.issueBodyFile ?? "").trim();
  if (bodyFile === "") {
    log(
      "[ship] [ERROR] --new-issue 要和 --issue-body-file <正文文件> 一起用：" +
        "标题与正文都是判断，本脚本不替你写（口径见规范 §13.10.12）。",
    );
    return CODE.NOT_RUN;
  }
  const read = readIssueBody(root, bodyFile, handle);
  if (!read.ok) {
    log(`[ship] 读不到正文文件：${read.where} ⇒ 这一格没有执行者。`);
    return CODE.NOT_RUN;
  }
  const plan = decideNewIssue({
    title: opt.newIssue,
    body: read.text,
    priority: opt.priority,
  });
  if (!plan.ok) {
    log(`[ship] ${plan.reason}`);
    return CODE.NOT_RUN;
  }
  const label = authorLabel(handle);
  if (plan.priority === null) {
    log(
      `[ship] 未给 --priority ⇒ 走平台默认（${ISSUE_PRIORITIES.split("|")[2]}，即「没被判断过」）；` +
        "优先级是判断，本脚本不代填（§13.10.10）。",
    );
  }
  if (!label) {
    log(
      "[ship] 未配留痕短名 ⇒ 单子会建，但不会带 `提单人:` 标签（读数，不阻断）；" +
        "要留痕就配好 COMFYAPP_DEV_HANDLE 再建。",
    );
  }
  if (dryRun) {
    log(
      `[ship] --dry-run：将创建「${plan.title}」（正文 ${bodyFile}，长度 ${read.text.length} 字，` +
        `优先级 ${plan.priority ?? "平台默认"}）` +
        (label
          ? `，再按 ${label}，最后 get-issue 回读`
          : "，不回读标签（未配留痕）") +
        "；一条都没写。",
    );
    return CODE.GREEN;
  }
  const file = mkTmp("ship-issue-body", read.text);
  if (!file) {
    log("[ship] 取不到 git 目录 ⇒ 正文没有落点，这一格没有执行者。");
    return CODE.NOT_RUN;
  }
  const got = cnbJson(run, [
    "issues",
    "create-issue",
    "--repo",
    slug,
    "--title",
    plan.title,
    "--body-file",
    file,
    ...(plan.priority ? ["--priority", plan.priority] : []),
    "-v",
  ]);
  const d =
    got && got.json && typeof got.json === "object" ? got.json.data : null;
  const number = Number(
    d && typeof d === "object" ? (d.number ?? d?.issue?.number) : NaN,
  );
  if (!Number.isInteger(number) || number <= 0) {
    log(
      "[ship] 建单的回执里没有可用的单号 ⇒ 不念「已建成」。" +
        "下一动作：去单子列表确认它是否存在（回执本身不是结论）。",
    );
    return CODE.NOT_RUN;
  }
  log(`[ship] 平台回执里的单号是 #${number}（回执不算结论，下面是独立回读）。`);
  if (label) {
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
  }
  const back = readIssue({ run, slug, number });
  if (!back) {
    log(
      `[ship] #${number} 建后回读没跑起来 ⇒ 不念「已建成」；` +
        `下一动作：打开单子确认，再手动补 ${label ?? "提单人:<短名>"}。`,
    );
    return CODE.NOT_RUN;
  }
  if (back.title !== plan.title) {
    log(
      `[ship] ✗ #${number} 回读的标题是「${back.title}」，与请求的「${plan.title}」不一致` +
        " ⇒ 公开状态不是这一件事，去单子上看一眼。",
    );
    return CODE.RED;
  }
  if (
    label &&
    !labelValues(back.labels, ISSUE_LABEL_ROLES.author).includes(
      String(handle).trim(),
    )
  ) {
    log(
      `[ship] #${number} 回读里没有 ${label} ⇒ 不念「留痕已补上」` +
        "（实测 create-issue --labels 不落地，只能建完再按）。",
    );
    return CODE.NOT_RUN;
  }
  if (plan.priority && back.priority.toUpperCase() !== plan.priority) {
    log(
      `[ship] ✗ #${number} 回读的优先级是「${back.priority}」，与请求的「${plan.priority}」不一致。`,
    );
    return CODE.RED;
  }
  log(
    `[ship] ✓ #${number} 已回读（get-issue）：标题一致 · ` +
      `priority=${back.priority || "?"} · labels=[${labelNames(back.labels).join(", ")}]`,
  );
  log(`[ship] 下一动作：开工前先领取：pnpm ship --claim ${number}`);
  return CODE.GREEN;
}
