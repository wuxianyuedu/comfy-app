#!/usr/bin/env node
/**
 * `ci-ga-failure-logs.mjs` —— GA 每日档失败立案的「红的那部分日志」取数与渲染层。
 *
 * ## 补的是哪一格
 *
 * `ci-ga-daily-failure-issue.mjs` 此前只把 jobs API 的 `steps[].conclusion` 变成一句
 * 「红在「<格名>」」，正文明写「不摘录日志正文」。读者看不出是哪一步、哪一行出错，
 * 要自己出站到 GA 页面取 `gh run view … --log-failed`（#3584 的现场）。这一份把
 * **红色失败窗口**接进立案正文：全部 `##[error]` 注解 + 失败 step 的原始窗口，
 * 脱敏后按字节预算贴；装得下就把完整日志一并贴，装不下就给窗口 + 下载端点。
 *
 * ## 复用优先：取数 / 脱敏 / 窗口 / 预算一律 import，不另写第二套（§12.18）
 *
 *   · `collectFailedJobLogs`（`ci-ga-logs-relay.mjs`）：jobs → 逐失败 job
 *     `/actions/jobs/{id}/logs`，已带重试 / 超时 / 脱敏，与 PR 档日志搬运同一条链；
 *   · `extractFailureWindow` / `capStageWindow` / `redactSecrets` / `jobLogUrl`
 *     （`ci-github-verdict-logs.mjs`）：注解、失败窗口、字节预算截断、脱敏，判决回读那一档在用；
 *   · `PULL_BODY_LIMIT`（`ship-pull-body.mjs`）：平台对正文的字节硬上限，PR 正文那一格在用。
 *
 * 这一份只新增纯函数（正文渲染、预算闸、入口装配）。取不到日志 ≠ 日志里没有失败行：
 * 失败形态一律如实念出 HTTP 状态 / 网络错误，绝不当成「没有失败行」（§13.6.2 同一口径）。
 *
 * ## 为什么是独立模块
 *
 * 立案脚本要留在 900 行硬闸之内，而日志取数与渲染是另一族职责（跟着 GA 日志端点与
 * 正文预算变，不跟着「哪一格算红 / 同一格不重复建」变）。纯函数与 IO 分开放，
 * 用例不必起网络就能钉住正文形状。所有 import 只吃 `node:*` 与本仓模块 ——
 * 下游 job `fetch-depth: 1` / 不装依赖照样加载得起来（与 `ci-ga-logs-relay.mjs` 同形）。
 *
 * ## 用法
 *
 * ```text
 * node scripts/ci-ga-failure-logs.mjs              # 读 env 里的 run，把读数打到 stdout
 * node scripts/ci-ga-failure-logs.mjs --dry-run     # 只念前提，一条网络都不发
 * ```
 *
 * 环境变量与 `ci-ga-daily-failure-issue.mjs` 同源：`GITHUB_TOKEN` / `GH_TOKEN`、
 * `GITHUB_REPOSITORY`、`GITHUB_RUN_ID`。
 */
import path from "node:path";
import process from "node:process";

import { collectFailedJobLogs, FAILED_JOB_CONCLUSIONS } from "./ci-ga-logs-relay.mjs";
import {
  capStageWindow,
  extractFailureWindow,
  jobLogUrl,
  redactSecrets,
  runJobsUrl,
  STAGE_WINDOW_MAX_BYTES,
} from "./ci-github-verdict-logs.mjs";
import { requestJson } from "./ci-github-verdict-request.mjs";
import { PULL_BODY_LIMIT } from "./ship-pull-body.mjs";

/** 正文里给日志读数的字节预算：平台硬上限的一半，剩下的留给症状 / 根因 / 出口。 */
export const LOG_BODY_BUDGET = Math.floor(PULL_BODY_LIMIT / 2);

/** 失败注解最多贴几条：它们与窗口共用预算，超出的只给条数，不静默丢。 */
export const MAX_ERROR_LINES = 25;

