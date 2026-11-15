#!/usr/bin/env node
/**
 * screenshot.mjs — 「改后真实运行截图」的**执行入口**（ISSUE #3780 / 规范 §13.12）。
 *
 * ## 它解决什么
 *
 * 规范 §13.12 要求：改了用户看得见的界面，交付时附一张「改后真实运行」截图并回帖到
 * 诉求那张 Issue。这条纪律此前**没有执行工具** —— 本仓的截图能力其实**已经有了**
 * （`@playwright/test` 是 devDependency、chromium 由 `pnpm exec playwright install`
 * 装、e2e 那 22 份 spec 天天在用），缺的只是「把浏览器开起来、把某一屏拍下来」这一格
 * 入口，于是每次 UI 改动都以「当前无可用的图形化运行与截图环境」收场。
 *
 * 本脚本把那**一格**补上：起应用（没起就自己起）→ 开无头 chromium → 打开指定路由 →
 * 按明暗两态各截一张 → 打印本机路径与上传命令。
 *
 * ## 口径（四条）
 *
 * · **截的是真界面**：走的是应用自己的 dev server（`scripts/dev.mjs`，与 `pnpm dev`
 *   同一条入口），不是 Storybook 的假形态、不是设计稿（§13.12.2 第 1 条）。
 * · **端口只认一处**：走 `scripts/app-port.mjs` 的 `resolveAppPort()`（与 dev / 启动器 /
 *   Playwright 同源），不自拼端口（§1.1）。
 * · **图落本机**：`log/screenshots/**`（`/log/` 已被 `.gitignore` 忽略）—— 截图是交付
 *   读数，不是仓库产物（§13.12.2 第 3 条）。
 * · **发图不归本脚本**：上传走 `cnb issues upload-image`（§13.12.3 的现成命令），
 *   本脚本只负责把路径念出来 —— 平台侧动作不进本地工具（§13.12.4 同一条纪律）。
 *
 * ## 用法
 *
 * ```bash
 * pnpm screenshot /settings                    # 默认明暗两态各一张
 * pnpm screenshot /settings --theme dark       # 只截暗色
 * pnpm screenshot / --out D:\tmp\a.png         # 指定落点（只截一张时用）
 * pnpm screenshot /workspace --full-page       # 整页而不是只截视口
 * pnpm screenshot / --no-server                # 应用已经在跑，别自己起
 * ```
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";

import { resolveAppPort, resolveRepoRoot } from "./app-port.mjs";
import { checkBrowserReady, describeBrowserMissing } from "../e2e/support/preflight-browser.mjs";

/** 截图落点（相对仓库根）—— `/log/` 在 `.gitignore` 里，图不进库。 */
export const SCREENSHOT_DIR = path.join("log", "screenshots");

/** 视口缺省值（1440×900 是本仓 e2e 常用档位，够宽也够高）。 */
export const DEFAULT_WIDTH = 1440;
export const DEFAULT_HEIGHT = 900;

/** 截图前额外静置的毫秒数（等首屏数据落定；网络空闲由调用处另外等）。 */
export const DEFAULT_SETTLE_MS = 2000;

/** 起应用时等它监端口的上限（dev server 首帧要现场编译，给足）。 */
export const DEFAULT_SERVER_TIMEOUT_MS = 180_000;

/**
 * 主题档位：明 / 暗 / 两态都要。
 *
 * ⚠️ 本文件是 `.mjs`（跨平台逻辑都写 Node，见硬规则 12）—— **不能写 `export type`**：
 * 它按纯 JS 解析（`export type` 是解析期错误，vitest / rolldown 直接崩）。类型走
 * JSDoc 注解表达。
 *
 * @typedef {"light" | "dark"} Theme
 */

/**
 * @typedef {{
 *   route: string,
 *   out: string | null,
 *   theme: Theme | "both",
 *   width: number,
 *   height: number,
 *   fullPage: boolean,
 *   settleMs: number,
 *   waitFor: string | null,
 *   startServer: boolean,
 *   serverTimeoutMs: number,
 *   help: boolean,
 * }} ScreenshotArgs
 */

/**
 * 解析命令行。纯函数（不碰文件系统、不起进程）⇒ 可单测。
 *
 * @param {string[]} argv
 * @returns {ScreenshotArgs}
 */
