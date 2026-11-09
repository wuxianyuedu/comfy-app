#!/usr/bin/env node
/**
 * `ci-ga-logs-relay.mjs` —— GA 收尾 job 把**失败 job 的日志正文**搬到 CNB 侧（ISSUE #3437）。
 *
 * ## 为什么有这一格
 *
 * #3378 演进线把 GA 的**结论**改成「GA 入站送回 + CNB 站内读」，但**日志正文**一直
 * 留在 `pnpm ship --gh-logs` 从 `api.github.com` 出站拉。本地 / 自托管机到 github.com
 * 出网间歇不通，判红时想看「哪一步、哪一行」就卡在这一跳。
 *
 * 本格把日志正文也搬到 CNB：**产在 GA 侧（托管机，出网稳、有 actions: read）→ 存进
 * CNB（站内）→ 本地从 CNB 站内读**。与结论回调同一条「GA 写 / CNB 读」的分工。
 *
 * ## 顺带治「回调成功为什么还是红」（ISSUE #3452）
 *
 * commit-status 里那条 `cnb/api_trigger_ga_verdict/*` 叫「GA 判决回调」、显示
 * `error [2.2s]`，读起来像「回调腿挂了」；它其实是**GA 判决结论的镜像**——
 * 红恰恰是判决生效的证据，不是信使没送到。平台这格 `description` 写不进去
 * （Swagger 里三条 commit-status 路径全是 `get`，`StartBuildReq` 也没有该字段），
 * 承重退码更是一字不能动（§13.5.33.1）。于是把「送达」与「判决」两件事并列
 * 念进这条**本来就会发的 PR 评论**：复用 #3102 那族「红格可见性」思路，不另起
 * 一条判据、不新增一条 status。判绿时本就不发评论（没有失败 job），列表上不点开
 * 就能读出「回调已送达 / GA 判红」。
 *
 * ## 载体（2026-11-09 探针逐格坐实，不是推断）
 *
 *   1. `POST /{repo}/-/upload/files`（`repo-notes:rw`）：body `{name,size}` ⇒ 回
 *      `upload_url` / `assets.path` / `token`。`name` 带 `.b64`，平台按 `text/plain` 收。
 *   2. `PUT <upload_url>`：把 gzip→base64 的纯文本送上去（Content-Type: text/plain）。
 *   3. `POST /{repo}/-/pulls/{n}/comments`（`repo-notes:rw`）：body 里引用
 *      `assets.path` 转成 Markdown 附件链 —— **发布这一跳是「可读」的前提**：
 *      未发布时 `GET /-/files/<path>` 恒 404（探针 `2119667552891596800` 一族），
 *      发布后 `cnb pulls get-files` / 裸 GET 都逐字读回（探针 `3432`）。
 *   4. 评论正文带一行固定 marker `GA_LOG_RELAY_V1`（含 run/sha/pr/jobs/bytes），
 *      本地按 PR 号扫评论列表认它；marker 形状不动，正文额外并列念「送达 / 判决」。
 *
 * PR 与 Issue 是两套独立编号（探测 `issues get --number 3432` 回 404），所以这里
 * 只用 `pulls` 那组端点；GA 侧没有 `cnb` CLI（四跑读数 #2551），全程裸 fetch。
 *
 * ## 边界（与 `--gh-logs` 同一口径）
 *
 *   · **日志搬不到 ≠ 判红**：前提不全 / 401 / 403 / 404 / 网络不通，都只多一行读数，
 *     不改三态、不改本 run 的 conclusion。收尾 job 带 `continue-on-error: true`。
 *   · **只搬判红 job 的日志**：与 `ci-github-verdict-logs.mjs` 同口径，成功 job 不进包。
 *   · **落 CNB 的是脱敏后的正文**（硬规则 17）：`redactSecrets` 抹精确令牌 /
 *     `ghp_` `github_pat_` / env / JSON 形状；再 gzip + base64 编成纯文本
 *     （`cnb` CLI 读附件走 JSON 信封，二进制会被转坏，端到端探针验过）。
 *   · **单 PR 一条评论**：marker 里带 run id 与 sha；不同 run 会留多条历史评论，
 *     但本地只认「最新一条 marker 评论」（按列表顺序，见 `ship-gh-logs.mjs`）。
 *   · **不碰承重**：不写 commit-statuses、不改流水线 name、不改 `GA_VERDICT` 折叠、
 *     不改三态退码。评论里那两行是**只读解释**，不参与任何判定（ISSUE #3452）。
 *
 * ## 用法（`pr-gate.yml` 的收尾 job，判红才跑）
 *
 * ```text
 * node scripts/ci-ga-logs-relay.mjs            # 前提全从 env 读
 * node scripts/ci-ga-logs-relay.mjs --dry-run   # 只打印计划，一条网络都不发
 * ```
 *
 * env：`CNB_ISSUE_TOKEN`（`repo-notes:rw`，与 code-scanning-triage 同一枚 secret）、
 * `CNB_REPO_SLUG`、`CNB_PULL_REQUEST_IID`、`CNB_PULL_REQUEST_MERGE_SHA`、
 * `GITHUB_RUN_ID`、`GITHUB_TOKEN`（内置 `github.token`，`actions: read`）、
 * `GITHUB_REPOSITORY`（镜像仓 `owner/repo`，不是 CNB origin）、
 * `GA_JOB_RESULTS`（同结论回调那一跳，用来在评论里念出本次 verdict）。
 */
