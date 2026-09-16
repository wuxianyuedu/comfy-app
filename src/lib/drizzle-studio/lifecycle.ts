// Drizzle Studio 生命周期管理：探测、拉起 `drizzle-kit studio`、等待本地端口就绪。
//
// 背景：Drizzle Studio 的界面托管在远端 beta 页面（https://local.drizzle.studio），
// 本地 `drizzle-kit studio` 只起一个回连端口（默认 4983）的 HTTPS 服务，
// 本质是给浏览器用的。桌面壳里点「打开查看」通过后端拉起系统默认浏览器
// 打开该 URL —— 与 ComfyUI 一样，把「进程怎么跑」收在 Node 服务端侧。
//
// 本模块提供（与 comfyui/lifecycle.ts 同构的接口形态）：
//   - probeDrizzleStudio()     探测本地端口是否可达
//   - ensureDrizzleStudioUp()  未运行时按解析出的 drizzle-kit 拉进程并等就绪
//   - stopDrizzleStudio()      杀进程树（设置页「关闭」按钮用，taskkill 整树）
//   - openDrizzleStudio()      用系统默认浏览器打开 studio 回连地址
//   - getDrizzleStudioStatus() 设置页状态/按钮用
//
// HMR 安全：单飞锁与子进程句柄挂在 globalThis 上（同 comfyui），模块重载不重复拉起。

import "server-only";
import { spawn } from "child_process";
import { connect } from "net";
import fs from "fs";
import path from "path";
import { logger } from "~/lib/core/logger";
import { openUrlInBrowser } from "~/lib/open-in-browser";
import { DRIZZLE_STUDIO_RUNTIME_LOG, SERVICES_LOG_DIR } from "~/lib/log-paths";
import { appendSessionBanner as appendSessionBannerToFile } from "~/lib/session-banner.server";
import { killProcessTree } from "~/lib/kill-process-tree";
import {
  createChildExitHandler,
  createOutputSink,
  createRecentOutputLedger,
  waitForComfyReady,
} from "~/lib/comfyui/lifecycle-wait";

/** drizzle-kit studio 默认监听端口。 */
export const DRIZZLE_STUDIO_DEFAULT_PORT = 4983;
/** 打开 studio 用到的远端托管页面（本地只回连 port）。 */
export const DRIZZLE_STUDIO_HOST = "https://local.drizzle.studio";

export type DrizzleStudioStatus = {
  up: boolean;
  port: number;
  starting: boolean;
  pid?: number;
};

type EnsureResult = { ok: boolean; port: number; detail: string };

type LifecycleGlobal = {
  child?: ReturnType<typeof spawn>;
  starting?: Promise<EnsureResult>;
};
const G_KEY = "__drizzleStudioLifecycle_v1";
const g = globalThis as unknown as Record<string, LifecycleGlobal | undefined>;
const st: LifecycleGlobal = g[G_KEY] ?? {};
g[G_KEY] = st;

/** drizzle-kit 的本地端口能否建立 TCP 连接（即 studio 进程是否已就绪）。 */
export async function probeDrizzleStudio(
  port = DRIZZLE_STUDIO_DEFAULT_PORT,
  timeoutMs = 1500,
): Promise<boolean> {
  const up = await probeDrizzleStudioRaw(port, timeoutMs);
  rememberProbe(port, up);
  return up;
}

async function probeDrizzleStudioRaw(
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  try {
    return await new Promise((resolve) => {
      const sock = connect({ host: "127.0.0.1", port });
      const onOk = () => {
        sock.destroy();
        resolve(true);
      };
      const onFail = () => {
        sock.destroy();
        resolve(false);
      };
      sock.setTimeout(timeoutMs);
      sock.once("connect", onOk);
      sock.once("timeout", onFail);
      sock.once("error", onFail);
    });
  } catch {
    return false;
  }
}

/**
 * 定位 drizzle-kit 的可执行脚本（node_modules/drizzle-kit/bin.cjs）。
 * 从进程工作目录开始向上逐层找 node_modules；找不到返回 null（调用方
 * 据此给友好报错）。生产 standalone 打包不携带完整 node_modules 时即此情形。
 */
