#!/usr/bin/env node
/**
 * `ci-cnb-attachment.mjs` —— 把一份文本搬上 CNB 仓库附件（`/-/files/`）的共享底层。
 *
 * ## 补的是哪一格
 *
 * 「日志正文不要留在 GitHub，要变成 CNB 站内可下载的附件」这条链路此前只长在
 * `ci-ga-logs-relay.mjs`（PR 侧，ISSUE #3437）里：上传链接 → PUT 正文 → 发评论发布。
 * 每日红立案（`ci-ga-daily-failure-issue.mjs`，ISSUE #4408）要的是同一件事——
 * 单子里的日志要能从 CNB 直接下载，而不是出站 `api.github.com`。两处共用同一套
 * 平台端点与解析，按 §12.18 / §12.12 收成这一份，不再各抄一遍。
 *
 * ## 载体（沿用 relay 的端到端探针结论，不另立口径）
 *
 *   1. `POST /{repo}/-/upload/files`（`repo-notes:rw`）：body `{name,size}` ⇒ 回
 *      `upload_url` / `assets.path` / `token`。
 *   2. `PUT <upload_url>`：把正文送上去（`text/plain`）。
 *   3. 附件在**被单子正文 / 评论引用发布之后**才可读：未发布时
 *      `GET /-/files/<path>` 恒 404（那是「还没发布」，不是「上传失败」）；
 *      发布后裸 GET 即可逐字读回——本地下载不需要令牌，也不需要出站 GitHub。
 *
 * GA 侧没有 `cnb` CLI（#2551 四跑读数），全程裸 fetch；本模块只吃 `node:*`，
 * 下游 job 不装依赖也加载得起来（与 `ci-ga-logs-relay.mjs` 同形）。
 */

/** 平台附件文件名里只许这些字符（run id / sha 都是数字与十六进制，够用）。 */
const SAFE_NAME = /[^0-9A-Za-z._-]/gu;

/**
 * 传输层只需要的最小 fetch 形状：真 `fetch`、测试假件、`FetchLike` 注入件都满足它
 * （cnbRequest 只读 `ok` / `status` / `text()`，不读头、不读 `json()`）。
 *
 * @typedef {(input: string, init?: {body?: string, headers?: Record<string, string>,
 *   method?: string, signal?: AbortSignal}) => Promise<{ok: boolean, status: number,
 *   text: () => Promise<string>}>} FetchTextLike
 */

/**
 * 是不是可按字段取值的对象（API 应答里的字段都是 `unknown`，先过这一跳）。
 *
 * @param {unknown} v 任意值
 * @returns {v is Record<string, unknown>} true ⇒ 对象
 */
function isRecord(v) {
  return typeof v === "object" && v !== null;
}

/**
 * 附件文件名归一：不在白名单里的字符替换成 `_`。
 *
 * @param {string} name 期望的文件名
 * @returns {string} 平台收得下的文件名
 */
export function safeFileName(name) {
  return String(name ?? "").replaceAll(SAFE_NAME, "_");
}

/**
 * 附件的 Markdown 链接（相对路径；平台回读时会自己补成绝对 URL）。
 *
 * @param {string} fileName 文件名（链接文字）
 * @param {string} assetPath `assets.path` 里 `/-/files/` 之后的尾段
 * @returns {string} `[name](/-/files/path)`
 */
export function assetLink(fileName, assetPath) {
  return `[${fileName}](/-/files/${assetPath})`;
}

/**
 * 发一次 CNB 调用（写一律不重试：一次重发就可能多一张单 / 多一条评论）。
 *
 * 自 `ci-ga-logs-relay.mjs` 上移到这里（relay 原样再导出，`ci-ga-desktop-relay.mjs`
 * 的既有 import 不动），超时 / 头部 / JSON 信封口径一字未改。
 *
 * @param {{ctx:{token:string}, fetchImpl:FetchTextLike}} io
 * @param {"POST"|"PUT"|"PATCH"|"GET"} method 方法
 * @param {string} target 完整 URL
 * @param {{json?:unknown, text?:string, contentType?:string}} [body] 请求体
 * @returns {Promise<{ok:true, status:number, json:unknown, text:string} | {ok:false, status:number, detail:string}>}
 */
