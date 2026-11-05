#!/usr/bin/env node
/**
 * `ci-github-verdict-request.mjs` —— 判决回读那一族共用的**读一跳**（从
 * `ci-github-verdict-read.mjs` 拆出，ISSUE #3051 之后的 job 日志回读也要用）。
 *
 * 为什么单独一份：`scripts/check-infra-file-size.cjs` 对 `scripts/**` 是硬闸（>900 行即红），
 * 而回读主体已经贴着上限。拆出「请求怎么发、怎么重试、怎么脱敏」这一层，让
 * 判定（verdict-read）与日志（verdict-logs）各留自己的余量。
 *
 * 边界与原来一字不差：
 *
 * 1. **单次请求 30s**（{@link CHECK_RUNS_TIMEOUT_MS}）—— 与镜像格探活同一量级；
 *    通的时候 api.github.com 这一读是亚秒级，30s 把「慢但活着」的抖动与「没通」分开。
 * 2. **只有网络类失败才重试**（至多 {@link REQUEST_MAX_ATTEMPTS} 次，退避 5s / 10s）。
 *    401/403 与其余 HTTP 错误一律不重试：重试权限问题只会把真问题拖慢，还把
 *    「令牌缺 `actions: read`」读成「网络不好」。
 * 3. **不打令牌值**（硬规则 17）：失败回话体先过 `sanitize`；成功回话（含日志正文）
 *    由调用方再过 `redactSecrets`（`ci-github-verdict-logs.mjs`）。
 */
import { isEgressFailure, sanitize } from "./ci-github-mirror-push.mjs";
/* 退避表自 2026-11-05 起单独一份（主文件贴着 900 行闸，不再转出这一组常量）。
 * 这一格只吃表的前两项（`REQUEST_MAX_ATTEMPTS` = 3），与改口径前逐值相同。 */
import { RETRY_BACKOFF_MS } from "./ci-mirror-retry-policy.mjs";

/** 单次请求的墙钟上限（同原 `ci-github-verdict-read.mjs`）。 */
export const CHECK_RUNS_TIMEOUT_MS = 30_000;

/** 单次读数的尝试上限：首跳 + 2 次重试。 */
export const REQUEST_MAX_ATTEMPTS = 3;

/**
 * 是不是一个可按键取值的对象（异常对象是 `unknown`，先过这一跳再读字段）。
 *
 * @param {unknown} value 任意值
 * @returns {value is Record<string, unknown>} true ⇒ 对象
 */
function isRecord(value) {
  return typeof value === "object" && value !== null;
}

/**
 * 这一次失败值不值得再试：egress 正则（与镜像格同源）之外，补 Node `fetch`
 * 在网络层抛出的那一族（`fetch failed` 与 `cause.code` 上的 `E*` 错误码）。
 *
 * @param {unknown} error `fetch` 抛出的异常
 * @returns {boolean} true ⇒ 网络根本没到 GitHub，重试有意义
 */
export function isRetryableRequestFailure(error) {
  const e = isRecord(error) ? error : {};
  const cause = isRecord(e.cause) ? e.cause : {};
  const text = String(e.message ?? error);
  const code = String(cause.code ?? "");
  return (
    isEgressFailure(text) ||
    /fetch failed|network|socket|econnreset|econnrefused|enotfound|etimedout|eai_again/i.test(
      text,
    ) ||
    /^(?:ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN)$/i.test(code)
  );
}

/**
 * 带单次上限的一次请求：到点 abort 并把异常翻成含「超时」字样的 Error ——
 * 那一形正好落进 `isEgressFailure` / `isRetryableRequestFailure` 的判据。
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
 * 一跳读数的公共骨架（JSON / 文本两种回话共用重试与超时口径）。
 *
 * @param {{fetchImpl: typeof fetch, log: (line: string) => void, sleep: (ms: number) => Promise<void>, token: string}} io
 * @param {string} url 请求目标
 * @param {string} label 路径名（进重试与超时日志）
 * @param {(res: Response) => Promise<unknown>} readBody 200 时怎么读回话体
 * @returns {Promise<{ok: true, body: unknown} | {ok: false, kind: "auth" | "http", status: number, body: string} | {ok: false, kind: "egress", error: string}>} 读数结果
 */
async function requestWithRetry(io, url, label, readBody) {
  const { fetchImpl, log, sleep, token } = io;
  let lastError = "";
  for (let attempt = 1; attempt <= REQUEST_MAX_ATTEMPTS; attempt += 1) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- 脚本按步串行（命令行/进程编排），并行会打乱启动与回收顺序
      const res = await fetchWithTimeout(fetchImpl, url, token, label);
      if (res.status === 200) {
        // oxlint-disable-next-line no-await-in-loop -- 脚本按步串行（命令行/进程编排），并行会打乱启动与回收顺序
        return { body: await readBody(res), ok: true };
      }
      // oxlint-disable-next-line no-await-in-loop -- 脚本按步串行（命令行/进程编排），并行会打乱启动与回收顺序
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
      // oxlint-disable-next-line no-await-in-loop -- 脚本按步串行（命令行/进程编排），并行会打乱启动与回收顺序
      await sleep(wait);
    }
  }
  return { error: lastError, kind: "egress", ok: false };
}

/**
 * @typedef {{ok: true, body: unknown} | {ok: false, kind: "auth", status: number, body: string} | {ok: false, kind: "http", status: number, body: string} | {ok: false, kind: "egress", error: string}} JsonRead
 * @typedef {{ok: true, text: string} | {ok: false, kind: "auth" | "http", status: number, body: string} | {ok: false, kind: "egress", error: string}} TextRead
 */

/**
 * JSON 读数（runs / checks / jobs 三处共用）。
 *
 * @param {{fetchImpl: typeof fetch, log: (line: string) => void, sleep: (ms: number) => Promise<void>, token: string}} io
 * @param {string} url 请求目标
 * @param {string} label 路径名
 * @returns {Promise<JsonRead>} 读数结果
 */
export async function requestJson(io, url, label) {
  const res = await requestWithRetry(io, url, label, (r) => r.json());
  return /** @type {JsonRead} */ (res);
}

/**
 * 文本读数（job 日志那一跳）。200 且正文为空也算**读到了**（`text: ""`）——
 * 「取不到」与「取到了但为空」是两形读数，调用方必须分得开。
 *
 * @param {{fetchImpl: typeof fetch, log: (line: string) => void, sleep: (ms: number) => Promise<void>, token: string}} io
 * @param {string} url 请求目标
 * @param {string} label 路径名
 * @returns {Promise<TextRead>} 读数结果
 */
export async function requestText(io, url, label) {
  const res = await requestWithRetry(io, url, label, (r) => r.text());
  if (res.ok) {
    return { ok: true, text: String(res.body ?? "") };
  }
  return /** @type {TextRead} */ (res);
}
