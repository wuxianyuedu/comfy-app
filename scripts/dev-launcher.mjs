#!/usr/bin/env node
// 启动编排器 —— **全平台唯一实现**（`pnpm dev` / 双击链路 / `pnpm tauri dev`
// 都走这里，见 docs/standards/launch-and-build.md §3）。
//
// 为什么是唯一实现：
//   · 同一件「启动一个能用的开发环境」此前有两套编排（Windows 的 .ps1 与
//     POSIX 的 .mjs）。两套各自演进 → 平台间行为不一致，且只能靠「记得同步
//     另一侧」维持，而漏同步是静默的（`dev` 一侧长期没走端口契约就是这么来的）。
//   · 编排的 90% 是平台无关的（预检 / 端口 / 缓存 / 就绪 / 日志 / 会话锚点），
//     Windows 特有的只有**进程机制**（回收走 taskkill）与**入口形态**
//     （双击 .ps1 / 启动器 exe）。前者收在 src/lib/process/kill-process-tree.ts，
//     后者收在平台判据模块（scripts/launcher-core/*），本文件不再摸平台。
//
// 职责（与 .ps1 版逐项对齐，两侧同契约同产物）：
//   预检（.env / 工具链 / node_modules / pnpm 版本）→ 端口（app-port.mjs 单一
//   事实源）→ .next 缓存指纹 → 拉起 dev server（自建进程组）→ 可选拉起桌面壳
//   → 等就绪 → 进度快照 run/launch-status.json → 任一子进程退出即整树回收。
//
// 用法：
//   直接 node 调用时传参形如：--mode web|tauri|prebuilt、--no-open
//   --shell-exe <app.exe> 则用于由启动器指定桌面壳
//   直跑等价于 web 模式（前台：Ctrl-C 收尾并回收整棵进程树）。
//
// 环境变量开关（与 .ps1 版同名同义）：SKIP_CLEAN / FORCE_CLEAN / NO_OPEN /
// COMFYAPP_FOREGROUND / COMFYAPP_PREBUILT_SHELL。

import fs from "node:fs";
import path from "node:path";

import { resolveAppPort, resolveRepoRoot } from "./app-port.mjs";
import { writeAppServiceExit } from "./app-service-exit.mjs";
import { applyPendingRestoreAtBoot } from "./db-backup-core.mjs";
import { spawnSchemaSync } from "./db-schema-state.mjs";
import { checkEnvFile, envInitHint } from "./env-preflight.mjs";
import { createLogSink, currentDirOf, runtimeStamp, runStamp } from "./launcher-core/log.mjs";
import { pruneRuns, recordPid, recoverStaleCurrent, startRun } from "./launcher-core/run.mjs";
import {
  classifyProbe,
  usesExplicitPort,
  writeLaunchStatus,
} from "./launcher-core/orchestrator.mjs";
import {
  READY_TIMEOUT_MS,
  describeReadyTimeout,
  waitForDevReady,
} from "./launcher-core/ready-wait.mjs";
// 「收尾定性」这一族（downstreamExitKind / readShellMarkers /
// describeDownstreamExit / runtimeExitRecord）判的是同一件事的四个侧面，收在
// launcher-core/downstream-exit.mjs（入口文件长度的约束，§12.6 R5 的姊妹档）。
// 主流程在这里 import 调用；**不再从本文件再导出**——调用方直接 import 那个
// 模块，少一层转发就少一处要同步的面（没有任何仓内调用方走本文件这道门）。
import { describeDownstreamExit, runtimeExitRecord } from "./launcher-core/downstream-exit.mjs";
import { isWindows } from "./launcher-core/shell.mjs";
import {
  concludeDownstreamExit,
  spawnDevServer as downstreamSpawnDevServer,
  spawnExecutorHost as downstreamSpawnExecutorHost,
  syncDependencies as downstreamSyncDependencies,
} from "./launcher-core/downstream.mjs";
import {
  appendRuntimeWarning as preflightAppendRuntimeWarning,
  reconcilePnpmVersion as preflightReconcilePnpmVersion,
  runToolchainGate as preflightRunToolchainGate,
  shellStaleWarning,
} from "./launcher-core/preflight.mjs";
import {
  defaultShellExe,
  ensureSplashResource as shellOpsEnsureSplash,
  killShellFromPidFile as shellOpsKillShell,
  resetShellPidFile,
  spawnShell as shellOpsSpawnShell,
} from "./launcher-core/shell-ops.mjs";
import { startShellStage } from "./launcher-core/shell-stage.mjs";
import { runStartupGates } from "./launcher-core/startup-gates.mjs";
import { bootDevServerStage } from "./launcher-core/dev-boot.mjs";
import {
  openBrowser as miscOpsOpenBrowser,
  parseArgs as miscOpsParseArgs,
  shutdown as miscOpsShutdown,
} from "./launcher-core/misc-ops.mjs";
import {
  reapAll as portReapReapAll,
  reapProcessTree,
  reapStaleSession as portReapReapStale,
  reconcilePort as portReapReconcilePort,
  scanPorts,
} from "./launcher-core/port-reap.mjs";
import { ProbeUnavailableError } from "./launcher-core/procs.mjs";
// `COMFY_EXECUTOR` 判据的纯 Node 侧唯一定义（与 executor-host.mjs 共用，ADR §14 D5）
import { resolveExecutorMode } from "./launcher-core/executor-mode.mjs";
import { pruneTimestampedLogs, syncNextCache } from "./launcher-core/worktree.mjs";
import {
  createRuntimeRouteWatch,
  describeRuntimeHealCause,
  readGitHead,
} from "./launcher-core/runtime-heal.mjs";
import { touchHeartbeat, writeSession } from "./dev-launcher-session.mjs";

