/**
 * ship-screenshot-reply.mjs —— 截图上传 + 回帖 Issue 的一步入口（ISSUE #5191）。
 *
 * `pnpm screenshot` 只拍照，回帖要人肉敲两条 `cnb` 命令：上传取 `asset_link`、
 * 再截取粘进评论；漏 `--repo` 报误导性 404（#4162）、评论署名首行漏写（#2269）、
 * `cnb … -v` 退 0 不等于写成功（#2436）都是踩过的坑。
 * 这里只串既有读写入口：上传走 `cnbJson`，正文署名 / 末尾换行归一 / 图片链接归一 /
 * 写后逐字回读全部复用 `ship-comment.mjs`，不另写第二套。
 */
import fs from "node:fs";

import { cnbData } from "../platform/cnb-fields.mjs";
import { appendComment, sameCommentBody } from "./ship-comment.mjs";
import { CODE } from "./ship-core.mjs";
import { cnbJson } from "./ship-exec.mjs";
import { readIssueBody } from "./ship-issue-new.mjs";
import { withCommentHeader } from "./ship-ticket.mjs";

/**
 * 从上传应答里取 asset_link。纯函数（平台形状两种都收）。
 *
 * @param {unknown} json
 * @returns {string|null}
 */
export function assetLinkOf(json) {
  /** @param {unknown} value */
  const pick = (value) => {
    if (value === null || typeof value !== "object") {
      return null;
    }
    for (const [key, v] of Object.entries(value)) {
      if (key === "asset_link" && typeof v === "string" && v.trim() !== "") {
        return v;
      }
    }
    return null;
  };
  const d = cnbData(json);
  return pick(d) ?? pick(d && typeof d === "object" ? d.data : null) ?? pick(json);
}

/**
 * 把人写的文案与图片链接拼成回帖正文。纯函数。
 *
 * @param {{body:string, link:string, handle:string}} input
 */
export function screenshotBody({ body, link, handle }) {
  const header = withCommentHeader(String(body ?? "").trim(), handle);
  return `${header.replace(/\s+$/, "")}\n\n改后截图：${link}\n`;
}

/**
 * @param {{run:any, log:(s:string)=>void, slug:string, number:number,
 *   file:string, bodyFile:string|null, root:string, handle:string, mkTmp:(name:string,text:string)=>string|null,
 *   dryRun?:boolean}} ctx
 */
export function runScreenshotReply({
  run,
  log,
  slug,
  number,
  file,
  bodyFile,
  root,
  handle,
  mkTmp,
  dryRun = false,
}) {
  if (!file || !fs.existsSync(file)) {
    log(`[screenshot-reply] 截图文件读不到：${file || "(空)"} ⇒ 这一格没有执行者。`);
    return CODE.NOT_RUN;
  }
  const read = bodyFile
    ? readIssueBody(root, bodyFile, handle)
    : { ok: true, text: "已按改后截图更新，请核对。\n", raw: "已按改后截图更新，请核对。\n" };
  if (!read.ok) {
    log(`[screenshot-reply] 文案文件读不到：${bodyFile} ⇒ 这一格没有执行者。`);
    return CODE.NOT_RUN;
  }
  if (dryRun) {
    log(
      `[screenshot-reply] --dry-run：#${number} 将上传 ${file} 并回帖（文案 ${bodyFile || "默认"}），一条都没写。`,
    );
    return CODE.GREEN;
  }
  const uploaded = cnbJson(run, [
    "issues",
    "upload-image",
    "--repo",
    slug,
    "--number",
    String(number),
    "--file",
    file,
    "-v",
  ]);
  if (!uploaded) {
    log("[screenshot-reply] 上传那一步没跑起来（响应不是 JSON）⇒ 不念「已上传」，也不回帖。");
    return CODE.NOT_RUN;
  }
  const link = assetLinkOf(uploaded.json);
  if (!link) {
    log("[screenshot-reply] 上传回执里没有 asset_link ⇒ 不猜图床地址、不回帖（退 2）。");
    return CODE.NOT_RUN;
  }
  const text = screenshotBody({ body: read.text, link, handle });
  const wrote = appendComment({ run, log, slug, number, body: text, mkTmp });
  if (!wrote.posted || !wrote.bodies) {
    log(
      "[screenshot-reply] 回帖没跑起来 / 回读没跑起来 ⇒ 不念「已回帖」（图已上传，地址见上面）。",
    );
    return CODE.NOT_RUN;
  }
  const hit = wrote.bodies.find((c) => sameCommentBody(text, c));
  if (!hit) {
    log("[screenshot-reply] ✗ 回读里没有与发出的正文逐字相同的那一条 ⇒ 不念「已回帖」。");
    return CODE.RED;
  }
  log(`[screenshot-reply] ✓ #${number} 截图已上传并回帖（asset_link=${link}，逐字回读命中）。`);
  return CODE.GREEN;
}