/** 失败注解的字节上限（日志里单行注解可能很长，不封顶会把窗口挤出正文）。 */
export const ERROR_BUDGET = 8 * 1024;

/** 单个失败窗口的字节预算：复用判决回读那一档的数，再压进本格剩下的预算。 */
export const WINDOW_BUDGET = Math.min(
  STAGE_WINDOW_MAX_BYTES,
  LOG_BODY_BUDGET - ERROR_BUDGET - 2 * 1024,
);

/**
 * 交给共享窗口函数之前，单行先压到这个字符数。
 *
 * `capStageWindow` 对「单行几 MB」按 500 字符步进逐次让位（与判决回读那一档同形），
 * 2 MB 的一行要跑 4000 轮 × 每轮一次全串字节计数 —— 那在立案这一跳（5 分钟 job 预算）
 * 上会表现为「卡死」。这里只做**前置形状归一**：长行截到可打印的长度并标出来，
 * 窗口算法本身仍只有 `capStageWindow` 一份（§12.18）。
 */
export const MAX_LINE_CHARS = 4000;

/**
 * 把过长的单行压短并明示（形状归一，不替代窗口截断）。
 *
 * @param {string} text 日志正文
 * @returns {string} 每行都不超过 {@link MAX_LINE_CHARS} 的正文
 */
export function clampLongLines(text) {
  const suffix = `…（本行已截到 ${String(MAX_LINE_CHARS)} 字符）`;
  return (
    String(text ?? "")
      .split("\n")
      /* 截完含标记也恰好不超过阈值 ⇒ 第二次调用是幂等的（渲染层与窗口层各过一次）。 */
      .map((line) =>
        line.length > MAX_LINE_CHARS
          ? `${line.slice(0, Math.max(0, MAX_LINE_CHARS - suffix.length))}${suffix}`
          : line,
      )
      .join("\n")
  );
}

/**
 * 是不是可按字段取值的对象（API 应答里的条目都是 `unknown`，先过这一跳）。
 *
 * @param {unknown} value 任意值
 * @returns {value is Record<string, unknown>} true ⇒ 对象
 */
function isRecord(value) {
  return typeof value === "object" && value !== null;
}

/**
 * 把窗口压进「这一格还剩多少」预算。复用 `capStageWindow`（尾部为主、保留首尾、
 * 超界明示省略行数），不重抄一份截断算法。
 *
 * @param {{errors: string[], lines: string[], startLine: number}} window 失败窗口
 * @param {number} budget 可用字节
 * @returns {ReturnType<typeof capStageWindow>} 可贴进正文的窗口
 */
export function capLogWindow(window, budget = WINDOW_BUDGET) {
  return capStageWindow(window, Math.max(1, budget));
}

/**
 * 失败注解按字节与条数双封顶：留得下几条贴几条，被省掉的**念出条数**，不静默丢。
 *
 * @param {string[]} errors 注解行
 * @param {number} budget 字节预算
 * @returns {{kept: string[], omitted: number}} 可贴的部分与省掉的条数
 */
function capErrors(errors, budget) {
  /** @type {string[]} */
  const kept = [];
  let bytes = 0;
  for (const line of clampLongLines(errors.slice(0, MAX_ERROR_LINES).join("\n")).split("\n")) {
    const cost = Buffer.byteLength(line, "utf8") + 1;
    if (bytes + cost > budget) {
      break;
    }
    kept.push(line);
    bytes += cost;
  }
  return { kept, omitted: errors.length - kept.length };
}

/**
 * 一段日志正文里的「红的那部分」：全部 `##[error]` 注解 + 失败 step 窗口。
 *
 * @param {string} text 已脱敏的日志正文
 * @param {number} [budget] 这一节总共可用的字节（注解 + 窗口共用）
 * @returns {{errors: string[], lines: string[], omittedErrors: number, startLine: number,
 *   totalLines: number, truncated: boolean}} 红色读数
 */
