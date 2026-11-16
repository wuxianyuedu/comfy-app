#!/usr/bin/env node
/**
 * `ci-ga-verdict-callback.mjs` —— GA 跑完把结论**主动送回 CNB** 的那一跳（ISSUE #3378）。
 *
 * ## 它替掉的是哪一段
 *
 * 2026-11-08 转正（ISSUE #3378 / §13.5.33）后，旧 `GitHub 判决回读` 出站轮询
 * GitHub Actions conclusion（45m 预算）那一格已停用 —— 自托管机到 github.com 的
 * 出网间歇不通，正是本单要解的那一格。探针在 #3374 上验过：外部用
 * `repo-cnb-trigger:rw` 的令牌调 `POST /{repo}/-/build/start`，带
 * `event=api_trigger_ga_verdict`、`sha=<PR 预合并 sha>`、`env.GA_VERDICT=<结论>`、
 * `env.GA_CALLBACK_SHA=<同一个预合并 sha>`，平台把这条短流水线的终态自动写进
 * 该 sha 的 commit-statuses。CNB 侧
 * `GA 回调结论回读`（`ci-ga-verdict-readout.mjs`）站内读这条 status 折退码，
 * 于是「读回」变成「送回」，CNB 机器不必再出网去读 GitHub。
 *
 * ## 它跑在哪 / 不跑在哪
 *
 * 跑在 **GA runner**（`pr-gate.yml` 的收尾 job）：那里有仓库代码、有出网、有
 * `CNB_TRIGGER_TOKEN`。**不**跑在 CNB 的回调 build 上 —— 那条 build 带
 * `git.enable: false`（绑预合并 sha 必须关检出，否则 clone 服务只 fetch master、
 * `checkout` 直接 `fatal: reference is not a tree`），工作区里没有本文件，
 * 所以它的判定逻辑内联在 `.cnb.yml` 的 stage 里，不依赖仓库脚本。
 *
 * ## 承重的前提（写死在这里，不靠调用方记得）
 *
 * 1. **sha 必须是 PR 预合并 sha**：`client_payload.cnb_merge_sha`（镜像格从
 *    `CNB_PULL_REQUEST_MERGE_SHA` 带过来）。它不是 `head_sha`（本跑的合成 merge
 *    HEAD），也不是 base —— 绑错 sha 时状态落不到 PR 那张 statuses 集合里。
 *
 *    ⚠️ 这一枚**从 payload 里取，不走 workflow 的 `env`**（#3998 现场）：`pr-gate.yml`
 *    只给自动档写了 `github.event.client_payload.*`，按需档（`workflow_dispatch`）
 *    那一路展开成空串；而 GitHub 的 `||` 在**表达式语法**里短路、不是 shell 语义
 *    （${{ a || b }} 里 a 存在但为空串时**不会**回落到 b），于是「两条触发形态都读」
 *    这句话在自动档上是空转 —— 镜像格那一刻 `CNB_PULL_REQUEST_MERGE_SHA` 为空时，
 *    回调直接 premises 不成立、三态退 2，CNB 侧读到的是 status 缺席（那跑白等 70m）。
 *    所以 `GITHUB_EVENT_PATH` 那份 payload 是**唯一取值口**：`--sha` / `--pr` 仍是
 *    显式覆盖（手跑复验），环境变量保留给「payload 里没有这个键」的老形态。
 *    文件头第 3 条（payload 形状）与 `ci-mirror-payload.mjs` 的 `dispatchPayload` 同源。
 * 2. **回调与占位共用同一事件名** ⇒ 同一条 commit-status context，后写覆盖前写
 *    （探针 `cnb-edc-1k6subhok` 一族）。不同事件名 = 两条 context，占位的红会
 *    一直拉住聚合，回调的绿救不回来。
 * 3. **同 context 是「最后跑完者赢」**：转正后只有 callback 一个写者，共用
 *    `cancel-in-progress: true` 的锁只管「同 PR 连派发几次时后一条掐掉前一条」。
 *    骨架期那半个 `GA_ROLE=placeholder` 写者已退役，fail-closed 改由 CNB 侧
 *    `GA 回调结论回读` 自己承担（超时 / status 缺席即判红）。
 *
 * ## 退出码只表「送达」，不表「判了什么」
 *
 * 这一跳是**信使**：把 GA 的 conclusion 折成 `GA_VERDICT` 送进 CNB 回调 build，
 * 由那条 build 读 `GA_VERDICT` 独立折红/折绿并挂进 commit-statuses（承重在那边）。
 * 所以本脚本的退出码只回答「结论送没送到」，不回答「GA 判绿还是判红」：
 * 前提齐全 + 成功拿回 `sn` ⇒ `0`（送达成功），与 `verdict` 是 success 还是
 * failure 无关；`--dry-run` 同口径。两格仍按 fail-closed 退 `2`（没判过 ≠ 判过）：
 * 前提不全（sha / 结论 / 令牌 / 仓库缺席）、或起跑没拿回 `sn`（没发出去）——
 * 绝不把「没发出去」读成绿，也不把「GA 判红」读成「送达失败」。
 * 结论→`GA_VERDICT` 的折叠仍是 fail-closed：只认 success / neutral / skipped，
 * 其余（含 `cancelled` / `startup_failure` / 空串 / 未认得的词）一律折成 failure。
 *
 * GA 侧收尾 job 带 `continue-on-error: true`：这一跳是**送结论**，它自己发没
 * 发出去不该反过来改变 GA workflow run 的 conclusion。
 *
 * 用法（`pr-gate.yml` 的收尾 job）：
 *
 * ```text
 * node scripts/ci/ci-ga-verdict-callback.mjs \
 *   --sha <预合并 sha> --repo <slug> --pr <IID> [--conclusion <词>] [--dry-run]
 * ```
 *
 * `--conclusion` 不给时从 `GA_JOB_RESULTS`（逗号分隔的 `needs.*.result`）折：
 * 任一红/取消/超时 ⇒ failure，全 success/skipped ⇒ success。
 */