export function resolveDrizzleKitBin(
  exists: (p: string) => boolean = fs.existsSync,
): string | null {
  const names = ["drizzle-kit/bin.cjs"];
  let dir = process.cwd();
  for (let depth = 0; depth < 6; depth++) {
    const nodeModules = path.join(dir, "node_modules");
    for (const name of names) {
      const candidate = path.join(nodeModules, name);
      if (exists(/*turbopackIgnore: true*/ candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** 本地时间戳（YYYY-MM-DD HH:mm:ss）：runtime 日志是给本机用户看的，
 *  toISOString 的 UTC 在 +8 时区会凭空差出 8 小时（同 comfyui/lifecycle.ts）。 */
function localTimestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function appendRuntimeLog(line: string): void {
  try {
    fs.mkdirSync(SERVICES_LOG_DIR, { recursive: true });
    fs.appendFileSync(
      DRIZZLE_STUDIO_RUNTIME_LOG,
      `${localTimestamp()} ${line}\n`,
      "utf-8",
    );
  } catch {
    /* 日志失败不影响主流程 */
  }
}

/** 会话边界横幅（唯一实现见 `src/lib/session-banner.server.ts`）：多次启动累积的
 * drizzle-studio-runtime.log 靠它分清会话边界（两侧各留空行，直接看文件也
 * 能看出本次从哪开始）。 */
function appendSessionBanner(kind: "start" | "end", title: string): void {
  appendSessionBannerToFile(DRIZZLE_STUDIO_RUNTIME_LOG, kind, title);
}

/** 确保 studio 本地端口就绪：可达则直接返回；否则按解析出的 drizzle-kit 拉起。 */
export async function ensureDrizzleStudioUp(
  opts: {
    port?: number;
    timeoutMs?: number;
    onLog?: (msg: string) => void;
  } = {},
): Promise<EnsureResult> {
  const port = opts.port ?? DRIZZLE_STUDIO_DEFAULT_PORT;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const note = (msg: string) => {
    logger.info(`[drizzle-studio-lifecycle] ${msg}`);
    opts.onLog?.(msg);
    appendRuntimeLog(msg);
  };

  if (await probeDrizzleStudio(port)) {
    return { ok: true, port, detail: "Drizzle Studio 已在运行" };
  }
  if (st.starting) {
    note("Drizzle Studio 正在启动中，等待就绪…");
    return st.starting;
  }

  const bin = resolveDrizzleKitBin();
  if (!bin) {
    return {
      ok: false,
      port,
      detail:
        "未找到 drizzle-kit：当前运行环境没有完整的 node_modules。" +
        "请在开发模式（双击桌面壳 / pnpm dev）下使用，打包后的 standalone 运行目录不含 drizzle-kit。",
    };
  }

  st.starting = (async () => {
    // drizzle-kit 是纯 Node 包，用当前 Node 解释器执行其 bin.cjs；cwd 落在
    // 含 node_modules 的项目根，保证它能解析自身传递依赖。
    const nodeExe = process.execPath;
    const args = [bin, "studio", "--port", String(port), "--host", "127.0.0.1"];
    appendSessionBanner(
      "start",
      `▶ Drizzle Studio 启动会话  ${localTimestamp()}`,
    );
    note(`Drizzle Studio 未运行，按解析路径启动：${nodeExe} ${args.join(" ")}`);
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(nodeExe, args, {
        cwd: path.dirname(path.dirname(path.dirname(bin))), // 项目根（node_modules 的父级）
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (e) {
      const detail = `启动 Drizzle Studio 失败：${e instanceof Error ? e.message : String(e)}`;
      note(detail);
      return { ok: false, port, detail };
    }
    st.child = child;
    appendRuntimeLog(
      `[spawn] pid=${child.pid} cmd=${nodeExe} args=${JSON.stringify(args)}`,
    );
    /* 回调与等待循环复用 comfyui 侧的同一套原语（ISSUE #570 第 6 项）：
     * 此前这里是另一段 80 行 IIFE，与 lifecycle.ts 同构 —— 两处各写一遍
     * 「留底 + 输出截断 + 退出横幅 + 轮询」只会各自漂移。 */
    const ledger = createRecentOutputLedger();
    const outSink = createOutputSink({
      appendRuntimeLog,
      pushRecent: ledger.push,
    });
    child.stdout?.on("data", outSink);
    child.stderr?.on("data", outSink);
    child.on(
      "exit",
      createChildExitHandler({
        banner: (code) => `■ Drizzle Studio 进程已退出（code=${String(code)}）`,
        appendSessionBanner: (b) => appendSessionBanner("end", b),
        log: note,
        clearChild: () => {
          if (st.child === child) st.child = undefined;
        },
      }),
    );

    const r = await waitForComfyReady({
      deadline: Date.now() + timeoutMs,
      timeoutDetail: `Drizzle Studio 启动超时（${Math.round(timeoutMs / 1000)}s 未就绪），详见 log/services/drizzle-studio-runtime.log`,
      readyDetail: `Drizzle Studio 已就绪（端口 ${port}）`,
      intervalMs: 500,
      probe: async () =>
        (await probeDrizzleStudio(port)) ? `127.0.0.1:${port}` : null,
      isDead: async () => {
        if (st.child === child) return null;
        const modErr =
          /Cannot find module '([^']+)'|Cannot find package '([^']+)'/.exec(
            ledger.lines.join("\n"),
          );
        return modErr
          ? `Drizzle Studio 启动后立即退出：缺少依赖（${modErr[1] ?? modErr[2]}）——请确认已安装 drizzle-kit（pnpm install），详见 log/services/drizzle-studio-runtime.log`
          : "Drizzle Studio 进程启动后立即退出，详见 log/services/drizzle-studio-runtime.log";
      },
    });
    return { ok: r.ok, port, detail: r.detail };
  })().finally(() => {
    st.starting = undefined;
  });
  return st.starting;
}

/**
 * 关闭 Drizzle Studio：杀整棵进程树。
 * 平台判据在 `~/lib/kill-process-tree`：Windows taskkill /PID /T /F，
 * POSIX 杀进程组（AGENTS 硬规则 3，禁止单杀留孤儿）。
 */
export async function stopDrizzleStudio(
  port = DRIZZLE_STUDIO_DEFAULT_PORT,
): Promise<{ ok: boolean; detail: string }> {
  const child = st.child;
  const pid = child?.pid;
  const stillUp = await probeDrizzleStudio(port);
  if (!pid) {
    return stillUp
      ? {
          ok: false,
          detail:
            "Drizzle Studio 不是由本应用启动的，请在启动它的终端中手动 Ctrl+C 关闭",
        }
      : { ok: true, detail: "Drizzle Studio 未在运行" };
  }
  // 回收整棵进程树（AGENTS 硬规则 3）：Windows taskkill /T /F，POSIX 杀进程组。
  // 平台判据集中在 kill-process-tree。旧实现的 POSIX 分支直接单杀 —— 虽然
  // drizzle-kit 多为单进程，但 pnpm/npm 外壳之下仍可能带出 node 子进程，
  // 单杀会留下锁端口的孤儿。
  const kill = await killProcessTree({ pid, detached: false });
  logger.info(`[drizzle-studio] 回收进程树：${kill.via}`);
  st.child = undefined;
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 400));
    if (!(await probeDrizzleStudio(port))) {
      return { ok: true, detail: "Drizzle Studio 已关闭" };
    }
  }
  return {
    ok: false,
    detail: "关闭命令已发送，但 Drizzle Studio 仍在响应，请手动确认进程已退出",
  };
}

/**
 * 用系统默认浏览器打开 Drizzle Studio 回连地址。
 * 等价于桌面壳里 tauri-plugin-opener 的「拉起系统浏览器」效果，但走 Node
 * 服务端命令（start / open / xdg-open），不需要动 Rust、不需重编壳。
 * 返回 ok=false 时 detail 给出可行动的提示。
 */
export async function openDrizzleStudio(
  port = DRIZZLE_STUDIO_DEFAULT_PORT,
): Promise<{ ok: boolean; detail: string }> {
  if (!(await probeDrizzleStudio(port))) {
    return {
      ok: false,
      detail:
        "Drizzle Studio 未在运行，请先点「启动 Drizzle Studio」再打开查看",
    };
  }
  const url = `${DRIZZLE_STUDIO_HOST}?port=${port}`;
  return openUrlInBrowser(url);
}

export function isDrizzleStudioStarting(): boolean {
  return !!st.starting;
}

/**
 * 端口可达性结果的短 TTL 缓存。
 *
 * `getDrizzleStudioStatus` 是**同步**函数（可达性只能异步问），此前它直接返回
 * `up: false` —— 于是「端口上确实有实例在跑、但不是本应用拉起的」会被读成
 * 「未运行」，调用方据此去重拉一个（或反过来以为无实例可关）。现在把最近一次
 * 探测结论缓存下来供同步读取；缓存缺失或过期时按 `false` 返回。
 */
const PROBE_TTL_MS = 2000;
let probeCache: { at: number; up: boolean } | null = null;

/** 记录一次异步探测结论（供同步状态读取）。 */
function rememberProbe(port: number, up: boolean): void {
  if (port !== DRIZZLE_STUDIO_DEFAULT_PORT) return;
  probeCache = { at: Date.now(), up };
}

/**
 * 清掉探测缓存（**测试用**）。
 *
 * 缓存是模块级状态，而用例之间共享同一个模块实例 —— 不清会让「上一个用例探测到
 * 可达」泄漏到下一个用例，表现为随机的假绿/假红。生产代码不需要调用它。
 */
export function resetDrizzleStudioProbeCache(): void {
  probeCache = null;
}

export function getDrizzleStudioStatus(
  port = DRIZZLE_STUDIO_DEFAULT_PORT,
): DrizzleStudioStatus {
  const fresh =
    probeCache && Date.now() - probeCache.at < PROBE_TTL_MS
      ? probeCache.up
      : false;
  return {
    up: fresh,
    port,
    starting: isDrizzleStudioStarting(),
    pid: st.child?.pid,
  };
}