const ROOT = resolveRepoRoot();

// 下面这些是「编排用的纯函数」的实现去处（launcher-core/*）：这里**再导出**，
// 既让测试与其它调用方有一个稳定的门面（编排器就是这套能力的入口），也避免
// 调用方各自去 import 内部模块造成路径散布。
export { spawnInGroup, whichCommand } from "./launcher-core/shell.mjs";
export { orchestratePnpm, probePnpm, packageManagerVersion } from "./launcher-core/corepack.mjs";

/** 工具链门禁留下的 pnpm 修复提示（供启动页横幅 / 测试取值）。 */
/** 工具链门禁认定的 pnpm 修复提示（非 null 时会被记进启动页横幅）。
 *
 *  为什么要在模块里留一份：门禁跑在**弹壳之前**，那一刻启动页还不存在，
 *  无法把提示交出去；而这条提示恰恰是「服务起不来」现场里最该被看到的一句。
 *  落进 launch-status 的 stale_shell 通道（启动页已有的横幅），用户不必先去翻日志。 */
let lastPnpmTip = /** @type {string | null} */ (null);

/** @returns {string | null} */
export function pnpmToolchainTip() {
  return lastPnpmTip;
}
export {
  configFingerprint,
  syncNextCache,
  checkNodeModules,
  lockfileDrift,
  verifyInstall,
} from "./launcher-core/worktree.mjs";
export {
  waitForReady,
  classifyProbe,
  describeProbeState,
  latestPanelTranscript,
  readDiagnosticsTail,
  readTail,
  fileHasMarker,
  writeLaunchStatus,
} from "./launcher-core/orchestrator.mjs";
export { listeningPidsOnPort, pidBelongsToRoot, processCwd } from "./launcher-core/procs.mjs";

/** 心跳间隔：必须明显小于 dev-launcher-session 的孤儿判定阈值（30s），
 *  否则正常运行的 launcher 会被下一次启动误判成已死。 */
const HEARTBEAT_INTERVAL_MS = 5000;

// ── 日志：log/current/<分区>/（路径固定，退出时整目录归档到 runs/）──
// 顺序很重要：先 recoverStaleCurrent 收走上一次崩掉的残留，再 startRun 写新
// run.json —— 反过来的话，本次的 run.json 会被当成「残留」一起收走。
try {
  recoverStaleCurrent(ROOT);
} catch {
  /* 崩溃补做失败不该拦住启动（上一轮的现场留在原地，下次还有机会） */
}
const { runId } = startRun(ROOT, {
  args: process.argv.slice(2),
  mode: process.env.COMFYAPP_LAUNCH_MODE ?? "",
});
/** 本次运行的 runId：行前缀与跨进程传递都用它。 */
export const RUN_ID = runId;
/* 注意：这里**刻意不**清掉上一次的「应用服务为什么结束」记录（ISSUE #1692）。
 *
 * 直觉上「新服务起来了，旧结论该清掉」，但读取侧的时序恰好相反：探活走的是
 * 应用服务自己的 HTTP，服务不在时那条通道必然不通——界面只能在**服务恢复之后**
 * 才读得到这份记录，而那一刻如果已经被清掉，用户就永远看不到「刚才为什么断」。
 *
 * 陈旧记录不会造成误报：记录带着**结束那一次**的 runId，而本进程的 runId 由
 * `COMFYAPP_RUN_ID` 透传给 dev server（见下），界面据此判「这份结论说的是不是
 * 上一次运行」。判据在 `~/lib/shell/app-service-exit` 一处。 */
