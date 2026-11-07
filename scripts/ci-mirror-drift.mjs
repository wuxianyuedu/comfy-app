/**
 * 每日档的镜像漂移判据：CNB `master` HEAD 与 GitHub `refs/heads/master` 不一致即立案。
 *
 * 为什么需要这一条（ISSUE #3252）：push 档镜像格是**读数档**（`--readout`），出网失败时
 * 平台那格仍绿、`push 失败立案` 又只数红格 ⇒ 镜像可以悄悄停在旧树，而每日档照样在旧树上
 * 跑（2026-11-07 实测：CNB `ae77db8a5` 已合并，GitHub `master` 停在它的父提交
 * `b85e6483e`）。当次靠 push 档的自证与立案兜住；「之后没人再推」的那一形只能靠每日一次的
 * 跨仓库核对。
 *
 * 两边都用**匿名** `git ls-remote`：
 * · CNB 仓库公开可读（实测 3.5s 回 `ae77db8a5`）；
 * · GitHub 镜像仓公开可读（实测 16.2s 回 `b85e6483e`）。
 *
 * 两种失败分开：**确认不等**才是事实（退 1，并尝试建单）；**读不到**只是没结论（退 2，
 * 带 `--allow-no-fact` 时退 0 并打一行警告 —— 不把「这条链今天没连上」判成漂移）。
 *
 * @module scripts/ci-mirror-drift — 每日镜像漂移核对
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

import { parseRemoteRefSha } from "./ci-mirror-push-verify.mjs";

/** CNB 主仓（公开读）。 */
export const CNB_REPO_URL = "https://cnb.cool/moon-read/comfy-app-t3.git";
/** GitHub 镜像仓（公开读）。 */
export const GITHUB_REPO_URL = "https://github.com/wuxianyuedu/comfy-app.git";
/** 两边都核对的 ref（这一条漂移会让 GitHub 侧 schedule 跑旧树）。 */
export const DRIFT_REF = "refs/heads/master";
/** 建单标题键：按它去重，也按它搜已开的单。 */
export const DRIFT_ISSUE_TITLE = "[镜像漂移] GitHub master 落后于 CNB master";

/**
 * 判决（纯函数，用例直接钉它）。
 *
 * @param {{cnbSha: string | null, githubSha: string | null}} reads 两边的读数
 * @returns {{code: number, note: string}} `0` 一致；`1` 确认不等；`2` 读数不全（没结论）
 */
export function judgeMirrorDrift({ cnbSha, githubSha }) {
  if (
    typeof cnbSha !== "string" ||
    typeof githubSha !== "string" ||
    cnbSha === "" ||
    githubSha === ""
  ) {
    return { code: 2, note: "有一边读不到 refs/heads/master ⇒ 没结论（不等于漂移）" };
  }
  if (cnbSha.toLowerCase() !== githubSha.toLowerCase()) {
    return {
      code: 1,
      note: `漂移：CNB master=${cnbSha} · GitHub master=${githubSha}`,
    };
  }
  return { code: 0, note: `一致：master=${cnbSha}` };
}

/**
 * 出口（用例可注入）。
 *
 * @param {object} io
 * @param {string[]} [io.argv]
 * @param {Record<string, string | undefined>} [io.env]
 * @param {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} [io.fetchImpl]
 * @param {(s: string) => void} [io.log]
 * @param {(args: string[]) => {code: number, stderr: string, stdout: string}} [io.runGit]
 * @returns {Promise<number>} 退码
 */
