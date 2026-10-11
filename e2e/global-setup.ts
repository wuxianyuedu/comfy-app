/**
 * 跑 e2e 期间的**说话人**：把「谁在替身 / 应用端口上」说清楚（ISSUE #1756 / #1766）。
 *
 * ## 它在守哪一格
 *
 * 假 ComfyUI 与真 ComfyUI 是**两个不同的东西**，而 Playwright 的
 * `reuseExistingServer` 只问「这个地址上有没有人应答」——它不区分谁在应答。
 * 于是「8188 上是真件」这件事此前**没有任何执行者**，表现是一堆依赖替身
 * 脚本化收口的用例报成「功能红」（`main-journey` 的话术甚至在说「执行器收口
 * 失败」，而真因是下游替身一行都没跑）。
 *
 * 修复取向见 `e2e/support/fake-comfyui-endpoint.mjs` 的文件头：**替身换到
 * 自己的端口**（不必要求任何人停掉真件），本文件补的是那之后仍然存在的一格
 * ——替身端口上万一坐着别人（有人把 ComfyUI 配到了 `18188`），也要当场说清，
 * 而不是让用例静默红。
 *
 * ## 为什么判据不挂在这里（ISSUE #1766 的订正）
 *
 * 本文件曾经把**两半**判据都挂在这里，而那是一条必然自击的机关：Playwright 的
 * 顺序是「**起 webServer 并等它可访问** → 跑 `globalSetup`」（上游
 * `runGlobalSetup()` 把 webServer 作为 plugin 的 `setup()` 先跑完，`globalSetup`
 * 是那一刻之后的任务），所以到这一步时**本轮自己起的 server 一定已经在跑**：
 *
 *   · 应用端口那半 → `reused` 恒真 → `if (reused && !CI) throw` 在本地全量跑上
 *     一条用例都没跑就红在启动；
 *   · 替身端口那半 → 判成 `fake` → 每次都打「替身已在运行（复用）」，而那不是复用。
 *
 * 判据要问的是「**在我起 server 之前**那个端口上有没有别人」——那它就不能活在这
 * 个时机里。现在那条判据在 `scripts/e2e-run.mjs` 的 pre-flight
 * （`e2e/support/preflight-ports.mjs`，跑在 `spawn` Playwright 之前），结论经
 * `E2E_PREFLIGHT` 带到本文件。
 *
 * ## 本文件还剩的两件事
 *
 *   ① **说话**：替身端口有人应答时，说清「是本轮自己起的」还是「起之前就在的」
 *      ——后者才叫复用，也才需要提醒「它的 history 带着上一轮的产物」；
 *   ② **兜底**：拿不到 pre-flight 结论时（有人手工 `pnpm exec playwright test`），
 *      仍然把「替身端口上坐着的不是替身」这一格当场阻断 —— 那是 pre-flight 那条
 *      路径覆盖不到的一格，而不是它的重复。
 *
 * ## 它不做的事
 *
 * **不失败在「真件在跑」上**：8188 上有真 ComfyUI 是**正常状态**，不是故障
 * ——本 ISSUE 的取向就是不要求任何人停它（见上）。这里只判替身自己那个口。
 */
import { resolveAppPort } from "../scripts/app-port.mjs";
import {
  E2E_PREFLIGHT_ENV_KEY,
  decodePreflight,
} from "./support/preflight-ports.mjs";
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
export interface FakeSlotObservation {
  /** HTTP 状态码；连不上（服务不在）是 **0**，不是错误。 */
  status: number;
  /** 200 时的响应体（解析不出 JSON 时是 null）。 */
  payload?: unknown;
  /** 连不上时的原因，仅供日志。 */
  error?: string;
}

/**
 * 探一次替身端口，把「谁在那儿」收成一个判决。
 *
 * 抽成导出函数是为了让判决能被真跑一次（`tests/e2e-fake-comfyui-endpoint.test.ts`
 * 拿一个临时 HTTP 服务喂它），而不是只在 Playwright 起得来时才被执行。
 *
 * 连接被拒（服务不在）**不是错误**：那正是「替身会由 webServer 正常起来」的
 * 前提，`fetch` 抛出的那一下翻成 `status: 0`。
 */
