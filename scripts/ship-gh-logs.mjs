#!/usr/bin/env node
/**
 * `ship-gh-logs.mjs` —— ship 侧读 GitHub Actions（GA）失败日志的**取数与呈现**。
 *
 * ## 为什么单独一层
 *
 * `ci-github-verdict-logs.mjs` 是 CI 里的读者：它把失败 job 的摘要 / 注解 / 窗口打到
 * CNB stage，并把全量正文落进构建工作区。ship 是**本地**读者，要的两件事与它不同：
 * 台面上直接看见「哪条 run、哪个 job、哪个 step、全部 `##[error]`、失败 step 窗口、
 * 一行结论」，以及一份**可直接用资源管理器打开**的绝对路径。取数（重试 / 超时 /
 * 脱敏 / 窗口边界）仍走那份既有实现，这里不写第二套。
 *
 * 于是本模块只做三件：
 *
 *   1. **认目标**：`run id` 或 PR 号（`run:4242` / `pr:3195` 可消歧；裸数字按位数判）。
 *   2. **取数**：`requestJson` / `requestText`（`ci-github-verdict-request.mjs`）+
 *      `runJobsUrl` / `jobLogUrl` / `extractFailureWindow` / `redactSecrets`。
 *   3. **呈现**：run id/URL、失败 job / step、全部注解、失败窗口（head/tail 标记 +
 *      准确截断行数）、一行归因（环境侧 / 内容判据 / 未判定），以及全量日志绝对路径。
 *
 * ## 边界（与 CI 那一份同一口径）
 *
 *   1. **日志取不到 ≠ 判红**。没有令牌、401/403、404、网络不通，都只多一行缺因；
 *      不改三态判定、不改退码。本模块的 `runGhLogs` 只在**输入认不出**时退 2。
 *   2. **没有令牌只念一行**：`未设置令牌 ⇒ 跳过 GH 日志回读`，一次网络都不发。
 *   3. **落盘的是脱敏后的正文**：精确令牌值、`ghp_…` / `github_pat_…`、以及日志里的
 *      `KEY=value` / `{"key":"value"}` 形状都抹成 `<redacted>`（硬规则 17）。
 *   4. **落盘目录是系统临时目录**（`<tmp>/comfy-ship-gh-logs/`）：不进仓库、单 run
 *      一份、每次回读先清空上一次；屏幕打印绝对路径 + 清理提示。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CODE } from "./ship-core.mjs";
import { requestJson, requestText } from "./ci-github-verdict-request.mjs";
import {
  extractFailureWindow,
  jobLogUrl,
  redactSecrets,
  runJobsUrl,
  JOB_LOG_FILE_MAX_BYTES,
  truncateJobLog,
} from "./ci-github-verdict-logs.mjs";
import { RED_RUN_CONCLUSIONS, workflowRunsUrl } from "./ci-github-verdict-read.mjs";

/** 全量日志落点（系统临时目录；不进仓库）。 */
export const GH_LOGS_DIR = path.join(os.tmpdir(), "comfy-ship-gh-logs");

/** 台面上失败 step 窗口的字节预算（12 KiB）：再大就会把上面那几行读数挤出屏幕。 */
export const SHIP_WINDOW_MAX_BYTES = 12 * 1024;

/** 窗口截断时保留的首 / 尾行数（尾部为主 —— 失败 step 的真因通常就在尾部）。 */
export const SHIP_WINDOW_HEAD_LINES = 20;
export const SHIP_WINDOW_TAIL_LINES = 120;

/** 裸数字多长才当 run id 认：本仓 PR 号是 4 位数，GA run id 至少 10 位数，6 位起足够分开。 */
export const GH_RUN_ID_MIN = 100_000;

/** 本仓 `run-name` 的 PR 前缀（`.github/workflows/pr-gate.yml`：`PR #号 · [标题 · ]sha`）。 */
const PR_TITLE_PREFIX = /PR #(?<num>\d+)(?![0-9])/u;

/** 判「内容判据」的强词：这些名字失败，说明本轮改动要过的那一格没过去。 */
const CONTENT_NAME = [
  /typecheck/i,
  /lint/i,
  /oxlint/i,
  /eslint/i,
  /test/i,
  /vitest/i,
  /check/i,
  /verify/i,
  /build/i,
  /gate/i,
  /render/i,
  /doc/i,
  /格式/u,
  /类型/u,
  /用例/u,
  /判据/u,
  /构建/u,
  /文档/u,
  /自检/u,
  /静态/u,
];

