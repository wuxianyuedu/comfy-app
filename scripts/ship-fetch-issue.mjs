#!/usr/bin/env node
/**
 * ship-fetch-issue.mjs —— `pnpm ship --fetch-issue <号>`：把一张 issue 的
 * 正文、评论与图片一次性取到本机固定目录（ISSUE #3965）。
 *
 * ── 为什么要有这一格 ────────────────────────────────────────────
 *
 * 处理问题时经常要回头看单子里的截图与描述，但图片链接是平台签名/时效形态，
 * 直接抓 URL 常常 404；逐张手工 `cnb issues get-imgs` 又要人肉拼路径、想落点。
 * 这一格把「取文本 + 取图片」收成一个有名字的入口：**一次跑完，落进
 * `<检出>/.workbuddy/issues/<号>/`**（固定目录、按号分目录、`.workbuddy/`
 * 已被 gitignore——机器本地的作业材料，不进版本库）。
 *
 * **重跑即更新**（issue 内容有改动时再跑一遍）：`issue.md` / `comments.md`
 * 整份重写，图片按「同路径同文件名」覆盖——没有任何跨次累积状态，所以
 * 「更新」不需要额外旗标。
 *
 * ── 边界 ────────────────────────────────────────────────────────
 *
 *   · **只读平台**：只发 `issues get-issue` / `issues list-comments` /
 *     `issues get-imgs` 三条读命令，一次也不写平台（与 --diagnose 同族）。
 *   · 图片走**官方通道**（`get-imgs`），不再让人手拼 URL 撞 404；
 *     某张图确实取不到（平台侧已删）⇒ 原样保留链接并念一行 warn，不阻断整体。
 *   · 退出码：读到 issue ⇒ 0；issue 取不到 / 没有执行者 ⇒ 2（「没跑起来」，
 *     不是「内容为空」）。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { CODE } from "./ship-codes.mjs";
import { cnbJson } from "./ship-exec.mjs";

/** issue/PR 图片链接的尾段形状（cnb-api 约定：imgs/<issues|pulls>/<ID>/<key>/<文件名>）。 */
const IMG_TAIL_RE = /imgs\/(?:issues|pulls)\/[A-Za-z0-9._/-]+/g;

/** 评论分页：单页 50、最多 5 页（250 条评论的封顶，超过的极少见、真有就明说）。 */
const COMMENTS_PAGE_SIZE = 50;
const COMMENTS_MAX_PAGES = 5;

/**
 * 从一段 markdown 里按出现顺序抽**去重**的图片尾段。
 * 纯函数：不认协议、不认域名，只认平台图片链接的固定尾段形状——
 * 这样正文、评论、相对/绝对链接都覆盖，且不会被 `)` / 空格 / 中文标点带偏。
 *
 * @param {string} text
 * @returns {string[]}
 */
export function extractImageTails(text) {
  /** @type {string[]} */
  const found = [];
  for (const m of String(text ?? "").matchAll(IMG_TAIL_RE)) {
    const tail = m[0];
    if (!found.includes(tail)) {
      found.push(tail);
    }
  }
  return found;
}

/**
 * 把文本里的图片链接换成**本地相对路径**（已成功下载的）；取不到的原样保留。
 * 纯函数：`mapping` 是 尾段 → 本地相对路径。
 *
 * @param {string} text
 * @param {Map<string, string>} mapping
 * @returns {string}
 */
export function rewriteImageLinks(text, mapping) {
  return String(text ?? "").replaceAll(IMG_TAIL_RE, (tail) => mapping.get(tail) ?? tail);
}

/**
 * 图片本地文件名：保留原文件名便于认，撞名时加序号前缀；非安全字符换 `_`。
 * 纯函数。
 *
 * @param {string} tail 图片尾段（最后一段是文件名）
 * @param {Set<string>} used 已用过的名字（就地追加）
 * @returns {string}
 */
