#!/usr/bin/env node
/**
 * `ci-ga-verdict-title.mjs` —— 把 PR 标题写进 `GITHUB_ENV`，供收尾的回调那一跳读（ISSUE #3981 / #3980）。
 *
 * ## 为什么需要它
 *
 * CNB 构建历史里，每条 GA 判决回调 build 的标题此前一律是平台缺省
 * （历史现场全是 `API custom event`），要**点进去**才知道它属于哪张 PR。
 * 平台侧 `dto.StartBuildReq` 有独立的 `title` 字段（与流水线 `name`、事件名都不是同一个源），
 * 于是修法是：GA 这一跳把 PR 标题取到，`ci-ga-verdict-callback.mjs` 再送进请求体。
 *
 * ## 三条取值路径（一份落点）
 *
 * | 顺序 | 来源                                         | 什么时候用               |
 * | ---- | -------------------------------------------- | ------------------------ |
 * | ①    | `GA_PR_TITLE`（环境变量）                     | 显式注入 / 手跑复验       |
 * | ②    | `GITHUB_EVENT_PATH` 的 `client_payload.pr_title` | 自动档（`repository_dispatch`） |
 * | ③    | 站内 `GET /{repo}/-/pulls/{n}`                | 上面两条都空时（按需档 / 老 payload） |
 *
 * 三条路都往 `GITHUB_ENV` 里写同一个键 `GA_PR_TITLE`，下游只认那一个键 ——
 * 否则「按需档的回调又变回无标题」会是只修一半的那种形态。
 *
 * ## 为什么读的是 payload 而不是 `github.event.pull_request.title`（ISSUE #3980）
 *
 * 本 workflow **没有** `pull_request` 触发（只有 `repository_dispatch` 与
 * `workflow_dispatch`），那个上下文字段在这里恒为空串 —— #3981 的自动档那一步
 * 于是从来没写进过任何东西。真正带标题的是镜像格送来的 `client_payload.pr_title`
 * （`scripts/ci/ci-mirror-payload.mjs` 的 `dispatchPayload`），`run-name` 同一份。
 * 所以取值口就是那份 payload 文件，不再依赖不存在的上下文。
 *
 * ## 什么算成功
 *
 * 取到非空标题 ⇒ `0`（已写进 `GITHUB_ENV`，日志里念一遍 + 念来源）。
 * 取不到（三条都空 / 没有 `GITHUB_ENV` / 请求失败）⇒ `2`，**日志逐条说明是哪一件**。
 * 退非零不代表判决变了：调用它的那一步带 `continue-on-error`，缺标题只让那条 build
 * 回落平台缺省标题，不该让一条本可送达的结论送不出去 —— 「没拿到测量 ≠ 测量结果是红的」
 * 在这一格同样成立。
 *
 * 用法（`pr-gate.yml` 的收尾 job，两条触发形态**同一个入口**）：
 *
 * ```text
 * GITHUB_EVENT_PATH=<payload.json> CNB_TRIGGER_TOKEN=… node scripts/ci/ci-ga-verdict-title.mjs
 * GA_PR_TITLE="<显式标题>" node scripts/ci/ci-ga-verdict-title.mjs
 * ```
 */
import { appendFileSync, readFileSync } from "node:fs";
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
 * 空串 / 全空白统一成 `""`：三条取值路径的「没拿到」必须同形，
 * 否则下游 `if (!title)` 会在一条路上短路、在另一条路上带着空白继续走。
 *
 * @param {unknown} value 原值
 * @returns {string} 剪过两头空白的结果；非字符串回空串
 */
const trim = (value) => (typeof value === "string" ? value.trim() : "");

/**
 * 从**派发 payload** 里取 PR 标题（`scripts/ci/ci-mirror-payload.mjs` 的 `dispatchPayload`）。
 *
 * 只认 `client_payload.pr_title`：那是镜像格读平台 `data.title` 之后塞进 payload 的
 * 那一份，与 `run-name` 的 `pr_title` 同一来源。缺键 / 非字符串 / 空白 ⇒ 空串，
 * 调用方按「没有标题」处置（继续走站内读）。
 *
 * @param {unknown} json `GITHUB_EVENT_PATH` 那份 payload
 * @returns {string} 标题；取不到时空串
 */
export function titleFromEvent(json) {
  if (typeof json !== "object" || json === null || !("client_payload" in json)) {
    return "";
  }
  const { client_payload: payload } = json;
  if (typeof payload !== "object" || payload === null || !("pr_title" in payload)) {
    return "";
  }
  return trim(payload.pr_title);
}

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
  return trim(data.title);
}