export function failureLines(text, budget = WINDOW_BUDGET + ERROR_BUDGET) {
  const raw = extractFailureWindow(clampLongLines(text));
  const errs = capErrors(raw.errors, Math.min(ERROR_BUDGET, Math.floor(budget / 2)));
  const windowBudget = Math.max(
    1,
    budget - errs.kept.reduce((n, l) => n + Buffer.byteLength(l, "utf8") + 1, 0),
  );
  const capped = capLogWindow(raw, windowBudget);
  return {
    errors: errs.kept,
    lines: capped.lines,
    omittedErrors: errs.omitted,
    /* `capStageWindow` 不带 startLine（它只回窗口行数），原始窗口那一格才有。 */
    startLine: raw.startLine,
    totalLines: capped.totalLines,
    truncated: capped.truncated,
  };
}

/**
 * 把一次日志取数渲染成正文里的两节：**失败行** + **完整日志**。
 *
 * 三态必须分得开（用例逐形钉住）：
 *   · `ok: false` ⇒ 取不到（带原因），绝不写成「日志里没有失败行」；
 *   · `ok: true` 但正文装不下 ⇒ 贴窗口 + 下载端点 + 可粘贴命令，明示截了多少；
 *   · `ok: true` 且装得下 ⇒ 窗口 + 整份完整日志，读者不用跳 GA 页面。
 *
 * 脱敏是硬规则 17 的那一跳：`collectFailedJobLogs` 抹过一次，正文这一层再抹一次
 * （调用方可能从别的来源递正文进来），不把凭据带进单子。
 *
 * @param {{
 *   ghRepo: string,
 *   jobs: Array<{conclusion: string, id?: number|string, name?: string}>,
 *   ok: boolean,
 *   reason?: string,
 *   runId: string,
 *   text: string,
 * }} reading 取数读数
 * @returns {string} Markdown 正文段
 */
