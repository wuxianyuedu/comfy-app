#!/usr/bin/env node
/**
 * `ship-gh-prs.mjs` —— ship 侧读 **GitHub 仓库侧（镜像仓）PR 清单 / 单条详情** 的
 * 只读工具（ISSUE #3704）。
 *
 * ## 为什么要有这一格
 *
 * 本仓的主战场在 CNB（`cnb.cool/moon-read/comfy-app-t3`），但镜像仓
 * （`wuxianyuedu/comfy-app`，GA 在它上面跑）那一侧也有自己的 PR 流——最典型的就是
 * dependabot[bot] 的依赖升级 PR：它们**只存在于 GitHub 侧**，`cnb pulls` 看不见。
 * `--gh-logs` 已经打通了「读 GA 日志」这半边，这一格补上「读 PR 清单 / 单条详情」
 * 那半边：一句 `pnpm ship --gh-prs` 就能看见镜像仓上开着哪些 PR、谁提的、能不能合。
 *
 * ## 纪律（与 `--gh-logs` / `--diagnose` 同一条）
 *
 *   1. **只读**：一次网络都不写；不改任何三态判定，退码只有「用法错（2）」与「绿」。
 *   2. **没有令牌只念一行**（`GITHUB_MIRROR_TOKEN` / `GITHUB_TOKEN`），一次网络都不发。
 *   3. 取数失败（401/403/404/网络）只多一行缺因，不抛异常、不改退码。
 *   4. 输出里带每条 PR 的**网页 URL**，要看 diff / 评论点开就是。
 */
import { CODE } from "./ship-core.mjs";
import { requestJson } from "./ci-github-verdict-request.mjs";
import { resolveGhToken } from "./ship-gh-logs.mjs";

/** 清单一页拉多少条（镜像仓 PR 量级很小，一页足够；要更多再翻 `page`）。 */
export const GH_PRS_PER_PAGE = 50;

/**
 * 是不是可按键取值的对象（API 回话里的条目都是 `unknown`，先过这一跳）。
 *
 * @param {unknown} value 任意值
 * @returns {value is Record<string, unknown>} true ⇒ 对象
 */
function isRecord(value) {
  return typeof value === "object" && value !== null;
}

/**
 * 认 `--gh-prs` 的输入：空 = 开着的；`open` / `closed` / `all` = 按状态列清单；
 * 数字 = 单条 PR 详情。
 *
 * @param {string} raw 命令行上那一个 token（可空）
 * @returns {{kind: "state", state: "open" | "closed" | "all"} | {kind: "pr", number: number} | {kind: null, bad: string}} 过滤器
 */
export function parseGhPrsFilter(raw) {
  const text = String(raw ?? "").trim();
  if (text === "") {
    return { kind: "state", state: "open" };
  }
  if (text === "open" || text === "closed" || text === "all") {
    return { kind: "state", state: text };
  }
  if (/^#\d+$/u.test(text) || /^\d+$/u.test(text)) {
    const number = Number(text.replaceAll("#", ""));
    if (number >= 1) {
      return { kind: "pr", number };
    }
  }
  return { kind: null, bad: text };
}

/**
 * PR 清单的 API URL。
 *
 * @param {string} repo `owner/repo`
 * @param {"open" | "closed" | "all"} state 状态过滤
 * @returns {string} URL
 */
export function ghPullsApiUrl(repo, state) {
  return `https://api.github.com/repos/${repo}/pulls?state=${state}&per_page=${String(GH_PRS_PER_PAGE)}&sort=updated&direction=desc`;
}

/**
 * 单条 PR 的 API URL。
 *
 * @param {string} repo `owner/repo`
 * @param {number} number PR 号
 * @returns {string} URL
 */
export function ghPullApiUrl(repo, number) {
  return `https://api.github.com/repos/${repo}/pulls/${String(number)}`;
}

/**
 * 单条 PR 的网页 URL。
 *
 * @param {string} repo `owner/repo`
 * @param {number} number PR 号
 * @returns {string} URL
 */
export function ghPullHtmlUrl(repo, number) {
  return `https://github.com/${repo}/pull/${String(number)}`;
}

/**
 * 把一条 PR 回话压成台面上的一行（人扫一眼就知道要不要点开）。
 *
 * @param {Record<string, unknown>} pull pulls / 单条回话
 * @returns {string} 一行读数
 */
export function renderPullLine(pull) {
  const number = String(pull.number ?? "?");
  const state = String(pull.state ?? "?");
  const draft = pull.draft === true ? " · draft" : "";
  const title = String(pull.title ?? "(无标题)");
  const author = isRecord(pull.user) ? String(pull.user.login ?? "?") : "?";
  const head = isRecord(pull.head) ? String(pull.head.ref ?? "?") : "?";
  const base = isRecord(pull.base) ? String(pull.base.ref ?? "?") : "?";
  const updated = String(pull.updated_at ?? "").slice(0, 10);
  const mergeable = String(pull.mergeable_state ?? "?");
  return `#${number} [${state}${draft}] ${title} · ${author} · ${head}→${base} · 更新 ${updated} · mergeable=${mergeable}`;
}

/**
 * 单条 PR 的详情读数（多几行：正文摘要 + 标签 + 网页 URL）。
 *
 * @param {Record<string, unknown>} pull 单条回话
 * @param {string} repo `owner/repo`
 * @returns {string[]} 行
 */
