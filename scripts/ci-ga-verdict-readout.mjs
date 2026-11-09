#!/usr/bin/env node
/**
 * `ci-ga-verdict-readout.mjs` —— PR 主列末尾的**承重回读格**（ISSUE #3378 转正）。
 *
 * ## 它替掉的是哪一段
 *
 * 旧 `GitHub 判决回读` 在自托管机上出站轮询 `api.github.com` 的 Actions
 * conclusion（45m 预算），再把几十 MB 日志压成分块打印，最后由
 * `GitHub 判决判定` 折成退码。自托管机到 github.com 的出网间歇不通，而
 * 托管机稳 —— 这一格把「CNB 出站去拉 GitHub 结论」换成「**站内读 GA 送回来的
 * 结论**」：读的是 `GET /{repo}/-/pulls/{n}/commit-statuses`，api.cnb.cool，
 * 与 `GitHub 镜像同步` 那格 `cnb pulls get-pull` 回读同一枚平台注入的
 * `CNB_TOKEN`、同一套站内链路。`ci-github-verdict-*` 那一族出站轮询与日志脚本
 * 保留在盘上，供 `pnpm ship --gh-logs` 按需复验与快速回退，不再在 PR 上跑。
 *
 * ## 数据源只有一个
 *
 * GA `pr-gate.yml` 的收尾 job（`if: always()`）用 `CNB_TRIGGER_TOKEN` 起一条
 * `api_trigger_ga_verdict` 短 build，把 `conclusion` 折成 `GA_VERDICT` 送回；
 * 平台把那条 build 的终态写进**本 PR 预合并 sha** 的 commit-statuses，context
 * 前缀 `cnb/api_trigger_ga_verdict/`。本格只认这一条 context 的**终态**：
 * success ⇒ 绿、failure/error ⇒ 红、pending/running ⇒ 还没判完、缺席/超时 ⇒
 * 没判过（fail-closed）。`cnb/pull_request/*` 那条 context 是**自己这一跑**，
 * 不能拿它给自己作证（自指面），聚合也不读它。
 *
 * ## fail-closed 三态
 *
 * 0 = 读到明确绿；1 = 读到明确红；2 = 没判过（前提不全 / 平台没回 / 到预算
 * 仍 pending 或 status 缺席）。2 与 1 一样折成流水线红，绝不让「GA 没送回来」
 * 被读成绿；占位腿因此不需要 —— 主列这条 build 自己活到出结论，超时即红。
 *
 * ## 判红时那条「错误日志怎么取」的指针
 *
 * 本格只回读 GA 送回的**结论**（commit-statuses），日志里没有失败 job 的正文。
 * 判红时看日志的人/AI 最容易卡在「看了这几行，不知道真正的错误日志去哪找」：
 * 正文由 GA 收尾 job 搬到 CNB（附件 + PR 评论/描述镜像，§13.5.33.4/.6），
 * 本地取回入口是 `pnpm ship --gh-logs pr:<号>`。于是明确判红（code=1）那一眼
 * 多打几行只读提示，把这条入口念出来。绿 / 没判过都不打，避免「没判过」被读成
 * 「有日志可取」；不改三态、不改退码、不发网络请求，`--json` 仍只给一行机器读数。
 *
 * ## 用法
 *
 * ```text
 * node scripts/ci-ga-verdict-readout.mjs --pr <IID> --repo <slug> \
 *   [--budget-ms <毫秒>] [--poll-ms <毫秒>] [--json] [--dry-run]
 * ```
 *
 * 令牌取 `CNB_TOKEN`（平台注入）或 `CNB_TRIGGER_TOKEN`。PR 号 / 仓库 slug
 * 从平台注入的 `CNB_PULL_REQUEST_IID` / `CNB_REPO_SLUG` 兜底。
 */
import path from "node:path";
import process from "node:process";

import { CODE } from "./ci-github-mirror-push.mjs";
import { readOption } from "./ci-ga-verdict-callback.mjs";

/** 回调/占位共用的 context 前缀（与 `CALLBACK_EVENT` 同源）。 */
export const STATUS_PREFIX = "cnb/api_trigger_ga_verdict";

/** CNB OpenAPI 的缺省服务地址。 */
export const DEFAULT_API_ENDPOINT = "https://api.cnb.cool";

/** 站内短轮询的缺省预算（GA 判据跑完通常远小于它；超时即「没判过」）。 */
export const DEFAULT_BUDGET_MS = 45 * 60 * 1000;

/** 两眼之间的间隔。 */
export const DEFAULT_POLL_MS = 20 * 1000;

