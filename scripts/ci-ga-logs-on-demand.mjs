#!/usr/bin/env node
/**
 * `ci-ga-logs-on-demand.mjs` —— CNB 侧**按需**发起「把 GA run 的日志搬进 CNB」（ISSUE #3667）。
 *
 * ## 补的是哪一格
 *
 * #3437 的 relay（`ci-ga-logs-relay.mjs`）只在**判红**时搬日志：没有失败 job 就一条
 * 评论都不写。判绿的 run 想「有需要时」也看一眼日志，本地 `--gh-logs pr:<n>` 在 CNB
 * 侧读不到、只能退回 `api.github.com` 出站 —— 而本地 / 自托管机到 github.com 的出网
 * 正是 #3437 要绕开的那一格。
 *
 * 本脚本是**发起那一跳**，跑在 CNB 平台池（`api_trigger_ga_logs` 事件，出网稳）：
 * 用 `GITHUB_MIRROR_TOKEN` 给镜像仓的 `pr-gate.yml` 发一次 `workflow_dispatch`，
 * 带 `relay_scope=all` + `pr_number`（+ 可选 `run_id`）。GA 那条 run 的收尾 relay
 * 便把**全部 job**（含判绿的 success）脱敏后搬进 CNB 附件 + PR 评论；本地随后
 * `pnpm ship --gh-logs pr:<n>` 站内读回。整条链：
 *
 *   本地 → CNB 平台池（本脚本代发）→ GA（托管机读日志、写 CNB）→ CNB（站内载体）→ 本地
 *
 * 本地一台都不碰 `api.github.com`；写 CNB 评论/附件也仍由 GA 侧那两枚已坐实的
 * secret（`CNB_ISSUE_TOKEN` / `CNB_PULL_REQUEST_TOKEN`）承担，本脚本不碰它们。
 *
 * ## 复用优先（§12.18 / 硬规则 24）
 *
 * 发请求的纯函数与发送面直接 import `ci-ga-dispatch.mjs` 的 `dispatchRequest` /
 * `sendDispatch` —— 与「五个固定档」共用同一套 URL / 头 / 令牌接法，不另抄一份。
 * 刻意**不**走它的 `main` / preset 注册表 / `awaitShaVisible`：按需动作不是「固定档」，
 * 也不必等某笔 sha 在镜像仓可见（relay 读的是 GA run 的 jobs，不是本次 checkout）。
 *
 * ## 三态退码（与 ci-ga-dispatch 同一套字面值）
 *
 *   · `0` —— 派发送达（或 `--dry-run` 走完计划）；GA 跑红跑绿不归本脚本判。
 *   · `1` —— 红：派发被拒 / 网络层没跑起来。
 *   · `2` —— 没判：前提不全（令牌 / PR 号缺席）。
 *
 * ## 用法（`.cnb.yml` 的 `api_trigger_ga_logs` 触发口）
 *
 * ```text
 * node scripts/ci-ga-logs-on-demand.mjs                 # env 全从平台注入读
 * node scripts/ci-ga-logs-on-demand.mjs --dry-run        # 只打计划，一条网络都不发
 * ```
 *
 * env：`GITHUB_MIRROR_TOKEN`（必填，平台池 `imports` 注入）、`GITHUB_MIRROR_REPO`
 * （缺省 `wuxianyuedu/comfy-app`）、`GA_LOG_PR_NUMBER`（必填，挂到哪张 PR）、
 * `GA_LOG_RUN_ID`（可选，要搬哪条 GA run；空 = GA 侧本次新跑的那条）、
 * `GA_LOG_HEAD_SHA`（可选，checkout 哪笔；空 = 镜像仓默认分支 HEAD）、
 * `CNB_COMMIT`（`GA_LOG_HEAD_SHA` 缺席时的兜底）。
 */
import path from "node:path";
import process from "node:process";

import { CODE, dispatchRequest, sendDispatch } from "./ci-ga-dispatch.mjs";

/** 按需档发到哪个 workflow（GA 侧收尾 relay 就挂在它上面）。 */
export const ON_DEMAND_WORKFLOW = "pr-gate.yml";

/** 派发的 ref：与固定档同口径（镜像仓 master）。 */
export const ON_DEMAND_REF = "master";

/** `relay_scope` 的字面值：relay 脚本 `relayScopeFromEnv` 只认这一个词切到全量档。 */
export const ON_DEMAND_SCOPE = "all";

/**
 * 收齐前提（纯函数，可注入 env 给用例）。
 *
 * @param {Record<string, string | undefined>} env 进程环境
 * @returns {{ok:true, token:string, repo:string, pr:string, runId:string, headSha:string} | {ok:false, reasons:string[]}}
 */