// 让被 spawn 的子进程（executor-host / standalone server）也带上同一个 runId ——
// 「grep runId 一把梭」要求所有通道都写这一列，靠各进程自己生成就散了。
process.env.COMFYAPP_RUN_ID = runId;

const launcherLogDir = currentDirOf("launcher", ROOT);
const nextjsLogDir = currentDirOf("nextjs", ROOT);
const currentLog = path.join(launcherLogDir, "dev-launcher.log");
const logSink = createLogSink(ROOT, {
  file: currentLog,
  runId,
  tag: "launcher",
});
// 供壳侧 get_launch_log 的 sentinel 机制定位本次运行日志（与 .ps1 版同文件）。
try {
  fs.writeFileSync(path.join(launcherLogDir, "dev-launcher-current.txt"), currentLog, "utf8");
} catch {
  /* 见 log 模块注释 */
}
const runTimestamp = runStamp();
/** `app-runtime` 通道本次启动那一份的名字戳 —— 与 {@link runTimestamp} 同一次
 *  取时刻（两个形态，不是两次实现），经 `COMFYAPP_LAUNCH_STAMP` 交给 dev server
 *  的写方，使「launcher 写的预检提醒」与「应用随后写的业务日志」落在同一份
 *  文件上（见 `appRuntimeLogFileName`）。 */
export const launchStamp = runtimeStamp();
process.env.COMFYAPP_LAUNCH_STAMP = launchStamp;
// 保留策略异步跑（启动路径上绝不能因为它变慢或挂住）；失败静默。
void pruneRuns(ROOT).catch(() => {});

/** 写一行日志（stdout + 本次运行日志双写）。 */
/**
 * @param {string} message
 * @param {"STEP" | "OK" | "WARN" | "ERROR" | "INFO"} [level]
 */
export function log(message, level = "INFO") {
  logSink.write(message, level);
}

/** 本次会话拉起的子进程（收尾时全部回收）。 */
/** @type {import("node:child_process").ChildProcess[]} */
const spawned = [];

// ── 预检 ────────────────────────────────────────────────────────────────────
// 实现搬到 `launcher-core/preflight.mjs`（ISSUE #1811 拆 R5 超限文件），这里只做
// **同名薄包装**：导出面一字不变，`shell-gate.mjs` 与各用例照旧。

/** 预检层的注入上下文（日志出口 / 启动戳 / pnpm 提示的落点）。 */
const preflightCtx = {
  log,
  stamp: launchStamp,
  setPnpmTip: (/** @type {string | null} */ tip) => {
    lastPnpmTip = tip;
  },
};

/** 工具链门禁（实现见 `launcher-core/preflight.mjs`）。
 * @param {string} [root] @returns {string | null} */
export function runToolchainGate(root = ROOT) {
  return preflightRunToolchainGate(preflightCtx, root);
}

/** pnpm 版本一致性（实现见 `launcher-core/preflight.mjs`）。
 * @param {string} [root] @returns {{ version: string, expected: string, tip: string | null } | null} */
export function reconcilePnpmVersion(root = ROOT) {
  return preflightReconcilePnpmVersion(preflightCtx, root);
}

/** 旧版桌面壳提醒（纯函数，实现见 `launcher-core/preflight.mjs`）。 */
export { shellStaleWarning } from "./launcher-core/preflight.mjs";

/** 把壳 / pnpm 提醒补录进 app-runtime 通道（实现见 `launcher-core/preflight.mjs`）。
 * @param {string} message @param {string} [root] */
export function appendRuntimeWarning(message, root = ROOT) {
  preflightAppendRuntimeWarning(preflightCtx, message, root);
}

// ── 端口 / 回收 ────────────────────────────────────────────────────────────
// 实现搬到 `launcher-core/port-reap.mjs`（ISSUE #1811 拆 R5 超限文件），这里只
// 做**同名薄包装**。需要模块状态的三个函数把 `log` / `spawned` / `root` 注入进去。
//
// `reapProcessTree` 是纯转发（转 kill-process-tree.ts），无状态 —— 但它是
// 桌面壳层与收尾路径共用的**唯一整树回收出口**，所以仍从本文件导出（薄包装在
// 下方 `shellOpsCtx` 里也引用它，同一份实现、不抄第二遍）。

export { reapProcessTree, scanPorts };

/** 回收层的注入上下文（与桌面壳层同源的三样状态 / 能力）。 */
const portReapCtx = {
  log,
  spawned,
  root: ROOT,
};

