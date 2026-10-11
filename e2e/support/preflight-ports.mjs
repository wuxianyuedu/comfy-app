/**
 * 起 Playwright **之前**的端口占用探测：谁在跑是「真实世界状态」，不是「本轮自己起的」。
 *
 * ## 它修的那一格（ISSUE #1766）
 *
 * `e2e/global-setup.ts` 的探测此前挂在 `globalSetup` 上，而 Playwright 的顺序是
 * 「**起 webServer 并等它可访问** → 跑 `globalSetup`」——于是同一份探测在本地
 * 全量跑上必然探到 **Playwright 自己刚起的那一个**：
 *
 *   · 应用端口那半：`reused === true` → `if (reused && !CI) throw` 是**必然自击**
 *     的机关，一条用例都没跑就红在启动；
 *   · 替身端口那半：判成 `fake` → 每次都打「替身已在运行（复用）；它的 history
 *     带着上一轮的产物」，而那根本不是复用。
 *
 * 判据要问的是「**在我起 server 之前**那个端口上有没有别人」，那它就不能挂在
 * `globalSetup` 上。本模块是那个问题的答案：`scripts/e2e-run.mjs` 在 `spawn`
 * Playwright **之前**调它，那时端口状态就是真实世界状态；结论随一次运行带下去。
 *
 * ## 为什么结论要带回 `globalSetup`，而不是就此消失
 *
 * 两个位置各能回答一半：
 *   · **pre-flight（本模块）** 回答「起之前有没有别人」——替身端口上坐着真件 /
 *     陌生服务、应用端口上坐着一个**别人的** dev server，都只能在这里判；
 *   · **`globalSetup`** 回答「谁在跑」——它跑在 webServer 之后，看到的是
 *     「本轮的 server」+「起之前就在的」之和，所以它只能**说话**（复用时提示
 *     替身的 history 不是本轮的），不能再凭「有人应答」判冲突。
 *
 * 把「起之前就在」这个事实带过去（`E2E_PREFLIGHT_ENV_KEY`），`globalSetup` 才能
 * 把两者分开：本轮自己起的不说「复用」，起之前就在的才说。
 *
 * ## 它不阻断「真件在跑」
 *
 * 8188 上有真 ComfyUI 是**正常状态**（`fake-comfyui-endpoint.mjs` 的文件头就是
 * 「不必停真件」的取向），本模块只判两个**本应用自己的端口**。
 */
import net from "node:net";

/** 承载 pre-flight 结论的环境变量键（`e2e-run.mjs` 写、`globalSetup` 读）。 */
export const E2E_PREFLIGHT_ENV_KEY = "E2E_PREFLIGHT";

/**
 * 一次 pre-flight 的结论：**两个端口在起 Playwright 之前**有没有人应答。
 *
 * 两个布尔各回答一件事，不合并成一个「有冲突」——冲突与否要看「谁在应答」，
 * 而这里只回答得了「有没有人在」。
 *
 * @typedef {{appOccupied: boolean, fakeOccupied: boolean}} PreflightResult
 */

/**
 * 探一次端口有没有人应答。
 *
 * 与 `global-setup.ts` 的 `probeFakeComfySlot` **同一条边界**（连接被拒不是错误），
 * 但这里不需要响应体：pre-flight 只回答「有没有人在」，至于是谁由
 * `classifyFakeSlot` 在 `globalSetup` 那一步判（它拿得到 payload）。
 *
 * 用 TCP 连接而不是 HTTP：`fetch` 会等响应头，而「占了端口的进程不答 HTTP」
 * （比如某些代理 / 半死的进程）照样是占用 —— 只判「连得上吗」更准也更便宜。
 *
 * @param {number} port
 * @param {{host?: string, timeoutMs?: number}} [options]
 * @returns {Promise<boolean>}
 */
export function probePortOccupied(port, options = {}) {
  const host = options.host ?? "127.0.0.1";
  const timeoutMs = options.timeoutMs ?? 1000;
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    let settled = false;
    /** @param {boolean} occupied */
    const done = (occupied) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(occupied);
    };
    socket.setTimeout(timeoutMs);
    socket.on("connect", () => done(true));
    socket.on("timeout", () => done(false));
    socket.on("error", () => done(false));
  });
}

/**
 * 起 Playwright 之前探两个端口：应用端口与替身端口。
 *
 * @param {{appPort: number, fakePort: number, host?: string, timeoutMs?: number}} input
 * @returns {Promise<PreflightResult>}
 */
export async function runPreflight(input) {
  const [appOccupied, fakeOccupied] = await Promise.all([
    probePortOccupied(input.appPort, input),
    probePortOccupied(input.fakePort, input),
  ]);
  return { appOccupied, fakeOccupied };
}

/**
 * 把结论编码成**一行 JSON** 交给子进程。
 *
 * 走环境变量而不是临时文件：`e2e-run.mjs` 起 Playwright 是同步 `spawnSync`，
 * 结论是**这一次运行**的事实，落盘会留下一个「谁写谁清」的次级问题（而按次命名
 * 的临时文件正是本仓库反复踩过的那类）。一行 JSON 也让它肉眼可读。
 *
 * @param {PreflightResult} result
 * @returns {string}
 */
export function encodePreflight(result) {
  return JSON.stringify({
    appOccupied: !!result.appOccupied,
    fakeOccupied: !!result.fakeOccupied,
  });
}

/**
 * 解码 `encodePreflight` 的产出。**读不出就当没有**（返回 null）而不是抛。
 *
 * 不抛的理由：这份结论是「让话术更准」的增强，不是判据的地基。手工 `pnpm exec
 * playwright test` 直接跑时它根本不存在（那时 `globalSetup` 该按「不知道」说话，
 * 而不是崩掉 —— 那条路本来就该能跑）。
 *
 * @param {string | undefined} raw
 * @returns {PreflightResult | null}
 */
export function decodePreflight(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.appOccupied !== "boolean") return null;
    if (typeof parsed.fakeOccupied !== "boolean") return null;
    return {
      appOccupied: parsed.appOccupied,
      fakeOccupied: parsed.fakeOccupied,
    };
  } catch {
    return null;
  }
}
