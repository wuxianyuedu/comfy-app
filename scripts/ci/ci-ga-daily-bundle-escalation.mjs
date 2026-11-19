/**
 * `ci-ga-daily-bundle-escalation.mjs` —— GA 每日档失败立案里的「预算账陈旧度触发器」（ISSUE #2639 的 GA 落点）。
 *
 * ## 为什么有两份取数链（一份判定层）
 *
 * 每日档 2026-11-10 起整体迁 GA（#3504 / #3515），失败立案随之从 CNB 的
 * `ci-daily-bundle-escalation.mjs` 挪到 `ci-ga-daily-failure-issue.mjs`；#2783 落地时的
 * 触发器留在 CNB 侧，于是 GA 这一档的预算账触发器一直没有执行者（#2639 一直开着，且
 * 开着的理由成立：每日失败立案的判据链一个字都没动，只是换了平台）。这一份补 GA 侧：
 * **判定层**（判决行解析 / 门限 / 正文拼装）与 CNB 侧共用 `ci-bundle-escalation-core.mjs`，
 * 这里只留 GA 取数链 —— workflow_runs 列表 + job 日志，全走 HTTP。
 *
 * ## 约束（GA `daily-failure-issue` job 的硬前提）
 *
 * 整条 import 链只吃 `node:*`（job 里不 `pnpm install`）：本模块 import 的都是
 * 同仓纯模块 —— `ci-bundle-escalation-core.mjs`（零本仓 import）、`ci-ga-failure-logs.mjs`
 * 的 `failedJobsFromJson`、`ci-github-verdict-logs.mjs` 的两个 URL 构造、`ci-github-verdict-request.mjs`
 * 的读一跳。**任何人往这里加本仓依赖之外的 import 都会让立案脚本在 import 期崩掉**
 * （`continue-on-error: true` 吞成静默绿，正是 #3563 要治的那一形）。
 *
 * ## 三态（与 CNB 侧同口径）
 *
 * 数字 = 逐日回看确认的连续天数；`"unknown"` = 读不出（**不是 0**）。读不出的形态各给一句：
 * runs 列表取不到 / 上一跑不在 completed runs 里 / 某一跑不是 success/failure 之一 /
 * job 日志取不到 / 预算闸读数认不出。中间断一天则如实截断到断点为止。
 *
 * ## 每天的判法
 *
 * `daily.yml` 的触发有两个事件（`schedule` 定时 / `workflow_dispatch` 手点与 CNB 派发），
 * 两个都算「每日那一跑」—— 手点验的是同一份判据，把它排除掉等于把手动复验的那一跑
 * 从「连续红」数里抹掉。顶层 conclusion：
 *   · `failure` ⇒ 深挖（jobs → 失败 job 日志 → 判决行），与 CNB 侧同一套判读；
 *   · `success`（含 `neutral` / `skipped`）⇒ 连续在这里断，返回已数的天数；
 *   · 其余（`cancelled` 等）⇒ `unknown`，不构成结论。
 * 当前跑的正文直接复用立案那一跳已取到的 `known.text`（同一份脱敏正文），不发第二遍日志请求。
 */
import { BUNDLE_GATE_RED_STREAK_DAYS, readBundleAccount } from "./ci-bundle-escalation-core.mjs";
import { failedJobsFromJson } from "./ci-ga-failure-logs.mjs";
import { jobLogUrl, runJobsUrl } from "./ci-github-verdict-logs.mjs";
import { requestJson, requestText } from "./ci-github-verdict-request.mjs";

/**
 * 每日档 runs 列表 URL：`Daily (mirror)` 的全部 completed runs（不分事件）。
 *
 * 不按 `?event=` 收窄：`schedule` 与 `workflow_dispatch` 都是「每日那一跑」
 * （见文件头「每天的判法」）。`per_page` 由调用方按门限天数传（`need * 3 + 3`），
 * 避免把历史跑全拉下来。
 *
 * @param {string} repo `owner/repo`
 * @param {number} perPage 每页条数
 * @returns {string} API URL
 */
export function dailyRunsUrl(repo, perPage) {
  return `https://api.github.com/repos/${repo}/actions/workflows/daily.yml/runs?per_page=${String(perPage)}`;
}

/** ANSI 转义剥离：写不出原始控制字符（`no-control-regex` 连转义写法也拦），拼出来。 */
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");

/**
 * 把 job 日志正文剥成纯文本：GitHub 的 job 日志里混着 ANSI 转义，与判据那边
 * 「正文已剥 ANSI」的口径对齐（`normalizeStageContent` 同一形）。**只剥、不脱敏**：
 * 这一跳的正文不进单、不进日志，脱敏由立案那一跳（`collectFailedJobLogs`）负责。
 *
 * @param {string | null | undefined} text 原始日志
 * @returns {string} 剥过 ANSI 的正文
 */
export function stripAnsi(text) {
  return String(text ?? "")
    .replaceAll(ANSI_ESCAPE, "")
    .replaceAll(/\r\n?/g, "\n");
}

/**
 * @param {unknown} value 任意值
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null;
}

/**
 * 把读数失败翻成一句人话（HTTP 状态 / 网络层），三种各念一句，不许混成「取不到」。
 *
 * @param {{kind?: string, status?: number, error?: string}} res 失败读数
 * @returns {string}
 */
