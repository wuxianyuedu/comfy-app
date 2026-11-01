/**
 * 端口占用扫描与进程树回收（ISSUE #1811 拆 R5 超限文件）。
 *
 * 从 `dev-launcher.mjs` 搬出来的这一层回答两件事：**这个端口上现在有谁**、
 * **怎么把它连同子树一起收干净**。回收一律转交
 * `src/lib/process/kill-process-tree.ts`（AGENTS 硬规则 3 的唯一出口），
 * 本模块只做「取 PID → 调它 → 记日志」的编排。
 *
 * **依赖靠注入**：`ctx.log`（日志出口）、`ctx.spawned`（子进程账本）、
 * `ctx.root`（本次操作的检出根）。回引主文件会成环。
 */
import process from "node:process";

import { resolveAppPort } from "../app-port.mjs";
import {
  isWindows,
  listeningPidsOnPort,
  pidBelongsToRoot,
  processCommandLines,
  runCapture,
} from "./procs.mjs";
import {
  APP_DEV_SCRIPT_MARKER,
  APP_START_SCRIPT_MARKER,
  PORT_OWNERSHIP,
  inspectPort,
  portOwnershipVerdict,
} from "./orchestrator.mjs";
import {
  clearSession,
  isPidAlive,
  isSessionOwnerAlive,
  readSession,
} from "../dev-launcher-session.mjs";

/** 端口占用扫描范围：本端口与 +1/+2（Next 在端口被占时会静默顺延，导致
 *  「服务起来了但连着旧实例」——§1.1 的端口契约因此必须连同邻位一起看）。 */
/** @param {number} port @returns {number[]} */
export function scanPorts(port) {
  return [port, port + 1, port + 2];
}

/**
 * **本检出**的应用服务此刻有没有在跑 —— AGENTS 硬规则 9 的现场判据。
 *
 * 为什么需要它而不是「探端口有没有人监听」：原生模块被锁住的是**本检出的
 * `node_modules`**，隔壁检出（或任何别的进程）占着同一个端口并不会让它锁住。
 * 所以两条信号都必须问得出归属：
 *
 *   · **会话锚点**（`run/launcher-session.json` + 心跳新鲜 +  launcher PID 存活）
 *     —— 本检出的编排器还在，它起的 dev server 自然也在；这是最便宜的一条，
 *     同步、零子进程；
 *   · **端口上的应用进程** —— 端口取本检出解析出来的那一个（含 +1/+2 顺延位），
 *     占位 PID 的命令行必须命中「根路径 + 本仓库的 `dev.mjs` / `start.mjs` /
 *     `next dev|start`」（`isAppDevServerCmdline`），否则按「别人的进程」处理。
 *
 * 走第二条而不是只看会话，是因为用户完全可以绕过编排器自己 `pnpm dev` ——
 * 那时没有会话锚点，而 `node_modules` 一样被锁着。
 *
 * @param {string} root 检出根
 * @returns {Promise<{running: boolean, pids: number[], via: "session" | "port" | null}>}
 */
export async function runningAppInstances(root) {
  if (isSessionOwnerAlive(root)) {
    const session = readSession(root);
    const pids = [
      Number(session?.launcher_pid),
      ...(Array.isArray(session?.child_pids) ? session.child_pids.map(Number) : []),
    ].filter((pid) => Number.isFinite(pid) && pid > 0);
    return {
      running: true,
      pids: [...new Set(pids)].sort((a, b) => a - b),
      via: "session",
    };
  }

  const held = [];
  for (const port of scanPorts(resolveAppPort(root))) {
    const pids = await listeningPidsOnPort(port);
    if (pids.length === 0) {
      continue;
    }
    // 命令行按一次批量查询取回（Windows 上逐 PID 起 PowerShell 是 0.5~1.5s 的冷启动）。
    const lines = await processCommandLines(pids);
    for (const pid of pids) {
      if (isAppDevServerCmdline(lines.get(pid) ?? "", root)) {
        held.push(pid);
      }
    }
  }
  if (held.length === 0) {
    return { running: false, pids: [], via: null };
  }
  return {
    running: true,
    pids: [...new Set(held)].sort((a, b) => a - b),
    via: "port",
  };
}

