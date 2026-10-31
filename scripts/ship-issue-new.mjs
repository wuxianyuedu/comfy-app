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

import { isExplicitSource } from "./dev-handle.mjs";
import { appendComment, sameCommentBody, stripTrailingNewline } from "./ship-comment.mjs";
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
 * 落点两档（`path`）：`issue` 是单子的评论区、`pull` 是 PR 的评论区。两档的命令形状
 * 只差一个词（`issues` / `pulls`），所以实现只有这一份 —— PR 档那一格（ISSUE #2332）
 * 在这里之前自己抄过一遍「写 + 回读」，两处漂开就是「一边补了回读、另一边没有」。
 *
 * @param {{run:any, log:(s:string)=>void, slug:string, number:number, body:string,
 *   marker:string, mkTmp:(name:string,text:string)=>string|null,
 *   path?:"issue"|"pull"}} input
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
  path: route = "issue",
}) {
  const wrote = appendComment({ run, log, slug, number, body, mkTmp, route });
  if (!wrote.bodies) {
    return false;
  }
  return wrote.bodies.some((c) => c.includes(marker));
}

/**
 * `--comment <号>` 的入口：往一张**已有**单子下写一条不属于任何状态动作的评论
 * （回执、读数、定性说明），写完**逐字回读**（ISSUE #2719）。
 *
 * 为什么要有这一格：这条链此前只能由人现写一份一次性脚本（`makeRunner` → `post-issue-comment`
 * → `list-issue-comments` 回读），而「要写一条评论」这件事在 #2712 的收尾里发生了两次。
 *
 * 四条边界：
 *   · **正文只从文件读**（`--body-file`）。argv 内联那一族被反引号挖过洞（§13.6 记过
 *     同型事故），所以不给 `-m` 那种写法；
 *   · **回读不等价就不退 0**：按「去掉正文末尾那个换行之后逐字相同」判
 *     （`sameCommentBody`，平台会收掉末尾换行），两侧长度一起念出来；
 *   · 署名行由 `withCommentHeader` 保证（与建单同一口径）；正文里的人话是调用方的判断；
 *   · 未配留痕**不阻断**：署名会写「未配」，评论照发 —— 它仍是读数，不是判据。
 *
 * @param {{run:any, log:(s:string)=>void, slug:string, number:number, handle:string, root:string, opt:any, mkTmp:(name:string,text:string)=>string|null, dryRun?:boolean}} ctx 全部由装配层注入
 * @returns {number} `CODE` 之一
 */