function describeReadFailure(res) {
  if (res.kind === "auth") {
    return `令牌没权限（HTTP ${String(res.status ?? "?")}）`;
  }
  if (res.kind === "http") {
    return `HTTP ${String(res.status ?? "?")}`;
  }
  return `网络不通（${String(res.error ?? "未知")}）`;
}

/**
 * 「预算闸连续红了几天」—— GA 版（CNB 侧见 `ci-daily-bundle-escalation.mjs` 的
 * `fetchBundleRedStreak`）。当前跑的正文由调用方以 `known` 递进来（立案那一跳
 * 已经取过、脱敏过），历史跑逐跑回看：runs 列表 → 失败 job → job 日志 → 判决行。
 *
 * 三态：数字 = 逐日回看确认的连续天数；`"unknown"` = 读不出（**不是 0**）。
 *
 * @param {{ghRepo:string, ghToken:string, runId:string, need?:number,
 *   known?:{runId:string, text:string|null}|null,
 *   fetchImpl?:typeof fetch, sleep?:(ms:number)=>Promise<void>, log?:(s:string)=>void}} input
 * @returns {Promise<{days:number|"unknown", note:string}>}
 */
export async function fetchGaBundleRedStreak({
  ghRepo,
  ghToken,
  runId,
  need = BUNDLE_GATE_RED_STREAK_DAYS,
  known = null,
  fetchImpl = globalThis.fetch,
  sleep = async () => {},
  log = () => {},
}) {
  const reqIo = { fetchImpl, log, sleep, token: ghToken };
  const list = await requestJson(reqIo, dailyRunsUrl(ghRepo, need * 3 + 3), "每日档 runs 列表");
  if (!list.ok) {
    return { days: "unknown", note: `runs 列表取不到（${describeReadFailure(list)}）` };
  }
  const body = isRecord(list.body) ? list.body : null;
  const runs = Array.isArray(body?.workflow_runs) ? body.workflow_runs : null;
  if (!runs) {
    return { days: "unknown", note: "runs 列表应答不是预期形状（缺 workflow_runs 数组）" };
  }
  const completed = runs.filter((r) => isRecord(r) && String(r.status) === "completed");
  const at = completed.findIndex((r) => String(r.id ?? "") === String(runId));
  if (at === -1) {
    return { days: "unknown", note: `上一跑 ${runId} 不在 completed runs 列表里` };
  }
  let red = 0;
  let examined = 0;
  for (let i = at; i < completed.length && examined < need; i += 1) {
    const sn = String(completed[i]?.id ?? "");
    if (sn === "") {
      continue;
    }
    const conclusion = String(completed[i]?.conclusion ?? "");
    if (conclusion === "success" || conclusion === "neutral" || conclusion === "skipped") {
      return { days: red, note: `run ${sn} 没红（${conclusion}）⇒ 连续在这里断` };
    }
    if (conclusion !== "failure") {
      return {
        days: "unknown",
        note: `run ${sn} 的结论认不出（${conclusion === "" ? "空" : conclusion}）`,
      };
    }
    examined += 1;
    const reuse = known && String(known.runId) === sn ? known : null;
    /** @type {string | null} */
    let text = reuse && typeof reuse.text === "string" ? stripAnsi(reuse.text) : null;
    if (text === null) {
      /** @type {any} */
      // oxlint-disable-next-line no-await-in-loop -- 逐跑串行回看历史跑：并行会打乱「哪一跑算一天」的归属
      const jobs = await requestJson(reqIo, runJobsUrl(ghRepo, sn), `run ${sn} 的 job 列表`);
      if (!jobs.ok) {
        return {
          days: "unknown",
          note: `run ${sn} 的 job 列表取不到（${describeReadFailure(jobs)}）`,
        };
      }
      const listing = failedJobsFromJson(jobs.body);
      if (!listing.ok) {
        return { days: "unknown", note: `run ${sn} 的 job 清单应答认不出形状` };
      }
      const job = listing.jobs[0];
      if (!job || job.id === undefined || job.id === null) {
        return {
          days: "unknown",
          note: `run ${sn} 没有 conclusion=failure 的 job（不是红跑，或被重跑了）`,
        };
      }
      // oxlint-disable-next-line no-await-in-loop -- 逐跑串行回看 job 日志：并行同理，且每一跑的判决依赖上一跑的结论
      const logs = await requestText(
        reqIo,
        jobLogUrl(ghRepo, String(job.id)),
        `job「${job.name ?? "?"}」日志`,
      );
      if (!logs.ok) {
        return {
          days: "unknown",
          note: `run ${sn} 的 job 日志取不到（${describeReadFailure(logs)}）`,
        };
      }
      text = stripAnsi(logs.text);
    }
    const marker = readBundleAccount(text).marker;
    if (marker === "enforced") {
      red += 1;
      continue;
    }
    if (marker === "suspended" || marker === "none") {
      return { days: red, note: `run ${sn} 预算闸没有判红 ⇒ 连续在这里断` };
    }
    return { days: "unknown", note: `run ${sn} 的预算闸读数认不出` };
  }
  if (examined < need) {
    return {
      days: "unknown",
      note: `completed runs 只有 ${String(examined)} 跑（要 ${String(need)} 跑）`,
    };
  }
  return { days: red, note: `逐日回看 ${String(need)} 跑：${String(red)} 跑判红` };
}