export async function cnbRequest(io, method, target, body = {}) {
  try {
    /** @type {Record<string,string>} */
    const headers = { Accept: "application/json", Authorization: `Bearer ${io.ctx.token}` };
    /** @type {string | undefined} */
    let payload;
    if (body.json !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body.json);
    } else if (body.text !== undefined) {
      headers["Content-Type"] = body.contentType ?? "text/plain";
      headers["Content-Length"] = String(Buffer.byteLength(body.text, "utf8"));
      payload = body.text;
    }
    const res = await io.fetchImpl(target, {
      body: payload,
      headers,
      method,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text === "" ? null : JSON.parse(text);
    } catch {
      /* 2xx 但不是 JSON：PUT 上传、GET 附件正文都走这一档。 */
    }
    return res.ok
      ? { json, ok: true, status: res.status, text }
      : { detail: text.slice(0, 300), ok: false, status: res.status };
  } catch (error) {
    return { detail: String(error), ok: false, status: -1 };
  }
}

/**
 * 把一份**纯文本**传成 CNB 仓库附件：取上传链接 → PUT 正文。
 *
 * 只做这两步；「发布」由调用方把 {@link assetLink} 拼进单子正文 / 评论来完成
 * （平台口径：附件随引用它的正文 / 评论发布后才可读）。文本按 UTF-8 计字节，
 * `size` 与 PUT 的 `Content-Length` 都用它——平台按这个数收。
 *
 * @param {{endpoint:string, repo:string, token:string, fileName:string, text:string,
 *   fetchImpl:FetchTextLike}} io
 *   `endpoint` 形如 `https://api.cnb.cool`；`repo` 是 `owner/repo` slug；
 *   `fileName` 会先过 {@link safeFileName} 归一。
 * @returns {Promise<{ok:true, fileName:string, assetPath:string, bytes:number} |
 *   {ok:false, detail:string}>} `assetPath` 是 `/-/files/` 之后的尾段（拼链接用）
 */
export async function uploadCnbTextFile(io) {
  const fileName = safeFileName(io.fileName);
  const bytes = Buffer.byteLength(io.text, "utf8");
  const api = `${io.endpoint.replace(/\/+$/u, "")}/${io.repo}`;
  const req = { fetchImpl: io.fetchImpl, ctx: { token: io.token } };
  const up = await cnbRequest(req, "POST", `${api}/-/upload/files`, {
    json: { name: fileName, size: bytes },
  });
  if (!up.ok) {
    return { ok: false, detail: `取上传链接（HTTP ${String(up.status)}）：${up.detail}` };
  }
  const data = isRecord(up.json) && isRecord(up.json.data) ? up.json.data : up.json;
  const uploadUrl = isRecord(data) ? String(data.upload_url ?? "") : "";
  const rawPath = isRecord(data) && isRecord(data.assets) ? String(data.assets.path ?? "") : "";
  const tail = /\/-\/files\/(?<path>.+)$/u.exec(rawPath);
  const assetPath = tail?.groups?.path ?? rawPath.replace(/^\/+/u, "");
  if (!uploadUrl || !assetPath) {
    return { ok: false, detail: "上传应答缺 upload_url / assets.path" };
  }
  const put = await cnbRequest(req, "PUT", uploadUrl, {
    contentType: "text/plain; charset=utf-8",
    text: io.text,
  });
  if (!put.ok) {
    return { ok: false, detail: `PUT 附件正文（HTTP ${String(put.status)}）：${put.detail}` };
  }
  return { assetPath, bytes, fileName, ok: true };
}
