/**
 * 起 Playwright 之前探一次「这一档的浏览器真能起来吗」：缺件时 81 条用例全红在同一个 `browserType.launch`，
 * 而 headless 档要的是 `chromium-headless-shell`（与 `executablePath()` 给的 `chromium` 不是同一份；ISSUE #1948）。
 * 判据是**真起一次**（要哪个二进制是 Playwright 内部决议，清单会随版本漂）；且**不自动下载**，缺件只给命令。
 */

/**
 * 缺件时给用户的那条命令。写成「这一档要用的那两件」而非裸 `playwright install`（后者会全量拉三种浏览器、
 * 数百 MiB），而本仓只跑 chromium；两个都写是因为 `chromium` 那份也可能缺（headed / 断言截图路径要它）。
 */
export const BROWSER_INSTALL_HINT = "pnpm exec playwright install chromium chromium-headless-shell";

/**
 * @typedef {{verdict: "ready" | "missing" | "unknown",
 *             detail?: string, executablePath?: string, installHint?: string}} BrowserPreflight
 */

/**
 * 「起一次浏览器」的默认实现 —— 真起、真关。`launch` 抽成参数是为了两个方向都能被真跑：
 * 缺件那一侧在**任何**机器上都能用「喂一个会抛的 launch」复核。
 * @returns {Promise<{ok: true} | {ok: false, error: Error}>}
 */
async function defaultLaunch() {
  try {
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch();
    await browser.close();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: /** @type {Error} */ (error) };
  }
}

/**
 * 从 Playwright 的报错里抠出「它期望的那个可执行文件路径」（话术 `Executable doesn't exist at <path>`，本机实测逐字如此）；抠不出返回 null，退化成原文，**不猜**。
 * @param {string} message
 * @returns {string | null}
 */
export function parseMissingExecutable(message) {
  const m = /Executable doesn't exist at (?<path>.+?)(?:\n|$)/.exec(message);
  const captured = m?.groups?.path;
  return captured ? captured.trim() : null;
}

/**
 * 判「这一档的浏览器能不能起来」；`launch` 可注入，便于复核两个方向。
 * @param {{launch?: typeof defaultLaunch}} [options]
 * @returns {Promise<BrowserPreflight>}
 */
export async function checkBrowserReady(options = {}) {
  const launch = options.launch ?? defaultLaunch;
  /** @type {Awaited<ReturnType<typeof defaultLaunch>>} */
  let result;
  try {
    result = await launch();
  } catch (error) {
    /* 注入的 launch 直接抛（而不是回 `{ok:false}`）：与「起不来」是同一件事的
     * 两种写法，都收进 missing 那一档。 */
    result = { ok: false, error: /** @type {Error} */ (error) };
  }
  if (result.ok) {
    return { verdict: "ready" };
  }

  // oxlint-disable-next-line no-unnecessary-condition -- error 是 catch 的 unknown 断言，注入的 launch 可能不回该字段，保留运行期守卫
  const message = result.error?.message ?? "";
  const executablePath = parseMissingExecutable(message);
  if (executablePath === null) {
    /* 起不来的**别的原因**（权限、缺系统库、沙箱）也在这一档：它们同样是
     * 「跑下去全档红」，但出口不同 —— 本模块只回答一件事，所以把原文带上。 */
    return {
      verdict: "missing",
      detail: "浏览器起不来（不是缺文件，见下面 Playwright 的原话）",
      installHint: BROWSER_INSTALL_HINT,
      executablePath: undefined,
      ...{ raw: message.split("\n").slice(0, 4).join("\n") },
    };
  }
  return {
    verdict: "missing",
    executablePath,
    installHint: BROWSER_INSTALL_HINT,
    detail:
      "Playwright 要用的浏览器二进制不在（headless 档走的是 chromium_headless_shell，" +
      "它与完整 chromium 是**两个**下载物）",
  };
}

/**
 * 缺件时给人看的那段话（`e2e-run.mjs` 直接打印它）。收在这里与判决同源，改一处就够（§12.12）。
 * @param {BrowserPreflight & {raw?: string}} preflight
 * @returns {string}
 */
export function describeBrowserMissing(preflight) {
  const lines = [`[e2e] ✗ ${preflight.detail ?? "浏览器缺件"}`];
  if (preflight.executablePath) {
    lines.push(`[e2e]   期望的路径：${preflight.executablePath}`);
  }
  if (preflight.raw) {
    lines.push(`[e2e]   Playwright 原话：${preflight.raw}`);
  }
  lines.push(`[e2e]   补它：${preflight.installHint}`);
  lines.push("[e2e]   跑下去的下场：全档每一条都报同一个 launch 失败，看不出真正要修的是什么。");
  return lines.join("\n");
}