import path from "node:path";
import process from "node:process";

import { CODE } from "./ci-github-mirror-push.mjs";
import { conclusionFromJobResults, verdictFromConclusion } from "./ci-ga-verdict-callback.mjs";
import { gzipSync } from "node:zlib";
import { jobLogUrl, redactSecrets, runJobsUrl } from "./ci-github-verdict-logs.mjs";
import { requestJson, requestText } from "./ci-github-verdict-request.mjs";

/** 本地按 marker 认这条评论；版本号留着，将来换格式不会认错上一代。 */
export const RELAY_MARKER = "GA_LOG_RELAY_V1";

/** 附件扩展名：正文是「gzip → base64」的**纯文本**，平台按 `.b64` 收成 text/plain。
 * 不直接 PUT gzip 字节：`cnb assets get-files` 走 JSON 信封，二进制会被转坏；
 * base64 逐字读回后 decode+gunzip 还原（端到端探针验过）。 */
export const RELAY_FILE_SUFFIX = ".b64";

/** 平台附件文件名里只许这些字符（sha 与 run id 都是数字/十六进制，够用）。 */
const SAFE_NAME = /[^0-9A-Za-z._-]/gu;

/** GA 侧判红结论词表（与 `ci-github-verdict-read.mjs` 同一族，不另抄一份）。 */
const RED = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure"]);

/**
 * 是不是可按字段取值的对象。
 *
 * @param {unknown} v 任意值
 * @returns {v is Record<string, unknown>} true ⇒ 对象
 */
function isRecord(v) {
  return typeof v === "object" && v !== null;
}

/**
 * @param {unknown} v 任意值
 * @returns {unknown[]} 数组（非数组给空表）
 */
function asList(v) {
  return Array.isArray(v) ? v : [];
}

/**
 * 收齐前提，缺哪件念哪件（fail-closed 的「读数」半边）。
 *
 * @param {Record<string, string | undefined>} env 进程环境
 * @returns {{ok:true, token:string, repo:string, pr:string, sha:string, runId:string, ghToken:string, ghRepo:string, endpoint:string} | {ok:false, reasons:string[]}}
 */