export function runIssueComment({
  run,
  log,
  slug,
  number,
  handle,
  root,
  opt,
  mkTmp,
  dryRun = false,
}) {
  const bodyFile = String(opt.bodyFile ?? "").trim();
  if (bodyFile === "") {
    log(
      "[ship] [ERROR] --comment 要和 --body-file <正文文件> 一起用：" +
        "正文是判断（读数 / 定性 / 回执），不由脚本生成，也不从 argv 内联读" +
        "（反引号会在 shell 那一步被当命令替换执行掉）。",
    );
    return CODE.NOT_RUN;
  }
  const read = readIssueBody(root, bodyFile, handle);
  if (!read.ok) {
    log(`[ship] 读不到正文文件：${read.where} ⇒ 这一格没有执行者。`);
    return CODE.NOT_RUN;
  }
  if (read.raw.trim() === "") {
    log(`[ship] 正文文件是空的：${read.where} ⇒ 不写一条只有署名的评论（那是噪音，不是读数）。`);
    return CODE.NOT_RUN;
  }
  if (dryRun) {
    log(
      `[ship] --dry-run：#${number} 将发一条评论（正文 ${bodyFile}，长度 ${read.text.length} 字，` +
        `首行「${read.text.split(/\r?\n/)[0] ?? ""}」），再 list-issue-comments 回读比对；一条都没写。`,
    );
    return CODE.GREEN;
  }
  const wrote = appendComment({
    run,
    log,
    slug,
    number,
    body: read.text,
    mkTmp,
  });
  if (!wrote.posted) {
    log(
      `[ship] #${number} 评论写那一步没跑起来 ⇒ 不念「已评论」` +
        "（下一动作：确认 cnb 与仓库 slug，再重跑一次这条命令）。",
    );
    return CODE.NOT_RUN;
  }
  if (!wrote.bodies) {
    log(
      `[ship] #${number} 评论写后回读没跑起来 ⇒ **不念「已评论」**：` +
        "写可能已经成功，先去评论区看一眼再决定要不要重投（重复投递是这一格的已知失效方向）。",
    );
    return CODE.NOT_RUN;
  }
  const hit = wrote.bodies.find((c) => sameCommentBody(read.text, c));
  if (!hit) {
    const near = wrote.bodies[0] ?? "";
    log(
      `[ship] ✗ #${number} 回读里没有与正文逐字相同的那一条` +
        `（发出 ${read.text.length} 字、最新一条回读 ${String(near).length} 字；` +
        `去末尾换行后 ${stripTrailingNewline(read.text).length} ⇄ ${stripTrailingNewline(near).length}）。` +
        "⇒ 不念「已评论」；先去看评论区，别直接重投。",
    );
    return CODE.RED;
  }
  log(
    `[ship] ✓ #${number} 评论已回读（list-issue-comments，逐字相同）：` +
      `${stripTrailingNewline(read.text).length} 字 · 首行「${String(hit).split(/\r?\n/)[0] ?? ""}」`,
  );
  return CODE.GREEN;
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
 * @returns {{ok:boolean, text:string, raw:string, where:string}} 读不到时 `ok:false`；`text` 带署名行、`raw` 是文件原文
 */
export function readIssueBody(root, file, handle) {
  const where = path.resolve(root || ".", file);
  let text;
  try {
    text = fs.readFileSync(where, "utf8");
  } catch {
    return { ok: false, text: "", raw: "", where };
  }
  return {
    ok: true,
    raw: text,
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
 * @param {string | null} ctx.handle 留痕短名（取值链给的，见 `dev-handle.mjs`）
 * @param {string | null} [ctx.handleSource] 短名**取自哪里**（`resolveDevHandle().source`，
 *   `ship.mjs` 传 `who.source`）。只管「这个名字稳不稳」那一句话术；「标签打不打得上」
 *   按**名字在不在**判（ISSUE #2387）。
 * @param {string | null} [ctx.explicitHandle] **人填过**的那个名字（只读 `COMFYAPP_DEV_HANDLE`）。
 *   `null` = 这次的短名是取的；非 `null` = 你填了 ⇒ 回读里没有标签就算「标签没落地」，退 2
 *   （ISSUE #2355）。
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
  handleSource = null,
  explicitHandle = null,
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
      "[ship] 取不到留痕短名（取值链 `dev-handle.mjs` 走到空，只可能是装配层没传）" +
        " ⇒ 单子会建，但不带 `提单人:` 标签（读数，不阻断）。",
    );
  }
  if (dryRun) {
    log(
      `[ship] --dry-run：将创建「${plan.title}」（正文 ${bodyFile}，长度 ${read.text.length} 字，` +
        `优先级 ${plan.priority ?? "平台默认"}）` +
        (label ? `，再按 ${label}，最后 get-issue 回读` : "，不回读标签（未配留痕）") +
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
  const d = got && got.json && typeof got.json === "object" ? got.json.data : null;
  const number = Number(d && typeof d === "object" ? (d.number ?? d?.issue?.number) : Number.NaN);
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
  /* 话术按**名字在不在**分支、回读为准（ISSUE #2387）：「标签打不打得上」只取决于
   * 名字有没有（名字非空时上一段就会去按，与取的还是填的无关）；「取的 / 填的」
   * 只管**这个名稳不稳**。把「取的」念成「这次不带标签」会与下一行回读互相推翻，
   * 还给人一条错误指令（名字不空，标签已经在了）。 */
  const landed =
    label && labelValues(back.labels, ISSUE_LABEL_ROLES.author).includes(String(handle).trim());
  if (label && !landed && explicitHandle) {
    /* 你填的却没落地 ⇒ 不念「留痕已补上」（ISSUE #2355）。 */
    log(
      `[ship] #${number} 回读里没有 ${label} ⇒ 不念「留痕已补上」` +
        "（实测 create-issue --labels 不落地，只能建完再按）。",
    );
    return CODE.NOT_RUN;
  }
  if (label && landed) {
    log(
      `[ship] ✓ 留痕已补：${label}` +
        (explicitHandle || isExplicitSource(handleSource)
          ? "（你填的）。"
          : handleSource
            ? `（短名取自 ${handleSource}，换机器会变；要固定就在 .env 里填一行 \`COMFYAPP_DEV_HANDLE\`。）`
            : "。"),
    );
  } else if (label) {
    log(
      `[ship] ⚠ ${label} 没在回读里 ⇒ 留痕没落上；` +
        `下一动作：pnpm ship --claim ${number} 补上。`,
    );
  } else {
    log(
      "[ship] 取不到留痕短名 ⇒ 单子会建，但不带 `提单人:` 标签（读数，不阻断）；" +
        "下一动作：`pnpm env:init` 配好留痕再来。",
    );
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
