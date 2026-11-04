#!/usr/bin/env node
/**
 * `ci-github-verdict-read.mjs` —— 双远端镜像的**判决回读**一格（ISSUE #3051 期望第 3 条的前置）。
 *
 * ## 它要回答的那一格
 *
 * 「GitHub 镜像同步」把本跑 HEAD 推到 `cnb-pr-<IID>` 并派发 `repository_dispatch`，
 * GitHub 侧 `pr-gate.yml` 按**同一笔 sha** 起跑 —— 但那条链路是单向的：GitHub 判出了
 * 什么，CNB 这边一个字都读不到。本格就是回程那一跳，读数有两条路径：
 *
 * - **主路径（runs API）**：轮询 `GET /repos/{owner}/{repo}/actions/runs?event=repository_dispatch`，
 *   再用 `display_title`（= pr-gate.yml 的 run-name，内含 payload 的 head_sha）认领本跑，
 *   用 workflow run 的 `conclusion` 判定 —— success / neutral / skipped 算绿；
 *   failure / timed_out / cancelled / action_required / startup_failure 判红；
 *   未 completed 继续等。需 `actions: read`。
 *   不用 `?head_sha=`：dispatch 触发的 run 其 head_sha 落默认分支 HEAD，payload 的
 *   sha 只在 client_payload，按它过滤恒得零条（PR #3080 线上实测）。
 * - **兜底路径（Checks API）**：主路径读不到本跑的 run —— Actions 权限缺（401/403）
 *   或 display_title 认不出 —— 时，同一轮回落
 *   `GET /repos/{owner}/{repo}/commits/{sha}/check-runs`（需 `checks: read`），
 *   判定词表与旧版一致（红：failure / timed_out / cancelled / action_required）。
 *   ⚠️ 这条路径**需 workflow 主动建 check-run 才有效**（当前 pr-gate.yml 未建，
 *   本批不实现主动建 check）—— 它只是「主路径不可用时的降级读数」占位，
 *   现实中大概率读到零条（按「还没跑完」继续等，不误判）。
 *   每一轮都先试主路径：Actions 权限中途补上，下一轮自动走回主路径。
 *
 * 日志会明确打出本轮走的是哪条路径、为什么回落，线上判读不用猜。
 *
 * sha 的推导与镜像格**同源**：同一份 `resolveContext()`（`GITHUB_MIRROR_TOKEN` +
 * `CNB_PULL_REQUEST_IID` → 镜像 ref + `git rev-parse HEAD`），两边读的一定是同一笔树，
 * 不会出现「推的是 A、读的是 B」的对账错位。
 *
 * ## 边界
 *
 * 1. **fail-closed 的三态**：令牌 / 请求 ID / HEAD 取不到 ⇒ exit 2；两条路径都 401/403
 *    ⇒ exit 2（**两条路径都被拒**才算权限前提没落地，不是 GitHub 判出了红）；
 *    egress 重试耗尽 ⇒ exit 2；轮询预算耗尽 ⇒ exit 2（「没跑完」不许被读成「判红」，
 *    也不许被读成「什么都没发生」）。只有拿到完整结论才出 0 / 1。
 *    **`empty` 不是权限问题**：主路径读到 0 条 = 令牌够、只是 GitHub 侧还没起跑（或
 *    display_title 还没认领本跑），这一形**继续按 30s 轮询到预算耗尽**，不因同一轮兜底
 *    403 提前交账 —— 那一形曾经被读成「两条路径的权限都没够上」（ISSUE #3136 的现场：
 *    3.8s 退掉，45m 预算一秒没用）。预算耗尽仍 0 条时原因写「读到 0 条（GitHub 侧没起跑）」，
 *    兜底的 403 只作降级事实记录（「兜底不可用（无 checks: read，仅降级）」），不催办。
 * 1b. **「认不上」提前夭折**（ISSUE #3148）：`empty` 有两种，此前被混成一种、一起吃满
 *    45m —— 一种是真的零条 run（GitHub 侧还没起跑，会随时起跑，就该等）；另一种是
 *    **触发表里有 run、但没有一条的 `display_title` 含目标 sha**（`run-name` 没渲染出
 *    payload 的 sha / 不是同一笔 sha，#3142 的现场）。后者再等也等不出新事实：`run-name`
 *    是 run **创建时**定死的，不是跑完才写。所以连续 {@link CLAIM_MISS_STREAK_TO_ABORT} 轮
 *    这一形 ⇒ 提前 exit 2，并把触发表的 `display_title` 样本念出来（{@link renderTitleSamples}），
 *    让「标题里没 sha」与「是别的 sha」当场可分。零条 run 那一形走 1c 的短窗口（#3153）。
 *    另一条同形的等待也归这里：上游镜像格失败 ⇒ 派发没发生 ⇒ 本跑永远不会有 run；
 *    那一形要缩的是 `.cnb.yml` 侧（把镜像格的失败读数交给本格判，属 #3148 期望第 1 条的另一半）。
 * 1c. **零条 run 的短窗口 + 结构正证据**（ISSUE #3153）：`empty` 里**零条 run** 那一形不再
 *    一律吃满 45m。第一次读到零条时先做一次结构判定（仓库身份可查 / `pr-gate.yml` 存在且
 *    workflow 为 active / 该 workflow 仍监听 `repository_dispatch` / 分支过滤现状），任一证据
 *    明确「结构上不会有 run」⇒ 当场 exit 2 并明念是哪一条。判不出（读不到 / 都在）⇒
 *    按 {@link NO_RUN_WINDOW_MS}（5 分钟）短窗口继续轮询；到点仍零条 ⇒ exit 2，读数写
 *    「没找到对应 run（不是 run 未到终态）」并附判定依据。45m 预算**只留给**「确实读到本跑
 *    （`data` 态）、但 `status` 还没 completed」那一形 —— 迟到 4 分钟的 run 仍在短窗口内被认领
 *    （用例钉着）。上游 `mirror-dispatch.json` 缺失是**独立一形**：单独读数、同样 5m 短界，
 *    不并入「零条 run」，也不冒充「没找到对应 run」（缺「派发已发生」这条正证据）。
 * 2. **主列读数档**（与镜像格同一族）：`.cnb.yml` 给它 `--readout`，三态照旧打点、对外
 *    恒退 0。翻承重的条件：本格读数稳定后单独一次决定，同时摘镜像格的 `--readout`
 *    （#3051 期望第 3 条）—— 不在本批。
 * 3. **egress 韧性对齐镜像格的推送改造**：单次请求上限 30s；**只有网络类失败**（TCP /
 *    DNS / 代理层，与 `isEgressFailure` 同源判据 + Node fetch 的错误码）才消耗重试
 *    （至多 3 次，退避 5s / 10s）；401/403 与其余 HTTP 错误**一律不重试** —— 重试权限
 *    问题只是把真问题拖慢，还把「令牌缺 `actions: read`」读成「网络不好」。
 * 4. **不打令牌值**（硬规则 17）：一切回显先过 `sanitize`。
 * 5. **「check-run 可能挂在分支 HEAD」这一坑已由主路径规避**：runs API 拉 dispatch
 *    触发表后按 display_title 里的 sha 认领本跑，读到的一定是本跑派发出去的那一跑，
 *    与 check-run 挂在哪笔 sha 上无关；兜底 checks 路径仍按同一笔 sha 读，是
 *    「主路径不可用时的降级读数」，不是主判定。
 *
 * ## 用法
 *
 * ```text
 * node scripts/ci-github-verdict-read.mjs               # 三态退码（本地自查 / 将来承重那一档）
 * node scripts/ci-github-verdict-read.mjs --readout     # 读数档：三态照打点，退码恒 0（CI 主列那一格）
 * node scripts/ci-github-verdict-read.mjs --dry-run     # 只打印计划，不发任何请求
 * ```
 *
 * 环境变量：`GITHUB_MIRROR_TOKEN`（必填；`actions: read` 主路径 / `checks: read` 兜底，
 * 任一即可、两条都给最稳）、`GITHUB_MIRROR_REPO`（缺省 `wuxianyuedu/comfy-app`）、
 * `CNB_PULL_REQUEST_IID`（PR 流水线注入）。
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  CODE,
  DISPATCH_STATE_DIR,
  DISPATCH_STATE_FILE,
  RETRY_BACKOFF_MS,
  exitCodeFor,
  isEgressFailure,
  resolveContext,
  sanitize,
} from "./ci-github-mirror-push.mjs";
import {
  NO_RUN_WINDOW_MS,
  probeDispatchChain,
  reportDispatchStateMissing,
  reportNoRunFound,
  reportNoRunStructural,
} from "./ci-github-verdict-chain.mjs";

/**
 * 单次请求（runs / checks 两条路径同一份）的墙钟上限：与镜像格探活同一量级
 * （`REMOTE_PROBE_TIMEOUT_MS`）。通的时候 api.github.com 这一读是亚秒级；
 * 30s 把「慢但活着」的抖动与「没通」分开。
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

/**
 * 认领不上时**提前夭折**的门槛：连续这么多轮「触发表里有 run、但一条 `display_title`
 * 都不含目标 sha」⇒ 判为「认不上了」，不再把 45m 预算花完（ISSUE #3148）。
 *
 * 取 4 轮（= 2 分钟）的理由：迟到的 dispatch 是**排队**造成的，而排队中的 run 一出现
 * 就带着 payload 的「pr_number / head_sha」渲染出的 `display_title`（`run-name` 是 run
 * 创建时就定死的，不是跑完才写）⇒ 「表里有 run 而认不上」不是迟到，是锚点恒假。
 * 4 轮只是给「GitHub 侧刚建 run、标题还没落」留一格余量；再多就只是把墙钟还给平台。
 *
 * ⚠️ 只有**读到过非空触发表**才累计：零条 run 的 `empty`（GitHub 侧压根没起跑）走
 * {@link NO_RUN_WINDOW_MS} 的短窗口，不吃满 45m（ISSUE #3153）。
 */
