/**
 * `ci-dependabot-triage-platform.mjs` —— Dependabot 那一侧的平台调用层。
 *
 * CNB 侧的读写（cnbCall / ensureLabel / createIssue / appendComment / updateBody /
 * listOpenIssues）与 GitHub 侧的通用 GET（ghGet，含 5xx 重试与失败分类）**全部
 * 复用** `ci-code-scanning-triage-platform.mjs` 的既有出口 —— 两个族共享同一套
 * 平台机制，本文件只放 Dependabot 独有的那一格：`/dependabot/alerts` 的分页读取
 * 与告警归一。
 *
 * ## 权限
 *
 * 内置 `GITHUB_TOKEN` 按**族**给权限：Dependabot alerts 要 `vulnerability-alerts: read`；
 * `security-events: read` 只覆盖 code scanning，两枚互不覆盖（细粒度 PAT 的
 * 「Security events」才是一项三合一）。所以 workflow 那侧各自声明自己那一枚。
 *
 * ## 分页
 *
 * 这个端点**不吃 `page` 参数**（实测 400：`Pagination using the page parameter
 * is not supported`）—— 它是游标分页，下一页地址只从响应的 `Link` 头
 * （`rel="next"`）里拿。code scanning 那族的 `page=` 写法在这里照抄会当场 400。
 *
 * @typedef {import("./ci-dependabot-triage-model.mjs").FetchLike} FetchLike
 * @typedef {import("./ci-dependabot-triage-model.mjs").Alert} Alert
 */

import { ghGet } from "./ci-code-scanning-triage-platform.mjs";
import { normalizeAlert } from "./ci-dependabot-triage-model.mjs";

const PER_PAGE = 100;
const MAX_PAGES = 20;

/**
 * 从 GitHub 的 `Link` 头里取 `rel="next"` 那一段，归一成相对 `apiBase` 的
 * path+query（ghGet 拼地址用）。没有下一页就是 `null`。
 * @param {string | null} link `Link` 头原值（可能为 null）
 * @returns {string | null} 如 `/repos/o/r/dependabot/alerts?...&after=x`；解析不了也是 null
 */
function nextPagePath(link) {
  const raw = String(link ?? "");
  if (raw === "") {
    return null;
  }
  for (const part of raw.split(",")) {
    const m = /<(?<href>[^>]+)>\s*;\s*rel="next"/.exec(part);
    const href = m?.groups?.href;
    if (!href) {
      continue;
    }
    try {
      const url = new URL(href);
      return `${url.pathname}${url.search}`;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 告警全量（open）。**只拿到部分页就是失败**：那会让「某包没有告警」这句话
 * 变成假读数（把一次失败写成一批「已清零」）。
 * @param {{fetchImpl: FetchLike, token: string, repo: string, apiBase: string}} ctx
 * @returns {Promise<{ok: true, alerts: Alert[], pages: number} | {ok: false, kind: string, status: number, detail: string, partial: number}>}
 */
export async function fetchDependabotAlerts(ctx) {
  return fetchAlertsPage(
    ctx,
    `/repos/${ctx.repo}/dependabot/alerts?state=open&per_page=${PER_PAGE}`,
    1,
    [],
  );
}

/**
 * 逐页取告警（递归：`await` 不进循环体）。下一页地址来自 `Link` 头的游标，
 * 不自己拼 `page=`（见文件头「分页」）。
 * @param {{fetchImpl: FetchLike, token: string, repo: string, apiBase: string}} ctx
 * @param {string} path 本页请求的 path+query（首页不带游标，后续页带 `after`）
 * @param {number} page 页码（从 1 起，只用于读数与 MAX_PAGES 闸）
 * @param {Alert[]} seen 已取到的告警
 * @returns {Promise<{ok: true, alerts: Alert[], pages: number} | {ok: false, kind: string, status: number, detail: string, partial: number}>}
 */
async function fetchAlertsPage(ctx, path, page, seen) {
  const got = await ghGet(ctx, path);
  if (!got.ok) {
    return {
      ok: false,
      kind: got.kind,
      status: got.status,
      detail: `第 ${page} 页：${got.detail}`,
      partial: seen.length,
    };
  }
  if (!Array.isArray(got.json)) {
    return {
      ok: false,
      kind: "shape",
      status: 200,
      detail: `第 ${page} 页不是数组`,
      partial: seen.length,
    };
  }
  const alerts = [...seen, ...got.json.map(normalizeAlert)];
  const next = nextPagePath(got.link);
  if (!next) {
    return { ok: true, alerts, pages: page };
  }
  if (page >= MAX_PAGES) {
    return {
      ok: false,
      kind: "too-many-pages",
      status: -1,
      detail: `${MAX_PAGES} 页仍是满页 ⇒ 没有取完（不拿部分读数写平台）`,
      partial: alerts.length,
    };
  }
  return fetchAlertsPage(ctx, next, page + 1, alerts);
}
