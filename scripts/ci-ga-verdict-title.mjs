#!/usr/bin/env node
/**
 * `ci-ga-verdict-title.mjs` —— 把 PR 标题写进 `GITHUB_ENV`，供收尾的回调那一跳读（ISSUE #3981）。
 *
 * ## 为什么需要它
 *
 * CNB 构建历史里，每条 GA 判决回调 build 的标题此前一律是平台缺省
 * （历史现场全是 `API custom event`），要**点进去**才知道它属于哪张 PR。
 * 平台侧 `dto.StartBuildReq` 有独立的 `title` 字段（与流水线 `name`、事件名都不是同一个源），
 * 于是修法是：GA 这一跳把 PR 标题取到，`ci-ga-verdict-callback.mjs` 再送进请求体。
 *
 * ## 两条取值路径（一份落点）
 *
 * | 触发形态                             | 标题从哪来                                     |
 * | ------------------------------------ | ---------------------------------------------- |
 * | 自动档（`repository_dispatch`）      | payload 的 `github.event.pull_request.title`   |
 * | 按需档（`workflow_dispatch`，#3667） | **没有** payload ⇒ 站内读 `GET /{repo}/-/pulls/{n}` |
 *
 * 两条路都往 `GITHUB_ENV` 里写同一个键 `GA_PR_TITLE`，下游只认那一个键 ——
 * 否则「按需档的回调又变回无标题」会是只修一半的那种形态。
 *
 * ## 什么算成功
 *
 * 取到非空标题 ⇒ `0`（已写进 `GITHUB_ENV`，日志里念一遍）。
 * 取不到（标题空 / 没有 `GITHUB_ENV` / 没有令牌 / 请求失败）⇒ `2`，**日志逐条说明是哪一件**。
 * 退非零不代表判决变了：调用它的那一步带 `continue-on-error`，缺标题只让那条 build
 * 回落平台缺省标题，不该让一条本可送达的结论送不出去 —— 「没拿到测量 ≠ 测量结果是红的」
 * 在这一格同样成立。
 *
 * 用法（`pr-gate.yml` 的收尾 job，两条形态各一步）：
 *
 * ```text
 * GA_PR_TITLE="<payload 里的标题>" node scripts/ci-ga-verdict-title.mjs   # 自动档
 * CNB_TRIGGER_TOKEN=… CNB_PULL_REQUEST_IID=<n> node scripts/ci-ga-verdict-title.mjs  # 按需档
 * ```
 */
import { appendFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

/** 写进 `GITHUB_ENV` 的键名，与 `ci-ga-verdict-callback.mjs` 的 `TITLE_ENV_KEY` 逐字相同。 */
export const TITLE_ENV_KEY = "GA_PR_TITLE";

/**
 * 一次 HTTP 读数的最小形状（注入面用，不给 `typeof fetch` 逼测试做断言）。
 *
 * @typedef {{ok: boolean, status: number, json: () => Promise<any>}} FetchResponse
 * @typedef {(url: string, init: {method: string, headers: Record<string, string>}) => Promise<FetchResponse>} FetchLike
 */

/** CNB OpenAPI 的缺省服务地址（平台侧可用 `CNB_API_ENDPOINT` 覆盖，同结论回调那一路）。 */
export const DEFAULT_API_ENDPOINT = "https://api.cnb.cool";

/** 退出码（与 `ci-github-mirror-push.mjs` 的 `CODE` 同口径：0 有结论、2 没结论）。 */
const CODE = { OK: 0, NO_FACT: 2 };

/**
 * 从按需档的 `GET /{repo}/-/pulls/{n}` 应答里取标题。
 *
 * 只认 `data.title`（平台信封），并容忍脚本自己拼的 `/pulls/{n}` 直读形态；
 * 两种形状都取不到非空字符串 ⇒ 回空串（调用方按「没拿到」处置）。
 *
 * @param {unknown} json 平台应答
 * @returns {string} 标题；取不到时空串
 */
export function titleFromPull(json) {
  /* 一层层收窄而不是 `as`：`any` 上的成员访问与断言都是判据里的硬红，
   * 而这里要的只是「`data.title` 是不是非空字符串」这一件事。 */
  if (typeof json !== "object" || json === null || !("data" in json)) {
    return "";
  }
  const { data } = json;
  if (typeof data !== "object" || data === null || !("title" in data)) {
    return "";
  }
  return typeof data.title === "string" ? data.title.trim() : "";
}

/**
 * 把标题写进 `GITHUB_ENV`（下一步的 `env.GA_PR_TITLE` 才读得到）。
 *
 * `GITHUB_ENV` 的多行写法是 `KEY<<DELIM` … `DELIM`；标题被折叠成单行，
 * 所以这里直接写一行值，不做 heredoc —— 少一种能写坏的形状。
 *
 * @param {{envFile: string, title: string}} io
 */
export function writeTitle({ envFile, title }) {
  appendFileSync(envFile, `${TITLE_ENV_KEY}=${title}\n`, "utf8");
}

/**
 * 主流程：先看 env 里有没有现成标题（自动档），没有再问平台（按需档）。
 *
 * `fetchImpl` 是注入面（同 `ci-ga-verdict-callback.mjs` 那一族的做法）：只吃
 * `url` + 回一个 `{ ok, status, json }`，不逼假件去造整个 `Response`。
 *
 * @param {{env?: Record<string, string | undefined>, fetchImpl?: FetchLike, log?: (line: string) => void}} io
 * @returns {Promise<number>} 0 已落盘 / 2 没拿到
 */
export async function main(io = {}) {
  const env = io.env ?? process.env;
  const log =
    io.log ??
    ((line) => {
      console.log(line);
    });
  const envFile = (env.GITHUB_ENV ?? "").trim();
  if (!envFile) {
    log(`[ga-title] 没有 GITHUB_ENV（不在 actions runner 上？）⇒ 标题传不到下一步`);
    return CODE.NO_FACT;
  }

  /* 自动档：payload 里的标题已经由 workflow 的 `env` 送进来。 */
  let title = (env[TITLE_ENV_KEY] ?? "").trim();
  let source = "payload";
  if (!title) {
    source = "api";
    const pr = (env.CNB_PULL_REQUEST_IID ?? "").trim();
    const repo = (env.CNB_REPO_SLUG ?? "").trim();
    const token = (env.CNB_TRIGGER_TOKEN ?? "").trim();
    const endpoint = (env.CNB_API_ENDPOINT || DEFAULT_API_ENDPOINT).replace(/\/+$/, "");
    if (!/^\d+$/.test(pr)) {
      log(`[ga-title] PR 号缺席或不是纯数字（${pr || "空"}）⇒ 读不到标题，回落平台缺省`);
      return CODE.NO_FACT;
    }
    if (!repo || !token) {
      log("[ga-title] 仓库 slug 或令牌缺席 ⇒ 读不到标题，回落平台缺省");
      return CODE.NO_FACT;
    }
    try {
      const response = await (io.fetchImpl ?? fetch)(`${endpoint}/${repo}/-/pulls/${pr}`, {
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        method: "GET",
      });
      if (!response.ok) {
        log(`[ga-title] 读 PR #${pr} 的标题被平台拒（${response.status}）⇒ 回落平台缺省`);
        return CODE.NO_FACT;
      }
      title = titleFromPull(await response.json());
    } catch (error) {
      log(`[ga-title] 读 PR #${pr} 的标题没跑起来：${String(error)}`);
      return CODE.NO_FACT;
    }
  }
  if (!title) {
    log(`[ga-title] ${source} 里没有标题 ⇒ 回落平台缺省`);
    return CODE.NO_FACT;
  }
  writeTitle({ envFile, title });
  log(`[ga-title] ${TITLE_ENV_KEY} 已落盘（来源=${source}）：${title}`);
  return CODE.OK;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`[ga-title] 没跑起来：${String(error)}`);
      process.exitCode = CODE.NO_FACT;
    },
  );
}