export const CLAIM_MISS_STREAK_TO_ABORT = 4;

/** 触发表样本里最多念几条（只进日志，不进判据）。 */
const SAMPLE_TITLES_LIMIT = 5;

/** `display_title` 在日志里截断到的长度（够看清「有没有 sha」，又不会把一整页刷满）。 */
const SAMPLE_TITLE_MAX_CHARS = 80;

/**
 * 主路径结论里算「红」的那一档（GitHub workflow-run conclusion 词表内）。
 * 其余 completed 结论（success / neutral / skipped）算绿 —— skipped 与 neutral 是
 * GitHub 自己的「不用跑」，与代码对错无关。
 */
const RED_RUN_CONCLUSIONS = new Set([
  "action_required",
  "cancelled",
  "failure",
  "startup_failure",
  "timed_out",
]);

/**
 * 兜底路径结论里算「红」的那一档（GitHub check-run conclusion 词表内 ——
 * check-run 没有 startup_failure；stale 是平台侧的清理动作，不判红）。
 */
const RED_CHECK_CONCLUSIONS = new Set(["action_required", "cancelled", "failure", "timed_out"]);

/** 本仓检出根（`scripts/` 的上一层）—— git 子进程在这里跑，不靠继承的工作目录。 */
const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * 真身读文件（用例注入 `io.readFile` 的假件，一次真磁盘都不碰）。
 *
 * @param {string} file 文件路径
 * @param {"utf8"} encoding 固定 utf8（这一族只读 JSON）
 * @returns {string} 文件内容
 */
