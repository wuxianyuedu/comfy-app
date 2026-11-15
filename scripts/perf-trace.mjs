#!/usr/bin/env node
/**
 * perf-trace.mjs — 「性能取证」的**执行入口**（ISSUE #3843）。
 *
 * ## 它解决什么
 *
 * #3771 那类冻结 / 卡顿问题，定位到行需要「出问题时刻的主线程 trace」；每次人工
 * 附加 DevTools 成本高、时机也难（冻结发生后才想抓已经晚了）。本脚本把「录一段
 * 可重复取证的 trace」补成一条命令：起应用（没起就自己起）→ 开无头 chromium →
 * 打开指定路由 → 用 Chrome DevTools 的 Tracing 域录一段（含主线程任务与 CPU
 * 采样）→ 按**次命名**落 `log/profiles/` → 打印摘要与「怎么读」。
 *
 * ## 口径（四条）
 *
 * · **按需取证，默认不开**：trace 本身有开销，会污染被测页面 —— 只在要查问题时
 *   手工跑，不挂进任何常驻轮询、不进 CI 档（#3843 的边界）。
 * · **端口只认一处**：走 `scripts/app-port.mjs` 的 `resolveAppPort()`（与 dev /
 *   启动器 / 截图工具同源），不自拼端口（§1.1）。
 * · **产物落本机**：`log/profiles/**`（`/log/` 已被 `.gitignore` 忽略），按次命名
 *   不用固定名（硬规则 4 同一条纪律）；它是取证读数，不是仓库产物。
 * · **只录不判**：本脚本把 trace 与页面计时摘要原样给出，「哪段代码慢」的归因
 *   仍由人（或后续会话）对着 trace 读 —— 不在这里发明第二套性能判定。
 *
 * ## 用法
 *
 * ```bash
 * pnpm profile /settings                    # 录「加载 + 静置 5s」一段
 * pnpm profile / --settle 10000             # 录更长一段（长任务更容易现形）
 * pnpm profile / --click "text=删除"         # 加载后先点一下再录（把操作录进去）
 * pnpm profile / --no-server                # 应用已经在跑，别自己起
 * ```
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";

import { resolveAppPort, resolveRepoRoot } from "./app-port.mjs";
import { checkBrowserReady, describeBrowserMissing } from "../e2e/support/preflight-browser.mjs";

/** trace 落点（相对仓库根）—— `/log/` 在 `.gitignore` 里，产物不进库。 */
export const TRACE_DIR = path.join("log", "profiles");

/** 加载完成后额外录制的毫秒数（缺省 5s：首屏之后的一段静置最能暴露长任务）。 */
export const DEFAULT_SETTLE_MS = 5000;

/** 起应用时等它监端口的上限（dev server 首帧要现场编译，给足）。 */
export const DEFAULT_SERVER_TIMEOUT_MS = 180_000;

/** 录制类别：主线程任务 / 渲染 / 脚本执行 + CPU 采样（定位「哪段代码在烧主线程」）。 */
export const TRACE_CATEGORIES = ["devtools.timeline", "disabled-by-default-v8.cpu_profiler"];

/**
 * 解析命令行。纯函数（不碰文件系统、不起进程）⇒ 可单测。
 *
 * @typedef {{
 *   route: string,
 *   out: string | null,
 *   settleMs: number,
 *   click: string | null,
 *   startServer: boolean,
 *   serverTimeoutMs: number,
 *   help: boolean,
 * }} ProfileArgs
 *
 * @param {string[]} argv
 * @returns {ProfileArgs}
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
  return {
    route: routeFrom(argv),
    out: get("--out") || null,
    settleMs: intOr(get("--settle"), DEFAULT_SETTLE_MS),
    click: get("--click") || null,
    startServer: !argv.includes("--no-server"),
    serverTimeoutMs: intOr(get("--timeout"), DEFAULT_SERVER_TIMEOUT_MS),
    help: argv.includes("--help") || argv.includes("-h"),
  };
}

/** 带值的旗标（它们的下一个参数不是路由）。 */
const VALUE_FLAGS = new Set(["--out", "--settle", "--click", "--timeout"]);

