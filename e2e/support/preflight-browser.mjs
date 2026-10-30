/**
 * 起 Playwright **之前**探一次「这一档要用的浏览器真的能起来吗」。
 *
 * ## 它修的那一格（ISSUE #1948 现场）
 *
 * `pnpm test:e2e` 在只装了「完整 chrome」的机器 / 容器上会**全档 81 条全红**，
 * 每条都报同一个 `browserType.launch` 失败，期望路径形如
 * `/opt/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`
 * （下面那一段是它的原文，本文件只在错误分支里转发）。
 *
 * 根因不在配置：Playwright 1.63 里 `chromium` 与 `chromium-headless-shell` 是
 * `browsers.json` 里**两个**条目、各自 `installByDefault: true`，而 **headless 档
 * 用的是后者** —— 于是「装过浏览器」与「这一档跑得起来」之间差了半件东西，
 * 而 `chromium.executablePath()` 返回的是前者（实测：它给出
 * `…/chromium-1243/chrome-linux64/chrome`，与 headless 真正要的那个不同）。
 *
 * ## 为什么判据是「真起一次」而不是「按路径猜一下」
 *
 * 因为「要哪一个二进制」是 Playwright 的**内部决议**：headless / headed、channel、
 * host platform 一起决定它，`browsers.json` 的 revision 又会随版本漂。本模块此前
 * 按 `executablePath()` 判 —— 实测那个值在 headless 档**判错方向**（报 ready、
 * 实际缺件），正是本节要修的那档「清单会静默失效」。真起一次拿到的就是同一份
 * 决议，且失败时 Playwright 自己把那**唯一正确的路径**打在错误里。
 *
 * 代价可接受：绿的那一侧是毫秒级的一次 launch（判完即关），红的那一侧实测 9ms
 * 就返回。相比「81 条用例各报一遍」，这一次 launch 便宜到不值得为它省。
 *
 * ## 它不做的事
 *
 * **不自动下载**。缺件的出口是一条命令，而不是在 `pnpm test:e2e` 里静默拉 100+ MiB
 * —— 「跑一次测试顺手改机器状态」会让「这台机器为什么突然慢了」变成一个查不出来
 * 的问题。缺件要么被命令补上、要么被人看见，两条路都比静默下载清楚。
 */

/**
 * 缺件时给用户的那条命令。
 *
 * 写成「这一档要用的那两件」而不是裸 `playwright install`：后者会把三种浏览器
 * 全量拉下来（数百 MiB），而本仓库的 project 只跑 chromium。两个都写是因为
 * `chromium` 自己那一份也可能缺（headed / 断言截图一类路径要它）。
 */
export const BROWSER_INSTALL_HINT = "pnpm exec playwright install chromium chromium-headless-shell";

/**
 * @typedef {{verdict: "ready" | "missing" | "unknown",
 *             detail?: string, executablePath?: string, installHint?: string}} BrowserPreflight
 */

/**
 * 「起一次浏览器」的默认实现 —— 真起、真关。
 *
 * 抽成可注入的（`launch` 是参数）是为了让两个方向都能被真跑一次：
 * 缺件那一侧在**任何**机器上都可以用「喂一个会抛的 launch」复核。
 *
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
 * 从 Playwright 的报错里抠出「它期望的那个可执行文件路径」。
 *
 * Playwright 的话术是 `Executable doesn't exist at <path>`（本机实测逐字如此）。
 * 抠不出来时返回 null —— 那段话就退化成 Playwright 的原文，**不猜**。
 *
 * @param {string} message
 * @returns {string | null}
 */
export function parseMissingExecutable(message) {
  const m = /Executable doesn't exist at (.+?)(?:\n|$)/.exec(message);
  const captured = m?.[1];
  return captured ? captured.trim() : null;
}

/**
 * 判「这一档的浏览器能不能起来」。
 *
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
 * 缺件时给人看的那段话（`e2e-run.mjs` 直接打印它）。
 *
 * 收在这里而不是调用点：与判决同源，改一处就够（§12.12）。
 *
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
