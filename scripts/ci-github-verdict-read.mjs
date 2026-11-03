#!/usr/bin/env node
/**
 * `ci-github-verdict-read.mjs` —— 双远端镜像的**判决回读**一格（ISSUE #3051 期望第 3 条的前置）。
 *
 * ## 它要回答的那一格
 *
 * 「GitHub 镜像同步」把本跑 HEAD 推到 `cnb-pr-<IID>` 并派发 `repository_dispatch`，
 * GitHub 侧 `pr-gate.yml` 按**同一笔 sha** 起跑 —— 但那条链路是单向的：GitHub 判出了
 * 什么，CNB 这边一个字都读不到。本格就是回程那一跳：轮询
 * `GET /repos/{owner}/{repo}/commits/{sha}/check-runs`，把同一笔 sha 上各 check 的结论
 * 汇总成三态退码。
 *
 * sha 的推导与镜像格**同源**：同一份 `resolveContext()`（`GITHUB_MIRROR_TOKEN` +
 * `CNB_PULL_REQUEST_IID` → 镜像 ref + `git rev-parse HEAD`），两边读的一定是同一笔树，
 * 不会出现「推的是 A、读的是 B」的对账错位。
 *
 * ## 边界
 *
 * 1. **fail-closed 的三态**：令牌 / 请求 ID / HEAD 取不到 ⇒ exit 2；请求 401/403 ⇒ exit 2
 *    （权限前提没落地，不是 GitHub 判出了红）；egress 重试耗尽 ⇒ exit 2；轮询预算耗尽 ⇒
 *    exit 2（「没跑完」不许被读成「判红」，也不许被读成「什么都没发生」）。只有拿到
 *    完整结论才出 0 / 1。
 * 2. **主列读数档**（与镜像格同一族）：`.cnb.yml` 给它 `--readout`，三态照旧打点、对外
 *    恒退 0。翻承重的条件：本格读数稳定后单独一次决定，同时摘镜像格的 `--readout`
 *    （#3051 期望第 3 条）—— 不在本批。
 * 3. **egress 韧性对齐镜像格的推送改造**：单次请求上限 30s；**只有网络类失败**（TCP /
 *    DNS / 代理层，与 `isEgressFailure` 同源判据 + Node fetch 的错误码）才消耗重试
 *    （至多 3 次，退避 5s / 10s）；401/403 与其余 HTTP 错误**一律不重试** —— 重试权限
 *    问题只是把真问题拖慢，还把「令牌缺 `checks: read`」读成「网络不好」。
 * 4. **不打令牌值**（硬规则 17）：一切回显先过 `sanitize`。
 * 5. **check-run 挂在哪笔 sha 上是待线上证实的点**：`repository_dispatch` 触发的 run，
 *    其 check-run 按 GitHub 文档语义挂在 run 的 head_sha 上；本格按派发时同一笔
 *    head_sha 读 `commits/{sha}/check-runs` —— 若线上读数恒为零条（轮询日志会一直念
 *    「还没有任何 check-run」直到预算耗尽 exit 2），那就是 GitHub 把 check-run 挂去了
 *    默认分支 HEAD，届时改走 Actions runs API 按 event/branch 过滤，属于另一批。
 *
 * ## 用法
 *
 * ```text
 * node scripts/ci-github-verdict-read.mjs               # 三态退码（本地自查 / 将来承重那一档）
 * node scripts/ci-github-verdict-read.mjs --readout     # 读数档：三态照打点，退码恒 0（CI 主列那一格）
 * node scripts/ci-github-verdict-read.mjs --dry-run     # 只打印计划，不发任何请求
 * ```
 *
 * 环境变量：`GITHUB_MIRROR_TOKEN`（必填，需 `checks: read`）、`GITHUB_MIRROR_REPO`
 * （缺省 `wuxianyuedu/comfy-app`）、`CNB_PULL_REQUEST_IID`（PR 流水线注入）。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import {
  CODE,
  RETRY_BACKOFF_MS,
  exitCodeFor,
  isEgressFailure,
  resolveContext,
  sanitize,
} from "./ci-github-mirror-push.mjs";

/**
 * 单次 check-runs 请求的墙钟上限：与镜像格探活同一量级（`REMOTE_PROBE_TIMEOUT_MS`）。
 * 通的时候 api.github.com 这一读是亚秒级；30s 把「慢但活着」的抖动与「没通」分开。
 */