/** 明确终态词：绿一档、红一档，其余都算「还没判完」。 */
const GREEN_STATES = new Set(["success"]);
const RED_STATES = new Set(["failure", "error"]);

/**
 * 一次 HTTP 读数的最小形状（注入面用）。
 *
 * @typedef {{ok: boolean, status: number, json: () => Promise<any>}} FetchResponse
 * @typedef {(url: string, init: {headers: Record<string, string>}) => Promise<FetchResponse>} FetchLike
 */

/**
 * 是能按键取值的对象吗（不做类型断言）。
 *
 * @param {unknown} value 任意值
 * @returns {value is Record<string, unknown>} true ⇒ 可按键取值
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 从一个可能不是对象的值里按字符串键取值（不做类型断言）。
 *
 * @param {unknown} value 任意值
 * @param {string} key 键名
 * @returns {unknown} 值；取不到时 undefined
 */
function field(value, key) {
  return isRecord(value) ? value[key] : undefined;
}

/**
 * 从 `ListPullCommitStatuses` 的应答里取本族 context 的**最后一条终态**。
 *
 * 同一条 context 平台按「后写覆盖前写」收（探针 `cnb-edc-1k6subhok` 一族）；
 * 多条并存时取 `updated_at` 最新的那条，不按数组顺序猜。非终态（pending /
 * running）也算一条读数，由调用方继续等。
 *
 * @param {unknown} payload 平台应答（数组 / `{data:[]}` / `{data:{statuses:[]}}`）
 * @returns {{present: boolean, state: string, context: string}}
 */
export function readCallbackStatus(payload) {
  const data = field(payload, "data");
  const raw =
    [payload, data, field(data, "statuses"), field(payload, "statuses")].find((candidate) =>
      Array.isArray(candidate),
    ) ?? [];
  const ours = raw.filter((item) => {
    const context = String(field(item, "context") ?? "");
    return context.startsWith(STATUS_PREFIX);
  });
  if (ours.length === 0) {
    return { context: "", present: false, state: "" };
  }
  let latest = ours[0];
  let latestAt = String(field(latest, "updated_at") ?? field(latest, "created_at") ?? "");
  for (const item of ours.slice(1)) {
    const at = String(field(item, "updated_at") ?? field(item, "created_at") ?? "");
    if (at >= latestAt) {
      latest = item;
      latestAt = at;
    }
  }
  return {
    context: String(field(latest, "context") ?? ""),
    present: true,
    state: String(field(latest, "state") ?? field(latest, "status") ?? "").toLowerCase(),
  };
}

/**
 * 把一条读数折成三态（绿 / 红 / 还没判完）。
 *
 * @param {{present: boolean, state: string}} status 本族读数
 * @returns {number} 0 绿 / 1 红 / 2 还没判完或没判过
 */
export function verdictFromStatus(status) {
  if (!status.present) {
    return CODE.NO_FACT;
  }
  if (GREEN_STATES.has(status.state)) {
    return CODE.OK;
  }
  if (RED_STATES.has(status.state)) {
    return CODE.FAIL;
  }
  return CODE.NO_FACT;
}

/**
 * 判红那一眼补的人读提示：本格只读 GA 结论，失败 job 的日志正文怎么取。
 *
 * 日志正文由 GA 收尾 job 搬到 CNB（附件 + PR 评论/描述镜像），本地取回入口是
 * `pnpm ship --gh-logs pr:<号>`（站内读、无需出站 github.com）。提示只在**明确判红**
 * 时打（绿 / 没判过都不打），且只读：不改三态、不改退码、不发网络请求。命令形状与
 * `ci-ga-logs-relay.mjs` 评论/描述里那条同源，由用例逐字对账，别两处各写一份形状。
 *
 * @param {string} pr PR 号（IID；前提齐全时必是数字串）
 * @returns {string[]} 逐行日志（每行自带 `[ga-readout]` 前缀）
 */
export function errorLogsHint(pr) {
  return [
    "[ga-readout] 判红了：本格只站内回读 GA 送回的结论（commit-statuses），这里没有失败 job 的日志正文。",
    `[ga-readout] 错误日志怎么取：\`pnpm ship --gh-logs pr:${pr}\`（优先从 CNB 站内读判红日志附件，无需出站 github.com，也不需要 GitHub 令牌）。`,
    "[ga-readout] 同一份附件链也挂在本 PR 的评论与描述里，可直接点开；CNB 侧缺席会如实念一行并退回 GitHub 链路。",
  ];
}