/**
 * 路由 = 第一个既不是旗标、也不是旗标取值的裸参数。
 *
 * 归一化补齐开头的 `/`：Git Bash 会把以 `/` 开头的裸参数改写成 Windows 路径
 * （`/` → Git 安装根），落到这里时已不是合法路由 —— 补齐前导斜杠能让
 * 「没带斜杠的写法」照常工作；带斜杠被改写的场合用 `MSYS_NO_PATHCONV=1`
 * 前缀（或改走双击入口），见 docs/guides/perf-trace.md。
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
    return token.startsWith("/") ? token : `/${token}`;
  }
  return "/";
}

/**
 * 路由 → 文件名片段（`/` → `home`；与截图工具同一套规则）。
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
 * 一次录制的落点：`log/profiles/trace-<路由>-<时间戳>.json`（按次命名，不覆盖旧证据）。
 *
 * @param {{root: string, route: string, out: string | null, now?: Date}} input
 * @returns {string} 绝对路径
 */
export function outputPathFor(input) {
  if (input.out) {
    return path.isAbsolute(input.out) ? input.out : path.resolve(input.root, input.out);
  }
  const stamp = (input.now ?? new Date()).toISOString().replaceAll(/[-:T]/gu, "").slice(0, 14);
  const name = `trace-${slugForRoute(input.route)}-${stamp}.json`;
  return path.resolve(input.root, TRACE_DIR, name);
}

/** 帮助文本。 */
export function usage() {
  return [
    "用法：pnpm perf:trace [路由] [选项]",
    "",
    "  路由                    应用内路由（缺省 /）",
    "  --out <path>            trace 输出路径（缺省 log/profiles/trace-<路由>-<时间戳>.json）",
    "  --settle <ms>           加载完成后额外录制的毫秒数（缺省 5000）",
    "  --click <选择器>        加载稳定后先点击该元素再继续录（把一次操作录进 trace）",
    "  --timeout <ms>          起应用时等它监端口的上限（缺省 180000）",
    "  --no-server             不自己起应用（应用必须已经在跑）",
    "  -h, --help              显示帮助",
    "",
    "Git Bash 注意：以 / 开头的路由会被 MSYS 改写成 Windows 路径 —— 加",
    "MSYS_NO_PATHCONV=1 前缀，或改走双击入口 tools/start/perf-trace.ps1。",
    "",
    "怎么读（拿到 trace 文件之后）：",
    "  1. 打开 https://ui.perfetto.dev（或 Chrome 的 chrome://tracing），把文件拖进去；",
    "  2. 看主线程泳道：RunTask / v8.run / FunctionCall 的长条 —— 单个任务 > 50ms 就会掉帧；",
    "  3. 展开长任务看采样栈（已录 cpu_profiler），定位到具体函数；",
    "  4. 网络与渲染事件在同一份时间轴上，能对出「是脚本在算、还是在等资源」。",
    "",
    "边界：trace 有开销，会污染被测页面 —— 按需取证用，别挂在常驻轮询里，也不进 CI。",
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
 * @returns {Promise<{pid: number}>}
 */
export async function startDevServer(input) {
  const script = path.join(input.root, "scripts", "dev.mjs");
  const child = spawn(process.execPath, [script, "-p", String(input.port)], {
    cwd: input.root,
    env: process.env,
    stdio: ["ignore", "ignore", "ignore"],
    windowsHide: true,
  });
  const pid = child.pid ?? 0;
  const deadline = Date.now() + input.timeoutMs;
  const origin = `http://127.0.0.1:${input.port}`;
  /* oxlint-disable no-await-in-loop -- 就绪探测是「一次问一次等」的轮询：并发发起
   * 多个探测只会得到同一份答案，且会把 dev server 的首帧编译再挤一遍。 */
  while (Date.now() < deadline) {
    if (await isAppUp(origin)) {
      return { pid };
    }
    if (child.exitCode !== null) {
      throw new Error(
        `应用起不来（退出码 ${String(child.exitCode)}），看 log/ 里 dev server 的输出。`,
      );
    }
    await sleep(500);
  }
  /* oxlint-enable no-await-in-loop */
  throw new Error(`等了 ${String(input.timeoutMs)}ms 应用仍未监听 ${origin}。`);
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
 * 从页面读一份**计时摘要**（导航 / 首绘 / LCP / 资源数 / 长任务数）。
 * 取不到的项如实给 null —— 摘要是 convenience，证据在 trace 文件里。
 *
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<Record<string, unknown>>}
 */
export async function collectSummary(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const navTiming = nav instanceof PerformanceNavigationTiming ? nav : null;
    const paints = performance
      .getEntriesByType("paint")
      .map((p) => ({ name: p.name, ms: Math.round(p.startTime) }));
    /* 每项各自兜底：取不到的如实给 null（LCP / longtask 在部分上下文不可用）。 */
    const lcp = (() => {
      try {
        const entries = performance.getEntriesByType("largest-contentful-paint");
        const last = entries.at(-1);
        return last ? Math.round(last.startTime) : null;
      } catch {
        return null;
      }
    })();
    const longTasks = (() => {
      try {
        return performance.getEntriesByType("longtask").length;
      } catch {
        return null;
      }
    })();
    return {
      domContentLoaded: navTiming ? Math.round(navTiming.domContentLoadedEventEnd) : null,
      load: navTiming ? Math.round(navTiming.loadEventEnd) : null,
      paints,
      lcp,
      resources: performance.getEntriesByType("resource").length,
      longTasks,
    };
  });
}