export function resolveRelayContext(env) {
  const token = String(env.CNB_ISSUE_TOKEN ?? env.CNB_TOKEN ?? "").trim();
  const repo = String(env.CNB_REPO_SLUG ?? "").trim();
  const pr = String(env.CNB_PULL_REQUEST_IID ?? "").trim();
  const sha = String(env.CNB_PULL_REQUEST_MERGE_SHA ?? "").trim();
  const runId = String(env.GITHUB_RUN_ID ?? "").trim();
  const ghToken = String(env.GITHUB_TOKEN ?? "").trim();
  const ghRepo = String(env.GITHUB_REPOSITORY ?? "").trim();
  const endpoint = String(env.CNB_API_ENDPOINT || "https://api.cnb.cool").replace(/\/+$/u, "");
  /** @type {string[]} */
  const reasons = [];
  if (!token) reasons.push("`CNB_ISSUE_TOKEN` / `CNB_TOKEN` 缺席（写 CNB 要 repo-notes:rw）");
  if (!repo) reasons.push("`CNB_REPO_SLUG` 缺席");
  if (!/^\d+$/u.test(pr)) reasons.push("`CNB_PULL_REQUEST_IID` 缺席或不是纯数字");
  if (!runId) reasons.push("`GITHUB_RUN_ID` 缺席（没有 run 就没有 job 日志对象）");
  if (!ghToken) reasons.push("`GITHUB_TOKEN` 缺席（要 actions: read 读 job logs）");
  if (!ghRepo) reasons.push("`GITHUB_REPOSITORY` 缺席（镜像仓 owner/repo）");
  if (reasons.length > 0) return { ok: false, reasons };
  return { endpoint, ghRepo, ghToken, ok: true, pr, repo, runId, sha, token };
}

/**
 * 「送达 / 判决」并列读数（ISSUE #3452）：把两件同名却颜色相反的事一次念清。
 *
 * 回调那一跳是**信使**（`ci-ga-verdict-callback.mjs`：送达成功恒退 0，判绿判红都一样）；
 * commit-status 那条 `error` 是**GA 判决结论的镜像**，红 = 判决生效的证据，不是回调挂了。
 * 平台这格 `description` 没有写入口，承重退码也不许动，于是把两件事并列念进 PR 评论。
 * 复用 callback 已导出的结论折叠函数，不另抄一份词表（§12.18 / 硬规则 24）。
 *
 * @param {string} jobResults `GA_JOB_RESULTS`（逗号分隔的 `needs.*.result`）
 * @returns {string} 一段人读摘要（纯函数，缺席时如实念「前提缺席」，不猜）
 */
export function renderVerdictReadout(jobResults) {
  const conclusion = conclusionFromJobResults(jobResults);
  if (conclusion === "") {
    return "判决读数：GA_JOB_RESULTS 缺席 ⇒ 本次结论读不出（不影响日志搬运与送达判定）。";
  }
  const verdict = verdictFromConclusion(conclusion);
  const color =
    verdict === "success"
      ? "这条 status 是绿的 = GA 判绿、允许合并"
      : "这条 status 的 error 是 GA 判红、已生效拦截合并";
  return [
    `**判决**：GA 本次 conclusion=${conclusion} → GA_VERDICT=${verdict}；${color}。`,
    "**送达**：结论回调是「信使」，退出码只表「送没送到」，判绿判红都恒绿 —— 它和这条 status 的红绿**无关**。",
    "要查回调本身有没有送到，看 GA 收尾 job「把结论送回 CNB」那格的 `[ga-callback]` 读数；",
    "这条 commit-status 是**GA 判决结论的镜像**，不是回调腿的检查。承重退码一字未改（§13.5.33.1）。",
  ].join("\n");
}

/**
 * 评论正文：一行 marker（本地按它认）+ 送达/判决并列读数 + 人读摘要 + 附件链。
 *
 * marker 里带 run id 与预合并 sha 的前 8 位 —— 本地能把「这条日志是哪一跑」念出来，
 * 不用跳 GA 页面（与 #3430 给回调日志补身份读数是同一条理由）。
 * 「送达 / 判决」那一段是只读解释，**不进 marker、不参与 parseRelayComment**
 * （本地读者只认 marker 与附件链，形状不变，ISSUE #3452）。
 *
 * @param {{pr:string, runId:string, sha:string, fileName:string, assetPath:string, jobs:number, bytes:number, verdictReadout?:string}} c
 * @returns {string} 评论正文（纯函数）
 */
