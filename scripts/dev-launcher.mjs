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
import { fileURLToPath } from "node:url";

import { resolveAppPort, resolveRepoRoot } from "./app-port.mjs";
import { writeAppServiceExit } from "./app-service-exit.mjs";
import { applyPendingRestoreAtBoot } from "./db-backup-core.mjs";
import { spawnSchemaSync } from "./db-schema-state.mjs";
import { checkEnvFile } from "./env-preflight.mjs";
import {
  createLogSink,
  currentDirOf,
  runtimeStamp,
  runStamp,
} from "./launcher-core/log.mjs";
import {
  pruneRuns,
  recordPid,
  recoverStaleCurrent,
  startRun,
} from "./launcher-core/run.mjs";
import {
  classifyProbe,
  describeProbeState,
  readDiagnosticsTail,
  usesExplicitPort,
  writeLaunchStatus,
} from "./launcher-core/orchestrator.mjs";
// 「收尾定性」这一族（downstreamExitKind / readShellMarkers /
// describeDownstreamExit / runtimeExitRecord）判的是同一件事的四个侧面，收在
// launcher-core/downstream-exit.mjs（入口文件长度的约束，§12.6 R5 的姊妹档）。
// 主流程在这里 import 调用；**不再从本文件再导出**——调用方直接 import 那个
// 模块，少一层转发就少一处要同步的面（没有任何仓内调用方走本文件这道门）。
import {
  describeDownstreamExit,
  runtimeExitRecord,
} from "./launcher-core/downstream-exit.mjs";
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
import { defaultShellExe, resetShellPidFile } from "./launcher-core/shell-ops.mjs";
import {
  openBrowser as miscOpsOpenBrowser,
  parseArgs as miscOpsParseArgs,
  shutdown as miscOpsShutdown,
} from "./launcher-core/misc-ops.mjs";
import {
  reapAll as portReapReapAll,
  reapStaleSession as portReapReapStale,
  reconcilePort as portReapReconcilePort,
} from "./launcher-core/port-reap.mjs";
import {
  ensureSplashResource as shellOpsEnsureSplash,
  killShellFromPidFile as shellOpsKillShell,
  spawnShell as shellOpsSpawnShell,
} from "./launcher-core/shell-ops.mjs";
// `COMFY_EXECUTOR` 判据的纯 Node 侧唯一定义（与 executor-host.mjs 共用，ADR §14 D5）
import { resolveExecutorMode } from "./launcher-core/executor-mode.mjs";
import {
  pruneTimestampedLogs,
  syncNextCache,
} from "./launcher-core/worktree.mjs";
import {
  touchHeartbeat,
  writeSession,
} from "./dev-launcher-session.mjs";

const ROOT = resolveRepoRoot();

// 下面这些是「编排用的纯函数」的实现去处（launcher-core/*）：这里**再导出**，
// 既让测试与其它调用方有一个稳定的门面（编排器就是这套能力的入口），也避免
// 调用方各自去 import 内部模块造成路径散布。
export { spawnInGroup, whichCommand } from "./launcher-core/shell.mjs";
export {
  orchestratePnpm,
  probePnpm,
  packageManagerVersion,
} from "./launcher-core/corepack.mjs";

/** 工具链门禁留下的 pnpm 修复提示（供启动页横幅 / 测试取值）。 */
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
export {
  listeningPidsOnPort,
  pidBelongsToRoot,
  processCwd,
} from "./launcher-core/procs.mjs";

/** 心跳间隔：必须明显小于 dev-launcher-session 的孤儿判定阈值（30s），
 *  否则正常运行的 launcher 会被下一次启动误判成已死。 */
const HEARTBEAT_INTERVAL_MS = 5_000;

/** 等服务就绪的上限（与 .ps1 的 180 次 × 1s 同口径）。 */
const READY_TIMEOUT_MS = 180_000;

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
  fs.writeFileSync(
    path.join(launcherLogDir, "dev-launcher-current.txt"),
    currentLog,
    "utf8",
  );
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