/**
 * 主流程：站内短轮询，直到拿到终态或预算到顶。
 *
 * @param {{argv?: string[], env?: Record<string, string | undefined>, fetchImpl?: FetchLike, now?: () => number, sleep?: (ms: number) => void | Promise<void>, log?: (line: string) => void}} io
 * @returns {Promise<number>} 0 绿 / 1 红 / 2 没判过
 */
export async function main(io = {}) {
  const argv = io.argv ?? process.argv.slice(2);
  const env = io.env ?? process.env;
  const log =
    io.log ??
    ((line) => {
      console.log(line);
    });
  const now = io.now ?? (() => Date.now());
  const sleep = io.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const fetchImpl = io.fetchImpl ?? fetch;
  const pr = (readOption(argv, "--pr") || env.CNB_PULL_REQUEST_IID || "").trim();
  const repo = (readOption(argv, "--repo") || env.CNB_REPO_SLUG || "").trim();
  const token = (env.CNB_TOKEN || env.CNB_TRIGGER_TOKEN || "").trim();
  const endpoint = (env.CNB_API_ENDPOINT || DEFAULT_API_ENDPOINT).replace(/\/+$/, "");
  const budgetRaw = Number(readOption(argv, "--budget-ms") || DEFAULT_BUDGET_MS);
  const pollRaw = Number(readOption(argv, "--poll-ms") || DEFAULT_POLL_MS);
  const budgetMs = Number.isFinite(budgetRaw) && budgetRaw > 0 ? budgetRaw : DEFAULT_BUDGET_MS;
  const pollMs = Number.isFinite(pollRaw) && pollRaw > 0 ? pollRaw : DEFAULT_POLL_MS;
  const json = argv.includes("--json");
  const reasons = [];
  if (!/^\d+$/.test(pr)) {
    reasons.push("PR 编号缺席（--pr / CNB_PULL_REQUEST_IID）");
  }
  if (!repo) {
    reasons.push("仓库 slug 缺席（--repo / CNB_REPO_SLUG）");
  }
  if (!token) {
    reasons.push("令牌缺席（CNB_TOKEN / CNB_TRIGGER_TOKEN）");
  }
  if (reasons.length > 0) {
    for (const reason of reasons) {
      log(`[ga-readout] 前提不成立：${reason}`);
    }
    return CODE.NO_FACT;
  }
  const url = `${endpoint}/${repo}/-/pulls/${pr}/commit-statuses`;
  if (argv.includes("--dry-run")) {
    log(`[ga-readout] DRY-RUN：GET ${url}`);
    return CODE.NO_FACT;
  }
  const deadline = now() + budgetMs;
  let lastState;
  let lastPresent;
  for (;;) {
    let response;
    try {
      // oxlint-disable-next-line no-await-in-loop -- 轮询本就是串行等待，并行没有意义
      response = await fetchImpl(url, {
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      });
    } catch (error) {
      log(`[ga-readout] 请求没发出去：${String(error)}`);
      return CODE.NO_FACT;
    }
    if (!response.ok) {
      log(`[ga-readout] 平台回 ${response.status} ⇒ 没取到读数`);
      return CODE.NO_FACT;
    }
    let payload;
    try {
      // oxlint-disable-next-line no-await-in-loop -- 轮询本就是串行等待，并行没有意义
      payload = await response.json();
    } catch {
      log("[ga-readout] 应答不是 JSON ⇒ 没取到读数");
      return CODE.NO_FACT;
    }
    const status = readCallbackStatus(payload);
    lastPresent = status.present;
    lastState = status.state;
    const code = verdictFromStatus(status);
    if (code !== CODE.NO_FACT || now() >= deadline) {
      const line = status.present
        ? `[ga-readout] ${STATUS_PREFIX}：state=${status.state || "(空)"} ⇒ ${code === CODE.OK ? "绿" : code === CODE.FAIL ? "红" : "还没判完"}`
        : `[ga-readout] ${STATUS_PREFIX}：status 缺席 ⇒ GA 还没送回结论`;
      log(json ? JSON.stringify({ code, state: lastState, present: lastPresent }) : line);
      if (!json && code === CODE.FAIL) {
        for (const hint of errorLogsHint(pr)) {
          log(hint);
        }
      }
      return code;
    }
    log(`[ga-readout] ${STATUS_PREFIX}：state=${status.state || "(空)"}（未终态），继续等`);
    // oxlint-disable-next-line no-await-in-loop -- 轮询本就是串行等待，并行没有意义
    await sleep(Math.min(pollMs, Math.max(0, deadline - now())));
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (invokedDirectly) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`[ga-readout] 没判过：${String(error)}`);
      process.exitCode = CODE.NO_FACT;
    },
  );
}