export function relayCommentBody(c) {
  const short = c.sha ? c.sha.slice(0, 8) : "n/a";
  const link = `[${c.fileName}](/-/files/${c.assetPath})`;
  const readout = c.verdictReadout ?? "";
  return [
    `<!-- ${RELAY_MARKER} run=${c.runId} sha=${c.sha} pr=${c.pr} jobs=${String(c.jobs)} bytes=${String(c.bytes)} -->`,
    `GA 判红日志正文（ISSUE #3437）：run ${c.runId} · sha ${short} · ${String(c.jobs)} 个失败 job · ${String(c.bytes)} 字节（gzip）。`,
    ...(readout ? ["", readout] : []),
    `本地取回：\`pnpm ship --gh-logs pr:${c.pr}\`（优先读本评论的附件，无需出站 github.com）。`,
    "",
    link,
  ].join("\n");
}

/**
 * 从评论正文里认 marker，并取出 run / sha / 附件路径。
 *
 * 平台把相对链接回读时会补成绝对 URL，所以两种形状都认；只认**最新一条**（调用方
 * 按列表顺序从新到旧扫，命中即停）。
 *
 * @param {string} body 评论正文
 * @returns {{run:string, sha:string, pr:string, jobs:number, bytes:number, assetPath:string} | null}
 */
export function parseRelayComment(body) {
  const text = String(body ?? "");
  if (!text.includes(RELAY_MARKER)) return null;
  /** @type {Record<string, string>} */
  const kv = {};
  for (const m of text.matchAll(/(?<key>[a-z]+)=(?<val>[^\s>]+)/gu)) {
    const key = m.groups?.key ?? "";
    if (key !== "") kv[key] = m.groups?.val ?? "";
  }
  const link = /\]\((?<url>[^)]*\/-\/files\/[^)]+)\)/u.exec(text);
  if (!link) return null;
  const hit = /\/-\/files\/(?<tail>.+)$/u.exec(link.groups?.url ?? "");
  if (!hit) return null;
  return {
    assetPath: hit.groups?.tail ?? "",
    bytes: Number(kv.bytes ?? 0),
    jobs: Number(kv.jobs ?? 0),
    pr: kv.pr ?? "",
    run: kv.run ?? "",
    sha: kv.sha ?? "",
  };
}

/**
 * 取本次 run 的失败 job 日志，脱敏后拼成一份正文（不压缩、不写盘）。
 *
 * 与 `ship-gh-logs.mjs` 的判红读数同一份 GA API：runs/{id}/jobs → 逐个失败 job
 * 拉 `/actions/jobs/{id}/logs`。取不到只多一行读数，不抛、不改三态。
 *
 * @param {{ctx:{ghRepo:string,ghToken:string,runId:string}, fetchImpl:typeof fetch, log:(l:string)=>void, sleep:(ms:number)=>Promise<void>}} io
 * @returns {Promise<{text:string, jobs:number} | null>} 拼好的正文；没有失败 job 日志时 null
 */
export async function collectFailedJobLogs(io) {
  const { ctx, fetchImpl, log } = io;
  const reqIo = {
    fetchImpl,
    log,
    sleep: io.sleep,
    token: ctx.ghToken,
  };
  const res = await requestJson(reqIo, runJobsUrl(ctx.ghRepo, ctx.runId), "job 列表");
  if (!res.ok) {
    log(`[ga-logs-relay] job 列表取不到 ⇒ 跳过搬运（缺的只是日志）`);
    return null;
  }
  const jobs = asList(isRecord(res.body) ? res.body.jobs : null);
  const failed = jobs.filter(
    (j) => isRecord(j) && RED.has(String(j.conclusion)) && j.conclusion !== "skipped",
  );
  if (failed.length === 0) {
    log(`[ga-logs-relay] 这条 run 没有失败 job ⇒ 不搬运日志`);
    return null;
  }
  /** @type {string[]} */
  const parts = [];
  let count = 0;
  for (const job of failed) {
    if (!isRecord(job)) continue;
    const name = String(job.name ?? "(未命名 job)");
    const id = job.id;
    if (id === undefined || id === null) {
      log(`[ga-logs-relay] job「${name}」没有 id ⇒ 跳过正文`);
      continue;
    }
    // oxlint-disable-next-line no-await-in-loop -- 逐个 job 串行取日志：并行会打乱正文顺序
    const lr = await requestText(reqIo, jobLogUrl(ctx.ghRepo, String(id)), `job「${name}」日志`);
    if (!lr.ok) {
      log(`[ga-logs-relay] job「${name}」日志取不到 ⇒ 跳过这一份（缺的只是日志）`);
      continue;
    }
    const clean = redactSecrets(lr.text, ctx.ghToken);
    parts.push("", `== run ${ctx.runId} / job「${name}」（${String(job.conclusion)}）==`, clean);
    count += 1;
  }
  if (count === 0) return null;
  parts.unshift(`# GA 判红日志正文（run ${ctx.runId} · 已脱敏 · ISSUE #3437）`);
  return { jobs: count, text: parts.join("\n") };
}

