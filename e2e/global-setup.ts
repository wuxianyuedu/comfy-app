/**
 * 跑 e2e 之前的**正面探测**（ISSUE #1756）。
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
 * ## 为什么是 globalSetup 而不是 webServer 的 command
 *
 * `reuseExistingServer` 为真时 Playwright **不会执行** `command`（那是它复用
 * 的语义），把探测放进 command 就等于「最需要它的那条路径上它偏不跑」。
 * `globalSetup` 无论复用与否都先跑一次，是唯一能覆盖两种情形的落点。
 *
 * ## 它做的第二件事：应用 server 被复用时说清楚
 *
 * Playwright 的 `reuseExistingServer` 有一条不显眼的语义：命中复用就**直接返回**
 * （`_startProcess()` 的 early return），`webServer.env` **根本不会被应用** ——
 * 也就是说这里注入的 `COMFYUI_BASE` 只在「它自己起 server」那条路上生效。
 * 一个本机常驻的 dev server（另一个窗口里的 `pnpm dev`）被复用时，应用会按它
 * **自己的**设置去连 ComfyUI（默认就是 8188 上的真件），替身又一次空跑。
 *
 * 这条与 ISSUE #1756 是同一个故障的两个面，所以在这里一并探掉。
 *
 * ## 它不做的事
 *
 * **不失败在「真件在跑」上**：8188 上有真 ComfyUI 是**正常状态**，不是故障
 * ——本 ISSUE 的取向就是不要求任何人停它（见上）。这里只判替身自己那个口。
 */
import { resolveAppPort } from "../scripts/app-port.mjs";
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
 * 应用 server 那一边：有人应答 ⇒ Playwright 会走「复用」，注入的环境变量
 * （`COMFYUI_BASE` / `E2E_FAKE_COMFY_*`）**到不了**那个已经跑着的进程。
 *
 * @param {{port?: number, timeoutMs?: number}} [options]
 * @returns {Promise<{reused: boolean, status: number}>}
 */
export async function probeAppServerReuse(
  options: { port?: number; timeoutMs?: number } = {},
): Promise<{ reused: boolean; status: number }> {
  const port = options.port ?? resolveAppPort(process.cwd());
  try {
    const res = await fetch(`http://localhost:${port}/`, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 1500),
    });
    return { reused: true, status: res.status };
  } catch {
    return { reused: false, status: 0 };
  }
}

export default async function globalSetup(): Promise<void> {
  const host = resolveFakeComfyuiHost();
  const port = resolveFakeComfyuiPort();
  /* 先判这一格：应用 server 已被别处跑着时，**下面注入的 env 一行都到不了它**，
   * 用例会拿一个连真件的应用去跑（本 ISSUE 的同一个故障，另一个面）。 */
  const appServer = await probeAppServerReuse();
  if (appServer.reused && !process.env.CI) {
    throw new Error(
      describeAppReuseConflict({ port: resolveAppPort(process.cwd()) }),
    );
  }

  const observed = await probeFakeComfySlot({
    url: fakeComfyuiStatsUrl({ host, port }),
  });
  const { verdict } = classifyFakeSlot(observed);
  if (verdict === "free" || verdict === "fake") {
    if (verdict === "fake") {
      /* 复用已有替身要说一声：替身的 history 是进程内存，跨次复用会带着上一轮
       * 的产物行 —— 用例若按「本轮新产物」断言，噪声就来自这里。 */
      process.stdout.write(
        `[e2e] 替身 ${fakeComfyuiBaseUrl({ host, port })} 已在运行（复用）；` +
          "它的 history 带着上一轮的产物。\n",
      );
    }
    return;
  }
  throw new Error(describeSlotConflict(observed, { host, port }));
}