export function parseArgs(argv) {
  /** @param {string} flag */
  const get = (flag) => {
    const index = argv.indexOf(flag);
    return index === -1 ? "" : (argv[index + 1] ?? "").trim();
  };
  /**
   * @param {string} raw
   * @param {number} fallback
   * @returns {number}
   */
  const intOr = (raw, fallback) => {
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  };
  const themeRaw = (get("--theme") || "both").toLowerCase();
  /** @type {Theme | "both"} */
  const theme =
    themeRaw === "light" || themeRaw === "dark" || themeRaw === "both" ? themeRaw : "both";
  return {
    route: routeFrom(argv),
    out: get("--out") || null,
    theme,
    width: intOr(get("--width"), DEFAULT_WIDTH),
    height: intOr(get("--height"), DEFAULT_HEIGHT),
    fullPage: argv.includes("--full-page"),
    settleMs: intOr(get("--settle"), DEFAULT_SETTLE_MS),
    waitFor: get("--wait-for") || null,
    startServer: !argv.includes("--no-server"),
    serverTimeoutMs: intOr(get("--timeout"), DEFAULT_SERVER_TIMEOUT_MS),
    help: argv.includes("--help") || argv.includes("-h"),
  };
}

/** 带值的旗标（它们的下一个参数不是路由）。 */
const VALUE_FLAGS = new Set([
  "--out",
  "--theme",
  "--width",
  "--height",
  "--settle",
  "--timeout",
  "--wait-for",
]);

/**
 * 路由 = 第一个既不是旗标、也不是旗标取值的裸参数。
 *
 * @param {string[]} argv
 * @returns {string}
 */
function routeFrom(argv) {
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? "";
    if (token.startsWith("-")) {
      if (VALUE_FLAGS.has(token)) {
        i += 1;
      }
      continue;
    }
    return token;
  }
  return "/";
}

/**
 * 两态都要时的取法（`both` → 先暗后亮：暗色是本仓的默认档，先给它）。
 *
 * @param {Theme | "both"} theme
 * @returns {Theme[]}
 */
export function themeList(theme) {
  return theme === "both" ? ["dark", "light"] : [theme];
}

/**
 * 路由 → 文件名片段（`/` → `home`）。
 *
 * @param {string} route
 * @returns {string}
 */
export function slugForRoute(route) {
  const trimmed = route.replaceAll(/^\/+|\/+$/gu, "");
  if (trimmed === "") {
    return "home";
  }
  return trimmed.replaceAll(/[^\w-]+/gu, "-").replaceAll(/^-+|-+$/gu, "") || "home";
}

/**
 * 某一张图的落点。`out` 给了就用它（且只截一张 —— 一个文件放两态没有意义）。
 *
 * @param {{root: string, route: string, theme: Theme, out: string | null}} input
 * @returns {string} 绝对路径
 */
export function outputPathFor(input) {
  if (input.out) {
    return path.isAbsolute(input.out) ? input.out : path.resolve(input.root, input.out);
  }
  const name = `${slugForRoute(input.route)}-${input.theme}.png`;
  return path.resolve(input.root, SCREENSHOT_DIR, name);
}

/** 帮助文本。 */
export function usage() {
  return [
    "用法：pnpm screenshot [路由] [选项]",
    "",
    "  路由                    应用内路由（缺省 /）",
    "  --out <path>            输出 PNG 路径（缺省 log/screenshots/<路由>-<主题>.png）",
    "  --theme light|dark|both  主题（缺省 both = 明暗两态各一张）",
    "  --width <px>            视口宽（缺省 1440）",
    "  --height <px>           视口高（缺省 900）",
    "  --full-page             整页截图（缺省只截视口）",
    "  --wait-for <选择器>     等某个元素出现再截（首屏数据落定的可靠信号）",
    "  --settle <ms>           截图前额外静置毫秒（缺省 2000）",
    "  --timeout <ms>          起应用时等它监端口的上限（缺省 180000）",
    "  --no-server             不自己起应用（应用必须已经在跑）",
    "  -h, --help              显示帮助",
    "",
    "截图落本机（log/ 不进库）；上传到诉求单走现成命令：",
    "  pnpm exec cnb issues upload-image --file <上面打印的路径> --number <诉求单号>",
  ].join("\n");
}

/**
 * 应用在不在跑（探一次端口）。
 *
 * @param {string} origin
 * @param {{timeoutMs?: number, fetchImpl?: typeof fetch}} [io]
 * @returns {Promise<boolean>}
 */