/**
 * 回收一棵进程树的**跨平台入口**（实现见 src/lib/process/kill-process-tree.ts，唯一出处）。
 *
 * 为什么不直接静态 `import "….ts"`：那是 TS 模块，在纯 Node 下需要运行时类型剥离
 * （Node ≥ 22.6 默认开启）。用动态 import 而非静态 import，是为了在旧 Node 上
 * 仍能给出可行动的报错，而不是让整个编排在加载阶段就崩。
 *
 * 说明符为什么经一个常量中转、不做成 `import("….ts")`：路径必须以 `.ts` 结尾
 * （少了扩展名纯 Node 解析不到），而 tsc 对「字面量 import 带 .ts 扩展」只认 TS5097
 * ——它没建模这条运行时约定。**中转的只是写法，路径本身仍是原样的字面量**：不拼
 * 字符串、不裁扩展名，因此能被搜索到，也被 `tests/cross-platform-launcher.test.ts`
 * 核对（拼字符串的形态正是它挡不住的那种：换目录时只在执行到这一行才炸）。
 * 同一份说明符在 `scripts/reap-process.mjs`（非 TS 宿主用的命令行入口）里也有一处，
 * 改路径时两处一起改。
 * @param {{ pid: number, detached?: boolean, force?: boolean }} options
 * @returns {Promise<{ ok: boolean, via: string }>}
 */
export async function reapProcessTree(options) {
  const specifier = "../../src/lib/process/kill-process-tree.ts";
  const mod = await import(specifier);
  return mod.killProcessTree(options);
}

/** 收尾：回收本次会话拉起的**整棵进程树**，并清理会话锚点。
 * @param {{ log: (m: string, l?: import("./log.mjs").LogLevel) => void, spawned: import("node:child_process").ChildProcess[], root: string }} ctx 日志出口、子进程账本、检出根
 */
export async function reapAll(ctx) {
  for (const child of ctx.spawned) {
    if (child.exitCode !== null || child.signalCode !== null) {
      continue;
    }
    try {
      if (child.pid) {
        const via = await reapProcessTree({
          pid: child.pid,
          detached: !isWindows(),
          force: true,
        });
        ctx.log(`回收子进程树 PID ${child.pid}：${via.via}`, "STEP");
      }
    } catch (error) {
      ctx.log(
        `回收子进程树失败：${error instanceof Error ? error.message : String(error)}`,
        "WARN",
      );
    }
  }
  clearSession(ctx.root);
}

/** 回收上一次运行遗留的进程树（崩溃 / 被 SIGKILL 时留下的孤儿）。
 *  判据是**心跳 + PID**两条（见 dev-launcher-session）：只判 PID 会被 PID 复用
 *  骗过，只判心跳会把卡死的实例当成死的。
 *
 *  **子进程再探一次活**：会话锚点残留本身不等于「有孤儿」——壳正常退出时用
 *  `Child.kill()`（Windows 上是 `TerminateProcess`）收编排器，编排器收不到信号、
 *  没机会执行自己的 `clearSession()`，锚点于是**必然**留下；而它拉起的整棵树
 *  早已被插件 kill / Job Object 收干净。这种情形只清锚点、**不回报**，否则每次
 *  正常关窗后的启动都会刷一条「回收上一次运行遗留的进程树」（PID 早已不存在，
 *  徒增噪声，且旧号被系统复用时还有误伤无关进程的风险）。
 *  本函数**不写日志**（只清锚点或回报回收结果，调用方决定怎么说）—— 因此
 *  不接 ctx。
 *  @param {string} [root] @returns {Promise<number[] | null>} 真正回收的 PID */
export async function reapStaleSession(root = process.cwd()) {
  if (isSessionOwnerAlive(root)) {
    return null;
  }
  const session = readSession(root);
  if (!session) {
    return null;
  }
  const pids = (Array.isArray(session.child_pids) ? session.child_pids : []).filter(
    (pid) => typeof pid === "number" && pid > 0,
  );
  const alive = pids.filter((pid) => isPidAlive(pid));
  if (alive.length === 0) {
    clearSession(root);
    return null;
  }
  for (const pid of alive) {
    await reapProcessTree({ pid, detached: !isWindows(), force: true });
  }
  clearSession(root);
  return alive;
}

