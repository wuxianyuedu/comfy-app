/**
 * 起 Playwright **之前**的端口占用探测：谁在跑是「真实世界状态」，不是「本轮自己起的」（ISSUE #1766）。
 * `globalSetup` 跑在 webServer 之后，会把 Playwright 刚起的那个探成冲突（`reused && !CI` 必然自击）。
 * 故 `e2e-run.mjs` 在 spawn 前调本模块，结论经 `E2E_PREFLIGHT_ENV_KEY` 带回；只判本应用两个端口（8188 真件在跑属正常）。
 */
import net from "node:net";

/** 承载 pre-flight 结论的环境变量键（`e2e-run.mjs` 写、`globalSetup` 读）。 */
export const E2E_PREFLIGHT_ENV_KEY = "E2E_PREFLIGHT";

/**
 * 一次 pre-flight 的结论：两个端口在起 Playwright 之前有没有人应答。两个布尔各答一件事（不合并成「有冲突」
 * —— 冲突要看「谁在应答」，这里只回答得了「有没有人在」）。
 * @typedef {{appOccupied: boolean, fakeOccupied: boolean}} PreflightResult
 */

/**
 * 探一次端口有没有人应答。用 TCP 而非 HTTP：`fetch` 会等响应头，而「占了端口却不答 HTTP」的进程照样是占用
 * —— 只判「连得上吗」更准也更便宜。连接被拒不是错误（同 `probeFakeComfySlot` 那条边界），「是谁」由
 * `classifyFakeSlot` 在 `globalSetup` 判（它拿得到 payload）。
 * @param {number} port @param {{host?: string, timeoutMs?: number}} [options] @returns {Promise<boolean>} */
export function probePortOccupied(port, options = {}) {
  const host = options.host ?? "127.0.0.1";
  const timeoutMs = options.timeoutMs ?? 1000;
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    let settled = false;
    /** @param {boolean} occupied */
    const done = (occupied) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(occupied);
    };
    socket.setTimeout(timeoutMs);
    socket.on("connect", () => {
      done(true);
    });
    socket.on("timeout", () => {
      done(false);
    });
    socket.on("error", () => {
      done(false);
    });
  });
}

/**
 * 起 Playwright 之前探两个端口：应用端口与替身端口（结论原样进 `PreflightResult`）。
 * @param {{appPort: number, fakePort: number, host?: string, timeoutMs?: number}} input @returns {Promise<PreflightResult>} */
export async function runPreflight(input) {
  const [appOccupied, fakeOccupied] = await Promise.all([
    probePortOccupied(input.appPort, input),
    probePortOccupied(input.fakePort, input),
  ]);
  return { appOccupied, fakeOccupied };
}

/**
 * 把结论编码成**一行 JSON** 交给子进程。走环境变量而不是临时文件：`e2e-run.mjs` 起 Playwright 是同步 `spawnSync`，
 * 落盘会留下「谁写谁清」的次级问题（按次命名的临时文件正是本仓库反复踩过的那类）。一行 JSON 也让它肉眼可读。
 * @param {PreflightResult} result @returns {string}
 */
export function encodePreflight(result) {
  return JSON.stringify({
    appOccupied: !!result.appOccupied,
    fakeOccupied: !!result.fakeOccupied,
  });
}

/**
 * 解码 `encodePreflight` 的产出。**读不出就当没有**（返回 null）而不是抛：这是「让话术更准」的增强，不是判据地基。
 * 手工 `pnpm exec playwright test` 直接跑时它根本不存在，那时 `globalSetup` 该按「不知道」说话而不是崩掉。
 * @param {string | undefined} raw @returns {PreflightResult | null}
 */
export function decodePreflight(raw) {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (typeof parsed.appOccupied !== "boolean") {
      return null;
    }
    if (typeof parsed.fakeOccupied !== "boolean") {
      return null;
    }
    return {
      appOccupied: parsed.appOccupied,
      fakeOccupied: parsed.fakeOccupied,
    };
  } catch {
    return null;
  }
}

/* ── 上一轮留下的替身：**认出来、收掉**，而不是让 Playwright 抛一句看不懂的错（现场 `cnb-ooc-1k52laqqh`）
 * CI 档 `reuseExistingServer` 为 false，见「已有人应答」直接抛，连 `globalSetup`（会说清「谁在那儿」）都到不了。
 * 只收两条证据都成立的自有残留：命令行点名本仓替身脚本 + `/system_stats` 是替身形状；只在 CI 档生效（本地刻意留复用）。 */

/** 本仓替身脚本的路径片段（命令行判据 ①）—— 与 `playwright.config.ts` 的 webServer
 *  `command` 同一处落点，改那一行时这一行跟着改（`tests/e2e-fake-comfyui-endpoint.test.ts`
 *  判两处一致）。 */
export const FAKE_SERVER_SCRIPT = "e2e/support/fake-comfyui-server.mjs";

/** 命令行是不是**本仓的替身服务**（判据 ①；只答「它是什么」，不答「能不能收」）。
 * 归一化反斜杠并小写：Windows 上同一条命令行可能写正斜杠也可能写反斜杠，两种都真实存在。
 * @param {string | null | undefined} cmdline @returns {boolean} */
export function isFakeServerCmdline(cmdline) {
  const text = (cmdline ?? "").replaceAll("\\", "/").toLowerCase();
  return text.includes(FAKE_SERVER_SCRIPT.toLowerCase());
}

/** 这一档的收尾结论。
 *
 * @typedef {{reclaimed: number[], foreign: number[], free: boolean}} ReclaimResult
 */

/**
 * 端口上那些占位者里，哪几个是**我们自己的替身**（两条证据都要）。纯函数：两条证据都已取好再喂进来
 * （`cmdlineOf` / `answersFake` 查表），所以能被直接断言，不必真起进程、也不必做成异步（同 `classifyFakeSlot`）。
 * @param {number[]} pids @param {{cmdlineOf: (pid: number) => string, answersFake: (pid: number) => boolean}} evidence @returns {number[]}
 */
export function pickOwnFakePids(pids, evidence) {
  return pids.filter(
    (pid) => isFakeServerCmdline(evidence.cmdlineOf(pid)) && evidence.answersFake(pid),
  );
}