/** 判「环境侧」的强词：这些名字失败，通常是准备步骤 / 运行时没到位，判据还没跑到。 */
const ENV_NAME = [
  /checkout/i,
  /set up/i,
  /setup/i,
  /install/i,
  /cache/i,
  /runner/i,
  /docker/i,
  /network/i,
  /dependency/i,
  /缓存/u,
  /网络/u,
  /依赖/u,
  /准备/u,
  /检出/u,
  /安装/u,
];

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
 * 数组读数（不是数组时给空表）。
 *
 * @param {unknown} value 任意值
 * @returns {Array<unknown>} 列表
 */
function asList(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * 从环境变量取令牌：`GITHUB_MIRROR_TOKEN` 优先，兼容 `GITHUB_TOKEN`。
 *
 * @param {Record<string, string | undefined>} [env] 进程环境
 * @returns {string} 令牌；没有时是空串
 */
export function resolveGhToken(env = {}) {
  const mirror = String(env?.GITHUB_MIRROR_TOKEN ?? "").trim();
  return mirror === "" ? String(env?.GITHUB_TOKEN ?? "").trim() : mirror;
}

/**
 * 认 `--gh-logs` 的输入：run id / PR 号（可带 `run:` / `pr:` 前缀或 GitHub URL）。
 *
 * @param {unknown} raw 命令行上那一个 token
 * @returns {{kind: "run", id: number} | {kind: "pr", number: number} | {kind: null, bad: string}} 目标
 */
export function parseGhLogsTarget(raw) {
  const text = String(raw ?? "").trim();
  if (text === "") {
    return { bad: "(缺 run id / PR 号)", kind: null };
  }
  const runPrefix = /^run:\s*#?(?<id>\d+)$/iu.exec(text);
  if (runPrefix) {
    return { id: Number(runPrefix.groups?.id), kind: "run" };
  }
  const prPrefix = /^pr:\s*#?(?<id>\d+)$/iu.exec(text);
  if (prPrefix) {
    return { kind: "pr", number: Number(prPrefix.groups?.id) };
  }
  const runUrl = /\/actions\/runs\/(?<id>\d+)(?:\/|\b)/u.exec(text);
  if (runUrl) {
    return { id: Number(runUrl.groups?.id), kind: "run" };
  }
  const prUrl = /\/pull\/(?<id>\d+)(?:\/|\b)/u.exec(text);
  if (prUrl) {
    return { kind: "pr", number: Number(prUrl.groups?.id) };
  }
  if (/^\d+$/.test(text)) {
    const n = Number(text);
    if (n >= GH_RUN_ID_MIN) {
      return { id: n, kind: "run" };
    }
    if (n >= 2) {
      return { kind: "pr", number: n };
    }
  }
  return { bad: text, kind: null };
}

/**
 * 单条 run 的 API / 网页 URL。
 *
 * @param {string} repo `owner/repo`
 * @param {number | string} runId run id
 * @returns {string} URL
 */
export function ghRunApiUrl(repo, runId) {
  return `https://api.github.com/repos/${repo}/actions/runs/${String(runId)}`;
}

/**
 * @param {string} repo `owner/repo`
 * @param {number | string} runId run id
 * @returns {string} 网页 URL（人直接点开的那一条）
 */
export function ghRunHtmlUrl(repo, runId) {
  return `https://github.com/${repo}/actions/runs/${String(runId)}`;
}

/**
 * 这条 run 的标题是不是人点名的那个 PR。
 *
 * @param {unknown} run workflow_runs 里的一条
 * @param {number} number PR 号
 * @returns {boolean} true ⇒ 是本 PR 的 run
 */
export function matchesPrNumber(run, number) {
  const title = isRecord(run) ? String(run.display_title ?? "") : "";
  const hit = PR_TITLE_PREFIX.exec(title);
  return hit !== null && Number(hit.groups?.num) === number;
}

/**
 * 从触发表里挑这条 PR 的 run：**判红的优先**，同类里取最新；没有判红的就取最新一条。
 *
 * @param {Array<unknown>} runs workflow_runs 全表
 * @param {number} number PR 号
 * @returns {Record<string, unknown> | null} 挑中的 run
 */
export function selectRunForPr(runs, number) {
  /** @type {Record<string, unknown>[]} */
  const mine = [];
  for (const run of runs) {
    if (isRecord(run) && matchesPrNumber(run, number)) {
      mine.push(run);
    }
  }
  if (mine.length === 0) {
    return null;
  }
  const red = mine.filter((run) => RED_RUN_CONCLUSIONS.has(String(run.conclusion)));
  const pool = red.length > 0 ? red : mine;
  /** @param {unknown} run 一条 @returns {number} 排序用的 id */
  const idOf = (run) => (isRecord(run) ? Number(run.id ?? 0) : 0);
  return [...pool].sort((a, b) => idOf(b) - idOf(a))[0] ?? null;
}

/**
 * 把一段失败窗口压进台面预算：**尾部为主**，并给出 head/tail 标记与准确省略行数。
 *
 * 与 CI 那一份的 `capStageWindow` 不同：这里不猜「读者想要哪一半」，而是明确告诉
 * 读者「原文多少行、这里示 head 多少 + tail 多少、省略了多少」。单行超长时压这一行
 * 本身（不改变行数口径）。
 *
 * @param {string[]} lines 失败窗口原文
 * @param {number} [maxBytes] 台面预算
 * @returns {{head: string[], tail: string[], headLines: number, tailLines: number, omittedLines: number, shownLines: number, totalLines: number, totalBytes: number, maxBytes: number, truncated: boolean, longLineTrimmed: boolean}} 可打印窗口
 */
export function shipFailureWindow(lines, maxBytes = SHIP_WINDOW_MAX_BYTES) {
  const all = Array.isArray(lines) ? lines : [];
  const totalLines = all.length;
  const totalBytes = Buffer.byteLength(all.join("\n"), "utf8");
  if (totalBytes <= maxBytes) {
    return {
      head: [...all],
      headLines: totalLines,
      longLineTrimmed: false,
      maxBytes,
      omittedLines: 0,
      shownLines: totalLines,
      tail: [],
      tailLines: 0,
      totalBytes,
      totalLines,
      truncated: false,
    };
  }
  let head = all.slice(0, SHIP_WINDOW_HEAD_LINES);
  let tail = all.slice(-SHIP_WINDOW_TAIL_LINES);
  let omittedLines = totalLines - head.length - tail.length;
  let longLineTrimmed = false;
  /** @returns {number} 当前可打印正文的字节数 */
  const bytesOf = () => Buffer.byteLength([...head, ...tail].join("\n"), "utf8");
  /* 先让头部让位（尾部才是真因），不够再让尾部；两组都空时压最后一行。 */
  while (bytesOf() > maxBytes && head.length > 0) {
    head = head.slice(0, -1);
    omittedLines += 1;
  }
  while (bytesOf() > maxBytes && tail.length > 1) {
    tail = tail.slice(1);
    omittedLines += 1;
  }
  if (bytesOf() > maxBytes && tail.length === 1) {
    let last = String(tail[0] ?? "");
    while (last.length > 0 && Buffer.byteLength([...head, last].join("\n"), "utf8") > maxBytes) {
      last = last.slice(0, Math.max(0, last.length - 400));
    }
    tail = [`${last}…（本行已截短）`];
    longLineTrimmed = true;
  }
  return {
    head,
    headLines: head.length,
    longLineTrimmed,
    maxBytes,
    omittedLines,
    shownLines: head.length + tail.length,
    tail,
    tailLines: tail.length,
    totalBytes,
    totalLines,
    truncated: true,
  };
}

/**
 * 一个失败名字属于哪一侧（step 名优先，其次 job 名）。
 *
 * @param {string} name 失败 step / job 名
 * @returns {"content" | "environment" | "unknown"} 侧别
 */
export function classifyFailureName(name) {
  const text = String(name ?? "");
  /* 准备步骤先判：`Checkout` 也含 `check`，若先跑判据词会被误归为内容判据。 */
  if (ENV_NAME.some((re) => re.test(text))) {
    return "environment";
  }
  if (CONTENT_NAME.some((re) => re.test(text))) {
    return "content";
  }
  return "unknown";
}

/**
 * 把若干失败读数的侧别收成一行结论（内容判据 / 环境侧 / 混合 / 未判定）。
 *
 * @param {Array<{name: string, kind: "content" | "environment" | "unknown"}>} failures 失败读数
 * @returns {string} 一行结论正文
 */
export function classifyFailureOrigin(failures) {
  const list = Array.isArray(failures) ? failures : [];
  const kinds = new Set(list.map((item) => item.kind));
  const first =
    list.find((item) => item.kind !== "unknown")?.name ?? list[0]?.name ?? "(无名 step)";
  if (kinds.has("content") && kinds.has("environment")) {
    return `混合（既有环境侧也有内容判据；首个失败点名「${first}」）`;
  }
  if (kinds.has("content")) {
    return `内容判据（失败在判据步骤「${first}」—— 本轮改动要过的那一格没过去）`;
  }
  if (kinds.has("environment")) {
    return `环境侧（失败在准备步骤「${first}」—— 判据可能还没跑到）`;
  }
  return `未判定（失败步骤「${first}」不在已知环境 / 判据清单，按原日志判断）`;
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
    log(
      `[ship] GH 日志回读：${what}取不到（HTTP ${String(res.status)}，令牌缺 actions: read）—— 缺的只是日志`,
    );
    return;
  }
  if (res.kind === "http") {
    const hint = res.status === 404 ? "（run / job 不在，或日志已过期）" : "";
    log(`[ship] GH 日志回读：${what}取不到（HTTP ${String(res.status)}${hint}）—— 缺的只是日志`);
    return;
  }
  log(
    `[ship] GH 日志回读：${what}取不到（网络没通：${String(res.error ?? "未知")}）—— 缺的只是日志`,
  );
}