/** 工具链门禁认定的 pnpm 修复提示（非 null 时会被记进启动页横幅）。
 *
 *  为什么要在模块里留一份：门禁跑在**弹壳之前**，那一刻启动页还不存在，
 *  无法把提示交出去；而这条提示恰恰是「服务起不来」现场里最该被看到的一句。
 *  落进 launch-status 的 stale_shell 通道（启动页已有的横幅），用户不必先去翻日志。 */
let lastPnpmTip = /** @type {string | null} */ (null);



// ── 预检 ────────────────────────────────────────────────────────────────────
// 实现搬到 `launcher-core/preflight.mjs`（ISSUE #1811 拆 R5 超限文件），这里只做
// **同名薄包装**：导出面一字不变，`shell-gate.mjs` 与各用例照旧。

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
  return preflightAppendRuntimeWarning(preflightCtx, message, root);
}

/** 预检层的注入上下文（日志出口 / 启动戳 / pnpm 提示的落点）。 */
const preflightCtx = {
  log,
  stamp: launchStamp,
  setPnpmTip: (/** @type {string | null} */ tip) => {
    lastPnpmTip = tip;
  },
};

// ── 端口 / 回收 ────────────────────────────────────────────────────────────
// 实现搬到 `launcher-core/port-reap.mjs`（ISSUE #1811 拆 R5 超限文件），这里只
// 做**同名薄包装**。需要模块状态的三个函数把 `log` / `spawned` / `root` 注入进去。
//
// `reapProcessTree` 是纯转发（转 kill-process-tree.ts），无状态 —— 但它是
// 桌面壳层与收尾路径共用的**唯一整树回收出口**，所以仍从本文件导出（薄包装在
// 下方 `shellOpsCtx` 里也引用它，同一份实现、不抄第二遍）。

import { reapProcessTree, scanPorts } from "./launcher-core/port-reap.mjs";

export { reapProcessTree, scanPorts };

/** 回收本次会话拉起的整棵进程树（实现见 `launcher-core/port-reap.mjs`）。 */
export function reapAll() {
  return portReapReapAll(portReapCtx);
}

/** 回收上一次运行遗留的进程树（实现见 `launcher-core/port-reap.mjs`）。 */
/** @param {string} [root] @returns {Promise<number[] | null>} */
export function reapStaleSession(root = ROOT) {
  return portReapReapStale(root);
}

export {
  processCommandLine,
  isAppDevServerCmdline,
} from "./launcher-core/port-reap.mjs";

/** 端口归属与残留回收（实现见 `launcher-core/port-reap.mjs`）。
 * @param {number} port @param {string} [root]
 * @param {{ explicit?: boolean }} [options] @returns {Promise<string>} */
export function reconcilePort(port, root = ROOT, options = {}) {
  return portReapReconcilePort(portReapCtx, port, root, options);
}