const realReadFile = (file, encoding) => String(readFileSync(file, encoding));

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
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- git 子进程失败时 stderr 实测为 null，@types/node 按 string 标
    stderr: String(r.stderr ?? ""),
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- git 子进程失败时 stdout 实测为 null，@types/node 按 string 标
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
 * 读上游镜像格留下的派发形状（ISSUE #3148）。**读不到不是错**：那说明本跑没写过
 * （老版本 / 干净检出 / 落盘失败），此时退回「自己猜」的老行为 —— 这一跳是增益，不是判据。
 *
 * @param {(file: string, encoding: "utf8") => string} readFile 注入面（用例不读真文件）
 * @param {string} root 检出根
 * @returns {{dispatched: boolean, reason: string} | null} 上游结论；`null` = 没有这个事实
 */
export function readDispatchState(readFile, root) {
  try {
    const raw = readFile(path.join(root, DISPATCH_STATE_DIR, DISPATCH_STATE_FILE), "utf8");
    const parsed = /** @type {{dispatched?: unknown, reason?: unknown}} */ (JSON.parse(raw));
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- parsed 来自 JSON.parse（文件内容是外部数据，可以是 null / 标量），类型标注按对象非空，保留 ?. 防线
    if (typeof parsed?.dispatched !== "boolean") {
      return null;
    }
    return { dispatched: parsed.dispatched, reason: String(parsed.reason ?? "") };
  } catch {
    return null;
  }
}

/**
 * 主路径读数的 URL。
 *
 * 不用 `?head_sha=`：repository_dispatch 触发的 run，其 `head_sha` 落**默认分支 HEAD**
 * （dispatch 那一时刻的），payload 里那笔 sha 只在 `client_payload` —— 按 head_sha 过滤
 * 恒得 `total_count=0`（PR #3080 线上实测：主路径 200 / total_count=0 → 空回落）。
 * 改按 `event=repository_dispatch` 拉最近一页，再用 {@link matchesTargetSha} 按
 * `display_title`（= pr-gate.yml 的 run-name，含 payload 的 head_sha）认领本跑。
 * `per_page=100`：一页盖住最近的 dispatch 触发表，远远够。
 *
 * @param {string} repo `owner/repo`
 * @returns {string} API URL
 */
export function workflowRunsUrl(repo) {
  return `https://api.github.com/repos/${repo}/actions/runs?event=repository_dispatch&per_page=100`;
}

/**
 * 这条 run 是不是本跑派发出去的那一跑：display_title 里带目标 sha（pr-gate.yml 的
 * run-name 把 payload 的 head_sha 全量写进标题，整 sha 子串匹配，不读缩写防撞前缀）。
 *
 * @param {unknown} run workflow_runs 里的一条
 * @param {string} sha 要认领的那一笔
 * @returns {boolean} true ⇒ 是本跑
 */
export function matchesTargetSha(run, sha) {
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- run 是 API 回话里的 unknown 条目，运行时可缺/为 null，断言不承重
  const title = String(/** @type {{display_title?: unknown}} */ (run)?.display_title ?? "");
  return title.includes(sha);
}

/**
 * 触发表里的 `display_title` 样本：给「认领不上」那一形留一眼可分的事实
 * （ISSUE #3142 期望第 1 条 / #3148）。
 *
 * 两件事要让线上那一眼分得开：
 *   · **表里有 run、标题里没有 sha** ⇒ `run-name` 没渲染出 payload 的 sha（锚点恒假）；
 *   · **表里有 run、标题里是别的 sha** ⇒ 本跑推的那一笔与 dispatch payload 不是同一笔。
 * 只念标题不念条目全名：`display_title` 是 `run-name` 的产物，里面是
 * `PR #号 · [标题 · ]sha`（形状见 `.github/workflows/pr-gate.yml` 的 `run-name`）。
 *
 * @param {Array<unknown>} runs runs API 回话里的 `workflow_runs`（**全部**，不只是认领上的）
 * @returns {string} 一行样本（空表时给「零条」）
 */