export async function isAppUp(origin, io = {}) {
  const fetchImpl = io.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, io.timeoutMs ?? 1500);
  try {
    const res = await fetchImpl(origin, { signal: controller.signal });
    return res.status > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 起应用（`scripts/dev.mjs`，与 `pnpm dev` 同一条入口），并等它监上端口。
 *
 * @param {{root: string, port: number, timeoutMs: number}} input
 * @returns {Promise<{pid: number, log: () => string}>}
 */
export async function startDevServer(input) {
  const script = path.join(input.root, "scripts", "dev.mjs");
  const child = spawn(process.execPath, [script, "-p", String(input.port)], {
    cwd: input.root,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  /** @type {string[]} */
  const lines = [];
  /**
   * @param {unknown} chunk
   */
  const collect = (chunk) => {
    const text = String(chunk ?? "");
    for (const line of text.split(/\r?\n/u)) {
      if (line.trim() !== "") {
        lines.push(line);
      }
    }
    /* 只留尾部：dev server 的输出能到几百行，全存着只是占内存。 */
    if (lines.length > 200) {
      lines.splice(0, lines.length - 200);
    }
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  const pid = child.pid ?? 0;
  const deadline = Date.now() + input.timeoutMs;
  const origin = `http://127.0.0.1:${input.port}`;
  /* oxlint-disable no-await-in-loop -- 就绪探测是「一次问一次等」的轮询：并发发起
   * 多个探测只会得到同一份答案，且会把 dev server 的首帧编译再挤一遍。 */
  while (Date.now() < deadline) {
    if (await isAppUp(origin)) {
      return { pid, log: () => lines.slice(-30).join("\n") };
    }
    if (child.exitCode !== null) {
      throw new Error(
        `应用起不来（退出码 ${String(child.exitCode)}）。最后几行输出：\n${lines.slice(-30).join("\n")}`,
      );
    }
    await sleep(500);
  }
  /* oxlint-enable no-await-in-loop */
  throw new Error(
    `等了 ${String(input.timeoutMs)}ms 应用仍未监听 ${origin}。最后几行输出：\n${lines
      .slice(-30)
      .join("\n")}`,
  );
}

/**
 * 收掉自己起的那棵进程树（硬规则 3：非 TS 宿主一律走 `scripts/reap-process.mjs`）。
 *
 * @param {{root: string, pid: number}} input
 * @returns {string} 回收结果那行文本
 */
export function reapDevServer(input) {
  if (!Number.isInteger(input.pid) || input.pid <= 0) {
    return "";
  }
  const result = spawnSync(
    process.execPath,
    [path.join(input.root, "scripts", "reap-process.mjs"), String(input.pid), "--force"],
    { cwd: input.root, encoding: "utf8", windowsHide: true },
  );
  return `${String(result.stdout ?? "")}${String(result.stderr ?? "")}`.trim();
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * 截一张图。浏览器没装时按既有提示给出安装命令（`e2e/support/preflight-browser.mjs`）。
 *
 * @param {{origin: string, route: string, theme: Theme, out: string, width: number,
 *          height: number, fullPage: boolean, settleMs: number, waitFor?: string | null,
 *          chromium?: typeof import("@playwright/test").chromium}} input
 * @returns {Promise<string>} 落盘路径
 */
export async function captureOne(input) {
  const chromium = input.chromium ?? (await import("@playwright/test")).chromium;
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: input.width, height: input.height },
      locale: "zh-CN",
    });
    /* 主题走 `next-themes` 的持久化键（storageKey `theme`，见 src/app/ThemeProvider.tsx）：
     * 首帧前就写好 ⇒ 渲染出来就是那一态，不必等用户点切换（§13.12.2 第 1 条要明暗两态）。 */
    await context.addInitScript((theme) => {
      try {
        window.localStorage.setItem("theme", theme);
      } catch {
        /* 隐私模式等场景下写不进去：截到默认态，不当成失败（提示在打印里）。 */
      }
    }, input.theme);
    const page = await context.newPage();
    const url = `${input.origin}${input.route}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
    try {
      await page.waitForLoadState("networkidle", { timeout: 30_000 });
    } catch {
      /* 应用有长连接（WS / 轮询），「网络空闲」不一定到得了 —— 不当成失败。 */
    }
    /* 等某个具体元素出现（可选）：首屏数据落定往往表现为「某个控件不再转圈」，
     * 而那是应用自己的语义 —— 让调用点点名，比在这里猜「加载完了没」可靠。 */
    if (input.waitFor) {
      await page.waitForSelector(input.waitFor, { timeout: 60_000 });
    }
    await sleep(input.settleMs);
    fs.mkdirSync(path.dirname(input.out), { recursive: true });
    await page.screenshot({ path: input.out, fullPage: input.fullPage });
    await context.close();
    return input.out;
  } finally {
    await browser.close();
  }
}

/**
 * 主流程。
 *
 * @param {{argv?: string[], root?: string, fetchImpl?: typeof fetch}} [io]
 * @returns {Promise<number>} 退出码
 */
export async function main(io = {}) {
  const argv = io.argv ?? process.argv.slice(2);
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const root = io.root ?? resolveRepoRoot();
  const port = resolveAppPort(root);
  const origin = `http://127.0.0.1:${port}`;

  const browser = await checkBrowserReady();
  if (browser.verdict !== "ready") {
    process.stderr.write(`[screenshot] ✗ 浏览器不可用：\n${describeBrowserMissing(browser)}\n`);
    return 2;
  }

  /** @type {number | null} */
  let startedPid = null;
  if (await isAppUp(origin, { fetchImpl: io.fetchImpl })) {
    process.stdout.write(`[screenshot] 复用已在跑的应用：${origin}\n`);
  } else {
    if (!args.startServer) {
      process.stderr.write(
        `[screenshot] ✗ 应用没在跑（${origin} 无响应），而 --no-server 表示不要自己起。\n` +
          "[screenshot]   先起应用（pnpm dev 或双击 tools/start/start-web.ps1），再跑本命令。\n",
      );
      return 2;
    }
    process.stdout.write(`[screenshot] 应用没在跑，正在起（scripts/dev.mjs，端口 ${port}）…\n`);
    try {
      const started = await startDevServer({ root, port, timeoutMs: args.serverTimeoutMs });
      startedPid = started.pid;
      process.stdout.write(`[screenshot] 应用已就绪：${origin}\n`);
    } catch (error) {
      process.stderr.write(
        `[screenshot] ✗ 起应用失败：${error instanceof Error ? error.message : String(error)}\n`,
      );
      return 2;
    }
  }

  const themes = themeList(args.theme);
  /* 一个文件放两态没有意义（第二张会把第一张盖掉）⇒ 给了 --out 就只截一张。 */
  const effectiveThemes = args.out ? themes.slice(0, 1) : themes;
  if (args.out && themes.length > 1) {
    process.stdout.write(
      `[screenshot] 给了 --out ⇒ 只截 ${effectiveThemes[0]} 一张（一个文件放两态会互相盖掉）。\n`,
    );
  }
  /** @type {string[]} */
  const written = [];
  try {
    /* oxlint-disable no-await-in-loop -- 两态**依次**截：第二态要复用第一态已编译好的
     * 路由（首帧编译是最贵的一段），而且并开两个 chromium 会与 dev server 抢核。 */
    for (const theme of effectiveThemes) {
      const out = outputPathFor({ root, route: args.route, theme, out: args.out });
      process.stdout.write(`[screenshot] 截 ${args.route}（${theme}）…\n`);
      await captureOne({
        origin,
        route: args.route,
        theme,
        out,
        width: args.width,
        height: args.height,
        fullPage: args.fullPage,
        settleMs: args.settleMs,
        waitFor: args.waitFor,
      });
      written.push(out);
      process.stdout.write(`[screenshot] ✓ ${out}\n`);
    }
    /* oxlint-enable no-await-in-loop */
  } catch (error) {
    process.stderr.write(
      `[screenshot] ✗ 截图失败：${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  } finally {
    if (startedPid !== null) {
      process.stdout.write(
        `[screenshot] 收掉自己起的应用：${reapDevServer({ root, pid: startedPid })}\n`,
      );
    }
  }

  process.stdout.write(
    `\n[screenshot] 上传到诉求单（把 <单号> 与 <路径> 换掉）：\n${written
      .map((file) => `  pnpm exec cnb issues upload-image --file "${file}" --number <单号>`)
      .join("\n")}\n`,
  );
  return 0;
}

const isEntry =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isEntry) {
  try {
    process.exit(await main());
  } catch (error) {
    const detail = error instanceof Error ? (error.stack ?? String(error)) : String(error);
    process.stderr.write(`[screenshot] ${detail}\n`);
    process.exit(1);
  }
}