export function resolveOnDemandContext(env) {
  const token = String(env.GITHUB_MIRROR_TOKEN ?? "").trim();
  const repo = String(env.GITHUB_MIRROR_REPO ?? "wuxianyuedu/comfy-app").trim();
  const pr = String(env.GA_LOG_PR_NUMBER ?? "").trim();
  const runId = String(env.GA_LOG_RUN_ID ?? "").trim();
  const headSha = String(env.GA_LOG_HEAD_SHA ?? env.CNB_COMMIT ?? "").trim();
  /** @type {string[]} */
  const reasons = [];
  if (!token) reasons.push("`GITHUB_MIRROR_TOKEN` 缺席（平台池 imports 那一格没接上？）");
  if (!repo) reasons.push("`GITHUB_MIRROR_REPO` 是空串");
  if (!/^\d+$/u.test(pr)) reasons.push("`GA_LOG_PR_NUMBER` 缺席或不是纯数字（挂到哪张 PR？）");
  return reasons.length > 0
    ? { ok: false, reasons }
    : { headSha, ok: true, pr, repo, runId, token };
}

/**
 * 拼这次派发的 inputs（纯函数，`--dry-run` 与真实发送共用）。
 *
 * 只把非空的值带进 `inputs`：GA `workflow_dispatch` 的空串输入会覆盖 `default: ""`，
 * 语义上等价，但少带几个键让「按需档到底改了哪几格」一眼可读。
 *
 * @param {{pr:string, runId:string, headSha:string}} c 前提
 * @returns {Record<string, string>} `dispatchRequest` 的 `extraInputs`
 */
export function onDemandInputs(c) {
  /** @type {Record<string, string>} */
  const inputs = { pr_number: c.pr, relay_scope: ON_DEMAND_SCOPE };
  if (c.runId !== "") inputs.run_id = c.runId;
  /* head_sha 由 `dispatchRequest` 自己放进 inputs，这里不重复。 */
  return inputs;
}

/**
 * 主入口。返回三态退码；独立导出供测试整链注入（fetch / log 全可换）。
 *
 * @param {{argv?:string[], env?:Record<string, string | undefined>, fetchImpl?:typeof fetch, log?:(l:string)=>void}} [options]
 * @returns {Promise<number>}
 */
export async function main(options = {}) {
  const { argv = process.argv.slice(2), env = process.env, ...io } = options;
  const log = io.log ?? console.log;
  const ctx = resolveOnDemandContext(env);
  if (!ctx.ok) {
    for (const reason of ctx.reasons) log(`[ga-logs-on-demand] 前提不成立：${reason}`);
    return CODE.NO_FACT;
  }
  const inputs = onDemandInputs(ctx);
  const request = dispatchRequest({
    extraInputs: inputs,
    ref: ON_DEMAND_REF,
    repo: ctx.repo,
    sha: ctx.headSha,
    workflow: ON_DEMAND_WORKFLOW,
  });
  if (argv.includes("--dry-run")) {
    log(`[ga-logs-on-demand] DRY-RUN：POST ${request.url}`);
    log(`[ga-logs-on-demand] DRY-RUN：body=${request.init.body}`);
    log("[ga-logs-on-demand] DRY-RUN：不发任何请求");
    return CODE.OK;
  }
  log(
    `[ga-logs-on-demand] 按需发起：PR #${ctx.pr} · scope=${ON_DEMAND_SCOPE}` +
      `${ctx.runId === "" ? "" : ` · run=${ctx.runId}`} → ${ctx.repo}/.github/workflows/${ON_DEMAND_WORKFLOW}`,
  );
  const { status, body } = await sendDispatch({
    io: { fetchImpl: io.fetchImpl, log },
    request,
    token: ctx.token,
  });
  if (status !== 204) {
    log(`[ga-logs-on-demand] 派发被拒：HTTP ${status}`);
    if (body.trim()) log(`[ga-logs-on-demand]   ${body.replaceAll(ctx.token, "***")}`);
    log(
      "[ga-logs-on-demand] 结论：exit 1 —— 派发没送达（401/403 核令牌 actions: write；404 核 workflow 文件）",
    );
    return CODE.FAIL;
  }
  log(
    `[ga-logs-on-demand] 派发送达：GA 收尾 relay 将按 scope=all 把日志搬进 CNB PR #${ctx.pr}；` +
      `本地随后 \`pnpm ship --gh-logs pr:${ctx.pr}\` 站内读回（无需出站 github.com）。`,
  );
  return CODE.OK;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main({ argv: process.argv.slice(2) }).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`[ga-logs-on-demand] 没判过：${String(error)}`);
      process.exitCode = CODE.NO_FACT;
    },
  );
}