export function renderLogReadout({ ghRepo, jobs, ok, reason = "", runId, text }) {
  if (!ok) {
    return [
      "## 失败日志（平台原样摘录）",
      "",
      `**取不到**：${reason || "原因未给出"}。`,
      "",
      "这一句不是「日志里没有失败行」，是**这一跳没拿到读数**（§13.6.2：读不出 ≠ 没到门限）。",
      "要取完整日志，在能出站到 `api.github.com` 且带 `actions: read` 的机器上跑：",
      "",
      "```bash",
      `gh run view ${runId} --repo ${ghRepo} --log-failed`,
      "```",
      "",
      "或在 GA 页面点开红格看日志正文。立案不因为取不到日志而不建 —— 那会让「红了」重新变成没人问。",
    ].join("\n");
  }
  const failed = jobs.filter(
    (j) => FAILED_JOB_CONCLUSIONS.has(j.conclusion) && j.conclusion !== "skipped",
  );
  /* 先做单行形状归一，再过共享的 `redactSecrets`：那份正则在超长单行上是平方级
   * （2 MB 一行实测 >60s），而日志正文里出现这种行只是「某个命令把 dump 打在一行」。
   * 截掉的是「同一行里第 4000 字之后」的那一段，标出来且不静默丢（见 clampLongLines）。 */
  const shaped = clampLongLines(text);
  const clean = redactSecrets(shaped, "");
  const bytes = Buffer.byteLength(clean, "utf8");
  /** 完整日志自身装得下，且给红色窗口留得出余量，才整份内联。 */
  const fit = bytes + 2 * 1024 <= LOG_BODY_BUDGET;
  /** @param {number} redBudget 红色那一节可用的字节 @param {boolean} inline 是否内联完整日志 @returns {string} 整段读数 */
  const build = (redBudget, inline) => {
    const win = failureLines(clean, redBudget);
    const head = [
      "## 失败日志（平台原样摘录，已脱敏）",
      "",
      `- 失败 job：${failed.map((j) => `「${String(j.name ?? "(未命名 job)")}」`).join("、") || "(读不到名字)"}`,
      `- 完整日志：${bytes} 字节 · ${String(clean.split("\n").length)} 行`,
      "",
      "### 红的那部分（`##[error]` 注解 + 失败 step 窗口）",
      "",
    ];
    const errors = win.errors.length
      ? [
          "**失败注解**：",
          "",
          "```text",
          ...win.errors,
          "```",
          "",
          ...(win.omittedErrors
            ? [`其余 ${String(win.omittedErrors)} 条注解未贴（见完整日志）。`, ""]
            : []),
        ]
      : ["**失败注解**：这一份日志里没认出 `##[error]` 行 —— 看下面的窗口与完整日志。", ""];
    const windowLines = [
      `**失败窗口**（从第 ${String(win.startLine)} 行起 · 共 ${String(win.totalLines)} 行${win.truncated ? " · 已按字节预算截到首尾" : ""}）：`,
      "",
      "```text",
      ...win.lines,
      "```",
      "",
    ];
    const tail = inline
      ? ["### 完整日志（装得下，整份贴在这里）", "", "```text", clean, "```"]
      : [
          "### 完整日志（超出正文预算，按窗口 + 下载端点）",
          "",
          `窗口外还有内容：完整日志 ${bytes} 字节，正文预算 ${String(LOG_BODY_BUDGET)} 字节。`,
          "逐 job 的下载端点（需 `actions: read`）：",
          "",
          ...failed.map((j) =>
            j.id === undefined || j.id === null
              ? `- 「${String(j.name ?? "(未命名 job)")}」没有 job id ⇒ 给不出端点`
              : `- \`${jobLogUrl(ghRepo, String(j.id))}\``,
          ),
          "",
          "可粘贴命令：",
          "",
          "```bash",
          `gh run view ${runId} --repo ${ghRepo} --log-failed`,
          "```",
        ];
    return [...head, ...errors, ...windowLines, ...tail].join("\n");
  };
  /* 红色那一节按预算逐次收紧，直到整段读数落进 LOG_BODY_BUDGET：静默超界会让
   * 建单 POST 直接被平台拒（正文硬上限，ISSUE #2248 的同一条量纲）。内联完整日志
   * 与红色窗口合起来仍超界时，退成「窗口 + 下载端点」那一档 —— 完整日志不内联，
   * 但红色那部分一定留在正文里。 */
  let budget = WINDOW_BUDGET + ERROR_BUDGET;
  let inline = fit;
  let out = build(budget, inline);
  while (Buffer.byteLength(out, "utf8") > LOG_BODY_BUDGET) {
    if (inline) {
      inline = false;
    } else if (budget > 1024) {
      budget = Math.floor(budget / 2);
    } else {
      break;
    }
    out = build(budget, inline);
  }
  return out;
}

/**
 * 从 jobs API 的应答里取失败 job 清单（下载端点要 job id）。**纯函数**：调用方
 * 已经问过一次 jobs（立案要靠它的 step conclusion 认红格），这里不再问第二次。
 *
 * @param {unknown} json `GET /repos/{repo}/actions/runs/{id}/jobs` 的应答
 * @returns {{ok: true, jobs: Array<{conclusion: string, id?: number|string, name?: string}>} |
 *   {ok: false, reason: string}} 取不到形状时给失败，不拿空数组冒充「没有失败 job」
 */
export function failedJobsFromJson(json) {
  const rows = isRecord(json) && Array.isArray(json.jobs) ? json.jobs : null;
  if (!rows) {
    return { ok: false, reason: "job 清单应答不是预期形状（缺 jobs 数组）" };
  }
  /** @type {Array<{conclusion: string, id?: number|string, name?: string}>} */
  const jobs = [];
  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }
    const id = row.id;
    jobs.push({
      conclusion: String(row.conclusion ?? ""),
      id: typeof id === "number" || typeof id === "string" ? id : undefined,
      name: String(row.name ?? ""),
    });
  }
  return { jobs, ok: true };
}