/** 回收本次会话拉起的整棵进程树（实现见 `launcher-core/port-reap.mjs`）。 */
export function reapAll() {
  return portReapReapAll(portReapCtx);
}

/** 回收上一次运行遗留的进程树（实现见 `launcher-core/port-reap.mjs`）。 */
/** @param {string} [root] @returns {Promise<number[] | null>} */
export function reapStaleSession(root = ROOT) {
  return portReapReapStale(root);
}

export { processCommandLine, isAppDevServerCmdline } from "./launcher-core/port-reap.mjs";

/** 端口归属与残留回收（实现见 `launcher-core/port-reap.mjs`）。
 * @param {number} port @param {string} [root]
 * @param {{ explicit?: boolean }} [options] @returns {Promise<string>} */
export function reconcilePort(port, root = ROOT, options = {}) {
  return portReapReconcilePort(portReapCtx, port, root, options);
}

// ── 桌面壳 ──────────────────────────────────────────────────────────────────
// 实现搬到 `launcher-core/shell-ops.mjs`（ISSUE #1811 拆 R5 超限文件），这里只
// 做**同名薄包装**：导出面一字不变，`shell-gate.mjs` / `doc-facts.cjs` 与用例照旧。
// 需要模块状态的三个函数把 `log` / `spawned` / `reapProcessTree` 注入进去 ——
// 那三样住在主文件里（日志出口、子进程账本、整树回收）。

export { defaultShellExe } from "./launcher-core/shell-ops.mjs";

/** 注入上下文：模块级状态与能力的唯一出口（见上方说明）。 */
const shellOpsCtx = {
  log,
  spawned,
  reapProcessTree,
};

/** 确保 Tauri 启动页资源就位（实现见 `launcher-core/shell-ops.mjs`）。
 * @param {string} [root] */
export function ensureSplashResource(root = ROOT) {
  return shellOpsEnsureSplash(shellOpsCtx, root);
}

/** 拉起预编译壳并把 PID 落盘（实现见 `launcher-core/shell-ops.mjs`）。
 * @param {string} shellExe @param {number} port
 * @param {{ root?: string, foreground?: string | null }} [options] */
export function spawnShell(shellExe, port, options = {}) {
  return shellOpsSpawnShell(shellOpsCtx, shellExe, port, options);
}

/** 清掉上一轮留下的壳 PID 文件（纯文件操作，实现见 shell-ops.mjs）。 */
export { resetShellPidFile } from "./launcher-core/shell-ops.mjs";

/** 按 PID 文件兜底回收壳（实现见 `launcher-core/shell-ops.mjs`）。 */
/** @param {string} [root] @returns {Promise<boolean>} */
export function killShellFromPidFile(root = ROOT) {
  return shellOpsKillShell(shellOpsCtx, root);
}

// ── 打开浏览器 / 收尾 ─────────────────────────────────────────────────────────
// 实现搬到 `launcher-core/misc-ops.mjs`（ISSUE #1811 拆 R5 超限文件），这里只做
// **同名薄包装**，导出面不变。

/** 杂项编排的注入上下文。 */
const miscOpsCtx = {
  log,
  reapAll,
  root: ROOT,
};

/** 打开浏览器（实现见 `launcher-core/misc-ops.mjs`）。 */
/** @param {string} url */
export function openBrowser(url) {
  miscOpsOpenBrowser(miscOpsCtx, url);
}

/** 优雅中断：回收整树 → 归档 → 退出（实现见 `launcher-core/misc-ops.mjs`）。 */
/** @param {number} code */
export async function shutdown(code) {
  return miscOpsShutdown(miscOpsCtx, code);
}

// ── 依赖与 lockfile 对齐（启动前的补装）─────────────────────────────────────
// 实现搬到 `launcher-core/downstream.mjs`（ISSUE #1811 拆 R5 超限文件），这里只做
// **同名薄包装**。`syncDependencies` 被 `tests/dev-launcher-dependency-sync.test.ts`
// 直接 import，签名（root, deps）保持不变。

/** 注入上下文：日志出口、子进程账本、检出根、收尾入口（都在本文件里）。 */
const downstreamCtx = {
  log,
  spawned,
  root: ROOT,
  shutdown,
  runId: RUN_ID,
  runTimestamp,
};

/** 补装依赖（实现见 `launcher-core/downstream.mjs`）。
 * @param {string} root
 * @param {{ status?: ((phase: string, progress: number, message: string, extra?: object) => void) | null, staleShell?: string | null }} [deps] */
