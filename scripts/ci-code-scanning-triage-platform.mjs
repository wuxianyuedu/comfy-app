/**
 * `ci-code-scanning-triage-platform.mjs` —— 平台调用层：读 GitHub code scanning、写 CNB issue。
 *
 * ## 为什么走 HTTP 而不是 `cnb` CLI
 *
 * 这一格跑在 GitHub 托管 runner 上，宿主 PATH 上没有 `cnb`（`ci-token-scopes.mjs` 的四跑
 * 读数已经量过这件事）。平台**无条件注入**的是 `CNB_TOKEN` 与 `CNB_API_ENDPOINT` ——
 * 这里用的是前者同一形状：`Authorization: Bearer <token>`。
 *
 * ## 重试的边界
 *
 * **读**才重试（5xx / 网络错误最多两次）；**写**一律一次 —— 一次建单重发就可能多一张单。
 * 401 / 403 / 429 不重试：重试只会把同一句错话再说两遍。
 *
 * @typedef {import("./ci-code-scanning-triage-model.mjs").FetchLike} FetchLike
 * @typedef {import("./ci-code-scanning-triage-model.mjs").Analysis} Analysis
 * @typedef {import("./ci-code-scanning-triage-model.mjs").Alert} Alert
 * @typedef {import("./ci-code-scanning-triage-model.mjs").IssueRow} IssueRow
 * @typedef {import("./ci-code-scanning-triage-model.mjs").Action} Action
 */

import {
  AUTHOR_HANDLE,
  CLEARED_LABEL,
  FAMILY_LABEL,
  LABEL_COLORS,
  normalizeAlert,
  normalizeTitle,
} from "./ci-code-scanning-triage-model.mjs";

const PER_PAGE = 100;
const MAX_PAGES = 20;
/** 5xx 只重试两次（第三次仍失败就红）：再多只会把一次平台抖动拉成一条慢红。 */
export const RETRIES = 2;

/* ── 平台调用（读给 retries；写**不重试**：一次建单重发就可能多一张单） ── */

/**
 * GitHub 那一侧的分类：401 / 403（含限流）/ 5xx / 形状。
 * @param {number} status HTTP 状态
 * @param {string} body 响应原文
 * @param {string | null} remaining `x-ratelimit-remaining`
 * @returns {{kind: string, detail: string}}
 */
export function classifyGithubFailure(status, body, remaining) {
  const text = String(body ?? "");
  if (status === 401) {
    return {
      kind: "auth",
      detail:
        "401：GH_TOKEN / GITHUB_TOKEN 无效或已过期（secret 名与本档注入的 env 不是同一个东西时也会落到这里）",
    };
  }
  if (
    status === 429 ||
    (status === 403 && (String(remaining ?? "") === "0" || /rate limit/i.test(text)))
  ) {
    return {
      kind: "rate-limit",
      detail: "限流：GitHub API 配额用尽（等配额重置，或把这一格挪到别的时刻；本档不改判据）",
    };
  }
  if (status === 403) {
    return {
      kind: "forbidden",
      detail:
        "403：内置 GITHUB_TOKEN 缺 `security-events: read`，或细粒度令牌没开 Security events（Read-only）",
    };
  }
  if (status >= 500) {
    return { kind: "server", detail: `${status}：GitHub 服务端错误（已重试 ${RETRIES} 次仍失败）` };
  }
  return { kind: "http", detail: `${status}：${text.slice(0, 160)}` };
}

/**
 * CNB 那一侧的分类：平台在 403 的原话里点名缺哪一枚 scope。
 * @param {number} status HTTP 状态
 * @param {string} body 响应原文
 * @returns {{kind: string, detail: string}}
 */