export async function probeFakeComfySlot(
  options: { url?: string; timeoutMs?: number } = {},
): Promise<FakeSlotObservation> {
  const url = options.url ?? fakeComfyuiStatsUrl();
  const timeoutMs = options.timeoutMs ?? 1500;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.status !== 200) return { status: res.status };
    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      /* 应答不是 JSON：形状两边都不像，交给 classifyFakeSlot 判 unknown */
    }
    return { status: res.status, payload };
  } catch (err) {
    /* 连不上 = 端口空着（替身待起）；这是**最常见**的一格，不进 unknown。 */
    return {
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 应用 server 那一边：**起 Playwright 之前**那个端口上有别人吗？
 *
 * ⚠️ 本函数**不再自己探测**（ISSUE #1766）。它曾经拿一次即时探测的结论当判据，
 * 而本文件跑在 webServer 之后 —— 那个探测必然探到**本轮自己起的** server，
 * 于是「复用」二字成了对自起服务的误判。
 *
 * 现在它只把 pre-flight（`scripts/e2e-run.mjs` 在 spawn 之前跑的）结论读出来，
 * 并**把「起之前有人」与「本轮自己起的」分开**：`globalSetup` 跑在 webServer
 * 之后，只凭「有人应答」永远分不开这两件事，而 pre-flight 那条事实正好补上另一半。
 *
 * 拿不到 pre-flight 结论（手工 `pnpm exec playwright test`）时返回 `null`：
 * 那一格是「不知道」而不是「没有」，调用方据此保持沉默（不阻断、也不误报复用）。
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {{occupiedBefore: boolean} | null}
 */
export function readAppServerPreflight(
  env: Record<string, string | undefined> = process.env,
): { occupiedBefore: boolean } | null {
  const preflight = decodePreflight(env[E2E_PREFLIGHT_ENV_KEY]);
  if (!preflight) return null;
  return { occupiedBefore: preflight.appOccupied };
}

/**
 * 替身端口这一边：**起 Playwright 之前**它上面有人吗？
 *
 * 与 `readAppServerPreflight` 同形（同一份 pre-flight 结论的另一栏）。判据是
 * 「起之前有人 ⇒ 这一轮会走复用」，而不是「现在有人应答」—— 后者在
 * `globalSetup` 这个时机上恒真（本轮自己起的）。
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {{occupiedBefore: boolean} | null}
 */
export function readFakeSlotPreflight(
  env: Record<string, string | undefined> = process.env,
): { occupiedBefore: boolean } | null {
  const preflight = decodePreflight(env[E2E_PREFLIGHT_ENV_KEY]);
  if (!preflight) return null;
  return { occupiedBefore: preflight.fakeOccupied };
}

export default async function globalSetup(): Promise<void> {
  const host = resolveFakeComfyuiHost();
  const port = resolveFakeComfyuiPort();

  /* 应用端口这一格：**起之前**就有别人的 server ⇒ 它会被复用、注入的 env 到不了。
   * 本轮自己起的那个不算（那正是 ISSUE #1766 的立案形态）。 */
  const appPreflight = readAppServerPreflight();
  if (appPreflight?.occupiedBefore && !process.env.CI) {
    throw new Error(
      describeAppReuseConflict({ port: resolveAppPort(process.cwd()) }),
    );
  }

  /* 替身端口这一格分两层：
   *   ① pre-flight 说「起之前就有人」⇒ 这一轮是**真复用**，说一声（替身的
   *      history 是进程内存，跨次复用会带着上一轮的产物行）；
   *   ② 现在应答的不是替身（真件 / 陌生服务）⇒ 无论起之前是什么，都当场阻断
   *      —— 这是 pre-flight 覆盖不到的兜底（手工跑 Playwright 时它不在）。
   * 两者不重复：① 说的是「谁的进程」，② 说的是「那个进程是什么」。 */
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