/**
 * 发一次 CNB 调用（写一律不重试：一次重发就可能多一条评论）。
 *
 * @param {{ctx:{endpoint:string,repo:string,token:string}, fetchImpl:typeof fetch}} io
 * @param {"POST"|"PUT"|"GET"} method 方法
 * @param {string} target 完整 URL
 * @param {{json?:unknown, text?:string, contentType?:string}} [body] 请求体
 * @returns {Promise<{ok:true, status:number, json:unknown, text:string} | {ok:false, status:number, detail:string}>}
 */
export async function cnbRequest(io, method, target, body = {}) {
  try {
    /** @type {Record<string,string>} */
    const headers = { Accept: "application/json", Authorization: `Bearer ${io.ctx.token}` };
    /** @type {string | undefined} */
    let payload;
    if (body.json !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body.json);
    } else if (body.text !== undefined) {
      headers["Content-Type"] = body.contentType ?? "text/plain";
      headers["Content-Length"] = String(Buffer.byteLength(body.text, "utf8"));
      payload = body.text;
    }
    const res = await io.fetchImpl(target, {
      body: payload,
      headers,
      method,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text === "" ? null : JSON.parse(text);
    } catch {
      /* 2xx 但不是 JSON：PUT 上传、GET 附件正文都走这一档。 */
    }
    return res.ok
      ? { json, ok: true, status: res.status, text }
      : { detail: text.slice(0, 300), ok: false, status: res.status };
  } catch (error) {
    return { detail: String(error), ok: false, status: -1 };
  }
}

/**
 * 把一份已拼好的正文搬上 CNB：上传 → PUT → 发PR评论（发布）。
 *
 * @param {{ctx:{endpoint:string,repo:string,token:string,pr:string,runId:string,sha:string,verdictReadout?:string}, fetchImpl:typeof fetch, log:(l:string)=>void, gzipSync:(b:Buffer)=>Buffer}} io
 * @param {{text:string, jobs:number}} collected 失败 job 日志正文
 * @returns {Promise<number>} 0 送达成功 / 2 没判过（前提不全或没发出去）
 */