export const CHECK_RUNS_TIMEOUT_MS = 30_000;

/**
 * 单次读数的尝试上限：首跳 + 2 次重试（文件头第 3 条）。
 * 只有网络类失败才消耗重试；401/403 这类「再试一百次也一样」的回话一次就交账。
 */
export const REQUEST_MAX_ATTEMPTS = 3;

/** 两轮轮询之间的间隔：30s —— GitHub 侧那一跑以十分钟计，读数不需要更密的采样。 */
export const POLL_INTERVAL_MS = 30_000;

/**
 * 轮询总预算：45 分钟。
 *
 * 取法：GitHub 侧最重的一格外框是 60m（heavy-gates），而本格排在 `.cnb.yml` 主列
 * **末尾** —— 镜像格在主列开头就派发，等轮到本格起跑时 GitHub 已经跑了 CNB 主列
 * 全程（实测整跑约 42 分钟），正常情形下本格第一读就该拿到完整或接近完整的结论；
 * 45m 是给「GitHub 侧排队 / 重跑」留的余量，同时留在 `.cnb.yml` 那一格 60m 外框之内。
 * 耗尽按 exit 2 交账（文件头第 1 条）。
 */
export const POLL_BUDGET_MS = 45 * 60_000;

/** 结论里算「红」的那一档（GitHub check-run conclusion 词表内）。 */
const RED_CONCLUSIONS = new Set(["action_required", "cancelled", "failure", "timed_out"]);

/** 本仓检出根（`scripts/` 的上一层）—— git 子进程在这里跑，不靠继承的工作目录。 */
const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * git 子进程的环境：清掉 `GIT_DIR` / `GIT_WORK_TREE`（与镜像格文件头第 7 条同因）。
 *
 * @returns {NodeJS.ProcessEnv} 交给 `spawnSync` 的环境
 */
function gitEnv() {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return env;
}

/**
 * 真身：git 子进程执行器。本格只调 `rev-parse`（本地跳，不限时）。
 * 镜像格的 `realRunGit` 未导出，这里写本格的最小版 —— 不共享那份是因为它带
 * push/ls-remote 的超时判读，本格一跳都用不上。
 *
 * @param {string[]} args git 参数表
 * @returns {{code: number, stderr: string, stdout: string}}
 */
function realRunGit(args) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", env: gitEnv() });
  return {
    code: r.status ?? -1,
    stderr: String(r.stderr ?? ""),
    stdout: String(r.stdout ?? ""),
  };
}

/**
 * 真身的等待（测试注入 `io.sleep` 的假件，用例一次真墙钟都不付）。
 *
 * @param {number} ms 等待毫秒数
 * @returns {Promise<void>} 到点兑现
 */
const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * check-runs 读数的 URL（`per_page=100`：pr-gate 一格 5 个 job，单页远远够）。
 *
 * @param {string} repo `owner/repo`
 * @param {string} sha 要读的那一笔
 * @returns {string} API URL
 */
export function checkRunsUrl(repo, sha) {
  return `https://api.github.com/repos/${repo}/commits/${sha}/check-runs?per_page=100`;
}

/**
 * 这一次失败值不值得再试：egress 正则（与镜像格同源）之外，补 Node `fetch`
 * 在网络层抛出的那一族（`fetch failed` 与 `cause.code` 上的 `E*` 错误码）。
 *
 * @param {unknown} error `fetch` 抛出的异常
 * @returns {boolean} true ⇒ 网络根本没到 GitHub，重试有意义
 */
export function isRetryableRequestFailure(error) {
  const e = /** @type {{message?: unknown, cause?: {code?: unknown}} | null} */ (error);
  const text = String(e?.message ?? error);
  const code = String(e?.cause?.code ?? "");
  return (
    isEgressFailure(text) ||
    /fetch failed|network|socket|econnreset|econnrefused|enotfound|etimedout|eai_again/i.test(text) ||
    /^(ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN)$/i.test(code)
  );
}

/**
 * 带单次上限的一次请求：到点 abort 并把异常翻成含「超时」字样的 Error ——
 * 那一形正好落进 `isEgressFailure` / `isRetryableRequestFailure` 的判据，
 * 与镜像格「本仓自己给的超时那一句」同一处理口径。
 *
 * @param {typeof fetch} fetchImpl fetch 实现（测试注入假件）
 * @param {string} url 请求目标
 * @param {string} token 令牌（只进请求头，不回显）
 * @returns {Promise<Response>} 响应
 */