/**
 * 录一段 trace。浏览器没装时由调用方的 `checkBrowserReady` 先拦（与截图工具同一道前置）。
 *
 * @param {{origin: string, route: string, out: string, settleMs: number,
 *          click: string | null, chromium?: typeof import("@playwright/test").chromium}} input
 * @returns {Promise<{out: string, summary: Record<string, unknown>}>}
 */
export async function captureTrace(input) {
  const chromium = input.chromium ?? (await import("@playwright/test")).chromium;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ locale: "zh-CN" });
    await browser.startTracing(page, {
      path: input.out,
      categories: TRACE_CATEGORIES,
    });
    await page.goto(`${input.origin}${input.route}`, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });
    try {
      await page.waitForLoadState("networkidle", { timeout: 30_000 });
    } catch {
      /* 应用有长连接（WS / 轮询），「网络空闲」不一定到得了 —— 不当成失败。 */
    }
    if (input.click) {
      await page.click(input.click, { timeout: 30_000 });
    }
    await sleep(input.settleMs);
    const summary = await collectSummary(page);
    await browser.stopTracing();
    fs.mkdirSync(path.dirname(input.out), { recursive: true });
    return { out: input.out, summary };
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
    process.stderr.write(`[profile] ✗ 浏览器不可用：\n${describeBrowserMissing(browser)}\n`);
    return 2;
  }

  /** @type {number | null} */
  let startedPid = null;
  if (await isAppUp(origin, { fetchImpl: io.fetchImpl })) {
    process.stdout.write(`[profile] 复用已在跑的应用：${origin}\n`);
  } else {
    if (!args.startServer) {
      process.stderr.write(
        `[profile] ✗ 应用没在跑（${origin} 无响应），而 --no-server 表示不要自己起。\n` +
          "[profile]   先起应用（pnpm dev 或双击 tools/start/start-web.ps1），再跑本命令。\n",
      );
      return 2;
    }
    process.stdout.write(`[profile] 应用没在跑，正在起（scripts/dev.mjs，端口 ${port}）…\n`);
    try {
      const started = await startDevServer({ root, port, timeoutMs: args.serverTimeoutMs });
      startedPid = started.pid;
      process.stdout.write(`[profile] 应用已就绪：${origin}\n`);
    } catch (error) {
      process.stderr.write(
        `[profile] ✗ 起应用失败：${error instanceof Error ? error.message : String(error)}\n`,
      );
      return 2;
    }
  }

  const out = outputPathFor({ root, route: args.route, out: args.out });
  try {
    process.stdout.write(
      `[profile] 录 ${args.route}（加载 + 静置 ${String(args.settleMs)}ms${args.click ? ` + 点击 ${args.click}` : ""}）…\n`,
    );
    const { summary } = await captureTrace({
      origin,
      route: args.route,
      out,
      settleMs: args.settleMs,
      click: args.click,
    });
    process.stdout.write(`[profile] ✓ trace 落盘：${out}\n`);
    process.stdout.write(`[profile] 摘要：${JSON.stringify(summary)}\n`);
  } catch (error) {
    process.stderr.write(
      `[profile] ✗ 录制失败：${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  } finally {
    if (startedPid !== null) {
      process.stdout.write(
        `[profile] 收掉自己起的应用：${reapDevServer({ root, pid: startedPid })}\n`,
      );
    }
  }

  process.stdout.write(`\n${usage().split("\n怎么读")[0]}\n`);
  process.stdout.write(
    "[profile] 怎么读：把 trace 文件拖进 https://ui.perfetto.dev（或 chrome://tracing），\n" +
      "[profile] 看主线程长任务（RunTask / v8.run / FunctionCall > 50ms）并展开采样栈定位函数。\n",
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
    process.stderr.write(`[profile] ${detail}\n`);
    process.exit(1);
  }
}