export function renderPullDetail(pull, repo) {
  const number = Number(pull.number ?? 0);
  const url = String(pull.html_url ?? ghPullHtmlUrl(repo, number));
  const out = [renderPullLine(pull), `[ship]   URL：${url}`];
  const labels = Array.isArray(pull.labels)
    ? pull.labels
        .map((label) => (isRecord(label) ? String(label.name ?? "") : ""))
        .filter((name) => name !== "")
    : [];
  if (labels.length > 0) {
    out.push(`[ship]   标签：${labels.join(" / ")}`);
  }
  const body = String(pull.body ?? "").trim();
  if (body !== "") {
    const excerpt =
      body.length > 400 ? `${body.slice(0, 400)}…（正文共 ${String(body.length)} 字）` : body;
    out.push(`[ship]   正文：${excerpt.replaceAll("\n", " ")}`);
  }
  return out;
}

/**
 * 真身回读：**只读、永不抛异常、不改三态**（输入认不出时退 2，那是用法错误）。
 *
 * @param {{
 *   filterRaw: string,
 *   repo: string | null,
 *   env?: Record<string, string | undefined>,
 *   log: (line: string) => void,
 *   fetchImpl?: typeof fetch,
 *   sleep?: (ms: number) => void | Promise<void>,
 *   dryRun?: boolean,
 * }} io 注入面
 * @returns {Promise<number>} 退码（只在「输入认不出」时是 2）
 */
export async function runGhPrs(io) {
  const env = io.env ?? {};
  const log = io.log;
  const filter = parseGhPrsFilter(io.filterRaw);
  if (filter.kind === null) {
    log(
      `[ship] [ERROR] --gh-prs 收的是状态（open / closed / all，缺省 open）或 PR 号，这里认不出：「${String(filter.bad)}」`,
    );
    return CODE.NOT_RUN;
  }
  const token = resolveGhToken(env);
  if (token === "") {
    log("[ship] 未设置令牌 ⇒ 跳过 GH PR 读取（GITHUB_MIRROR_TOKEN / GITHUB_TOKEN）");
    return CODE.GREEN;
  }
  if (!io.repo) {
    log("[ship] GH PR 读取：取不到仓库 slug ⇒ 跳过");
    return CODE.GREEN;
  }
  if (io.dryRun) {
    log("[ship] --dry-run：将读取 GitHub 侧 PR（一条网络都不发）。");
    return CODE.GREEN;
  }
  const fetchImpl = io.fetchImpl ?? globalThis.fetch;
  const sleep = io.sleep ?? (() => Promise.resolve());
  const reqSleep =
    /** @param {number} ms 毫秒 @returns {Promise<void>} 等到点 */
    async (ms) => {
      await sleep(ms);
    };
  const reqIo = { fetchImpl, log, sleep: reqSleep, token };
  try {
    if (filter.kind === "pr") {
      const res = await requestJson(
        reqIo,
        ghPullApiUrl(io.repo, filter.number),
        `PR #${String(filter.number)}`,
      );
      if (!res.ok) {
        noteReadFailure(log, `PR #${String(filter.number)}`, res);
        return CODE.GREEN;
      }
      if (!isRecord(res.body)) {
        log("[ship] PR 回话不是对象 ⇒ 跳过");
        return CODE.GREEN;
      }
      for (const line of renderPullDetail(res.body, io.repo)) {
        log(line);
      }
      return CODE.GREEN;
    }
    const res = await requestJson(reqIo, ghPullsApiUrl(io.repo, filter.state), "PR 清单");
    if (!res.ok) {
      noteReadFailure(log, "PR 清单", res);
      return CODE.GREEN;
    }
    const pulls = Array.isArray(res.body) ? res.body : [];
    if (pulls.length === 0) {
      log(`[ship] GitHub 侧（${io.repo}）没有 ${filter.state} 状态的 PR。`);
      return CODE.GREEN;
    }
    log(`[ship] GitHub 侧（${io.repo}）${filter.state} PR 共 ${String(pulls.length)} 条：`);
    for (const pull of pulls) {
      if (isRecord(pull)) {
        log(`[ship]   ${renderPullLine(pull)}`);
      }
    }
    return CODE.GREEN;
  } catch (error) {
    /* 这一格只加读数：任何意外都折成一行读数，绝不改变调用方的退码。 */
    log(`[ship] GH PR 读取出现异常（不改三态）：${String(error)}`);
    return CODE.GREEN;
  }
}

/**
 * 把一次取数失败翻成**一行缺因**（带 HTTP / 网络原文），并明确「判决不受影响」。
 *
 * @param {(line: string) => void} log 日志出口
 * @param {string} what 缺的是什么
 * @param {{kind?: string, status?: number, error?: string}} res 失败读数
 * @returns {void}
 */
function noteReadFailure(log, what, res) {
  if (res.kind === "auth") {
    log(`[ship] GH PR 读取：${what}取不到（HTTP ${String(res.status)}，令牌权限不够）`);
    return;
  }
  if (res.kind === "http") {
    const hint = res.status === 404 ? "（PR / 仓库不在）" : "";
    log(`[ship] GH PR 读取：${what}取不到（HTTP ${String(res.status)}${hint}）`);
    return;
  }
  log(`[ship] GH PR 读取：${what}取不到（网络没通：${String(res.error ?? "未知")}）`);
}