import path from "node:path";
import process from "node:process";

import { readFileSync } from "node:fs";

import { CODE } from "./ci-github-mirror-push.mjs";

/** 回调的 API 触发事件名，与 `.cnb.yml` 的 `api_trigger_ga_verdict` 逐字配对。 */
export const CALLBACK_EVENT = "api_trigger_ga_verdict";

/** 回调 build 读的那枚环境变量名（与 `.cnb.yml` 内联判定同源）。 */
export const VERDICT_ENV_KEY = "GA_VERDICT";

/** 回调 build 读的「本条 build 绑定到哪个 sha」环境变量名（与 `.cnb.yml` 内联日志同源）。 */
export const SHA_ENV_KEY = "GA_CALLBACK_SHA";

/**
 * PR 标题进 `env` 的那枚键名（`pr-gate.yml` 送、本脚本读，只作请求体 `title` 的来源）。
 *
 * 为什么不直接读 `GITHUB_EVENT_PATH`：`pull_request.title` 只在 `pull_request` 事件上
 * 存在，而按需档（`workflow_dispatch`，#3667）没有它 —— 两条触发形态共用一个取值口，
 * 才不会有「按需档的回调又变回无标题」这种只修一半的形态。
 */
export const TITLE_ENV_KEY = "GA_PR_TITLE";

/** 送进请求体 `title` 的长度上限（`dto.LogInfo.title` 没有说明长度，这里给个防呆值）。 */
const TITLE_MAX_LEN = 200;

/**
 * 把 PR 标题拼成 build 标题：`<PR 标题> (#<PR号>)`。
 *
 * 为什么带上号：平台 `GET /{repo}/-/build/logs?title=` 只判**关键字命中**，而两张 PR
 * 标题互为前缀是常事 —— 带上号之后「这张 PR 的几次回调」才筛得干净。
 *
 * 标题缺席 / 空白 ⇒ 回空串，调用方据此**不送** `title` 键（回落平台缺省，不发明
 * 「无标题」这种新形态）；标题里的换行 / 制表折成单空格 —— 列表那一列是单行。
 *
 * @param {string} title PR 标题原值
 * @param {string} pr PR 号
 * @returns {string} 拼好的 build 标题；拼不出来时空串
 */
export function buildTitle(title, pr) {
  const flat = String(title ?? "")
    .replaceAll(/\s+/g, " ")
    .trim();
  if (!flat) {
    return "";
  }
  const head = flat.length > TITLE_MAX_LEN ? `${flat.slice(0, TITLE_MAX_LEN - 1)}…` : flat;
  const tail = /^\d+$/.test(String(pr ?? "").trim()) ? ` (#${String(pr).trim()})` : "";
  return `${head}${tail}`;
}

/** CNB OpenAPI 的缺省服务地址（平台侧可用 `CNB_API_ENDPOINT` 覆盖，同 `ci-token-scopes.mjs`）。 */
export const DEFAULT_API_ENDPOINT = "https://api.cnb.cool";

