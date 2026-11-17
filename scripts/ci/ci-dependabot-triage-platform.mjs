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
 * 内置 `GITHUB_TOKEN` 的 `security-events: read` 同时覆盖 code scanning 与
 * Dependabot alerts（GitHub 的「Security events」细粒度权限是三合一：code
 * scanning / Dependabot / secret scanning），所以 workflow 那侧不用加新权限。
 *
 * @typedef {import("./ci-dependabot-triage-model.mjs").FetchLike} FetchLike
 * @typedef {import("./ci-dependabot-triage-model.mjs").Alert} Alert
 */

import { ghGet } from "./ci-code-scanning-triage-platform.mjs";
import { normalizeAlert } from "./ci-dependabot-triage-model.mjs";

const PER_PAGE = 100;
const MAX_PAGES = 20;

/**
 * 告警全量（open）。**只拿到部分页就是失败**：那会让「某包没有告警」这句话
 * 变成假读数（把一次失败写成一批「已清零」）。
 * @param {{fetchImpl: FetchLike, token: string, repo: string, apiBase: string}} ctx
 * @returns {Promise<{ok: true, alerts: Alert[], pages: number} | {ok: false, kind: string, status: number, detail: string, partial: number}>}
 */
export async function fetchDependabotAlerts(ctx) {
  return fetchAlertsPage(ctx, 1, []);
}

/**
 * 逐页取告警（递归：`await` 不进循环体）。
 * @param {{fetchImpl: FetchLike, token: string, repo: string, apiBase: string}} ctx
 * @param {number} page 页码（从 1 起）
 * @param {Alert[]} seen 已取到的告警
 * @returns {Promise<{ok: true, alerts: Alert[], pages: number} | {ok: false, kind: string, status: number, detail: string, partial: number}>}
 */
async function fetchAlertsPage(ctx, page, seen) {
  const got = await ghGet(
    ctx,
    `/repos/${ctx.repo}/dependabot/alerts?state=open&per_page=${PER_PAGE}&page=${page}`,
  );
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
  if (got.json.length < PER_PAGE) {
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
  return fetchAlertsPage(ctx, page + 1, alerts);
}