/**
 * 取本次 run 的失败 job 日志。复用 `collectFailedJobLogs`（同一条 jobs → logs → 脱敏链），
 * 这里只补「失败 job 清单」与「取不到的原因」两件读数，供正文与下载端点用。
 *
 * @param {{fetchImpl?: typeof fetch, ghRepo: string, ghToken: string,
 *   jobsJson?: unknown, log?: (s:string)=>void, runId: string,
 *   sleep?: (ms:number)=>Promise<void>}} io
 *   `jobsJson` 是调用方已经取到的 jobs 应答（立案那一跳复用它认红格）；
 *   缺省时本模块自己问一次，供独立入口 `ci-ga-failure-logs.mjs` 用。
 * @returns {Promise<{ghRepo:string, jobs:Array<{conclusion:string,id?:number|string,name?:string}>,
 *   ok:boolean, reason?:string, runId:string, text:string}>}
 */
export async function collectFailureLogReading(io) {
  const log =
    io.log ??
    ((s) => {
      console.log(s);
    });
  const fetchImpl = io.fetchImpl ?? globalThis.fetch;
  const ctx = { ghRepo: io.ghRepo, ghToken: io.ghToken, runId: io.runId };
  const sleep = io.sleep ?? (() => Promise.resolve());
  let listing = io.jobsJson === undefined ? null : failedJobsFromJson(io.jobsJson);
  if (listing === null) {
    const res = await requestJson(
      { fetchImpl, log, sleep, token: io.ghToken },
      runJobsUrl(io.ghRepo, io.runId),
      "job 清单",
    );
    listing = res.ok
      ? failedJobsFromJson(res.body)
      : {
          ok: false,
          reason: `job 清单 ${res.kind === "egress" ? "网络没通" : `HTTP ${String(res.status)}`}`,
        };
  }
  if (!listing.ok) {
    log(`[ga-failure-logs] ${listing.reason} ⇒ 日志读数没结论`);
    return { ...ctx, jobs: [], ok: false, reason: listing.reason, text: "" };
  }
  const collected = await collectFailedJobLogs({ ctx, fetchImpl, log, sleep });
  if (!collected) {
    return {
      ...ctx,
      jobs: listing.jobs,
      ok: false,
      reason: "失败 job 的日志正文一份都没取到（HTTP 401/403/404 或正文为空）",
      text: "",
    };
  }
  /* 同一道形状归一也放在取数出口：正文可能从别的来源递进来（手工立案 / 用例），
   * 渲染层再抹一次才不依赖调用方记得这件事。 */
  return { ...ctx, jobs: listing.jobs, ok: true, text: clampLongLines(collected.text) };
}

/** 入口：把这一跑的失败日志读数打到 stdout（供本地复核 / 手工立案粘贴）。
 *
 * @param {{argv?: string[], env?: Record<string, string | undefined>,
 *   fetchImpl?: typeof fetch, log?: (s: string) => void}} [io]
 * @returns {Promise<number>} 0 取到 / 2 没结论
 */
export async function main(io = {}) {
  const env = io.env ?? process.env;
  const ghRepo = String(env.GITHUB_REPOSITORY ?? "").trim() || "wuxianyuedu/comfy-app";
  const ghToken = String(env.GITHUB_TOKEN ?? env.GH_TOKEN ?? "").trim();
  const runId = String(env.GITHUB_RUN_ID ?? "").trim();
  const log =
    io.log ??
    ((s) => {
      console.log(s);
    });
  if (!ghToken || !runId) {
    log("[ga-failure-logs] 缺 GITHUB_TOKEN / GITHUB_RUN_ID ⇒ 没有读数。");
    return 2;
  }
  if ((io.argv ?? process.argv.slice(2)).includes("--dry-run")) {
    log(`[ga-failure-logs] DRY-RUN：run ${runId} · ${ghRepo}（一条网络都不发）`);
    return 0;
  }
  const reading = await collectFailureLogReading({
    fetchImpl: io.fetchImpl ?? globalThis.fetch,
    ghRepo,
    ghToken,
    log,
    runId,
  });
  log(renderLogReadout(reading));
  return reading.ok ? 0 : 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().then((code) => {
    process.exitCode = code;
  });
}
