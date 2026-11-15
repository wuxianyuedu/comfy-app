#!/usr/bin/env node
/**
 * `ship-ga-logs-cnb.mjs` —— 本地从 **CNB 站内**读回 GA 判红日志正文（ISSUE #3437）。
 *
 * ## 为什么单独一层
 *
 * `ci-ga-logs-relay.mjs` 是 GA 侧的写者：判红时把失败 job 日志脱敏 + gzip + base64
 * 写成 CNB 附件，并发一条带 `GA_LOG_RELAY_V1` marker 的 PR 评论发布它。本模块是本地
 * 读者：按 PR 号扫评论列表认 marker、从附件读回 base64、decode + gunzip 还原正文。
 *
 * 整条链全在 `api.cnb.cool` 站内（`cnb` CLI 自动带登录态 / 平台注入 `CNB_TOKEN`），
 * **本地一台都不碰 github.com** —— 这正是本单要解的那一格。`pnpm ship --gh-logs`
 * 优先走这里；CNB 侧缺席（旧 PR 没跑过 relay / 评论被清 / 平台读不到）才退回
 * `ship-gh-logs.mjs` 的原 GitHub 链路（快速回退完整留盘）。
 *
 * ## 为什么走 `cnb` CLI 而不是裸 fetch
 *
 * `ship` 本来就依赖 `cnb`（`probeCnb` / `cnbJson` 全族），CLI 自己解析 `~/.cnb/token`
 * 与平台注入的 `CNB_TOKEN`，开发机上不必再配一遍令牌。`assets get-files` 的 `-v`
 * 输出是平台 JSON 信封，`data` 是附件正文（纯文本 base64），逐字读回不受二进制损坏。
 *
 * ## 边界
 *
 *   · **取不到 ≠ 判红**：任何一步没读到都只回 `null`，由调用方退回 GitHub 链路，
 *     不改三态、不改退码。本模块永不抛异常。
 *   · **只认最新一条 marker 评论**：列表按 `-created` 新到旧；marker 里带 run/sha/pr
 *     身份读数，本地把它们念出来，不用跳 GA 页面。
 *   · **不写平台**：纯只读。
 */
import { gunzipSync } from "node:zlib";

import { parseRelayComment, RELAY_MARKER } from "./ci-ga-logs-relay.mjs";
import { cnbJson } from "./ship-exec.mjs";

/** 评论列表一次取多少条：relay 每次判红留一条，几十笔足够覆盖活跃 PR。
 * 列表是旧→新且不支持 sort，取满一页再倒着扫第一条 marker。 */
export const COMMENT_PAGE_SIZE = 50;

/**
 * 从一条评论的正文里抽出附件路径（`/-/files/<tail>`）。
 *
 * 平台把相对链回读时可能补成绝对 URL，两种形状都认；`parseRelayComment` 已经做过
 * 这一跳，这里只是把它暴露给「只想拿路径」的调用方 / 单测。
 *
 * @param {string} body 评论正文
 * @returns {{run:string,sha:string,pr:string,jobs:number,bytes:number,assetPath:string,scope:string} | null}
 */
export function readRelayMarker(body) {
  return parseRelayComment(body);
}

/**
 * 按 PR 号列出评论，认出最新一条 relay marker。
 *
 * @param {(cmd:string,args:string[])=>import("./ship-exec.mjs").ExecResult} run 执行者
 * @param {string} slug 仓库路径
 * @param {number} number PR 号
 * @returns {{run:string,sha:string,pr:string,jobs:number,bytes:number,assetPath:string,scope:string} | null}
 */
export function findRelayComment(run, slug, number) {
  const res = cnbJson(run, [
    "pulls",
    "list-comments",
    "--repo",
    slug,
    "--number",
    String(number),
    "--page-size",
    String(COMMENT_PAGE_SIZE),
    "-v",
  ]);
  const list = res?.json && Array.isArray(res.json.data) ? res.json.data : null;
  if (!list) return null;
  /* 列表是旧→新，且两个 list 命令都不支持 `--sort`（实测 `unknown option`）。
   * 倒着扫，第一条 marker 就是最新那一跑；不去猜平台的排序口径。 */
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const c = list[i];
    if (c && typeof c === "object") {
      const hit = readRelayMarker(String(c.body ?? ""));
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * 读回一条附件正文（纯文本 base64）。
 *
 * @param {(cmd:string,args:string[])=>import("./ship-exec.mjs").ExecResult} run 执行者
 * @param {string} slug 仓库路径
 * @param {string} assetPath `/-/files/` 之后那一段
 * @returns {string | null} 正文；读不到时 null
 */
export function readRelayAttachment(run, slug, assetPath) {
  const res = cnbJson(run, ["assets", "get-files", "--repo", slug, "--filePath", assetPath, "-v"]);
  if (!res?.json || !("data" in res.json)) return null;
  const data = res.json.data;
  if (typeof data !== "string") return null;
  return data;
}

/**
 * base64 → gzip → 正文。任何一步坏掉都回 null（不抛、不假装读到了）。
 *
 * @param {string} b64 base64 文本
 * @param {(b:Buffer)=>Buffer} [gunzip] 可注入（单测）
 * @returns {string | null} 还原后的日志正文
 */
export function decodeRelayPayload(b64, gunzip = gunzipSync) {
  try {
    const cleaned = String(b64 ?? "").replaceAll(/\s/gu, "");
    if (cleaned === "") return null;
    const out = gunzip(Buffer.from(cleaned, "base64"));
    return Buffer.from(out).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * 一次完整读回：认 marker → 读附件 → 解码。
 *
 * @param {{run:(cmd:string,args:string[])=>import("./ship-exec.mjs").ExecResult, slug:string, number:number}} io
 * @returns {{meta:{run:string,sha:string,pr:string,jobs:number,bytes:number,assetPath:string,scope:string}, text:string} | null}
 *   读到正文时给它 + 身份读数；任一跳没读到回 null
 */
export function readRelayLogs(io) {
  const meta = findRelayComment(io.run, io.slug, io.number);
  if (!meta) return null;
  const b64 = readRelayAttachment(io.run, io.slug, meta.assetPath);
  if (!b64) return null;
  const text = decodeRelayPayload(b64);
  if (!text) return null;
  return { meta, text };
}

/** marker 字符串再导出一份，给调用方拼「CNB 侧缺席」的诊断行用。 */
export { RELAY_MARKER };
