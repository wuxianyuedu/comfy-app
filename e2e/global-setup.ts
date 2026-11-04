/**
 * 跑 e2e 期间的**说话人**：说清「谁在替身 / 应用端口上」（ISSUE #1756 / #1766）。Playwright 先起 webServer 再
 * 跑 `globalSetup`，所以判「起之前有没有别人」不能活在这里（会恒判复用）；那条在 `scripts/e2e-run.mjs` 的
 * pre-flight（经 `E2E_PREFLIGHT` 带进来）。这里只剩：说清端口上是本轮自起还是起前就在、拿不到结论时仍阻断陌生服务；不因真件在跑而失败。
 */
import { resolveAppPort, resolveRepoRoot } from "../scripts/app-port.mjs";
import { E2E_PREFLIGHT_ENV_KEY, decodePreflight } from "./support/preflight-ports.mjs";
import {
  classifyFakeSlot,
  describeAppReuseConflict,
  describeSlotConflict,
  fakeComfyuiBaseUrl,
  fakeComfyuiStatsUrl,
  resolveFakeComfyuiHost,
  resolveFakeComfyuiPort,
} from "./support/fake-comfyui-endpoint.mjs";

/** 一次探针的观测结果。 */
export type FakeSlotObservation = {
  /** 连不上时的原因，仅供日志。 */
  error?: string;
  /** 200 时的响应体（解析不出 JSON 时是 null）。 */
  payload?: unknown;
  /** HTTP 状态码；连不上（服务不在）是 **0**，不是错误。 */
  status: number;
};

/**
 * 探一次替身端口，把「谁在那儿」收成判决（导出以便用临时 HTTP 服务真跑一次）。「端口空着」与「没来得及答」
 * 必须分开（ISSUE #1961）：CPU 争用下已监听的本地服务也会超时 ⇒ `status: 0` 被判 `free`，而 `free` 会放行
 * 本应阻断的那格 —— 只有连接层被拒（`ECONNREFUSED`/`ENOTFOUND`/`EHOSTUNREACH`）算空着，`TimeoutError` 归 `unknown`。
 */
export async function probeFakeComfySlot(
  options: { timeoutMs?: number; url?: string } = {},
): Promise<FakeSlotObservation> {
  const url = options.url ?? fakeComfyuiStatsUrl();
  /* 1500ms 是**本地回环**上探一个已经起来的服务，本机实测 13ms —— 给两个数量级
   * 的余量。但它不是为高负载准备的：争用下真正要的是「别把超时读成没人」，
   * 那件事由上面的分岔判，不是靠把这个数抬高（抬它只会让真挂死晚 1.5s 被看见）。 */
  const timeoutMs = options.timeoutMs ?? 1500;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.status !== 200) {
      return { status: res.status };
    }
    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      /* 应答不是 JSON：形状两边都不像，交给 classifyFakeSlot 判 unknown */
    }
    return { status: res.status, payload };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    return connectionRefused(error)
      ? /* 连不上 = 端口空着（替身待起）；这是**最常见**的一格，不进 unknown。 */
        { status: 0, error: text }
      : /* 不是「没人」而是「没等到」：归 unknown，让判据拦下并说清。
         * `status: 0` 在这里会**静默放行**，正是本 ISSUE 要收的那一格。 */
        { status: -1, error: `探针没在预算内拿到应答：${text}` };
  }
}

/**
 * 这一下 `fetch` 失败是不是「连接层确实被拒」？Node 的 `fetch`（undici）把 `ECONNREFUSED` 一族包在 `err.cause`，
 * 把预算耗尽报成 `TimeoutError`（`DOMException`）；此前两者都只是「抛了」，同一个 `status: 0` 同时表示「没人」与「没等到」。
 * @param {unknown} err
 */