export function syncDependencies(root, deps = {}) {
  return downstreamSyncDependencies(downstreamCtx, root, deps);
}

/** 起 dev server（实现见 `launcher-core/downstream.mjs`）。
 * @param {number} port @param {string} host
 * @param {string} outFile @param {string} errFile
 * @param {Record<string, string>} [extraEnv] */
export function spawnDevServer(port, host, outFile, errFile, extraEnv = {}) {
  return downstreamSpawnDevServer(downstreamCtx, port, host, outFile, errFile, extraEnv);
}

/** 拉起 executor host（实现见 `launcher-core/downstream.mjs`）。 */
export function spawnExecutorHost() {
  return downstreamSpawnExecutorHost(downstreamCtx);
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

/** 解析命令行参数（实现见 `launcher-core/misc-ops.mjs`）。 */
/** @param {string[]} argv */
export function parseArgs(argv) {
  return miscOpsParseArgs(argv);
}

/**
 * 主流程：回收孤儿 → 预检 → 端口 → 缓存 → 起服务 →（可选）起壳 → 等就绪 → 常驻。
 * @param {string[]} [argv] @returns {Promise<number>} 退出码（0 正常，非 0 已打印可行动作）
 */
export async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const startedAt = Date.now();
  /* 归因用的「起点」：启动那一刻的 HEAD。只存内存、只为通知文案服务 —— 运行期
   * 自愈时拿它比一次 `git diff`（懒归因，见 launcher-core/runtime-heal.mjs）。
   * git 不可用 / 非检出 → null（文案退化为「无法归因」，自愈照常）。 */
  const headAtBoot = readGitHead(ROOT);
  const explicitPort = Number.parseInt(args.port ?? "", 10);
  const portOrNull = Number.isInteger(explicitPort) && explicitPort > 0 ? explicitPort : null;
  let currentPort = portOrNull;
  /** 进度快照 + 提醒字段（一次运行内共享）。 */
  /**
   * 写一次进度快照。
   * @param {string} phase 当前阶段名
   * @param {number} progress 进度百分比
   * @param {string} message 给用户看的说明
   *  @param {Partial<import("./launcher-core/orchestrator.mjs").LaunchStatusPayload>} [extra] 附加上报字段
   */

  const status = (phase, progress, message, extra = {}) =>
    writeLaunchStatus(ROOT, {
      phase,
      progress,
      message,
      appPort: portOrNull ?? currentPort,
      startedAt,
      ...extra,
    });
  // 0~2) 预检桥段（孤儿回收 → 环境/工具链门禁 → 依赖对齐 → 备份恢复 → 端口）
  // 实现见 `launcher-core/startup-gates.mjs`（ISSUE #1811 拆 R5 超限文件）；
  // 那一段的**内部顺序是契约**（回收在起进程前、换库在开库前），见模块注释。
  const gated = await runStartupGates(
    {
      log,
      root: ROOT,
      status,
      reapStaleSession,
      checkEnvFile,
      envInitHint,
      runToolchainGate,
      syncDependencies,
      applyPendingRestoreAtBoot,
      resolveAppPort,
    },
    { portOrNull, mode: args.mode },
  );
  if (!gated.ok) {
    log(gated.error.message, "ERROR");
    status("error", 1, gated.error.statusMessage, {
      error: true,
      ...(gated.error.staleShell ? { staleShell: gated.error.staleShell } : {}),
    });
    return 1;
  }
  const port = gated.port;
  currentPort = port;
  // 3) 桌面壳（prebuilt 模式最先拉起：用户双击后第一件事是看见窗口）
  // 这一段在 `launcher-core/shell-stage.mjs`（ISSUE #1811 拆 R5 超限文件）；
  // 主文件只把壳层动作与日志出口注进去，并接「找不到壳」这个提前返回。
  let shell = /** @type {import("node:child_process").ChildProcess | null} */ (null);
  let staleShell = null;
  if (args.mode === "prebuilt") {
    const staged = startShellStage(
      {
        log,
        root: ROOT,
        appendRuntimeWarning,
        defaultShellExe,
        ensureSplashResource,
        spawnShell,
        resetShellPidFile,
        shellStaleWarning,
      },
      {
        mode: args.mode,
        shellExe: args.shellExe,
        coldStart: args.coldStart,
        port,
      },
    );
    if (!staged.ok) {
      log(staged.error, "ERROR");
      status("error", 1, staged.error, { error: true });
      return 1;
    }
    shell = staged.shell;
    staleShell = staged.staleShell;
    status("port-check", 0.05, "桌面壳已启动，正在检查端口占用…", {
      staleShell,
    });
  }

  // 4) 端口归属：只回收自己的残留（§1.4）。`explicit` 由 `portOrNull` 决定——
  // 编排器一律显式把端口传给 dev server（Next 不认 COMFYAPP_PORT），因此显式
  // 口上的本仓库应用服务只可能是残留；缺省解析链上则一律不碰（见 reconcilePort）。
  //
  // **这一步不能因为「壳已查过」而跳过**（ISSUE #1687 的「同一次启动只问一次」前提
  // 只在「本次启动无历史残留」时成立）。壳的单实例判据（`another_instance_running`
  // 的命名互斥量，见 `shell_launch.rs`）只认「有没有别的壳在跑」，**从不碰端口**——
  // 它看不到「上一次启动残留的 dev server 还占着 3790」这种互斥量早已释放、只剩孤儿
  // 进程的情况（§1.7）。`reconcilePort` 才是回收本检出端口残留的**唯一入口**：跳过它，
  // 新 dev server 会撞 `EADDRINUSE` 立刻退出，编排器随之 `await [dev]` 解析为 1 整体退出
  // （一次双击起不来的典型现场：两个窗口没了，应用也起不来）。残留是**上一次**启动的，
  // 不在这一次启动的单一实例假设里，因此端口族回收必须每次都跑。
  let portSummary;
  try {
    portSummary = await reconcilePort(port, ROOT, {
      explicit: usesExplicitPort(portOrNull),
    });
  } catch (error) {
    /* 端口 / 进程探测没跑起来：不是「端口空闲」，也不是「被别人占着」。
     * 这一格**没有结论**，不许继续起服务（会撞残留 / EADDRINUSE），
     * 也不许被最外层泛化成「启动编排异常」而不给可行动作（§13.6.3）。 */
    if (error instanceof ProbeUnavailableError) {
      const reason = error.message;
      log(`端口归属判据没量到：${reason}`, "ERROR");
      status("error", 1, "端口归属判据没量到，未继续启动", { error: true, staleShell: reason });
      return 1;
    }
    throw error;
  }
  log(`端口检查：${portSummary}`, "OK");
  status("port-ready", 0.12, "端口已就绪，处理编译缓存…", { staleShell });

  // 5~8) 起服务桥段（缓存策略 → dev server → 执行器宿主 → 会话锚点 → 后台 schema）
  // 实现见 `launcher-core/dev-boot.mjs`（ISSUE #1811 拆 R5 超限文件）。
  // 心跳定时器留在这一层：它的句柄要传给两个下游出口（下游退出 / 常驻结束），
  // 挪进阶段模块就得把句柄再透出来一次 —— 那不是拆分，是搬运所有权。
  const booted = bootDevServerStage(
    {
      log,
      root: ROOT,
      status,
      spawnedChildren: () => spawned,
      appendRuntimeWarning,
      syncNextCache,
      reconcilePnpmVersion,
      currentDirOf,
      pruneTimestampedLogs,
      spawnDevServer,
      recordPid,
      spawnExecutorHost,
      resolveExecutorMode,
      writeSession,
      touchHeartbeat,
      spawnSchemaSync,
    },
    {
      port,
      host: args.host,
      mode: args.mode,
      staleShell,
      runTimestamp,
      startedAt,
    },
  );
  let dev = booted.dev;
  const nextOut = booted.nextOut;
  const nextErr = booted.nextErr;
  staleShell = booted.staleShell;
  const heartbeat = setInterval(() => {
    touchHeartbeat(ROOT);
  }, HEARTBEAT_INTERVAL_MS);
  clearIntervalGuard(heartbeat);
  // 9) 等就绪（dev server 先退出则立刻定性；检测到路由表 404 则自愈一次）
  // 循环本体在 `launcher-core/ready-wait.mjs`（ISSUE #1811 拆 R5 超限文件，
  // §3.3 已随本刀列为实现去处）；这里只接两个出口。
  log(`等待服务就绪（http://${args.host}:${port}）…`, "STEP");
  status("dev-server-starting", 0.3, "本地服务已启动，等待就绪…", {
    staleShell,
  });
  const devExited = () => dev.exitCode !== null || dev.signalCode !== null;

  /* 常驻退出监听的接线：`dev` 会被轻量重启**换成新对象**，因此监听器必须跟着
   * 换 —— 否则「重启后 dev 崩了」不会被收尾。旧对象被我们主动回收时先摘掉监听，
   * 不然「自己回收自己」会当场被当成意外退出，把整棵进程树一起收走。 */
  /** @type {{ child: import("node:child_process").ChildProcess,
   *           listener: (code: number | null) => void } | null} */
  let devWatch = null;
  /** 常驻收尾的解析器（step 11 填进来；dev 退出时由 watchDevChild 的监听器调它）。 */
  /** @type {((end: { who: string, code: number }) => void) | null} */
  let resolveLaunchEnd = null;

  /** 把「dev 退出」接到常驻收尾的解析器上（每次换 dev 都要重新接一次）。
   * @param {import("node:child_process").ChildProcess} child */
  function watchDevChild(child) {
    if (devWatch) {
      devWatch.child.off("exit", devWatch.listener);
    }
    /** @type {(code: number | null) => void} */
    const listener = (code) => resolveLaunchEnd?.({ who: "dev", code: code ?? 0 });
    devWatch = { child, listener };
    child.once("exit", listener);
  }

  /** 摘掉旧 dev 的退出监听（回收它**之前**调，避免把「主动重启」判成意外退出）。 */
  function detachDevWatch() {
    if (devWatch) {
      devWatch.child.off("exit", devWatch.listener);
      devWatch = null;
    }
  }

  /** 只重启 dev 子进程（保住壳）：回收 dev 整棵子树 → 清 .next → 带重启原因
   *  （+ 可选的人话归因）重新拉起 → 重新武装退出监听 → 刷新会话锚点（新 dev 的
   *  pid 要落进去，否则进程被杀后的孤儿回收会漏掉它）。
   *
   *  `reason` 经 `COMFYAPP_RESTART_REASON` 透传给新 dev（界面据此弹通知）；
   *  `detail` 非空时另注入 `COMFYAPP_RESTART_DETAIL`，作为通知里「为什么」那句人话。
   *  这是「陈旧路由表」自愈的唯一动作，被调用方限制为有界（冷却 + 上限）。
   * @param {string} reason
   * @param {string | null} [detail] */
  async function restartDevForReason(reason, detail = null) {
    detachDevWatch();
    if (dev.pid) {
      try {
        await reapProcessTree({
          pid: dev.pid,
          detached: !isWindows(),
          force: true,
        });
      } catch (error) {
        log(
          `回收旧 dev 子树失败：${error instanceof Error ? error.message : String(error)}`,
          "WARN",
        );
      }
    }
    syncNextCache(ROOT, { FORCE_CLEAN: "1" });
    /** @type {Record<string, string>} */
    const extraEnv = { COMFYAPP_RESTART_REASON: reason };
    if (detail) {
      extraEnv.COMFYAPP_RESTART_DETAIL = detail;
    }
    dev = spawnDevServer(port, args.host, nextOut, nextErr, extraEnv);
    watchDevChild(dev);
    writeSession(ROOT, {
      launcher_pid: process.pid,
      child_pids: spawned.map((c) => c.pid).filter((pid) => typeof pid === "number"),
      app_port: port,
      mode: args.mode,
      started_at: new Date(startedAt).toISOString(),
    });
  }

  const waited = await waitForDevReady(
    {
      log,
      status,
      devExited,
      respawnDev: async (reason) => {
        /* 启动就绪期的自愈不带归因（headAtBoot 刚记下、此刻 diff 必为空）：这句
         * 「为什么」由既有文案给出，无需多跑一次 git。 */
        await restartDevForReason(reason, null);
        log(`dev server 已重启（PID ${dev.pid}）`, "OK");
      },
    },
    {
      port,
      host: args.host,
      staleShell,
      nextOut,
      nextErr,
      panelDir: nextjsLogDir,
      startedAt,
    },
  );

  if (devExited()) {
    return await concludeDownstreamExit(downstreamCtx, {
      dev,
      shell,
      heartbeat,
      staleShell,
      // 本次运行**自己起的**日志文件，不按名字重找（见函数注释）。
      stdoutFile: nextOut,
      stderrFile: nextErr,
      port: currentPort,
    });
  }
  if (!waited.ready) {
    const verdict = describeReadyTimeout({
      lastProbeState: waited.lastProbeState,
      recovered: waited.recovered,
      tail: waited.tail ?? "(无输出)",
      timeoutMs: READY_TIMEOUT_MS,
    });
    log(verdict.log, verdict.level);
    status("error", 1, verdict.statusMessage, { error: true, staleShell });
    await shutdown(1);
  }
  log(`服务已就绪：http://${args.host}:${port}`, "OK");
  status("dev-server-ready", 0.9, "本地服务已就绪", {
    ready: true,
    staleShell,
  });

  // 9.5) 运行期自愈：常驻探测「接口层是不是整体 404」。
  //
  // **症状驱动，不看代码**：与 HMR 零重叠 —— HMR 已吸收的 pull 下 `/api/health`
  // 仍是 200，探测毫不知情、零动作；真坏了（页面 200 而 `/api/health` 404）才
  // 轻量重启 dev server。归因（为什么改坏）在这一刻才懒跑一次 git（见 runtime-heal.mjs），
  // 拿不到就退化为「无法归因」，不影响自愈。`armedInitially` 为真：本行只在就绪
  // 之后才走到。
  const runtimeWatch = createRuntimeRouteWatch({
    log,
    armedInitially: true,
    probeHealth: () => classifyProbe({ port, host: args.host }),
    probeRoot: async () => (await classifyProbe({ port, host: args.host, path: "/" })) === "ready",
    onHeal: async () => {
      const detail = describeRuntimeHealCause(ROOT, headAtBoot);
      log(`陈旧路由表自愈归因：${detail ?? "（无法归因）"}`, detail ? "INFO" : "WARN");
      await restartDevForReason("route-404-heal", detail);
      log(`dev server 已重启（PID ${dev.pid}）`, "OK");
    },
  });

  // 10) 打开浏览器（仅纯 Web 模式；桌面模式界面就是壳窗口）
  if (args.open && process.env.NO_OPEN !== "1" && args.mode === "web") {
    openBrowser(`http://localhost:${port}`);
  }

  // 11) 常驻：任一子进程退出即收尾（与 .ps1 的「等任一退出」同语义）。
  //
  // **要记住是谁退出的**：写侧只在「dev 先走」时才有一件事可做（见下），而
  // 「等任一退出」这个语义本身不回答是谁。
  const ended = await new Promise((resolve) => {
    /* dev 的监听由 watchDevChild 接（它随每次轻量重启重新武装）；这里只把解析器
     * 交出去 + 接壳与信号这两条一轮会话内不会变的边。 */
    resolveLaunchEnd = resolve;
    shell?.once("exit", (code) => {
      resolve({ who: "shell", code: code ?? 0 });
    });
    process.once("SIGINT", () => {
      resolve({ who: "signal", code: 0 });
    });
    process.once("SIGTERM", () => {
      resolve({ who: "signal", code: 0 });
    });
    watchDevChild(dev);
  });
  runtimeWatch.stop();
  clearInterval(heartbeat);
  /* 运行期退出的落盘（ISSUE #1692 的第二半）。判据与措辞在
   * {@link runtimeExitRecord}（可单测），这里只负责把它写下去。 */
  const record = runtimeExitRecord({
    who: ended.who,
    devCode: dev.exitCode,
    devSignal: dev.signalCode,
    port: currentPort,
    runId: RUN_ID,
  });
  if (record) {
    writeAppServiceExit(ROOT, record);
    log("dev server 已退出：结束原因已记进 run/app-service-exit.json（界面恢复后会读它）", "WARN");
    log(
      describeDownstreamExit("dev-server", {
        devCode: dev.exitCode,
        shellCode: shell?.exitCode ?? null,
        shellPid: shell?.pid,
        stderrFile: nextErr,
        stdoutFile: nextOut,
      }),
      "ERROR",
    );
  }
  if (args.mode === "prebuilt") {
    log("桌面壳或 dev server 已退出，正在回收整棵进程树…", "STEP");
  } else {
    log("检到子进程退出，正在回收整棵进程树…", "STEP");
  }
  await shutdown(ended.code);
  return ended.code;
}

/** 心跳定时器的引用遮蔽（避免被 tree-shaking 式的误读当成未使用）。 */
/** @param {NodeJS.Timeout} timer */
function clearIntervalGuard(timer) {
  if (process.env.COMFYAPP_LAUNCHER_NO_HEARTBEAT === "1") {
    clearInterval(timer);
  }
}

// 信号处理：任何中断都要先回收整棵进程树再退出（硬规则 3）。
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log(`收到 ${signal}：回收子进程树后退出`, "WARN");
    void shutdown(signal === "SIGINT" ? 130 : 143);
  });
}

// 直跑（被 import 时不执行）：供测试复用上面这些纯函数。
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  if (process.env.COMFYAPP_LAUNCHER_DRY_RUN === "1") {
    process.stdout.write("dry-run：未启动任何进程\n");
  } else {
    run()
      .then((code) => process.exit(code))
      .catch(async (error) => {
        log(`启动编排异常：${error?.stack ?? error}`, "ERROR");
        await reapAll();
        process.exit(1);
      });
  }
}