export function imageLocalName(tail, used) {
  const base = path.basename(tail).replaceAll(/[^A-Za-z0-9._-]/g, "_");
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let i = 2;
  for (; ; i += 1) {
    const candidate = `img-${i}-${base}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

/**
 * issue 主文档：front matter 一段 + 正文（图片链接已换本地路径）。
 * 纯函数。
 *
 * @param {{number: number|string, title: string, state: string, author: string,
 *           createdAt: string, updatedAt: string, priority: string, labels: string[],
 *           body: string, fetchedAt: string, commentsCount: number, imagesTotal: number,
 *           imagesFailed: number}} r
 * @returns {string}
 */
export function renderIssueMd(r) {
  const lines = [
    `# #${r.number} ${r.title}`,
    "",
    `- 号：#${r.number} · 状态：${r.state} · 作者：${r.author}`,
    `- 创建：${r.createdAt} · 更新：${r.updatedAt}`,
    `- 优先级：${r.priority || "（未设）"} · 标签：${r.labels.length > 0 ? r.labels.join("、") : "（无）"}`,
    `- 抓取时间：${r.fetchedAt}（重跑即更新；评论 ${r.commentsCount} 条）`,
    `- 图片：${r.imagesTotal} 张（下载成功 ${r.imagesTotal - r.imagesFailed}、失败 ${r.imagesFailed}；失败者保留原链接）`,
    "",
    "## 正文",
    "",
    r.body.trim() === "" ? "（正文为空）" : r.body,
    "",
  ];
  return lines.join("\n");
}

/**
 * 评论文档：逐条小节，图片链接同样换本地路径。纯函数。
 *
 * @param {Array<{index: number, author: string, createdAt: string, body: string}>} comments
 * @returns {string}
 */
export function renderCommentsMd(comments) {
  const lines = ["## 评论", ""];
  if (comments.length === 0) {
    lines.push("（无评论）");
  }
  for (const c of comments) {
    lines.push(`### 评论 ${c.index} · ${c.author} · ${c.createdAt}`, "", c.body, "");
  }
  return lines.join("\n");
}

/**
 * 把 `data` 里指向的临时文件复制进 imgs 目录；返回本地相对路径。
 * 复制而不是移动：那份临时件是 cnb CLI 的产出，留在原地无害。
 *
 * @param {{run: (cmd: string, args: string[]) => import("./ship-exec.mjs").ExecResult,
 *          log: (s: string) => void, slug: string, tail: string, dest: string}} io
 * @returns {boolean} 成功落盘与否
 */
function downloadImage({ run, log, slug, tail, dest }) {
  const got = cnbJson(run, ["issues", "get-imgs", "--repo", slug, "--img-path", tail, "-v"]);
  const data = got?.json?.data;
  if (!got || typeof data !== "string" || data === "") {
    log(`[fetch-issue] ⚠ 图片取不到（get-imgs 没答或没给落点）：${tail}`);
    return false;
  }
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(data, dest);
    return true;
  } catch (error) {
    log(`[fetch-issue] ⚠ 图片落盘失败（${String(error)}）：${tail}`);
    return false;
  }
}

/**
 * 分页拉评论：单页 50、最多 5 页；任何一页没答就**带 warn 继续**（正文优先落地）。
 *
 * @param {{run: (cmd: string, args: string[]) => import("./ship-exec.mjs").ExecResult,
 *          log: (s: string) => void, slug: string, number: number|string}} io
 * @returns {Array<{author: string, createdAt: string, body: string}>}
 */
function fetchComments({ run, log, slug, number }) {
  const items = [];
  for (let page = 1; page <= COMMENTS_MAX_PAGES; page += 1) {
    const got = cnbJson(run, [
      "issues",
      "list-comments",
      "--repo",
      slug,
      "--number",
      String(number),
      "--sort",
      "created",
      "--page",
      String(page),
      "--page-size",
      String(COMMENTS_PAGE_SIZE),
      "-v",
    ]);
    const data = got?.json?.data;
    if (!Array.isArray(data)) {
      if (page === 1) {
        log("[fetch-issue] ⚠ 评论列表取不到（list-comments 没答）⇒ 只落正文，评论跳过。");
      }
      break;
    }
    for (const item of data) {
      const body = typeof item?.body === "string" ? item.body : "";
      const author = String(item?.author?.nickname ?? item?.author?.username ?? "（未知）");
      items.push({ author, createdAt: String(item?.created_at ?? ""), body });
    }
    if (data.length < COMMENTS_PAGE_SIZE) {
      break;
    }
  }
  return items;
}