export function renderTitleSamples(runs) {
  if (runs.length === 0) {
    return "触发表里零条 run";
  }
  const titles = runs.slice(0, SAMPLE_TITLES_LIMIT).map((item) => {
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- item 是 API 回话里的 unknown 条目，运行时可缺/为 null，断言不承重
    const raw = String(/** @type {{display_title?: unknown}} */ (item)?.display_title ?? "").trim();
    const text = raw === "" ? "(无标题)" : raw;
    return text.length > SAMPLE_TITLE_MAX_CHARS
      ? `${text.slice(0, SAMPLE_TITLE_MAX_CHARS)}…`
      : text;
  });
  const more =
    runs.length > SAMPLE_TITLES_LIMIT
      ? `（另有 ${String(runs.length - SAMPLE_TITLES_LIMIT)} 条未念）`
      : "";
  return `触发表 ${String(runs.length)} 条，标题样本：${titles.join(" ｜ ")}${more}`;
}

/**
 * 「这一轮读到了触发表，但一条都认领不上」——提前夭折判据的那一位（ISSUE #3148）。
 *
 * 零条 run 是「GitHub 侧还没起跑」，那是真·等待（#3136 为它放开了整段预算），
 * 不属于这一形：本函数只在 `items` 非空时成立。
 *
 * @param {{state: string, items?: Array<unknown>, runs?: Array<unknown>, status?: number}} read 主路径本轮读数
 * @returns {boolean} true ⇒ 这一轮计入「认不上」的连击
 */
export function isUnclaimedNonEmpty(read) {
  return read.state === "empty" && (read.items ?? []).length > 0;
}

/**
 * 兜底路径读数的 URL（`per_page=100`：pr-gate 一格 5 个 job，单页远远够）。
 * ⚠️ 需 workflow 主动建 check-run 才有效（当前 pr-gate.yml 未建，本批不实现）；
 * 读到零条由汇总层当「还没跑完」继续等，不误判。
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
    /fetch failed|network|socket|econnreset|econnrefused|enotfound|etimedout|eai_again/i.test(
      text,
    ) ||
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
 * @param {string} label 路径名（只进超时那句日志，便于线上分清是哪条路径没通）
 * @returns {Promise<Response>} 响应
 */
async function fetchWithTimeout(fetchImpl, url, token, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, CHECK_RUNS_TIMEOUT_MS);
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
      throw new Error(
        `${label}读数超时（>${String(CHECK_RUNS_TIMEOUT_MS)} ms）：这一跳没拿到任何回话`,
        {
          cause: error,
        },
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @typedef {{ok: true, body: unknown} | {ok: false, kind: "auth", status: number, body: string} | {ok: false, kind: "http", status: number, body: string} | {ok: false, kind: "egress", error: string}} JsonRead
 */

/**
 * 带有限重试的一次读数（文件头第 3 条），runs / checks 两条路径共用。
 *
 * @param {{fetchImpl: typeof fetch, log: (line: string) => void, sleep: (ms: number) => Promise<void>, token: string}} io
 * @param {string} url 请求目标
 * @param {string} label 路径名（进重试与超时日志）
 * @returns {Promise<JsonRead>} 读数结果
 */
async function requestJson(io, url, label) {
  const { fetchImpl, log, sleep, token } = io;
  let lastError = "";
  for (let attempt = 1; attempt <= REQUEST_MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetchWithTimeout(fetchImpl, url, token, label);
      if (res.status === 200) {
        return { body: await res.json(), ok: true };
      }
      const text = await res.text().catch(() => "");
      const kind = res.status === 401 || res.status === 403 ? "auth" : "http";
      return { body: sanitize(text, token), kind, ok: false, status: res.status };
    } catch (error) {
      lastError = String(error);
      if (!isRetryableRequestFailure(error) || attempt === REQUEST_MAX_ATTEMPTS) {
        break;
      }
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- 下标越界时运行时为 undefined（未开 noUncheckedIndexedAccess），退避表长度不随上限变
      const wait = RETRY_BACKOFF_MS[attempt - 1] ?? RETRY_BACKOFF_MS.at(-1) ?? 5000;
      log(
        `[verdict] ${label}读数第 ${String(attempt)}/${String(REQUEST_MAX_ATTEMPTS)} 次没通（egress 类）⇒ ${String(wait / 1000)}s 后试第 ${String(attempt + 1)} 次（网络抖动重试；认证 / 权限类不重试）`,
      );
      await sleep(wait);
    }
  }
  return { error: lastError, kind: "egress", ok: false };
}

/**
 * 汇总一轮读数：是不是都跑完了、哪些红、哪些还在跑。
 *
 * 判红的词表由调用方给（runs / checks 两条路径各一份，见文件头「它要回答的那一格」）；
 * 不在红词表里的 completed 结论都不算红。
 *
 * @param {Array<unknown>} runs API 回话里的条目（workflow_runs / check_runs 同构的最小面）
 * @param {ReadonlySet<string>} redConclusions 判红词表
 * @returns {{completed: boolean, failing: string[], ok: string[], pending: string[], total: number}}
 */