/** 回收层的注入上下文（与桌面壳层同源的三样状态 / 能力）。 */
const portReapCtx = {
  log,
  spawned,
  root: ROOT,
};

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
  return miscOpsOpenBrowser(miscOpsCtx, url);
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
  return downstreamSpawnDevServer(
    downstreamCtx,
    port,
    host,
    outFile,
    errFile,
    extraEnv,
  );
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
  const explicitPort = Number.parseInt(args.port ?? "", 10);
  const portOrNull =
    Number.isInteger(explicitPort) && explicitPort > 0 ? explicitPort : null;
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
  let currentPort = portOrNull;

  log(`project_root=${ROOT}`, "INFO");
  log(`平台=${process.platform}，模式=${args.mode}`, "INFO");

  // 0) 上一次的孤儿回收（必须在起新进程之前：否则新旧实例抢同一端口）
  const reaped = await reapStaleSession(ROOT);
  if (reaped)
    log(`回收上一次运行遗留的进程树：PID ${reaped.join(", ")}`, "WARN");

  // 1) 预检：环境文件（与 dev.mjs / start.mjs 同判据）+ 工具链
  const envProblem = checkEnvFile(ROOT);
  if (envProblem) {
    log("环境配置未就绪，**不会**启动服务。", "ERROR");
    log(envProblem.message, "ERROR");
    status("error", 1, "环境配置未就绪：先执行 pnpm env:init", { error: true });
    return 1;
  }
  const gateProblem = runToolchainGate(ROOT);
  if (gateProblem) {
    log(gateProblem, "ERROR");
    // 多行提示分两条写：`status` 的 message 是启动页**一行**标题位，塞整段
    // 会把「先做什么」挤没；完整提示（含修复命令）放 stale_shell 横幅，
    // 启动页是多行渲染（见 splash.html 的 renderNotice）。
    status("error", 1, gateProblem.split("\n")[0] ?? "工具链不可用", {
      error: true,
      staleShell: gateProblem,
    });
    return 1;
  }
  log("工具链门禁：pnpm 可用、node_modules 已安装", "OK");

  // 1.5) 依赖与 lockfile 对齐：拉了更新但没重装时，`node_modules` 是「在但陈旧」的，
  //      报错会落在业务模块解析失败上，与「依赖没装」这句结论长得完全不一样。
  //      判据是 lockfile 的**实质差异**（`lockfileDrift`），差异明细复用
  //      scripts/lockfile/ 的既有实现（唯一出处，质量门禁同源）。
  const syncProblem = await syncDependencies(ROOT, { status });
  if (syncProblem) {
    log(syncProblem, "ERROR");
    status("error", 1, syncProblem.split("\n")[0] ?? "依赖未对齐", {
      error: true,
      staleShell: syncProblem,
    });
    return 1;
  }
  log("依赖与 lockfile 一致（无需补装）", "OK");

  // 1.6) 待恢复的备份：**必须**排在起任何会打开数据库的东西之前（壳、Next、
  //      执行宿主、后台 schema 同步）。运行期多个进程持有同一个库，运行期覆盖
  //      `db.sqlite` 等于在别人握着句柄时换掉文件 —— 这里换是唯一安全的时刻。
  //      空转（没有标记）是绝大多数启动的形态。
  const restore = applyPendingRestoreAtBoot(ROOT, {
    write: (line) => log(line.replace(/^\[db-backup\] /, "").trimEnd(), "INFO"),
  });
  if (restore.status === "restored") {
    log(`数据库已从备份恢复（${restore.from}）`, "OK");
  } else if (restore.status === "failed") {
    log(`数据库恢复没能完成：${restore.reason}`, "WARN");
  }

  // 2) 端口（单一事实源：app-port.mjs，绝不在这里重算）
  const port = portOrNull ?? resolveAppPort(ROOT);
  currentPort = port;
  log(
    `使用端口 ${port}（.env 显式值优先，否则按检出路径推导，见 §1.1）`,
    "INFO",
  );
  status("port-check", 0.05, "正在检查端口占用…");

  // 3) 桌面壳（prebuilt 模式最先拉起：用户双击后第一件事是看见窗口）
  let shell = /** @type {import("node:child_process").ChildProcess | null} */ (
    null
  );
  let staleShell = null;
  // 自编排标记：壳拉起本编排器时注入（`shell_launch.rs` 的 `spawn_orchestrator`）。
  // 它回答「本次编排是谁拉起的」，只有壳自编排链路（§1.5）里的 prebuilt 会带。
  const launchedByShell =
    process.env.COMFYAPP_SHELL_SELF_LAUNCH === "1" && args.mode === "prebuilt";
  if (args.mode === "prebuilt") {
    const shellExe =
      args.shellExe ??
      process.env.COMFYAPP_PREBUILT_SHELL ??
      defaultShellExe(ROOT);
    if (!shellExe || !fs.existsSync(shellExe)) {
      const message =
        "找不到预编译 Tauri 壳（src-tauri/target/{release,debug}/app[.exe]）。" +
        "请先执行 cargo build --release --features custom-protocol 或 pnpm tauri build。";
      log(message, "ERROR");
      status("error", 1, message, { error: true });
      return 1;
    }
    staleShell = shellStaleWarning(shellExe, ROOT);
    if (staleShell) {
      log(staleShell, "WARN");
      appendRuntimeWarning(staleShell);
    }
    resetShellPidFile(ROOT);
    if (launchedByShell) {
      /* 双击壳的自编排链路（§1.5）里，拉起本编排器的那只壳**就是**本次启动唯一
       * 的应用宿主：启动页与主窗都是 tauri.conf.json 的声明式窗口，每个壳进程
       * 各建一份。这里若再 spawn 一只壳，同一次启动就有两个壳——用户会看到两个
       * 一模一样的启动窗口（PR #1712 的回归），两只壳的回收链还互相纠缠（关掉
       * 任意一只都会把编排器连同另一只一起收走）。所以自编排那次**只编排、
       * 不起壳**：壳已经在跑，把本地服务起起来就好。 */
      log("本次编排由桌面壳亲自拉起：壳已在运行，不再起第二个壳。", "INFO");
    } else {
      ensureSplashResource(ROOT);
      shell = spawnShell(shellExe, port, {
        root: ROOT,
        foreground: args.coldStart ? "1" : null,
      });
      log(`预编译 Tauri 壳已启动（PID ${shell.pid}）：${shellExe}`, "OK");
      log("Tauri 桌面壳已启动，正在启动本地服务…", "STEP");
    }
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
  let portSummary = await reconcilePort(port, ROOT, {
    explicit: usesExplicitPort(portOrNull),
  });
  log(`端口检查：${portSummary}`, "OK");
  status("port-ready", 0.12, "端口已就绪，处理编译缓存…", { staleShell });

  // 5) .next 缓存策略（与 .ps1 同一指纹口径）
  const cache = syncNextCache(ROOT, process.env);
  log(
    cache.cleaned
      ? `清空 .next 全量重编译（${cache.reason}）`
      : `保留 .next 缓存（${cache.reason}）`,
    cache.cleaned ? "STEP" : "OK",
  );
  const pnpm = reconcilePnpmVersion(ROOT);
  if (pnpm?.tip) {
    appendRuntimeWarning(pnpm.tip);
    staleShell = staleShell ? `${staleShell}；${pnpm.tip}` : pnpm.tip;
  }
  status("cache", 0.2, "正在启动本地服务（Next.js dev server）…", {
    staleShell,
  });

  // 6) 起 dev server（输出重定向到 log/nextjs/，按次命名后轮转保留 5 份）
  const nextDir = currentDirOf("nextjs", ROOT);
  pruneTimestampedLogs(nextDir, ["nextjs-stdout-", "nextjs-stderr-"], 5);
  const nextOut = path.join(nextDir, `nextjs-stdout-${runTimestamp}.log`);
  const nextErr = path.join(nextDir, `nextjs-stderr-${runTimestamp}.log`);
  log(`启动 Next.js dev server（${args.host}:${port}）…`, "STEP");
  // dev 用 let：就绪阶段若检测到「路由表 404」的确切信号，会清缓存重启一次
  // （见步骤 9 的有界自愈），届时重新赋值 dev 供常驻循环与回收使用。
  let dev = spawnDevServer(port, args.host, nextOut, nextErr);
  recordPid(ROOT, "nextjs", dev.pid ?? null);
  log(`dev server 已启动（PID ${dev.pid}，输出见 ${nextOut}）`, "OK");

  // 6.5) 可选：拉起 ComfyUI 执行器独立宿主（P3 §5 第 2 期 · Phase 2-C）
  // 默认 `inline` —— Next 里跑 ComfyUI 执行编排；本步 **不 spawn 任何东西**。
  // `COMFY_EXECUTOR=host` 时把 `scripts/executor-host.mjs` 作为 launcher 的
  // **又一个受管子进程** 起起来；spawnInGroup 走同一份平台判据（POSIX 自建进程组 /
  // Windows taskkill 走 `/T`），因此回收、孤儿检测、会话锚点等既有语义一字不改。
  // 3-B1 起 host 会真正领取 claimedBy='host' 的行；判据与 Next 侧
  // `resolveExecutorClaim()`（src/lib/comfyui/executor-mode.ts）读同一个 key、
  // 同一套归一化——这里额外回读 `.env` 是因为纯 Node 不注入 .env，而 Next
  // server 的 process.env 里有它（@next/env），不回读会造成「Next 写 host 片、
  // launcher 却不拉 host」的任务停摆组合。
  // 4-A4 起归一化收在 `launcher-core/executor-mode.mjs`（纯 Node 侧唯一定义，
  // host 脚本共用同一份），两侧判决是否同值由 tests/executor-mode-consistency.test.ts
  // 逐值比对（ADR §14 D5）。
  const { mode: executorMode, unknown: unknownExecutor } =
    resolveExecutorMode();
  if (executorMode === "host") {
    const hostChild = spawnExecutorHost();
    log(
      `executor-host 已启动（PID ${hostChild?.pid ?? "?"}，COMFY_EXECUTOR=host 灰度中；host 领取 claimedBy='host' 的行）`,
      "OK",
    );
  } else if (unknownExecutor) {
    log(
      `COMFY_EXECUTOR="${unknownExecutor}" 不识别，按默认 inline 处理（可选：inline|host）`,
      "WARN",
    );
  }

  // 7) 会话锚点：把 PID 与心跳落盘，让「进程被杀后仍能回收」成立
  writeSession(ROOT, {
    launcher_pid: process.pid,
    child_pids: spawned
      .map((c) => c.pid)
      .filter((pid) => typeof pid === "number"),
    app_port: port,
    mode: args.mode,
    started_at: new Date(startedAt).toISOString(),
  });
  const heartbeat = setInterval(
    () => touchHeartbeat(ROOT),
    HEARTBEAT_INTERVAL_MS,
  );
  touchHeartbeat(ROOT);
  clearIntervalGuard(heartbeat);

  // 8) DB schema 自检 + **后台同步**（§9.1）。「拉了含 schema 变更的代码后忘了
  //    跑 db:push」由这里兜住，但**不阻塞启动** —— drizzle 同步一次 15~30 秒，
  //    等它等于让用户盯着空窗。判据见 db-schema-state.mjs 的 spawnSchemaSync；
  //    不一致时它会自动同步，页面经 GET /api/schema 显示「已同步，请刷新」。
  const schema = spawnSchemaSync(ROOT);
  if (schema.started) {
    log(
      "数据库结构核对已在后台开始（不一致时自动同步，页面会提示刷新）",
      "INFO",
    );
  } else {
    log(
      `无法后台核对数据库结构：${schema.reason ?? "原因未知"}（必要时手动跑 pnpm db:push）`,
      "WARN",
    );
  }

  // 9) 等就绪（dev server 先退出则立刻定性；检测到路由表 404 则自愈一次）
  log(`等待服务就绪（http://${args.host}:${port}）…`, "STEP");
  status("dev-server-starting", 0.3, "本地服务已启动，等待就绪…", {
    staleShell,
  });
  const devExited = () => dev.exitCode !== null || dev.signalCode !== null;

  /** 只重启 dev 子进程（保住壳）：回收 dev 整棵子树 → 清 .next → 带重启原因
   *  重新拉起 → 刷新会话锚点（新 dev 的 pid 要落进去，否则进程被杀后的孤儿回收
   *  漏掉它）。这是「陈旧路由表」自愈的唯一动作，被上层限制为只跑一次。 */
  async function restartDevForStaleRoutes() {
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
    dev = spawnDevServer(port, args.host, nextOut, nextErr, {
      COMFYAPP_RESTART_REASON: "stale-route-table",
    });
    writeSession(ROOT, {
      launcher_pid: process.pid,
      child_pids: spawned
        .map((c) => c.pid)
        .filter((pid) => typeof pid === "number"),
      app_port: port,
      mode: args.mode,
      started_at: new Date(startedAt).toISOString(),
    });
  }

  // 「连上但 /api/health 持续 404」的确切签名 → 判定陈旧路由表，自愈一次。
  // 阈值给 3 次（约 3s）：单次 404 可能只是路由还在按需编译，不足以定性。
  const READY_ROUTE_404_THRESHOLD = 3;
  // 「服务已应答但库还没建」连中几次才提示（约 8s）：后台 db-sync 建表要 30 秒
  // 上下，单次 503 完全正常，过早开口等于制造噪声。
  const READY_SCHEMA_NOTICE_THRESHOLD = 8;
  let consecutive404 = 0;
  let consecutiveSchemaNotReady = 0;
  let schemaNoticeSent = false;
  let recovered = false;
  let ready = false;
  /** 最后一次探测的结论：超时出口要靠它讲清「卡在哪一档」（见 §5）。 */
  let lastProbeState = "not-up";
  let pollCount = 0;
  const readyDeadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < readyDeadline) {
    if (devExited()) break;
    const state = await classifyProbe({ port, host: args.host });
    lastProbeState = state;
    if (state === "ready") {
      ready = true;
      break;
    }
    if (state === "route-404") {
      consecutive404 += 1;
      if (consecutive404 >= READY_ROUTE_404_THRESHOLD && !recovered) {
        recovered = true;
        consecutive404 = 0;
        log(
          "检测到路由表 404（服务已应答但 /api/health 未进编译图），判定为陈旧 .next 路由表：清缓存重启 dev server 一次。",
          "WARN",
        );
        status(
          "dev-server-starting",
          0.35,
          "检测到路由表不一致，清缓存重启中…",
          { staleShell },
        );
        await restartDevForStaleRoutes();
        log(`dev server 已重启（PID ${dev.pid}）`, "OK");
      }
      consecutiveSchemaNotReady = 0;
    } else if (state === "schema-not-ready") {
      /* 服务活着、路由也在，只是库还没建。**不能就这么空等**：用户看到的将是
       * 「卡了三分钟、应用自己消失」，而真正该做的是「等一下（后台正在建）」
       * 或「跑一次 pnpm db:push」——这句话必须在他还盯着屏幕的时候说出来。 */
      consecutive404 = 0;
      consecutiveSchemaNotReady += 1;
      if (
        consecutiveSchemaNotReady >= READY_SCHEMA_NOTICE_THRESHOLD &&
        !schemaNoticeSent
      ) {
        schemaNoticeSent = true;
        log(
          "本地服务已应答，但数据库表还没建（/api/health 503，db=empty）。后台同步正在按 schema 建表（约 30 秒）；" +
            "若长时间不就绪，手动跑一次 pnpm db:push（见 docs/standards/launch-and-build.md §9.1）。",
          "WARN",
        );
      }
    } else {
      // not-up（连不上）：正常的「还没起来」，重置两个计数。
      consecutive404 = 0;
      consecutiveSchemaNotReady = 0;
    }
    const left = Math.round((readyDeadline - Date.now()) / 1000);
    const progress =
      0.3 +
      Math.min(
        0.6,
        ((READY_TIMEOUT_MS - left * 1000) / READY_TIMEOUT_MS) * 0.6,
      );
    /* 状态文件降频：就绪等待期每轮都写 launch-status.json（最多 180 次），
     * 而进度条以秒为粒度 —— 每 5 轮写一次足够顺滑；就绪 / 出错等关键状态
     * 变化仍在别处即时写。 */
    if (pollCount % 5 === 0) {
      status(
        "dev-server-starting",
        progress,
        schemaNoticeSent
          ? `数据库表还没建，正在等待自动建表（还剩 ${left}s）…`
          : `正在等待本地服务就绪（还剩 ${left}s）…`,
        { staleShell },
      );
    }
    /* 轮询退避：前 10 次每 1s（快速冷启动大多几秒内就绪），之后 2s、30 次
     * 后 3s —— 冷编译普遍 1~3 分钟，固定 1s 是 180 次探测 + 180 次状态文件
     * 写的纯浪费；就绪感知延迟只出现在冷启动后段（用户本来就在等编译）。
     * 总超时是墙钟 deadline（Date.now()），退避不会缩短它。 */
    pollCount += 1;
    await new Promise((r) =>
      setTimeout(r, pollCount < 10 ? 1000 : pollCount < 30 ? 2000 : 3000),
    );
  }

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
  if (!ready) {
    /* 诊断的取词顺序与理由见 orchestrator.readDiagnosticsTail：Next 的输出走
     * stdout，而这里过去只读 stderr（那里通常只有 pnpm 的一行脚本横幅），
     * 于是「最近输出」什么都没说；应用服务自己的转录是随写随见的那一份。 */
    const tail =
      readDiagnosticsTail({
        stderrFile: nextErr,
        stdoutFile: nextOut,
        panelDir: nextjsLogDir,
        panelSince: startedAt,
      }) || "(无输出)";
    const stateLine = describeProbeState(lastProbeState);
    if (recovered) {
      // 已自愈过一次仍持续 404：不再循环重启，把结论与现场交清楚。
      log(
        `清缓存重启一次后 /api/health 仍持续 404，路由表异常未恢复（已停止自动重启，避免循环）。最后一次探测：${stateLine}。最近输出：\n${tail}`,
        "ERROR",
      );
      status(
        "error",
        1,
        "路由表持续异常（已自动清缓存重启一次仍未恢复），见 log/nextjs/",
        { error: true, staleShell },
      );
    } else {
      log(
        `服务未在 ${READY_TIMEOUT_MS / 1000}s 内就绪。最后一次探测：${stateLine}。最近输出：\n${tail}`,
        "ERROR",
      );
      status(
        "error",
        1,
        lastProbeState === "schema-not-ready"
          ? "数据库表一直没建起来：跑一次 pnpm db:push（见 log/nextjs/）"
          : "服务未在超时内就绪，见 log/nextjs/",
        { error: true, staleShell },
      );
    }
    await shutdown(1);
  }
  log(`服务已就绪：http://${args.host}:${port}`, "OK");
  status("dev-server-ready", 0.9, "本地服务已就绪", {
    ready: true,
    staleShell,
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
    dev?.once("exit", (code) => resolve({ who: "dev", code: code ?? 0 }));
    shell?.once("exit", (code) => resolve({ who: "shell", code: code ?? 0 }));
    process.once("SIGINT", () => resolve({ who: "signal", code: 0 }));
    process.once("SIGTERM", () => resolve({ who: "signal", code: 0 }));
  });
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
    log(
      "dev server 已退出：结束原因已记进 run/app-service-exit.json（界面恢复后会读它）",
      "WARN",
    );
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
  if (process.env.COMFYAPP_LAUNCHER_NO_HEARTBEAT === "1") clearInterval(timer);
}

// 信号处理：任何中断都要先回收整棵进程树再退出（硬规则 3）。
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`收到 ${signal}：回收子进程树后退出`, "WARN");
    void shutdown(signal === "SIGINT" ? 130 : 143);
  });
}

// 直跑（被 import 时不执行）：供测试复用上面这些纯函数。
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
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