/** 该 PID 的命令行（判「端口上的是不是本仓库的应用服务」，拿不到返回空串）。 */
/** @param {number} pid @returns {Promise<string>} */
export async function processCommandLine(pid) {
  try {
    return (
      await runCapture(
        isWindows() ? "powershell" : "ps",
        isWindows()
          ? [
              "-NoProfile",
              "-Command",
              `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
            ]
          : ["-o", "args=", "-p", String(pid)],
      )
    ).trim();
  } catch {
    return "";
  }
}

/**
 * 命令行是否为本仓库应用服务的自证。
 *
 *  `pidBelongsToRoot` 只回答「命令行里有没有出现过检出根路径」——`node_modules`、
 *  缓存路径、用户传进来的相对路径参数都会带出检出根，于是「别的程序恰好从本检出
 *  目录启动」与「本检出上次留下的 dev server」在旧判据下不可区分，而两者的正确
 *  动作完全相反。这里再加一层：**跑的是本仓库的应用服务脚本或 next CLI**。
 *
 *  形状来自实测的链路：编排器起服务是 `pnpm dev -p N -H 127.0.0.1`
 *  接着 node 起 scripts/dev.mjs，再由它经 pnpm exec 起 next dev --turbo
 *  → `node …/next/dist/bin/next dev` → `next-server`。端口上的监听者可能是其中
 *  任意一层，因此三种形状都认（都要求命令行含检出根路径）。
 *  @param {string} cmdline @param {string} [root] @returns {boolean} */
export function isAppDevServerCmdline(cmdline, root = process.cwd()) {
  /** @param {string} value */
  const norm = (value) => value.replaceAll("\\", "/").toLowerCase();
  const text = norm(cmdline);
  const base = norm(root).replace(/\/+$/, "");
  if (!text || !base || !text.includes(base)) {
    return false;
  }
  if (text.includes(`${base}/scripts/${APP_DEV_SCRIPT_MARKER}`)) {
    return true;
  }
  if (text.includes(`${base}/scripts/${APP_START_SCRIPT_MARKER}`)) {
    return true;
  }
  if (/next(\.cmd|\.ps1)?\s+(dev|start)\b/.test(text)) {
    return true;
  }
  return false;
}

/** 端口检查：空闲 / 自己的残留（回收）/ 别人的（只提示，绝不擅自杀）。
 *
 *  「只回收自己的」是多检出并行的保护线（§1.4），因此这里必须**问得出归属**
 *  才动手。Windows 与 POSIX 的判据都由 launch-core/procs 提供，本函数不分平台。
 *
 *  ⚠️ **只有显式端口才自作主张回收**（ISSUE #621）：`pnpm dev` 一律经编排器
 *  `pnpm dev -p <port>` 拉起（Next 不认 COMFYAPP_PORT，必须显式传），所以
 *  「显式端口上有一个命令行的 cwd / 路径落在本检出、且跑的是本仓库应用服务的
 *  进程」只可能是本检出自己的残留。而**缺省解析链上的服务**（用户自己
 *  `pnpm dev` / 另一份检出的 .env 刚好解析到同一个端口）无法与残留区分 ——
 *  那时仍按「别的进程，不碰」处理。
 *  @param {{ log: (m: string, l?: import("./log.mjs").LogLevel) => void }} ctx 日志出口
 *  @param {number} port @param {string} [root]
 *  @param {{ explicit?: boolean }} [options] explicit = 端口由调用方显式指定
 *  @returns {Promise<string>} 结论摘要 */
export async function reconcilePort(ctx, port, root = process.cwd(), { explicit = false } = {}) {
  const summary = [];
  for (const p of scanPorts(port)) {
    // 自证只对「本次真正要用的那个端口」成立：扫描范围内的 +1/+2 是「Next 会不会
    // 顺延」的探测位，本次并不打算用它们，谈不上回收。
    const verdict = await inspectPort(p, {
      listenPids: listeningPidsOnPort,
      belongsToRoot: pidBelongsToRoot,
      root,
    });
    /* 命令行一次批量预取：`portOwnershipVerdict` 会对每个占位 PID 各调一次
     * `cmdlineOf`，Windows 上那是每 PID 一次 PowerShell 冷启动（0.5~1.5s）；
     * 合并为一条 CIM 查询后回填进 Map，回调只查表（契约不变，仍是逐 PID 取）。 */
    const commandLines = await processCommandLines(verdict.pids ?? []);
    const decision = await portOwnershipVerdict({
      requestedPort: explicit && p === port ? port : null,
      verdict,
      cmdlineOf: async (pid) => commandLines.get(pid) ?? "",
      isAppProcess: (_pid, cmdline) => isAppDevServerCmdline(cmdline, root),
    });
    if (decision.ownership === PORT_OWNERSHIP.free) {
      summary.push(`${p} 空闲`);
      continue;
    }
    if (decision.ownership === PORT_OWNERSHIP.own) {
      // 自证路径要交代清楚「为什么敢动它」：这条路径上 `pidBelongsToRoot` 是
      // 否定的（否则走的是旧分支），只凭「显式端口 + 应用服务自证」回收。
      ctx.log(
        `端口 ${p} 被本检出上一次启动的进程占用（PID ${decision.ownPids.join(", ")}），正在回收…`,
        "WARN",
      );
      for (const pid of decision.ownPids) {
        const via = await reapProcessTree({
          pid,
          detached: !isWindows(),
          force: true,
        });
        ctx.log(`  回收 PID ${pid}：${via.via}`, "INFO");
      }
      summary.push(`${p} 已回收自己的残留`);
      continue;
    }
    summary.push(`${p} 被其它进程占用（PID ${decision.foreignPids.join(", ")}）`);
    ctx.log(
      `端口 ${p} 被非本检出的进程占用（PID ${decision.foreignPids.join(", ")}）——多检出并行保护，不清理。` +
        `若与本检出冲突，请改 .env 的 COMFYAPP_PORT。`,
      "WARN",
    );
  }
  return summary.join("；");
}