function summarizeItems(runs, redConclusions) {
  /** @type {string[]} */
  const failing = [];
  /** @type {string[]} */
  const ok = [];
  /** @type {string[]} */
  const pending = [];
  for (const item of runs) {
    const run = /** @type {{conclusion?: unknown, name?: unknown, status?: unknown}} */ (item);
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- item 是 API 回话里的 unknown 条目，运行时可缺/为 null，断言不承重
    const name = String(run?.name ?? "(未命名)");
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- item 是 API 回话里的 unknown 条目，运行时可缺/为 null，断言不承重
    if (run?.status !== "completed") {
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- item 是 API 回话里的 unknown 条目，运行时可缺/为 null，断言不承重
      pending.push(`${name}（${String(run?.status ?? "?")}）`);
      continue;
    }
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- item 是 API 回话里的 unknown 条目，运行时可缺/为 null，断言不承重
    const conclusion = String(run?.conclusion ?? "?");
    if (redConclusions.has(conclusion)) {
      failing.push(`${name}（${conclusion}）`);
    } else {
      ok.push(`${name}（${conclusion}）`);
    }
  }
  return {
    completed: runs.length > 0 && pending.length === 0,
    failing,
    ok,
    pending,
    total: runs.length,
  };
}

/**
 * 汇总一轮 workflow runs（主路径）。
 *
 * @param {Array<unknown>} runs runs API 回话里的 `workflow_runs`
 * @returns {{completed: boolean, failing: string[], ok: string[], pending: string[], total: number}}
 */
export function summarizeWorkflowRuns(runs) {
  return summarizeItems(runs, RED_RUN_CONCLUSIONS);
}

/**
 * 汇总一轮 check-runs（兜底路径）。
 *
 * @param {Array<unknown>} runs check-runs API 回话里的 `check_runs`
 * @returns {{completed: boolean, failing: string[], ok: string[], pending: string[], total: number}}
 */
export function summarizeCheckRuns(runs) {
  return summarizeItems(runs, RED_CHECK_CONCLUSIONS);
}

/**
 * @typedef {{state: "auth", status: number} | {state: "http", status: number, body: string} | {state: "egress", error: string}} FailRead
 * @typedef {{state: "data", runs: Array<unknown>} | {state: "empty", items?: Array<unknown>} | FailRead} PathRead
 * @typedef {{state: "data", runs: Array<unknown>} | FailRead} ChecksRead
 */

/**
 * 把 `requestJson` 的失败原样翻成路径读数状态（两条路径的尾巴同构）。
 *
 * @param {JsonRead} res 一次读数的结果
 * @returns {FailRead} 失败三态之一
 */
function failState(res) {
  if (!res.ok && res.kind === "auth") {
    return { state: "auth", status: res.status };
  }
  if (!res.ok && res.kind === "http") {
    return { body: res.body, state: "http", status: res.status };
  }
  return { error: res.ok ? "未知读数失败" : res.error, state: "egress" };
}

/**
 * 主路径一跳：按 `event=repository_dispatch` 拉最近一页 run，再用 display_title
 * 认领本跑（{@link matchesTargetSha}）；本跑一条都认不出来时单独成 empty 态
 * （回落的信号之一）。
 *
 * @param {{fetchImpl: typeof fetch, log: (line: string) => void, sleep: (ms: number) => Promise<void>, token: string}} io
 * @param {{repo: string, headSha: string}} ctx
 * @returns {Promise<PathRead>} 主路径读数状态
 */
async function readMainPath(io, ctx) {
  const res = await requestJson(io, workflowRunsUrl(ctx.repo), "主路径（runs API）");
  if (res.ok) {
    const body = /** @type {{workflow_runs?: unknown}} */ (res.body);
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- body 是 API 回话 JSON，运行时可缺/为 null，断言不承重
    const all = Array.isArray(body?.workflow_runs) ? body.workflow_runs : [];
    const runs = all.filter((r) => matchesTargetSha(r, ctx.headSha));
    /* 认不上时把**触发表原样**带出去（`items`，样本渲染与提前夭折判据都要它）：
     * 只念一句「没认出本跑」分不开「标题里没 sha」与「是别的 sha」两种形（#3142 的现场）。 */
    return runs.length > 0 ? { runs, state: "data" } : { items: all, state: "empty" };
  }
  return failState(res);
}

/**
 * 兜底路径一跳：check-runs 按同一笔 sha 读（零条 check-run 由汇总层当「继续等」处理）。
 *
 * @param {{fetchImpl: typeof fetch, log: (line: string) => void, sleep: (ms: number) => Promise<void>, token: string}} io
 * @param {{repo: string, headSha: string}} ctx
 * @returns {Promise<ChecksRead>} 兜底路径读数状态（零条 check-run 归 data 态，没有 empty）
 */
async function readChecksPath(io, ctx) {
  const res = await requestJson(io, checkRunsUrl(ctx.repo, ctx.headSha), "兜底（checks API）");
  if (res.ok) {
    const body = /** @type {{check_runs?: unknown}} */ (res.body);
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- body 是 API 回话 JSON，运行时可缺/为 null，断言不承重
    return { runs: Array.isArray(body?.check_runs) ? body.check_runs : [], state: "data" };
  }
  return failState(res);
}

