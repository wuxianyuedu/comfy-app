/**
 * 杂项编排：打开浏览器、优雅中断、命令行解析（ISSUE #1811 拆 R5 超限文件）。
 *
 * 三件互相独立、都不依赖启动阶段状态的事从 `dev-launcher.mjs` 搬到这里：
 * · `openBrowser` —— 三平台各有入口，失败只提示不阻断（§9.2 第 3 条）；
 * · `shutdown` —— Ctrl-C / SIGTERM / SIGHUP 的收尾（回收整树 → 归档 → 退出）；
 * · `parseArgs` —— 与 `.ps1` 的开关语义逐项对齐。
 *
 * **依赖靠注入**：`openBrowser` 与 `shutdown` 各接一个 `ctx`。
 */
import { spawn } from "node:child_process";
import process from "node:process";

import { echoCommandLine } from "./command-echo.mjs";
import { isWindows } from "./procs.mjs";
import { archiveCurrent } from "./run.mjs";

/** 打开浏览器：三平台各有入口，失败只提示不阻断（§9.2 第 3 条）。
 * @param {{ log: (m: string, l?: import("./log.mjs").LogLevel) => void }} ctx 日志出口
 * @param {string} url */
export function openBrowser(ctx, url) {
  const command = isWindows() ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = isWindows() ? ["/c", "start", "", url] : [url];
  // 三平台各有一条不同的命令（cmd / open / xdg-open）：回显后「浏览器没弹出来」
  // 这类现象能落到具体是哪条命令、参数对不对上。
  echoCommandLine(command, args);
  const child = spawn(command, args, {
    stdio: "ignore",
    detached: true,
    windowsHide: true,
  });
  // 打开浏览器是体验降级，绝不能成为启动失败：xdg-open 缺失时给一条 WARN 即可。
  child.on("error", () => {
    ctx.log(`未能自动打开浏览器，请手动访问 ${url}`, "WARN");
  });
  child.unref();
  ctx.log(`已尝试打开浏览器：${url}`, "INFO");
}

/** 重入守卫（ISSUE #3836）：dev-launcher.mjs 信号处理器里的 `shuttingDown` 只覆盖
 *  信号那一侧；正常收尾正在 `await reapAll()` 时再来一条信号，会从这里**第二次**
 *  进入 —— 对同一批子进程重复派发回收命令、归档与 exit 竞争。按进程挡住：只跑
 *  第一遍，后到的直接返回（process.exit 即将发生，无需等待）。 */
let shutdownStarted = false;

/** 优雅中断（Ctrl-C / SIGTERM / SIGHUP）：回收整棵进程树后退出。
 * @param {{ log: (m: string, l?: import("./log.mjs").LogLevel) => void,
 *           reapAll: () => Promise<void>, root: string }} ctx 注入上下文
 * @param {number} code */
export async function shutdown(ctx, code) {
  if (shutdownStarted) {
    return;
  }
  shutdownStarted = true;
  ctx.log("正在回收整棵进程树…", "STEP");
  await ctx.reapAll();
  try {
    // 一次一包：current/ 整个复制进 runs/，再清空内容。
    archiveCurrent(ctx.root, { exitCode: code });
  } catch {
    /* 归档失败不影响退出（下一轮启动的 recoverStaleCurrent 还会再收一次） */
  }
  process.exit(code);
}

/** 解析命令行参数（与 .ps1 的开关语义逐项对齐）。 */
/** @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {{ mode: string, open: boolean, host: string, port: string | null,
   *           shellExe: string | null, coldStart: boolean }} */
  const args = {
    mode: "web",
    open: true,
    host: "127.0.0.1",
    port: null,
    shellExe: null,
    coldStart: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--mode") {
      args.mode = argv[++i] ?? args.mode;
    } else if (a.startsWith("--mode=")) {
      args.mode = a.slice("--mode=".length);
    } else if (a === "--tauri") {
      args.mode = "tauri";
    } else if (a === "--prebuilt" || a === "-Prebuilt") {
      args.mode = "prebuilt";
    } else if (a === "--no-open") {
      args.open = false;
    } else if (a === "--cold-start" || a === "-ColdStart") {
      args.coldStart = true;
    } else if (a === "--host") {
      args.host = argv[++i] ?? args.host;
    } else if (a === "-p" || a === "--port") {
      args.port = argv[++i] ?? null;
    } else if (a === "--shell-exe") {
      args.shellExe = argv[++i] ?? null;
    }
  }
  return args;
}