export async function relayLogs(io, collected) {
  const { ctx, fetchImpl, log } = io;
  const gz = io.gzipSync(Buffer.from(collected.text, "utf8"));
  const payload = Buffer.from(gz).toString("base64");
  const fileName =
    `ga-logs-${ctx.runId}-${ctx.sha.slice(0, 8) || "noid"}${RELAY_FILE_SUFFIX}`.replaceAll(
      SAFE_NAME,
      "_",
    );
  const api = `${ctx.endpoint}/${ctx.repo}`;
  const up = await cnbRequest({ ctx, fetchImpl }, "POST", `${api}/-/upload/files`, {
    json: { name: fileName, size: Buffer.byteLength(payload, "utf8") },
  });
  if (!up.ok) {
    log(`[ga-logs-relay] 上传链接取不到（HTTP ${String(up.status)}）⇒ 跳过（缺的只是日志）`);
    return CODE.NO_FACT;
  }
  const data = isRecord(up.json) ? (isRecord(up.json.data) ? up.json.data : up.json) : null;
  const uploadUrl = String(data?.upload_url ?? "");
  const rawPath = String((isRecord(data?.assets) ? data.assets.path : "") ?? "");
  const tail = /\/-\/files\/(?<path>.+)$/u.exec(rawPath);
  const assetPath = tail?.groups?.path ?? rawPath.replace(/^\/+/u, "");
  if (!uploadUrl || !assetPath) {
    log("[ga-logs-relay] 上传应答缺 upload_url / assets.path ⇒ 跳过（缺的只是日志）");
    return CODE.NO_FACT;
  }
  const put = await cnbRequest({ ctx, fetchImpl }, "PUT", uploadUrl, {
    contentType: "text/plain",
    text: payload,
  });
  if (!put.ok) {
    log(`[ga-logs-relay] PUT 正文失败（HTTP ${String(put.status)}）⇒ 跳过（缺的只是日志）`);
    return CODE.NO_FACT;
  }
  const body = relayCommentBody({
    assetPath,
    bytes: gz.length,
    fileName,
    jobs: collected.jobs,
    pr: ctx.pr,
    runId: ctx.runId,
    sha: ctx.sha,
    verdictReadout: ctx.verdictReadout,
  });
  const posted = await cnbRequest({ ctx, fetchImpl }, "POST", `${api}/-/pulls/${ctx.pr}/comments`, {
    json: { body },
  });
  if (!posted.ok) {
    log(
      `[ga-logs-relay] PR 评论发布失败（HTTP ${String(posted.status)}）⇒ 附件未发布（缺的只是日志）`,
    );
    return CODE.NO_FACT;
  }
  log(
    `[ga-logs-relay] 已搬到 CNB：PR #${ctx.pr} · run ${ctx.runId} · ${String(collected.jobs)} 个失败 job · ${String(gz.length)} 字节（gzip）`,
  );
  return CODE.OK;
}

/**
 * 主流程：收前提 → 取失败 job 日志 → 搬上 CNB。永不抛异常、永不改三态。
 *
 * @param {{argv?:string[], env?:Record<string,string|undefined>, fetchImpl?:typeof fetch, log?:(l:string)=>void, sleep?:(ms:number)=>Promise<void>, gzipSync?:(b:Buffer)=>Buffer}} io
 * @returns {Promise<number>} 0 送达 / 2 没判过
 */
export async function main(io = {}) {
  const argv = io.argv ?? process.argv.slice(2);
  const env = io.env ?? process.env;
  const log =
    io.log ??
    ((l) => {
      console.log(l);
    });
  const fetchImpl = io.fetchImpl ?? globalThis.fetch;
  const sleep = io.sleep ?? (() => Promise.resolve());
  const ctx = resolveRelayContext(env);
  if (!ctx.ok) {
    for (const reason of ctx.reasons) log(`[ga-logs-relay] 前提不成立：${reason}`);
    return CODE.NO_FACT;
  }
  if (argv.includes("--dry-run")) {
    log(
      `[ga-logs-relay] DRY-RUN：将从 GA run ${ctx.runId} 取失败 job 日志，搬到 CNB PR #${ctx.pr}（一条网络都不发）`,
    );
    return CODE.OK;
  }
  try {
    const collected = await collectFailedJobLogs({ ctx, fetchImpl, log, sleep });
    if (!collected) return CODE.OK;
    return await relayLogs(
      {
        ctx: { ...ctx, verdictReadout: renderVerdictReadout(env.GA_JOB_RESULTS ?? "") },
        fetchImpl,
        gzipSync: io.gzipSync ?? gzipSync,
        log,
      },
      collected,
    );
  } catch (error) {
    log(`[ga-logs-relay] 搬运出现异常（不改三态）：${String(error)}`);
    return CODE.OK;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`[ga-logs-relay] 没判过：${String(error)}`);
      process.exitCode = CODE.NO_FACT;
    },
  );
}