/**
 * HTTP 层被拒（非 401/403）的交账：重试无意义，exit 2。
 *
 * @param {(line: string) => void} log 日志出口
 * @param {string} label 路径名
 * @param {number} status HTTP 状态码
 * @param {string} body 已脱敏的回话体
 * @returns {number} 仓内三态退码
 */
function reportHttpReject(log, label, status, body) {
  log(`[verdict] ${label}读数被拒：HTTP ${String(status)}（不是网络层没通，重试无意义）`);
  if (body.trim()) {
    log(`[verdict]   ${body.trim()}`);
  }
  log("[verdict] 结论：exit 2 —— 有一步没跑起来（请求本身被拒，看上面那句）");
  return CODE.NO_FACT;
}

/**
 * egress 重试耗尽的交账：exit 2。
 *
 * @param {(line: string) => void} log 日志出口
 * @param {string} label 路径名
 * @param {string} error 最后一次失败的原文
 * @returns {number} 仓内三态退码
 */
function reportEgressDown(log, label, error) {
  log(
    `[verdict] ${label}读数没跑起来（egress 类，${String(REQUEST_MAX_ATTEMPTS)} 次都没通）：${error}`,
  );
  log("[verdict] 结论：exit 2 —— 节点到 api.github.com 这一跳没通（出网问题在节点侧），与判据无关");
  return CODE.NO_FACT;
}

/**
 * 「认不上」提前夭折的交账：exit 2，**不把 45m 预算花完**（ISSUE #3148）。
 *
 * 这一形的事实是：`dispatch` 触发表里有 run，但它们**一条都不是本跑**。两种候选原因
 * （#3142 正文列的那两条）在这一眼里就已经可分，下一动作不同 —— 所以样本必须念出来，
 * 正文也必须点名「不是权限、不是红」：它既没读到权限被拒，也读到过别人的 run。
 *
 * @param {(line: string) => void} log 日志出口
 * @param {string} headSha 要认领的那一笔（截断成短 sha 进正文）
 * @returns {number} 仓内三态退码
 */
function reportClaimMissed(log, headSha) {
  log(
    `[verdict] 结论：exit 2 —— 连续 ${String(CLAIM_MISS_STREAK_TO_ABORT)} 轮认领不上本跑 @ ${headSha.slice(0, 8)}，提前收工（不再空转满 ${String(POLL_BUDGET_MS / 60_000)}m）`,
  );
  log(
    "[verdict]   两种下一动作（样本见上一行）：① 标题里**没有** sha ⇒ `pr-gate.yml` 的 `run-name` 没渲染出 payload 的 head_sha，" +
      "改 GitHub 侧的 run-name；② 标题里是**别的** sha ⇒ dispatch payload 与本格推的 HEAD 不是同一笔，改认领锚点。",
  );
  log(
    "[verdict]   这不是权限问题（主路径能读到就是读到了），也不是「GitHub 侧判了红」——" +
      "另一种同形是上游派发没发生（镜像格失败 ⇒ 本跑永远不会有 run，见 #3046 / #3146）。",
  );
  return CODE.NO_FACT;
}

/**
 * **45m 预算**耗尽的交账：exit 2。这一档只服务「确实读到本跑、但 `status` 还没
 * completed」那一形（ISSUE #3153）—— 零条 run / 派发读数缺失各有自己的短窗口与话术。
 *
 * @param {(line: string) => void} log 日志出口
 * @param {string} fbNote 兜底路径本轮的状态（仅作降级读数记录）
 * @returns {number} 仓内三态退码
 */
function reportPendingBudgetSpent(log, fbNote) {
  const minutes = String(POLL_BUDGET_MS / 60_000);
  log(
    `[verdict] 结论：exit 2 —— ${minutes}m 轮询预算耗尽还没拿到完整判决（读到本跑但没到终态；没跑完 ≠ 判红，去查 GitHub 侧那一跑是不是卡住了）${fbNote}`,
  );
  return CODE.NO_FACT;
}

/**
 * 两条路径都 401/403 的交账：exit 2（**主路径也没读到任何东西**的前提下的权限结论）。
 *
 * 只在主路径本身被拒时才有资格说「权限」；主路径读到 0 条而兜底被拒是另一回事
 * （令牌够、只是 GitHub 侧还没起跑），那一形走短窗口交账（#3153）。
 *
 * @param {(line: string) => void} log 日志出口
 * @param {number} mainStatus 主路径被拒的 HTTP 状态
 * @param {number} fbStatus 兜底被拒的 HTTP 状态
 * @returns {number} 仓内三态退码
 */
function reportBothDenied(log, mainStatus, fbStatus) {
  log(
    `[verdict] 主路径（runs API）被拒 HTTP ${String(mainStatus)}，兜底（checks API）也被拒 HTTP ${String(fbStatus)} ——` +
      "两条路径这枚令牌都没够上。",
  );
  log(
    "[verdict]   下一动作：给这枚 fine-grained PAT 追加 `actions: read`（优先，主路径 runs API）" +
      "或 `checks: read`（兜底，Checks API）—— 任一即可、两条都给最稳；" +
      "并把新值同步进密钥仓库 moon-read/GITHUB_MIRROR_TOKEN（PR / push 两条流水线都从那里 imports）。",
  );
  log("[verdict] 结论：exit 2 —— 前提没落地（权限），不是 GitHub 侧判出了红");
  return CODE.NO_FACT;
}