export function classifyCnbFailure(status, body) {
  const text = String(body ?? "");
  const scope = /Missing required scopes?:?\s*(?<scope>[^\s",}]*)/i.exec(text);
  if (status === 401) {
    return { kind: "auth", detail: "401：CNB_ISSUE_TOKEN 无效或已过期" };
  }
  if (status === 403) {
    return {
      kind: "forbidden",
      detail: scope?.groups?.scope
        ? `403：令牌缺 \`${scope.groups.scope}\`（GitHub secret \`CNB_ISSUE_TOKEN\` 的权限面）`
        : "403：令牌权限不足（本档要 `repo-issue:rw`（建单/改单/贴标签）+ `repo-notes:rw`（评论/仓库标签））",
    };
  }
  if (status === 429) {
    return { kind: "rate-limit", detail: "429：CNB API 限流" };
  }
  if (status >= 500) {
    return { kind: "server", detail: `${status}：CNB 服务端错误` };
  }
  return { kind: "http", detail: `${status}：${text.slice(0, 160)}` };
}

/**
 * catch 里的 `error` 是 `unknown`：只取名字（`ENOTFOUND` / `TimeoutError` 那类），
 * 不把 message 拼进读数（message 里可能有长 URL）。
 * @param {unknown} error 捕获到的值
 * @returns {string}
 */
function errorName(error) {
  if (typeof error === "object" && error !== null && "name" in error) {
    const name = /** @type {unknown} */ (error.name);
    if (typeof name === "string" && name !== "") {
      return name;
    }
  }
  return String(error);
}

/**
 * 一次 GitHub GET（5xx / 网络错误重试两次）。
 *
 * 写成**递归**而不是 `for` 循环：分页与重试都必须按顺序来，但 `await` 不进循环体
 * 才过得了 `no-await-in-loop`（本仓规矩：不新增 lint 禁用）。
 *
 * @param {{fetchImpl: FetchLike, token: string, repo: string, apiBase: string}} ctx
 * @param {string} path 以 `/` 开头的子路径
 * @param {number} [attempt] 已重试次数（内部用）
 * @returns {Promise<{ok: true, json: any, link: string | null} | {ok: false, kind: string, status: number, detail: string}>}
 */
async function ghGet(ctx, path, attempt = 0) {
  try {
    const res = await ctx.fetchImpl(`${ctx.apiBase}${path}`, {
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Cache-Control": "no-cache",
      },
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (res.ok) {
      try {
        return { ok: true, json: JSON.parse(text), link: res.headers.get("link") };
      } catch {
        return { ok: false, kind: "shape", status: res.status, detail: "响应不是 JSON" };
      }
    }
    const failure = classifyGithubFailure(
      res.status,
      text,
      res.headers.get("x-ratelimit-remaining"),
    );
    /* 只有 5xx 值得重试；401/403/429 重试只会把同一句错话再说两遍。 */
    if (failure.kind === "server" && attempt < RETRIES) {
      return ghGet(ctx, path, attempt + 1);
    }
    return { ok: false, kind: failure.kind, status: res.status, detail: failure.detail };
  } catch (error) {
    if (attempt < RETRIES) {
      return ghGet(ctx, path, attempt + 1);
    }
    return {
      ok: false,
      kind: "network",
      status: -1,
      detail: `起不来（${errorName(error)}）`,
    };
  }
}

/**
 * 一次 CNB 调用（**读**才允许重试，见 `opt.retries`；写一律 0）。
 *
 * 重试同样写成递归：写路径不重试（一次建单重发就可能多一张单），读路径最多两次。
 *
 * @param {{fetchImpl: FetchLike, token: string, base: string, slug: string}} ctx
 * @param {"GET" | "POST" | "PATCH"} method
 * @param {string} subPath 相对 `/{repo}/-/` 的子路径
 * @param {{body?: unknown, retries?: number}} [opt]
 * @param {number} [attempt] 已重试次数（内部用）
 * @returns {Promise<{ok: true, status: number, json: any} | {ok: false, kind: string, status: number, detail: string}>}
 */
export async function cnbCall(ctx, method, subPath, opt = {}, attempt = 0) {
  const url = `${ctx.base.replace(/\/+$/, "")}/${ctx.slug}/-/${subPath}`;
  try {
    const res = await ctx.fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        Accept: "application/json",
        ...(opt.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: opt.body === undefined ? undefined : JSON.stringify(opt.body),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (res.ok) {
      let json = null;
      try {
        json = text === "" ? null : JSON.parse(text);
      } catch {
        /* 平台回 2xx 但正文不是 JSON：读的部分仍然算「够得着」，但调用方拿不到字段。 */
      }
      return { ok: true, status: res.status, json };
    }
    const failure = classifyCnbFailure(res.status, text);
    const allowed = opt.retries ?? 0;
    if (failure.kind === "server" && attempt < allowed) {
      return cnbCall(ctx, method, subPath, opt, attempt + 1);
    }
    return { ok: false, kind: failure.kind, status: res.status, detail: failure.detail };
  } catch (error) {
    const allowed = opt.retries ?? 0;
    if (attempt < allowed) {
      return cnbCall(ctx, method, subPath, opt, attempt + 1);
    }
    return {
      ok: false,
      kind: "network",
      status: -1,
      detail: `起不来（${errorName(error)}）`,
    };
  }
}

/**
 * 告警全量（open）。**只拿到部分页就是失败**：那会让「某规则没有告警」这句话变成假读数。
 * @param {{fetchImpl: FetchLike, token: string, repo: string, apiBase: string}} ctx
 * @returns {Promise<{ok: true, alerts: Alert[], pages: number} | {ok: false, kind: string, status: number, detail: string, partial: number}>}
 */
export async function fetchAlerts(ctx) {
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
    `/repos/${ctx.repo}/code-scanning/alerts?state=open&per_page=${PER_PAGE}&page=${page}`,
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
  const alerts = seen.concat(got.json.map(normalizeAlert));
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

/**
 * 最近一次**成功**的 CodeQL 分析（有 `error` 的那几条跳过）。
 * @param {{fetchImpl: FetchLike, token: string, repo: string, apiBase: string}} ctx
 * @returns {Promise<{ok: true, analysis: Analysis} | {ok: false, kind: string, status: number, detail: string}>}
 */
export async function fetchLatestAnalysis(ctx) {
  const got = await ghGet(
    ctx,
    `/repos/${ctx.repo}/code-scanning/analyses?per_page=20&direction=desc&sort=created_at`,
  );
  if (!got.ok) {
    return { ok: false, kind: got.kind, status: got.status, detail: got.detail };
  }
  if (!Array.isArray(got.json)) {
    return { ok: false, kind: "shape", status: 200, detail: "analyses 不是数组" };
  }
  const good = got.json
    .filter((row) => !row?.error && String(row?.tool?.name ?? "").includes("CodeQL"))
    .sort((a, b) => String(b?.created_at ?? "").localeCompare(String(a?.created_at ?? "")));
  const latest = good[0];
  if (!latest) {
    return {
      ok: false,
      kind: "no-analysis",
      status: 200,
      detail: "本页没有一条无 error 的 CodeQL 分析",
    };
  }
  return {
    ok: true,
    analysis: {
      id: Number(latest.id ?? 0),
      ref: String(latest.ref ?? "(无 ref)"),
      commitSha: String(latest.commit_sha ?? ""),
      createdAt: String(latest.created_at ?? ""),
    },
  };
}

/**
 * 某仓库开着的所有单（分页取全）。**取不全 ⇒ 失败对象**：查不到已有单不等于没有已有单。
 * @param {{fetchImpl: FetchLike, token: string, base: string, slug: string}} ctx
 * @returns {Promise<{ok: true, issues: IssueRow[]} | {ok: false, kind: string, status: number, detail: string}>}
 */
export async function listOpenIssues(ctx) {
  return listOpenIssuesPage(ctx, 1, []);
}

/**
 * 逐页取 open 单（递归：`await` 不进循环体）。
 * @param {{fetchImpl: FetchLike, token: string, base: string, slug: string}} ctx
 * @param {number} page 页码（从 1 起）
 * @param {IssueRow[]} seen 已取到的单
 * @returns {Promise<{ok: true, issues: IssueRow[]} | {ok: false, kind: string, status: number, detail: string}>}
 */
async function listOpenIssuesPage(ctx, page, seen) {
  const got = await cnbCall(ctx, "GET", `issues?state=open&page=${page}&page_size=${PER_PAGE}`, {
    retries: RETRIES,
  });
  if (!got.ok) {
    return { ok: false, kind: got.kind, status: got.status, detail: got.detail };
  }
  if (!Array.isArray(got.json)) {
    return { ok: false, kind: "shape", status: got.status, detail: "issues 不是数组" };
  }
  const issues = seen.concat(
    got.json.map((/** @type {any} */ row) => ({
      number: Number(row?.number ?? 0),
      title: String(row?.title ?? ""),
      labels: (Array.isArray(row?.labels) ? row.labels : [])
        .map((/** @type {any} */ l) => (typeof l === "string" ? l : String(l?.name ?? "")))
        .filter(Boolean),
    })),
  );
  if (got.json.length < PER_PAGE) {
    return { ok: true, issues };
  }
  if (page >= MAX_PAGES) {
    return {
      ok: false,
      kind: "too-many-pages",
      status: -1,
      detail: `open 单超过 ${MAX_PAGES * PER_PAGE} 张 ⇒ 分页没取完`,
    };
  }
  return listOpenIssuesPage(ctx, page + 1, issues);
}

/**
 * 仓库标签是否存在；不存在就建。**建标签是写**，所以一旦失败就不再往下建单
 * （单子建出来却没有可筛的标签，等于把「写了没有读者」再落一遍）。
 * @param {{fetchImpl: FetchLike, token: string, base: string, slug: string}} ctx
 * @param {string} name 标签名
 * @returns {Promise<{ok: true} | {ok: false, kind: string, status: number, detail: string}>}
 */
export async function ensureLabel(ctx, name) {
  const got = await cnbCall(ctx, "GET", `labels?page=1&page_size=${PER_PAGE}`, {
    retries: RETRIES,
  });
  if (!got.ok) {
    return { ok: false, kind: got.kind, status: got.status, detail: `读标签列表：${got.detail}` };
  }
  if (!Array.isArray(got.json)) {
    return { ok: false, kind: "shape", status: got.status, detail: "labels 不是数组" };
  }
  if (got.json.some((l) => String(l?.name ?? "") === name)) {
    return { ok: true };
  }
  const created = await cnbCall(ctx, "POST", "labels", {
    body: {
      name,
      color: LABEL_COLORS[name] ?? "8A2BE2",
      description:
        name === CLEARED_LABEL
          ? "code scanning 规则已无命中（留给人确认后关单）"
          : "GitHub code scanning 告警",
    },
  });
  if (!created.ok) {
    return {
      ok: false,
      kind: created.kind,
      status: created.status,
      detail: `建标签 ${name}：${created.detail}`,
    };
  }
  return { ok: true };
}

/**
 * 建单 → 补标签 → **独立回读**（标题 + 标签）。
 *
 * 为什么必须回读：`create-issue --labels` 实测不落地，而建单接口的回执里也可能没有标签
 * 这一栏。回读是唯一能回答「这张单现在长什么样」的那一问。
 *
 * @param {{fetchImpl: FetchLike, token: string, base: string, slug: string}} ctx
 * @param {Action} action
 * @param {(line: string) => void} log
 * @returns {Promise<{ok: true, number: number} | {ok: false, detail: string}>}
 */
export async function createIssue(ctx, action, log) {
  const created = await cnbCall(ctx, "POST", "issues", {
    body: { title: action.title, body: action.body ?? "", priority: action.priority ?? "P2" },
  });
  if (!created.ok) {
    return { ok: false, detail: `建单：${created.detail}` };
  }
  const raw = created.json;
  const number = Number(raw?.number ?? raw?.data?.number ?? raw?.issue?.number ?? 0);
  if (!Number.isInteger(number) || number <= 0) {
    return { ok: false, detail: "建单回执里没有可用的单号（回执本身不是结论）" };
  }
  const labels = [`提单人:${AUTHOR_HANDLE}`, FAMILY_LABEL];
  const tagged = await cnbCall(ctx, "POST", `issues/${number}/labels`, { body: { labels } });
  if (!tagged.ok) {
    /* 单已经建出来了：这时说「零写入」是不诚实的。如实报「单在、标签没落上」，退 1。 */
    return { ok: false, detail: `#${number} 已建成，但补标签失败：${tagged.detail}` };
  }
  const back = await cnbCall(ctx, "GET", `issues/${number}`, { retries: RETRIES });
  if (!back.ok) {
    return { ok: false, detail: `#${number} 建后回读失败：${back.detail}` };
  }
  const title = String(back.json?.title ?? back.json?.data?.title ?? "");
  const names = (Array.isArray(back.json?.labels) ? back.json.labels : [])
    .map((/** @type {any} */ l) => (typeof l === "string" ? l : String(l?.name ?? "")))
    .filter(Boolean);
  const titleOk = normalizeTitle(title) === normalizeTitle(action.title);
  const labelsOk = labels.every((label) => names.includes(label));
  if (!titleOk || !labelsOk) {
    return {
      ok: false,
      detail: `#${number} 回读不一致：标题「${title}」· 标签 [${names.join(", ")}]`,
    };
  }
  log(`[code-scanning] ✓ #${number} 已回读：标题一致 · 标签 [${names.join(", ")}]`);
  return { ok: true, number };
}

/**
 * 追加一条评论并回读（不拿回执当结论）。
 * @param {{fetchImpl: FetchLike, token: string, base: string, slug: string}} ctx
 * @param {number} number 单号
 * @param {string} body 评论正文
 * @param {string} marker 「这一条写上了」的凭据
 * @returns {Promise<{ok: true} | {ok: false, detail: string}>}
 */
export async function appendComment(ctx, number, body, marker) {
  const posted = await cnbCall(ctx, "POST", `issues/${number}/comments`, { body: { body } });
  if (!posted.ok) {
    return { ok: false, detail: `写评论：${posted.detail}` };
  }
  const listed = await cnbCall(ctx, "GET", `issues/${number}/comments?page=1&page_size=20`, {
    retries: RETRIES,
  });
  if (!listed.ok || !Array.isArray(listed.json)) {
    return { ok: false, detail: "评论已发，但回读列表没跑起来（不拿回执当结论）" };
  }
  const bodies = listed.json.map((c) => String(c?.body ?? ""));
  return bodies.some((text) => text.includes(marker))
    ? { ok: true }
    : { ok: false, detail: "回读里没找到这一条评论的 marker" };
}

/**
 * 刷新已有单的正文（内容没变就一个字节都不写）。
 * @param {{fetchImpl: FetchLike, token: string, base: string, slug: string}} ctx
 * @param {number} number 单号
 * @param {string} body 新正文
 * @returns {Promise<{ok: true, changed: boolean, previous: string} | {ok: false, detail: string}>}
 */
export async function updateBody(ctx, number, body) {
  const detail = await cnbCall(ctx, "GET", `issues/${number}`, { retries: RETRIES });
  if (!detail.ok) {
    return { ok: false, detail: `读旧正文：${detail.detail}` };
  }
  const previous = String(detail.json?.body ?? detail.json?.data?.body ?? "");
  if (previous.replace(/\s+$/, "") === String(body ?? "").replace(/\s+$/, "")) {
    return { ok: true, changed: false, previous };
  }
  const patched = await cnbCall(ctx, "PATCH", `issues/${number}`, { body: { body } });
  if (!patched.ok) {
    return { ok: false, detail: `刷新正文：${patched.detail}` };
  }
  return { ok: true, changed: true, previous };
}