/**
 * 入口：取 issue → 落 `.workbuddy/issues/<号>/`。
 *
 * @param {{run: (cmd: string, args: string[]) => import("./ship-exec.mjs").ExecResult,
 *          log: (s: string) => void, slug: string | null, number: number,
 *          root?: string, now?: () => Date}} io
 * @returns {number} `CODE` 之一
 */
export function runFetchIssue(io) {
  const { run, log, slug, number } = io;
  const root = io.root ?? process.cwd();
  const now = io.now ?? (() => new Date());
  if (!slug) {
    log("[fetch-issue] 取不到仓库 slug ⇒ 没有结论（不猜一个仓库名去读别人的单子）。");
    return CODE.NOT_RUN;
  }
  const got = cnbJson(run, [
    "issues",
    "get-issue",
    "--repo",
    slug,
    "--number",
    String(number),
    "-v",
  ]);
  const data = got?.json?.data;
  if (!got || typeof data !== "object" || data === null) {
    log(`[fetch-issue] issue #${number} 取不到（get-issue 没答 / 号不存在）⇒ 没有结论。`);
    return CODE.NOT_RUN;
  }

  const title = String(data.title ?? "");
  const body = typeof data.body === "string" ? data.body : "";
  const comments = fetchComments({ run, log, slug, number });

  /* 落点：.workbuddy/issues/<号>/（固定目录、按号分目录、gitignored）。 */
  const dir = path.join(root, ".workbuddy", "issues", String(number));
  const imgsDir = path.join(dir, "imgs");
  fs.mkdirSync(imgsDir, { recursive: true });

  /* 图片：正文 + 全部评论按序抽尾段，去重下载；成功的换本地相对路径。 */
  const mapping = new Map();
  const usedNames = new Set();
  const tails = [
    ...extractImageTails(body),
    ...comments.flatMap((c) => extractImageTails(c.body)),
  ].filter((tail, i, all) => all.indexOf(tail) === i);
  let failed = 0;
  for (const tail of tails) {
    const localName = imageLocalName(tail, usedNames);
    const ok = downloadImage({ run, log, slug, tail, dest: path.join(imgsDir, localName) });
    if (ok) {
      mapping.set(tail, `imgs/${localName}`);
    } else {
      failed += 1;
    }
  }

  const rewrittenBody = rewriteImageLinks(body, mapping);
  const rewrittenComments = comments.map((c, i) => ({
    index: i + 1,
    author: c.author,
    createdAt: c.createdAt,
    body: rewriteImageLinks(c.body, mapping),
  }));

  const fetchedAt = now().toISOString();
  fs.writeFileSync(
    path.join(dir, "issue.md"),
    renderIssueMd({
      number,
      title,
      state: String(data.state ?? ""),
      author: String(data.author?.nickname ?? data.author?.username ?? "（未知）"),
      createdAt: String(data.created_at ?? ""),
      updatedAt: String(data.updated_at ?? ""),
      priority: String(data.priority ?? ""),
      labels: Array.isArray(data.labels)
        ? data.labels.map((/** @type {{name?: unknown} | string} */ l) =>
            String(typeof l === "object" && l !== null ? (l.name ?? "") : l),
          )
        : [],
      body: rewrittenBody,
      fetchedAt,
      commentsCount: comments.length,
      imagesTotal: tails.length,
      imagesFailed: failed,
    }),
    "utf8",
  );
  fs.writeFileSync(path.join(dir, "comments.md"), renderCommentsMd(rewrittenComments), "utf8");

  log(
    `[fetch-issue] ✓ #${number} 已落到 ${dir}` +
      `（正文 + 评论 ${comments.length} 条；图片 ${tails.length} 张，成功 ${tails.length - failed}、失败 ${failed}）。`,
  );
  if (failed > 0) {
    log("[fetch-issue] ⚠ 有图片没取到：issue.md / comments.md 里保留原链接，可重跑本口再试。");
  }
  return CODE.GREEN;
}