/**
 * 全量日志落盘：先清空上一次（单 run 只留一份），再写这一份；返回**绝对路径**。
 *
 * @param {string} text 已脱敏的全量正文
 * @param {number | string} runId run id（文件名里只用数字）
 * @param {string} [dir] 落点目录
 * @returns {string} 绝对路径
 */
export function writeGhLogsFile(text, runId, dir = GH_LOGS_DIR) {
  fs.rmSync(dir, { force: true, recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `run-${String(runId).replaceAll(/[^0-9A-Za-z_-]/gu, "_")}.log`);
  fs.writeFileSync(file, text, "utf8");
  return path.resolve(file);
}

/**
 * 把失败窗口排版成屏幕上的那几行（带 head / tail 标记与准确省略行数）。
 *
 * @param {string} label 窗口标题（job / step）
 * @param {ReturnType<typeof shipFailureWindow>} win 窗口
 * @returns {string[]} 行
 */
export function renderFailureWindow(label, win) {
  const out = [
    `[ship]   ── ${label}失败窗口（原文 ${String(win.totalLines)} 行 / ${String(win.totalBytes)} 字节；上限 ${String(win.maxBytes)} 字节）${win.truncated ? "【已截断】" : ""} 开始 ──`,
  ];
  if (win.truncated) {
    out.push(`[ship]   [head ${String(win.headLines)} 行]`);
    out.push(...win.head);
    out.push(
      `[ship]   …（已截断：省略 ${String(win.omittedLines)} 行；原文 ${String(win.totalLines)} 行，这里只示 head ${String(win.headLines)} + tail ${String(win.tailLines)}）…`,
    );
    out.push(`[ship]   [tail ${String(win.tailLines)} 行]`);
    out.push(...win.tail);
  } else {
    out.push(...win.head);
  }
  out.push(
    `[ship]   ── ${label}失败窗口结束（${win.truncated ? `已截断：省略 ${String(win.omittedLines)} 行` : "未截断"}${win.longLineTrimmed ? "；末行超长已截短" : ""}）──`,
  );
  return out;
}

/**
 * 真身回读：**永不抛异常、永不改三态**（输入认不出时退 2，那是用法错误）。
 *
 * @param {{
 *   input: string,
 *   repo: string | null,
 *   env?: Record<string, string | undefined>,
 *   log: (line: string) => void,
 *   fetchImpl?: typeof fetch,
 *   sleep?: (ms: number) => void | Promise<void>,
 *   dryRun?: boolean,
 *   windowMaxBytes?: number,
 *   dir?: string,
 * }} io 注入面
 * @returns {Promise<number>} 退码（只在「输入认不出」时是 2）
 */
export async function runGhLogs(io) {
  const env = io.env ?? {};
  const log = io.log;
  const token = resolveGhToken(env);
  if (token === "") {
    log("[ship] 未设置令牌 ⇒ 跳过 GH 日志回读（GITHUB_MIRROR_TOKEN / GITHUB_TOKEN）");
    return CODE.GREEN;
  }
  const target = parseGhLogsTarget(io.input);
  if (target.kind === null) {
    log(
      `[ship] [ERROR] --gh-logs 收的是 run id 或 PR 号（可写 run:4242 / pr:3195），这里认不出：「${String(target.bad)}」`,
    );
    return CODE.NOT_RUN;
  }
  if (!io.repo) {
    log("[ship] GH 日志回读：取不到仓库 slug ⇒ 跳过（缺的只是日志）");
    return CODE.GREEN;
  }
  if (io.dryRun) {
    log(
      `[ship] --dry-run：将回读 GH run（${target.kind === "run" ? `run:${String(target.id)}` : `pr:${String(target.number)}`}），一条网络都不发。`,
    );
    return CODE.GREEN;
  }
  const fetchImpl = io.fetchImpl ?? globalThis.fetch;
  const sleep = io.sleep ?? (() => Promise.resolve());
  /**
   * @param {number} ms 毫秒
   * @returns {Promise<void>} 等到点
   */
  const reqSleep = async (ms) => {
    await sleep(ms);
  };
  const reqIo = { fetchImpl, log, sleep: reqSleep, token };
  try {
    let run = null;
    if (target.kind === "run") {
      const res = await requestJson(reqIo, ghRunApiUrl(io.repo, target.id), "run");
      if (!res.ok) {
        noteReadFailure(log, "run", res);
        return CODE.GREEN;
      }
      run = isRecord(res.body) ? res.body : null;
      if (run === null) {
        log("[ship] GH 日志回读：run 回话不是对象 ⇒ 跳过（缺的只是日志）");
        return CODE.GREEN;
      }
    } else {
      const res = await requestJson(reqIo, workflowRunsUrl(io.repo), "runs 列表");
      if (!res.ok) {
        noteReadFailure(log, "runs 列表", res);
        return CODE.GREEN;
      }
      const runs = asList(isRecord(res.body) ? res.body.workflow_runs : null);
      run = selectRunForPr(runs, target.number);
      if (run === null) {
        log(
          `[ship] GH 日志回读：触发表里没有 PR #${String(target.number)} 的 run（最近 ${String(runs.length)} 条 repository_dispatch）—— 缺的只是日志`,
        );
        return CODE.GREEN;
      }
    }
    const runId = String(run.id ?? "?");
    const conclusion = String(run.conclusion ?? run.status ?? "?");
    const title = String(run.display_title ?? "");
    const url = String(run.html_url ?? ghRunHtmlUrl(io.repo, runId));
    log(
      `[ship] GH run #${runId}（conclusion=${conclusion}）${title === "" ? "" : `「${title}」`}：${url}`,
    );
    if (!RED_RUN_CONCLUSIONS.has(conclusion)) {
      log(`[ship] 该 run 不是红的 ⇒ 没有失败 job 要回读（conclusion=${conclusion}）。`);
      return CODE.GREEN;
    }
    if (run.id === undefined || run.id === null) {
      log("[ship] run 回话里没有 id ⇒ 跳过 job 日志（只回读 conclusion）");
      return CODE.GREEN;
    }
    const jobsRes = await requestJson(reqIo, runJobsUrl(io.repo, runId), "job 列表");
    if (!jobsRes.ok) {
      noteReadFailure(log, "job 列表", jobsRes);
      return CODE.GREEN;
    }
    const jobs = asList(isRecord(jobsRes.body) ? jobsRes.body.jobs : null);
    if (jobs.length === 0) {
      log("[ship] job 列表读到了但为空（0 个 job）—— 与「取不到」不是同一形");
      return CODE.GREEN;
    }
    const failed = jobs.filter(
      (job) =>
        isRecord(job) &&
        RED_RUN_CONCLUSIONS.has(String(job.conclusion)) &&
        job.conclusion !== "skipped",
    );
    if (failed.length === 0) {
      log(
        `[ship] 这条 run 的 ${String(jobs.length)} 个 job 里没有失败项（日志无对象）—— conclusion=${conclusion}`,
      );
      return CODE.GREEN;
    }
    const archive = [
      "# ship GH 失败日志回读（全量正文，已脱敏）",
      `# run ${runId} / conclusion=${conclusion} / ${url}`,
      `# 单 job 文件上限 ${String(JOB_LOG_FILE_MAX_BYTES / 1024 / 1024)} MB`,
    ];
    let archiveFiles = 0;
    let archiveBytes = 0;
    /** @type {Array<{name: string, kind: "content" | "environment" | "unknown"}>} */
    const failureReadings = [];
    for (const job of failed) {
      if (!isRecord(job)) {
        continue;
      }
      const jobName = String(job.name ?? "(未命名 job)");
      log(`[ship] ✗ job「${jobName}」（${String(job.conclusion)}）`);
      const failedSteps = asList(job.steps).filter(
        (step) => isRecord(step) && RED_RUN_CONCLUSIONS.has(String(step.conclusion)),
      );
      /** @type {string[]} */
      const stepNames = [];
      if (failedSteps.length === 0) {
        log("[ship]   失败 step：回话里没有失败的 steps 读数（只回读 job 结论）");
      }
      for (const step of failedSteps) {
        if (!isRecord(step)) {
          continue;
        }
        const stepName = String(step.name ?? "(未命名 step)");
        stepNames.push(stepName);
        log(
          `[ship]   失败 step #${String(step.number ?? "?")}「${stepName}」（${String(step.conclusion)}）`,
        );
      }
      const originNames = stepNames.length > 0 ? stepNames : [jobName];
      for (const name of originNames) {
        failureReadings.push({ kind: classifyFailureName(name), name });
      }
      if (job.id === undefined || job.id === null) {
        log(`[ship]   job「${jobName}」没有 id ⇒ 跳过日志（只回读 conclusion）`);
        continue;
      }
      // oxlint-disable-next-line no-await-in-loop -- 逐个 job 串行取日志：并行会打乱屏幕顺序，也更容易撞 GitHub 限流
      const logRes = await requestText(
        reqIo,
        jobLogUrl(io.repo, String(job.id)),
        `job「${jobName}」日志`,
      );
      if (!logRes.ok) {
        noteReadFailure(log, `job「${jobName}」日志`, logRes);
        continue;
      }
      if (logRes.text.trim() === "") {
        log(`[ship]   job「${jobName}」日志取到了但为空（0 行）—— 与「取不到」不是同一形`);
        continue;
      }
      const clean = redactSecrets(logRes.text, token);
      const raw = extractFailureWindow(clean);
      if (raw.errors.length === 0) {
        log("[ship]   失败注解：没有 ##[error] 行（日志里没有注解）");
      } else {
        log(`[ship]   失败注解（共 ${String(raw.errors.length)} 条）：`);
        for (const line of raw.errors) {
          log(`[ship]     ${line}`);
        }
      }
      const win = shipFailureWindow(raw.lines, io.windowMaxBytes ?? SHIP_WINDOW_MAX_BYTES);
      for (const line of renderFailureWindow(`job「${jobName}」`, win)) {
        log(line);
      }
      const cut = truncateJobLog(clean, JOB_LOG_FILE_MAX_BYTES);
      archiveBytes += cut.bytes;
      archiveFiles += 1;
      archive.push(
        "",
        `== run ${runId} / job「${jobName}」（${String(job.conclusion)}）==`,
        cut.truncated
          ? `# 已截到 ${String(cut.shownLines)} 行 / 上限 ${String(JOB_LOG_FILE_MAX_BYTES)} 字节（原始 ${String(cut.totalLines)} 行 / ${String(cut.bytes)} 字节）`
          : `# ${String(cut.totalLines)} 行 / ${String(cut.bytes)} 字节`,
        cut.text,
      );
    }
    if (archiveFiles === 0) {
      log("[ship] 没有取到任何 job 日志正文 —— 不落盘（缺的只是日志）");
    } else {
      const absPath = writeGhLogsFile(archive.join("\n"), runId, io.dir ?? GH_LOGS_DIR);
      log(
        `[ship] 全量日志已落盘：${absPath}（${String(archiveFiles)} 份 job / ${String(archiveBytes)} 字节）`,
      );
      log(`[ship] 清理提示：删掉 ${path.dirname(absPath)} 即可（系统临时目录，不进仓库）`);
    }
    log(`[ship] 结论：${classifyFailureOrigin(failureReadings)}`);
    return CODE.GREEN;
  } catch (error) {
    /* 这一格只加读数：任何意外都折成一行脱敏读数，绝不改变调用方的退码。 */
    log(`[ship] GH 日志回读出现异常（不改三态）：${redactSecrets(String(error), token)}`);
    return CODE.GREEN;
  }
}

/**
 * auto 触发：ship 轮询读到 build 红时，按 PR 号做一次日志回读。
 *
 * 「blocked 里的失败项」也在这一格里：CNB 把 GA 判红折算成 build 红，下游被阻塞的
 * job 在同一批 `failed` 读数里出现，不另开第二个入口。
 *
 * @param {Omit<Parameters<typeof runGhLogs>[0], "input"> & {number: number, buildState: string}} io 注入面
 * @returns {Promise<void>} 到点兑现（不参与退码）
 */
export async function runGhLogsOnRed(io) {
  if (io.buildState !== "red") {
    return;
  }
  await runGhLogs({ ...io, input: `pr:${String(io.number)}` });
}