function connectionRefused(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  /* 预算耗尽（含手动 abort）一律**不算**「空着」—— 它回答不了那个问题。 */
  /* SAFETY: 类型断言已复核 */
  const name = (err as { name?: unknown }).name;
  if (name === "TimeoutError" || name === "AbortError") {
    return false;
  }
  /* SAFETY: 类型断言已复核 */
  const code = (err as { cause?: { code?: unknown } }).cause?.code;
  if (typeof code === "string") {
    return ["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH"].includes(code);
  }
  /* 拿不到 `cause.code` 时退回文本：Node 在部分路径上把码并进 message
   * （`connect ECONNREFUSED 127.0.0.1:18188`）。**认不出就按「没等到」处理** ——
   * 反过来的默认值会让「未知故障」静默放行，而那一格的代价见本函数上方。
   * 非 `Error` 的抛出物没有可读文本（`String({})` 是 `[object Object]`），
   * 它同样落进「认不出」那一档 —— 这不需要单独分支，只是别把它当字符串拼。 */
  const text = err instanceof Error ? err.message : "";
  return /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH/.test(text);
}

/**
 * 应用 server 那一边：**起 Playwright 之前**端口上有人吗？本函数**不再自己探测**（#1766）：它跑在 webServer
 * 之后，即时探测必探到本轮自起的 server；现在只读 `scripts/e2e-run.mjs` 的 pre-flight 结论，把「起前有人」
 * 与「自起」分开；拿不到结论（手工跑）返回 `null` =「不知道」，调用方据此保持沉默。
 */
export function readAppServerPreflight(
  env: Record<string, string | undefined> = process.env,
): { occupiedBefore: boolean } | null {
  const preflight = decodePreflight(env[E2E_PREFLIGHT_ENV_KEY]);
  if (!preflight) {
    return null;
  }
  return { occupiedBefore: preflight.appOccupied };
}

/**
 * 替身端口这一边：**起 Playwright 之前**它上面有人吗？与 `readAppServerPreflight` 同形（同一份 pre-flight
 * 结论的另一栏）。判据是「起之前有人 ⇒ 这一轮会走复用」，而非「现在有人应答」—— 后者在 `globalSetup`
 * 这个时机恒真（本轮自己起的）。
 */
export function readFakeSlotPreflight(
  env: Record<string, string | undefined> = process.env,
): { occupiedBefore: boolean } | null {
  const preflight = decodePreflight(env[E2E_PREFLIGHT_ENV_KEY]);
  if (!preflight) {
    return null;
  }
  return { occupiedBefore: preflight.fakeOccupied };
}

export default async function globalSetup(): Promise<void> {
  const host = resolveFakeComfyuiHost();
  const port = resolveFakeComfyuiPort();

  /* 应用端口这一格：**起之前**就有别人的 server ⇒ 它会被复用、注入的 env 到不了。
   * 本轮自己起的那个不算（那正是 ISSUE #1766 的立案形态）。 */
  const appPreflight = readAppServerPreflight();
  if (appPreflight?.occupiedBefore && !process.env.CI) {
    throw new Error(describeAppReuseConflict({ port: resolveAppPort(resolveRepoRoot()) }));
  }

  /* 替身端口这一格分两层：① pre-flight 说「起之前就有人」⇒ 真复用，说一声（替身的 history 是进程内存，
   *   跨次复用会带着上一轮产物行）；② 现在应答的不是替身（真件 / 陌生服务）⇒ 无论起前是什么都当场阻断
   *   —— 这是 pre-flight 覆盖不到的兜底。两者不重复：① 说的是「谁的进程」，② 说的是「它是什么」。 */
  const observed = await probeFakeComfySlot({
    url: fakeComfyuiStatsUrl({ host, port }),
  });
  const { verdict } = classifyFakeSlot(observed);
  if (verdict === "free" || verdict === "fake") {
    const fakePreflight = readFakeSlotPreflight();
    if (verdict === "fake" && fakePreflight?.occupiedBefore) {
      /* 只有「起之前就在」才叫复用 —— ISSUE #1766 之前这里对**自己起的**那一个
       * 也这么说，一句话术在两条路径上说反了一件事。 */
      process.stdout.write(
        `[e2e] 替身 ${fakeComfyuiBaseUrl({ host, port })} 已在运行（复用）；` +
          "它的 history 带着上一轮的产物。\n",
      );
    }
    return;
  }
  throw new Error(describeSlotConflict(observed, { host, port }));
}