async function fetchWithTimeout(fetchImpl, url, token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_RUNS_TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "comfy-app-cnb-verdict",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`check-runs 读数超时（>${String(CHECK_RUNS_TIMEOUT_MS)} ms）：这一跳没拿到任何回话`, {
        cause: error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 带有限重试的一次读数（文件头第 3 条）。
 *
 * @param {{fetchImpl: typeof fetch, log: (line: string) => void, sleep: (ms: number) => Promise<void>}} io
 * @param {{repo: string, headSha: string, token: string}} ctx
 * @returns {Promise<{ok: true, runs: Array<unknown>} | {ok: false, kind: "auth", status: number, body: string} | {ok: false, kind: "http", status: number, body: string} | {ok: false, kind: "egress", error: string}>}
 */
async function requestCheckRuns(io, ctx) {
  const { fetchImpl, log, sleep } = io;
  const url = checkRunsUrl(ctx.repo, ctx.headSha);
  let lastError = "";
  for (let attempt = 1; attempt <= REQUEST_MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetchWithTimeout(fetchImpl, url, ctx.token);
      if (res.status === 200) {
        const body = /** @type {{check_runs?: unknown}} */ (await res.json());
        return { ok: true, runs: Array.isArray(body?.check_runs) ? body.check_runs : [] };
      }
      const text = await res.text().catch(() => "");
      const kind = res.status === 401 || res.status === 403 ? "auth" : "http";
      return { body: sanitize(text, ctx.token), kind, ok: false, status: res.status };
    } catch (error) {
      lastError = String(error);
      if (!isRetryableRequestFailure(error) || attempt === REQUEST_MAX_ATTEMPTS) {
        break;
      }
      const wait = RETRY_BACKOFF_MS[attempt - 1] ?? RETRY_BACKOFF_MS.at(-1) ?? 5000;
      log(
        `[verdict] 读数第 ${String(attempt)}/${String(REQUEST_MAX_ATTEMPTS)} 次没通（egress 类）⇒ ${String(wait / 1000)}s 后试第 ${String(attempt + 1)} 次（网络抖动重试；认证 / 权限类不重试）`,
      );
      await sleep(wait);
    }
  }
  return { error: lastError, kind: "egress", ok: false };
}

/**
 * 汇总一轮 check-runs：是不是都跑完了、哪些红、哪些还在跑。
 *
 * 判红的词表（`RED_CONCLUSIONS`）：failure / timed_out / cancelled / action_required。
 * 其余 completed 结论（success / neutral / skipped / stale）都不算红 —— skipped 与
 * neutral 是 GitHub 自己的「不用跑」，stale 是平台侧的清理动作，都与代码对错无关。
 *
 * @param {Array<unknown>} runs check-runs API 回话里的 `check_runs`
 * @returns {{completed: boolean, failing: string[], ok: string[], pending: string[], total: number}}
 */
export function summarizeCheckRuns(runs) {
  /** @type {string[]} */
  const failing = [];
  /** @type {string[]} */
  const ok = [];
  /** @type {string[]} */
  const pending = [];
  for (const item of runs) {
    const run = /** @type {{conclusion?: unknown, name?: unknown, status?: unknown}} */ (item);
    const name = String(run?.name ?? "(无名 check)");
    if (run?.status !== "completed") {
      pending.push(`${name}（${String(run?.status ?? "?")}）`);
      continue;
    }
    const conclusion = String(run?.conclusion ?? "?");
    if (RED_CONCLUSIONS.has(conclusion)) {
      failing.push(`${name}（${conclusion}）`);
    } else {
      ok.push(`${name}（${conclusion}）`);
    }
  }
  return { completed: runs.length > 0 && pending.length === 0, failing, ok, pending, total: runs.length };
}

/**
 * 执行回读：上下文收口 → 轮询 check-runs 直到全部 completed / 预算耗尽。
 *
 * @param {{env: Record<string, string | undefined>, fetchImpl?: typeof fetch, runGit?: typeof realRunGit, sleep?: (ms: number) => Promise<void>, now?: () => number, dryRun?: boolean, log?: (line: string) => void}} io
 * @returns {Promise<number>} 仓内三态退码
 */
export async function runVerdict(io) {
  const { dryRun = false, env } = io;
  const log = io.log ?? ((line) => console.log(line));
  const fetchImpl = io.fetchImpl ?? fetch;
  const runGit = io.runGit ?? realRunGit;
  const sleep = io.sleep ?? realSleep;
  const now = io.now ?? (() => Date.now());
  const ctx = resolveContext({ env, runGit });
  if (!ctx.ok) {
    for (const reason of ctx.reasons) {
      log(`[verdict] 没跑起来的原因：${reason}`);
    }
    log("[verdict] 结论：exit 2 —— 有一步没跑起来（不等于通过，也不等于「GitHub 侧是绿的」）");
    return CODE.NO_FACT;
  }
  log(
    `[verdict] 计划：轮询 ${ctx.repo} @ ${ctx.headSha.slice(0, 8)}（镜像 ref ${ctx.ref}）的 check-runs · 间隔 ${String(POLL_INTERVAL_MS / 1000)}s · 预算 ${String(POLL_BUDGET_MS / 60_000)}m`,
  );
  if (dryRun) {
    log("[verdict] DRY-RUN：没发任何请求，计划如上");
    return CODE.OK;
  }
  const deadline = now() + POLL_BUDGET_MS;
  for (;;) {
    const res = await requestCheckRuns({ fetchImpl, log, sleep }, ctx);
    if (!res.ok) {
      if (res.kind === "auth") {
        log(`[verdict] 权限不够：HTTP ${String(res.status)} —— 这枚令牌读不了 check-runs。`);
        log(
          "[verdict]   下一动作：给这枚 fine-grained PAT 追加 `checks: read`（只读）权限，" +
            "并把新值同步进密钥仓库 moon-read/GITHUB_MIRROR_TOKEN（PR / push 两条流水线都从那里 imports）。",
        );
        log("[verdict] 结论：exit 2 —— 前提没落地（权限），不是 GitHub 侧判出了红");
        return CODE.NO_FACT;
      }
      if (res.kind === "http") {
        log(`[verdict] 读数被拒：HTTP ${String(res.status)}（不是网络层没通，重试无意义）`);
        if (res.body.trim()) {
          log(`[verdict]   ${res.body.trim()}`);
        }
        log("[verdict] 结论：exit 2 —— 有一步没跑起来（请求本身被拒，看上面那句）");
        return CODE.NO_FACT;
      }
      log(`[verdict] 读数没跑起来（egress 类，${String(REQUEST_MAX_ATTEMPTS)} 次都没通）：${res.error}`);
      log("[verdict] 结论：exit 2 —— 节点到 api.github.com 这一跳没通（出网问题在节点侧），与判据无关");
      return CODE.NO_FACT;
    }
    const summary = summarizeCheckRuns(res.runs);
    if (summary.total === 0) {
      log("[verdict] 这一笔 sha 上还没有任何 check-run（GitHub 侧可能还没起跑）—— 继续等");
    } else if (summary.completed) {
      for (const line of summary.ok) {
        log(`[verdict]   ✓ ${line}`);
      }
      for (const line of summary.failing) {
        log(`[verdict]   ✗ ${line}`);
      }
      if (summary.failing.length > 0) {
        log(
          `[verdict] 结论：exit 1 —— GitHub 对同一笔 sha 的判决是红的（${String(summary.failing.length)}/${String(summary.total)} 个 check 没过）`,
        );
        return CODE.FAIL;
      }
      log(
        `[verdict] ✓ 结论：exit 0 —— GitHub 对同一笔 sha 的 ${String(summary.total)} 个 check 全部完成且没有红`,
      );
      return CODE.OK;
    } else {
      log(
        `[verdict] ${String(summary.total)} 个 check：${String(summary.pending.length)} 个还在跑（${summary.pending.join("、")}）—— 继续等`,
      );
    }
    if (now() >= deadline) {
      log(
        `[verdict] 结论：exit 2 —— ${String(POLL_BUDGET_MS / 60_000)}m 轮询预算耗尽还没拿到完整判决（没跑完 ≠ 判红；去查 GitHub 侧那一跑是不是卡住了）`,
      );
      return CODE.NO_FACT;
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const dryRun = process.argv.includes("--dry-run");
  const readout = process.argv.includes("--readout");
  const code = await runVerdict({ dryRun, env: process.env });
  if (readout && code !== CODE.OK) {
    console.log("[verdict] 读数档：上面那一行是三态原值；这一格不折进流水线判决（--readout）");
  }
  process.exit(exitCodeFor(code, readout));
}