export async function main(io = {}) {
  const argv = io.argv ?? process.argv.slice(2);
  const env = io.env ?? process.env;
  const log = io.log ?? ((line) => console.log(line));
  const fetchImpl = io.fetchImpl ?? fetch;
  const runGit =
    io.runGit ??
    ((args) => {
      const res = spawnSync("git", args, { encoding: "utf8", timeout: 60_000 });
      return {
        code: typeof res.status === "number" ? res.status : 1,
        stderr: res.stderr ?? "",
        stdout: res.stdout ?? "",
      };
    });
  const fileIssue = argv.includes("--file-issue");
  const allowNoFact = argv.includes("--allow-no-fact");

  const cnbRead = runGit(["ls-remote", CNB_REPO_URL, DRIFT_REF]);
  const cnbSha = cnbRead.code === 0 ? parseRemoteRefSha(cnbRead.stdout, DRIFT_REF) : null;
  const githubRead = runGit(["ls-remote", GITHUB_REPO_URL, DRIFT_REF]);
  const githubSha = githubRead.code === 0 ? parseRemoteRefSha(githubRead.stdout, DRIFT_REF) : null;

  const verdict = judgeMirrorDrift({ cnbSha, githubSha });
  log(`[mirror-drift] ${verdict.note}`);
  if (verdict.code === 2) {
    if (allowNoFact) {
      log("[mirror-drift] 没结论 ⇒ 这一格不判红（--allow-no-fact），但下一跑要重试");
      return 0;
    }
    return 2;
  }
  if (verdict.code === 0) {
    return 0;
  }
  /* `verdict.code === 1` 意味着判据里两边都非空；类型面看不出这层关系，这里显式收窄。 */
  if (typeof cnbSha !== "string" || typeof githubSha !== "string") {
    log("[mirror-drift] 判据说漂移、读数却有一边为空 ⇒ 不按漂移立案（退 2）");
    return 2;
  }

  if (!fileIssue) {
    log("[mirror-drift] 未带 --file-issue：只报读数，不建单");
    return 1;
  }
  const token = String(env.GITHUB_TOKEN ?? "").trim();
  const slug = String(env.GITHUB_REPOSITORY ?? "").trim();
  if (token === "" || slug === "") {
    log("[mirror-drift] GITHUB_TOKEN / GITHUB_REPOSITORY 不在场 ⇒ 立不了案（仍以退码 1 交账）");
    return 1;
  }
  const filed = await fileDriftIssue({ fetchImpl, githubSha, log, slug, token, cnbSha });
  if (!filed) {
    log("[mirror-drift] 建单没落地 ⇒ 以退码 1 交账（不静默）");
    return 1;
  }
  return 0;
}

/**
 * 在镜像仓建/追加一张漂移单（标题键去重）。
 *
 * @param {object} deps
 * @param {typeof fetch} deps.fetchImpl HTTP 执行面
 * @param {string} deps.cnbSha CNB master 的 sha
 * @param {string} deps.githubSha GitHub master 的 sha
 * @param {(s: string) => void} deps.log 输出
 * @param {string} deps.slug `owner/repo`
 * @param {string} deps.token GitHub 令牌
 * @returns {Promise<boolean>} 真写落了才 true
 */
async function fileDriftIssue(deps) {
  const { cnbSha, fetchImpl, githubSha, log, slug, token } = deps;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "comfy-app-cnb-mirror",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const body = [
    `CNB \`master\` = \`${cnbSha}\``,
    `GitHub \`master\` = \`${githubSha}\``,
    "",
    "镜像没跟上 CNB：GitHub 侧 schedule（daily）跑的是旧树。",
    "",
    `CNB 提交：https://cnb.cool/moon-read/comfy-app-t3/-/commit/${cnbSha}`,
    "",
    "处置：在 CNB 上重跑一次 master 的 push 档（`GitHub master 镜像` 格凡带 `--readout`，绿不代表推到了；",
    "以本单的 shas 为准）；若 egress 仍不通，见 `push 失败立案` 那张单。",
  ].join("\n");
  let existing;
  try {
    const q = encodeURIComponent(`repo:${slug} in:title ${DRIFT_ISSUE_TITLE} state:open`);
    const res = await fetchImpl(`https://api.github.com/search/issues?q=${q}`, { headers });
    if (res.status !== 200) {
      log(`[mirror-drift] 查重没通：HTTP ${String(res.status)}`);
      return false;
    }
    const json = await res.json();
    existing = Array.isArray(json?.items) ? json.items : [];
  } catch (error) {
    log(`[mirror-drift] 查重没跑起来：${String(error)}`);
    return false;
  }
  try {
    if (existing.length > 0) {
      const number = existing[0].number;
      const res = await fetchImpl(
        `https://api.github.com/repos/${slug}/issues/${String(number)}/comments`,
        {
          body: JSON.stringify({ body }),
          headers,
          method: "POST",
        },
      );
      if (res.status !== 201) {
        log(`[mirror-drift] 追加评论没通：HTTP ${String(res.status)}`);
        return false;
      }
      log(`[mirror-drift] 已追加到 #${String(number)}`);
      return true;
    }
    const res = await fetchImpl(`https://api.github.com/repos/${slug}/issues`, {
      body: JSON.stringify({ body, title: DRIFT_ISSUE_TITLE }),
      headers,
      method: "POST",
    });
    if (res.status !== 201) {
      log(`[mirror-drift] 建单没通：HTTP ${String(res.status)}`);
      return false;
    }
    const created = await res.json();
    log(`[mirror-drift] 已建单 #${String(created?.number ?? "?")}`);
    return true;
  } catch (error) {
    log(`[mirror-drift] 建单没跑起来：${String(error)}`);
    return false;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().then((code) => {
    process.exit(code);
  });
}