/**
 * 执行回读：上下文收口 → 每轮先试主路径、读不到任何 run 再回落兜底，
 * 直到拿到完整结论 / 预算耗尽。
 *
 * @param {{env: Record<string, string | undefined>, fetchImpl?: typeof fetch, runGit?: typeof realRunGit, sleep?: (ms: number) => Promise<void>, now?: () => number, dryRun?: boolean, log?: (line: string) => void, readFile?: (file: string, encoding: "utf8") => string, root?: string}} io
 * @returns {Promise<number>} 仓内三态退码
 */
export async function runVerdict(io) {
  const { dryRun = false, env } = io;
  const log =
    io.log ??
    ((line) => {
      console.log(line);
    });
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
    `[verdict] 计划：轮询 ${ctx.repo} @ ${ctx.headSha.slice(0, 8)}（镜像 ref ${ctx.ref}）· 主路径 runs API（event=repository_dispatch + display_title 认领本跑，需 actions: read），认不到本跑的 run 回落 checks API（需 checks: read，且需 workflow 主动建 check 才有效 —— 当前未建，兜底仅作降级读数）· 间隔 ${String(POLL_INTERVAL_MS / 1000)}s · 预算：读到本跑 ${String(POLL_BUDGET_MS / 60_000)}m / 零条 run ${String(NO_RUN_WINDOW_MS / 60_000)}m`,
  );
  if (dryRun) {
    log("[verdict] DRY-RUN：没发任何请求，计划如上");
    return CODE.OK;
  }
  /* 上游自己知道「本跑派发了没有」（镜像格落的 `mirror-dispatch.json`）。派发没发生 ⇒
   * 本跑永远不会有 run，再等 45m 也只是等一个不存在的东西（#3148 的现场）。 */
  const upstream = readDispatchState(io.readFile ?? realReadFile, io.root ?? ROOT);
  if (upstream && !upstream.dispatched) {
    log(`[verdict] 上游派发格留下的读数：派发没发生 —— ${upstream.reason}`);
    log(
      "[verdict] 结论：exit 2 —— 本跑不会有 GitHub 侧那一跑（派发没发生，不是认领锚点的问题），一秒不轮询",
    );
    log(
      "[verdict]   下一动作：修上游那一跳（形状见 `GitHub 镜像同步` 格的小结与原文行；" +
        "egress / 令牌 / LFS / 派发各是各的下一动作，见 #3046 / #3146），修好后本格自然能读到判决。",
    );
    return CODE.NO_FACT;
  }
  if (upstream) {
    log(`[verdict] 上游派发格的读数：${upstream.reason}`);
  }
  const reqIo = { fetchImpl, log, sleep, token: ctx.token };
  /* 两档窗口从同一时刻起算（只读一次钟面，避免假时钟把两档 deadline 错拍）：
   * 45m 只给「读到本跑、但没到终态」；5m 给零条 run / 派发读数缺失（ISSUE #3153）。 */
  const startedAt = now();
  const pendingDeadline = startedAt + POLL_BUDGET_MS;
  const noRunDeadline = startedAt + NO_RUN_WINDOW_MS;
  /** 兜底路径本轮的读数（**只作降级事实记录**，不参与结论）：主路径读到 0 条而兜底
   *  不可用时，它只用来解释「这一形为什么连读数的影子都没有」。 */
  let fbNote = "";
  /** 连续「触发表里有 run、一条都认不上」的轮数（`CLAIM_MISS_STREAK_TO_ABORT` 的计数）。 */
  let missStreak = 0;
  /** 读到过本跑（`data` 态，含主路径被拒时兜底读到的条目）⇒ 45m 预算。 */
  let sawRun = false;
  /** 主路径被拒（没给 `actions: read`）：主路径读不到，退回老的 45m 行为。 */
  let mainUnreadable = false;
  /** 零条 run 的结构判定（只探一次；`null` = 还没探）。 */
  /** @type {Awaited<ReturnType<typeof probeDispatchChain>> | null} */
  let chain = null;
  for (;;) {
    /** 主路径被拒的 HTTP 状态（0 = 没被拒）—— 决定「权限」这句有没有资格说。 */
    let mainAuthStatus = 0;
    const main = await readMainPath(reqIo, ctx);
    /** @type {{completed: boolean, failing: string[], ok: string[], pending: string[], total: number} | null} */
    let summary = null;
    let pathLabel = "主路径（runs API）";
    if (main.state === "data") {
      missStreak = 0;
      sawRun = true;
      summary = summarizeWorkflowRuns(main.runs);
    } else if (main.state === "auth") {
      mainAuthStatus = main.status;
      mainUnreadable = true;
      log(
        `[verdict] 主路径（runs API）被拒 HTTP ${String(main.status)} —— 令牌没给 actions: read ⇒ 本轮回落兜底（checks API）`,
      );
    } else if (main.state === "empty") {
      /* 读到过非空触发表、却一条都没认领上 —— 与「零条 run」（GitHub 侧还没起跑）不是同一件事：
       * 前者再等也等不出新事实（锚点恒假），后者可能随时起跑。分开说、分开计时（#3148）。 */
      if (isUnclaimedNonEmpty(main)) {
        missStreak += 1;
        log(
          `[verdict] 主路径（runs API）认领不上本跑（第 ${String(missStreak)}/${String(CLAIM_MISS_STREAK_TO_ABORT)} 轮）：${renderTitleSamples(main.items ?? [])}`,
        );
        if (missStreak >= CLAIM_MISS_STREAK_TO_ABORT) {
          return reportClaimMissed(log, ctx.headSha);
        }
      } else {
        missStreak = 0;
        /* 零条 run：第一次先做一次结构判定（仓库身份 / workflow / 事件条件），
         * 任一证据明确「不会有 run」⇒ 当场收工；判不出就走 5m 短窗口（#3153）。 */
        if (chain === null) {
          chain = await probeDispatchChain(
            (url, label) => requestJson(reqIo, url, label),
            ctx,
          );
          log(`[verdict] 零条 run 的结构判定：${chain.note}`);
          if (chain.structural !== "") {
            return reportNoRunStructural(log, chain);
          }
        }
        log(
          `[verdict] 主路径（runs API）的 dispatch 触发表里零条 run（GitHub 侧还没起跑 / 结构上没建）⇒ 本轮回落兜底（checks API）；主路径本身读通了（不是权限问题），按 ${String(NO_RUN_WINDOW_MS / 60_000)}m 短窗口继续轮询`,
        );
      }
    } else if (main.state === "http") {
      return reportHttpReject(log, "主路径（runs API）", main.status, main.body);
    } else {
      return reportEgressDown(log, "主路径（runs API）", main.error);
    }
    if (summary === null) {
      const fb = await readChecksPath(reqIo, ctx);
      if (fb.state === "data") {
        fbNote = "";
        /* 主路径**被拒**时兜底才是唯一读数 ⇒ 用它的条目；主路径读到 0 条时兜底读到
         * 什么都不改变「本跑还没起跑」那一判（check-run 可能挂在别的 sha 上，且这一路径
         * 当前 workflow 根本不建 check-run）—— 它只是降级事实，不许顶掉主路径的形状。 */
        if (mainAuthStatus > 0 && fb.runs.length > 0) {
          pathLabel = "兜底（checks API）";
          sawRun = true;
          summary = summarizeCheckRuns(fb.runs);
        }
      } else if (fb.state === "auth") {
        fbNote = `（兜底（checks API）不可用：HTTP ${String(fb.status)}，无 checks: read，仅降级读数）`;
        log(
          `[verdict] 兜底（checks API）被拒 HTTP ${String(fb.status)} —— 无 checks: read，**仅降级读数**（不参与结论、不需补权限）`,
        );
        if (mainAuthStatus > 0) {
          return reportBothDenied(log, mainAuthStatus, fb.status);
        }
      } else if (fb.state === "http") {
        return reportHttpReject(log, "兜底（checks API）", fb.status, fb.body);
      } else {
        return reportEgressDown(log, "兜底（checks API）", fb.error);
      }
    }
    if (summary?.total === 0) {
      /* 只有主路径被拒时才可能走到这里用兜底；那种形状已经不是「读到 0 条」了。 */
      const what = pathLabel === "兜底（checks API）" ? "check-run" : "workflow run";
      log(
        `[verdict] ${pathLabel}：这一笔 sha 上还没有任何 ${what}（GitHub 侧可能还没起跑）—— 继续等`,
      );
    } else if (summary?.completed) {
      for (const line of summary.ok) {
        log(`[verdict]   ✓ ${line}`);
      }
      for (const line of summary.failing) {
        log(`[verdict]   ✗ ${line}`);
      }
      if (summary.failing.length > 0) {
        log(
          `[verdict] 结论：exit 1 —— ${pathLabel}对同一笔 sha 的判决是红的（${String(summary.failing.length)}/${String(summary.total)} 个没过）`,
        );
        return CODE.FAIL;
      }
      log(
        `[verdict] ✓ 结论：exit 0 —— ${pathLabel}对同一笔 sha 的 ${String(summary.total)} 个全部完成且没有红`,
      );
      return CODE.OK;
    } else if (summary) {
      log(
        `[verdict] ${pathLabel}：${String(summary.total)} 个条目：${String(summary.pending.length)} 个还在跑（${summary.pending.join("、")}）—— 继续等`,
      );
    }
    /* 窗口按**已读到的形状**分档（ISSUE #3153）：读到本跑（或主路径本身读不到）才配
     * 45m；零条 run / 派发读数缺失各走 5m，到点按那一形自己的话术交账。 */
    const deadline = sawRun || mainUnreadable ? pendingDeadline : noRunDeadline;
    if (now() >= deadline) {
      if (sawRun || mainUnreadable) {
        return reportPendingBudgetSpent(log, fbNote);
      }
      if (chain === null) {
        chain = await probeDispatchChain((url, label) => requestJson(reqIo, url, label), ctx);
        log(`[verdict] 零条 run 的结构判定：${chain.note}`);
        if (chain.structural !== "") {
          return reportNoRunStructural(log, chain);
        }
      }
      return upstream === null
        ? reportDispatchStateMissing(log, chain)
        : reportNoRunFound(log, ctx.headSha, chain, upstream);
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