/**
 * 从 PR 应答里取 PR 号 —— 按需档补读标题时 `pull_number` / `number` 任一即可。
 *
 * 有了它，「站内读标题」这条路就不必再依赖 workflow 表达式算出的 PR 号：
 * 那一枚在按需档上取不到时是空串（#3980 现场那一档就是这样断的）。
 *
 * @param {unknown} json 平台应答
 * @returns {string} 纯数字 PR 号；取不到时空串
 */
export function numberFromPull(json) {
  if (typeof json !== "object" || json === null || !("data" in json)) {
    return "";
  }
  const { data } = json;
  if (typeof data !== "object" || data === null) {
    return "";
  }
  /* `dto.PullRequest` 信封里两种形状都见过：PR 号本身 `number`，
   * 而 `/pulls/{n}` 直读那一层给的是 `pull_number` —— 两个都认，先认后者。 */
  const raw = "pull_number" in data ? data.pull_number : "number" in data ? data.number : "";
  const text = typeof raw === "number" ? String(raw) : trim(raw);
  return /^\d+$/.test(text) ? text : "";
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
 * 读 `GITHUB_EVENT_PATH` 那份 payload；读不到 / 不是 JSON ⇒ `null`（不抛）。
 *
 * 这一步失败只是让标题少一条来源，不该让本可送达的判决送不出去。
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
 * 主流程：环境变量 → 派发 payload → 站内读，三条路取第一个非空标题。
 *
 * `fetchImpl` 是注入面（同 `ci-ga-verdict-callback.mjs` 那一族的做法）：只吃
 * `url` + 回一个 `{ ok, status, json }`，不逼假件去造整个 `Response`。
 *
 * @param {{env?: Record<string, string | undefined>, fetchImpl?: FetchLike, log?: (line: string) => void, readPayload?: (eventPath: string) => unknown}} io
 * @returns {Promise<number>} 0 已落盘 / 2 没拿到
 */
export async function main(io = {}) {
  const env = io.env ?? process.env;
  const log =
    io.log ??
    ((line) => {
      console.log(line);
    });
  const envFile = trim(env.GITHUB_ENV);
  if (!envFile) {
    log("[ga-title] 没有 GITHUB_ENV（不在 actions runner 上？）⇒ 标题传不到下一步");
    return CODE.NO_FACT;
  }

  /* ① 显式注入（手跑复验用；也是唯一能压过 payload 的那条路）。 */
  let title = trim(env[TITLE_ENV_KEY]);
  let source = "env";
  let pr = trim(env.CNB_PULL_REQUEST_IID);

  /* ② 自动档：镜像格送来的 `client_payload.pr_title`（ISSUE #3980 —— 这里此前
   * 读的是 `github.event.pull_request.title`，而本 workflow 没有那个触发形态，
   * 于是自动档从来没写进过任何东西）。PR 号顺带从同一份 payload 取，
   * 免得下游 `/pulls/{n}` 那一步因为表达式算不出号而空转。 */
  if (!title) {
    const payload = (io.readPayload ?? readEventPayload)(trim(env.GITHUB_EVENT_PATH));
    title = titleFromEvent(payload);
    source = "payload";
    if (!pr && typeof payload === "object" && payload !== null && "client_payload" in payload) {
      const { client_payload: body } = payload;
      if (typeof body === "object" && body !== null && "pr_number" in body) {
        const raw = trim(body.pr_number);
        pr = /^\d+$/.test(raw) ? raw : "";
      }
    }
  }

  /* ③ 站内补读：按需档没有 payload（也没有老 payload 的 `pr_title`）。 */
  if (!title) {
    source = "api";
    const repo = trim(env.CNB_REPO_SLUG);
    const token = trim(env.CNB_TRIGGER_TOKEN);
    const endpoint = (env.CNB_API_ENDPOINT || DEFAULT_API_ENDPOINT).replace(/\/+$/, "");
    if (!/^\d+$/.test(pr)) {
      log(`[ga-title] 前两条路都没有标题，且 PR 号缺席或不是纯数字（${pr || "空"}）⇒ 回落平台缺省`);
      return CODE.NO_FACT;
    }
    if (!repo || !token) {
      log("[ga-title] 前两条路都没有标题，且仓库 slug 或令牌缺席 ⇒ 回落平台缺省");
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
      const json = await response.json();
      title = titleFromPull(json);
      if (!title) {
        /* 应答里 PR 号还在的话，把它写回去 —— 下一跳要的是「这条属于哪张 PR」，
         * 与标题是两件事，缺标题不该连号一起丢掉。 */
        pr = pr || numberFromPull(json);
      }
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