/** GA 侧算「红」的 job result 词表；其余（success / skipped）算绿。 */
const RED_JOB_RESULTS = new Set(["cancelled", "failure", "timed_out", "action_required"]);

/** 合法 sha：40 位十六进制。 */
const SHA_RE = /^[0-9a-f]{40}$/i;

/**
 * 一次 HTTP 读数的最小形状（注入面用，不给 `typeof fetch` 逼测试做断言）。
 *
 * @typedef {{ok: boolean, status: number, json: () => Promise<any>}} FetchResponse
 * @typedef {(url: string, init: {method: string, headers: Record<string, string>, body: string}) => Promise<FetchResponse>} FetchLike
 */

/**
 * 从 argv 里取一个字符串旗标的值。
 *
 * @param {string[]} argv 参数表（不含 node / 脚本名）
 * @param {string} name 旗标名（含 `--`）
 * @returns {string} 值；缺席或下一项还是旗标时回空串
 */
export function readOption(argv, name) {
  const i = argv.indexOf(name);
  const v = i === -1 ? undefined : argv[i + 1];
  return v !== undefined && !v.startsWith("--") ? v : "";
}

/**
 * 把 `needs.*.result` 的读数折成一个 workflow-run 风格的 conclusion。
 *
 * 任一红/取消/超时 ⇒ `failure`；全 success / skipped ⇒ `success`；空清单 ⇒
 * 空串（调用方按「没判过」处置，不静默成绿）。
 *
 * @param {string} raw 逗号分隔的 job result
 * @returns {string} `success` / `failure` / 空串
 */
export function conclusionFromJobResults(raw) {
  const parts = String(raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) {
    return "";
  }
  return parts.some((r) => RED_JOB_RESULTS.has(r)) ? "failure" : "success";
}

/**
 * 把 GA 的 conclusion 折成回调要送的 `GA_VERDICT` 值。
 *
 * 只认 `success` / `neutral` / `skipped`，其余（含 `cancelled` /
 * `startup_failure` / 空串 / 未认得的词）一律折成 `failure` —— 「GA 没给出可放行的
 * 结论」与「GA 判红」在保护分支上必须是同一种红，否则一次跑挂就会早放行。
 *
 * @param {string} raw GA 的 conclusion 原值
 * @returns {"success" | "failure"} 回调 build 该带的结论
 */
export function verdictFromConclusion(raw) {
  return ["success", "neutral", "skipped"].includes(String(raw ?? "").toLowerCase())
    ? "success"
    : "failure";
}

/**
 * 是能按键取值的普通对象吗（不做类型断言）。
 *
 * @param {unknown} v 任意值
 * @returns {v is Record<string, unknown>} true ⇒ 可按键取值
 */
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 把环境变量值归一成去掉首尾空白的字符串（缺席 ⇒ 空串）。
 *
 * @param {unknown} v 原值
 * @returns {string} 归一后的字符串
 */
function trimEnv(v) {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * 读 `GITHUB_EVENT_PATH` 那份 payload；读不到 / 不是 JSON ⇒ `null`（不抛）。
 *
 * 这一步失败只是让这次回调少一条来源，不该让本可送达的判决送不出去 ——
 * 缺前提时下面的 `reasons` 会逐条念出来，比抛栈更能说明白。
 *
 * @param {string} eventPath payload 文件路径
 * @returns {unknown} 解析后的 payload；取不到时 `null`
 */
function readEventPayload(eventPath) {
  if (!eventPath) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(eventPath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * 从派发 payload 的 `client_payload` 里取一个字符串字段。
 *
 * 形状由 `scripts/ci/ci-mirror-payload.mjs` 的 `dispatchPayload()` 定义，
 * `pr-gate.yml` 的 `client_payload.*` 表达式读的是同一份 —— 这里只多一个取值口，
 * 不另立第二套字段名。
 *
 * @param {unknown} payload `GITHUB_EVENT_PATH` 解析结果
 * @param {string} key 字段名（`cnb_merge_sha` / `pr_number` 等）
 * @returns {string} 命中时的字符串值；没有这个键 / 不是字符串时为空串
 */
export function payloadField(payload, key) {
  const body = isRecord(payload) ? payload.client_payload : undefined;
  if (!isRecord(body)) {
    return "";
  }
  const raw = body[key];
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * 收集这次回调的前提，缺哪件念哪件（fail-closed 的「读数」半边）。
 *
 * `readPayload` 是注入面（同本文件其余 `fetchImpl` 的做法）：只吃 payload 文件路径、
 * 回解析结果；默认真读 `GITHUB_EVENT_PATH`。
 *
 * @param {{argv: string[], env: Record<string, string | undefined>, readPayload?: (eventPath: string) => unknown}} io
 * @returns {{ok: true, sha: string, pr: string, repo: string, conclusion: string, verdict: string, token: string, endpoint: string, dryRun: boolean, title: string} | {ok: false, reasons: string[]}}
 */
export function resolveCallbackContext({ argv, env, readPayload = readEventPayload }) {
  const reasons = [];
  /* 取值顺序：显式旗标（手跑复验）→ 派发 payload（自动档的唯一可信来源，
   * 理由见文件头「承重的前提」第 1 条）→ 环境变量（老形态 / 按需档兜底）。 */
  const payload = readPayload(trimEnv(env.GITHUB_EVENT_PATH));
  const sha = (
    readOption(argv, "--sha") ||
    payloadField(payload, "cnb_merge_sha") ||
    env.CNB_PULL_REQUEST_MERGE_SHA ||
    env.GA_MERGE_SHA ||
    ""
  ).trim();
  const pr = (
    readOption(argv, "--pr") ||
    payloadField(payload, "pr_number") ||
    env.CNB_PULL_REQUEST_IID ||
    env.GA_PR_NUMBER ||
    ""
  ).trim();
  const repo = (readOption(argv, "--repo") || env.CNB_REPO_SLUG || env.GA_REPO_SLUG || "").trim();
  /* 标题是**可选**项：拼不出来就不送（不参与前提判定，也不进 reasons ——
   * 缺标题只让这一列回落平台缺省，不该让一条本可送达的结论送不出去）。 */
  const title = buildTitle(readOption(argv, "--title") || env[TITLE_ENV_KEY] || "", pr);
  const token = (env.CNB_TRIGGER_TOKEN ?? "").trim();
  const endpoint = (env.CNB_API_ENDPOINT || DEFAULT_API_ENDPOINT).replace(/\/+$/, "");
  const conclusion =
    (readOption(argv, "--conclusion") || "").trim() ||
    conclusionFromJobResults(env.GA_JOB_RESULTS ?? "");
  if (!SHA_RE.test(sha)) {
    reasons.push("预合并 sha 缺席或不是 40 位十六进制（回调必须绑 PR 预合并 sha）");
  }
  if (!/^\d+$/.test(pr)) {
    reasons.push("PR 编号缺席或不是纯数字");
  }
  if (!repo) {
    reasons.push("仓库 slug 缺席（OpenAPI 路径要它）");
  }
  if (!token) {
    reasons.push("`CNB_TRIGGER_TOKEN` 缺席（要带 `repo-cnb-trigger:rw`）");
  }
  if (!conclusion) {
    reasons.push("conclusion 缺席（`--conclusion` 或 `GA_JOB_RESULTS` 至少要给一个）");
  }
  if (reasons.length > 0) {
    return { ok: false, reasons };
  }
  return {
    conclusion,
    dryRun: argv.includes("--dry-run"),
    endpoint,
    ok: true,
    pr,
    repo,
    sha,
    title,
    token,
    verdict: verdictFromConclusion(conclusion),
  };
}

/**
 * 拼 `POST /{repo}/-/build/start` 的请求体（形状逐字对 `dto.StartBuildReq`）。
 *
 * `sync: "false"`：发完就走，不等短流水线跑完 —— GA 收尾 job 不该被 CNB 那几秒
 * 占着。`sha` 绑预合并 sha，`env` 送结论、PR 号、角色与**同一个 sha** ——
 * 后者让 CNB 侧回调 build 的日志能念出「这条 build 绑的是哪笔」；
 * `CNB_COMMIT` 在 `api_trigger*` 事件上平台没有明文取值保证，不拿它当唯一来源。
 *
 * `title`（`dto.StartBuildReq.title`）：不送的时候平台给的是缺省标题
 * （历史现场一律 `API custom event`），而流水线 `name` 又是另一列 —— 所以
 * 「这条回调属于哪张 PR」只能点进去看。标题拼得出来就送、拼不出来（PR 标题缺席）
 * **一个 `title` 键都不多写**，回落平台缺省。
 *
 * @param {{pr: string, sha: string, verdict: string, title?: string}} ctx
 * @returns {{url: string, init: {method: string, headers: Record<string, string>, body: string}}}
 */
export function startBuildRequest({ pr, sha, verdict, title = "" }) {
  const body = {
    branch: "master",
    env: {
      GA_PR_NUMBER: pr,
      GA_ROLE: "callback",
      [SHA_ENV_KEY]: sha,
      [VERDICT_ENV_KEY]: verdict,
    },
    event: CALLBACK_EVENT,
    sha,
    sync: "false",
    ...(title ? { title } : {}),
  };
  return {
    init: {
      body: JSON.stringify(body),
      headers: {
        Accept: "application/json",
        Authorization: "Bearer <redacted>",
        "Content-Type": "application/json",
      },
      method: "POST",
    },
    url: "/-/build/start",
  };
}

/**
 * 发一次回调；只认应答 JSON 里的 `data.sn`（`dto.BuildResult`）。
 *
 * 平台信封上的 HTTP 200 与「这一跑真起来了」毫无关系，`cnb` CLI 认不出的子命令
 * 也会退 0 打 usage（§13.6）。所以 sn 是唯一的在场证明：取不到 ⇒ 没发出去。
 *
 * @param {{ctx: {endpoint: string, repo: string, token: string, sha: string, pr: string, verdict: string, title?: string}, fetchImpl?: FetchLike, log: (line: string) => void}} io
 * @returns {Promise<string | null>} 构建号；没发出去时 null
 */
export async function sendCallback({ ctx, fetchImpl = fetch, log }) {
  const { init, url } = startBuildRequest(ctx);
  const full = `${ctx.endpoint}/${ctx.repo}${url}`;
  let response;
  try {
    response = await fetchImpl(full, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${ctx.token}` },
    });
  } catch (error) {
    log(`[ga-callback] 请求没发出去：${String(error)}`);
    return null;
  }
  if (!response.ok) {
    log(`[ga-callback] 平台回 ${response.status} ⇒ 没发出去`);
    return null;
  }
  let json;
  try {
    json = await response.json();
  } catch {
    log("[ga-callback] 应答不是 JSON ⇒ 没发出去");
    return null;
  }
  const sn = json?.data?.sn ?? json?.sn;
  if (typeof sn !== "string" || !sn.startsWith("cnb-")) {
    log("[ga-callback] 应答里没有合法构建号 sn ⇒ 没发出去");
    return null;
  }
  return sn;
}

/**
 * 主流程：折结论 → 发回调 → 按「送达」退码。
 *
 * @param {{argv?: string[], env?: Record<string, string | undefined>, fetchImpl?: FetchLike, log?: (line: string) => void}} io
 * @returns {Promise<number>} 0 送达成功（判决内容见 GA_VERDICT）/ 2 没判过
 */
export async function main(io = {}) {
  const argv = io.argv ?? process.argv.slice(2);
  const env = io.env ?? process.env;
  const log =
    io.log ??
    ((line) => {
      console.log(line);
    });
  const ctx = resolveCallbackContext({ argv, env });
  if (!ctx.ok) {
    for (const reason of ctx.reasons) {
      log(`[ga-callback] 前提不成立：${reason}`);
    }
    return CODE.NO_FACT;
  }
  if (ctx.dryRun) {
    const { url, init } = startBuildRequest(ctx);
    log(`[ga-callback] DRY-RUN：POST ${ctx.endpoint}/${ctx.repo}${url}`);
    log(`[ga-callback] DRY-RUN：body=${init.body}`);
    log(`[ga-callback] DRY-RUN：conclusion=${ctx.conclusion} → ${VERDICT_ENV_KEY}=${ctx.verdict}`);
    return CODE.OK;
  }
  const sn = await sendCallback({ ctx, fetchImpl: io.fetchImpl, log });
  if (!sn) {
    return CODE.NO_FACT;
  }
  log(
    `[ga-callback] 已起回调 build ${sn} · event=${CALLBACK_EVENT} · sha=${ctx.sha.slice(0, 8)} · ` +
      `conclusion=${ctx.conclusion} → ${VERDICT_ENV_KEY}=${ctx.verdict}`,
  );
  log(`[ga-callback] 送达成功，判决内容由 CNB 回调 build 读 ${VERDICT_ENV_KEY} 折红/折绿`);
  return CODE.OK;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`[ga-callback] 没判过：${String(error)}`);
      process.exitCode = CODE.NO_FACT;
    },
  );
}
