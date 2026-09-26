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

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveAppPort } from "./app-port.mjs";
import { spawnSchemaSync, SKIP_SCHEMA_SYNC_ENV } from "./db-schema-state.mjs";
import { checkEnvFile } from "./env-preflight.mjs";
import {
  archiveRunLog,
  createLogSink,
  localTimestamp,
  runStamp,
} from "./launcher-core/log.mjs";
import {
  APP_DEV_SCRIPT_MARKER,
  APP_START_SCRIPT_MARKER,
  PORT_OWNERSHIP,
  classifyProbe,
  describeProbeState,
  fileHasMarker,
  inspectPort,
  portOwnershipVerdict,
  readDiagnosticsTail,
  readTail,
  usesExplicitPort,
  writeLaunchStatus,
} from "./launcher-core/orchestrator.mjs";
import {
  listeningPidsOnPort,
  pidBelongsToRoot,
  runCapture,
} from "./launcher-core/procs.mjs";
import {
  orchestratePnpm,
  packageManagerVersion,
  preparePnpm,
  probePnpm,
} from "./launcher-core/corepack.mjs";
import {
  commandInvocation,
  isWindows,
  pnpmInvocation,
  runSync,
  spawnInGroup,
  whichCommand,
} from "./launcher-core/shell.mjs";
import { echoCommandLine } from "./launcher-core/command-echo.mjs";
import { syncSplashAssets } from "./launcher-core/splash-assets.mjs";
import {
  checkNodeModules,
  lockfileDrift,
  pruneTimestampedLogs,
  syncNextCache,
  verifyInstall,
} from "./launcher-core/worktree.mjs";
import { renderDriftReport } from "./lockfile/render-lock-diff.mjs";
import {
  clearSession,
  isSessionOwnerAlive,
  readSession,
  touchHeartbeat,
  writeSession,
} from "./dev-launcher-session.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

/** 壳侧写下的收尾正标记（判据只认它们，见 orchestrator.fileHasMarker）。
 *
 *  「用户放弃本次启动」= 关闭启动页；壳会写 `launch abandoned` 并以 0 退出。
 *  这不是失败：用户刚刚亲手按的 ✕，再报一次红色「启动失败」是误报。 */
const ABANDONED_MARKER = "launch abandoned";
const NONZERO_EXIT_MARKER = "exiting with non-zero code";

// ── 日志：log/launcher/dev-launcher.log（当前运行，实时读）+ 历史归档 ──
const launcherLogDir = path.join(ROOT, "log", "launcher");
const nextjsLogDir = path.join(ROOT, "log", "nextjs");
fs.mkdirSync(launcherLogDir, { recursive: true });
fs.mkdirSync(nextjsLogDir, { recursive: true });
const currentLog = path.join(launcherLogDir, "dev-launcher.log");
const logSink = createLogSink(ROOT, { file: currentLog });
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

/** 工具链门禁：node 可用 + pnpm 可用 + node_modules 已装。
 *
 *  双击链路里这一步尤其重要：**在弹壳之前**拦下致命损坏，用户才能看到一句
 *  「pnpm 坏了，怎么修」，而不是先弹出黑窗口再在启动页里慢慢报错。
 *
 *  探测与「坏了怎么修」都收在 `launcher-core/corepack.mjs`（Issue #576）：
 *    · 探测不再只看退出码 —— 命令压根没起来（EACCES/ENOEXEC）与命令报错退出
 *      是两种成因，此前都塌成一句「exit=?：未知错误」，把「PATH 上选错了可执行
 *      形态」误报成「corepack 缓存损坏」（后者要用户删缓存 / 重装 Node，方向全错）；
 *    · 修复提示里的版本号取自 package.json 的 `packageManager`，不再留
 *      `<项目版本>` 这种没人会去填的占位符；
 *    · spawn-error 一类（看起来就是缓存/形态坏了）会**自动 corepack prepare 重建
 *      并复核**，只有复核仍失败才落回提示 —— 把「自己就能好」的那部分留给自己。
 *
 *  @param {string} [root] @returns {string | null} 失败原因（null = 通过） */
export function runToolchainGate(root = ROOT) {
  const pnpm = orchestratePnpm({ root });
  if (pnpm.repaired) log(`pnpm 已自动修复：${pnpm.tip}`, "OK");
  if (!pnpm.probe.ok) {
    lastPnpmTip = pnpm.tip;
    return pnpm.tip ?? "pnpm 不可用";
  }
  const modules = checkNodeModules(root);
  if (!modules.healthy) {
    return (
      `node_modules 缺失或不完整（${modules.reasons.join("；")}）。\n` +
      "修复：pnpm install（首次上手可先跑 pnpm env:init 生成 .env；" +
      "Windows 双击入口 tools/start/run-local.ps1 会把这两步一起做完）"
    );
  }
  return null;
}

/** pnpm 版本一致性：不一致时尝试 corepack 对齐；失败只提示（不阻断启动）。
 *
 *  「本机版本」与「期望版本」都走 corepack.mjs 的单一判据：版本号只从
 *  package.json 的 `packageManager` 解析，命令探测只用 `probePnpm()` ——
 *  这里不再自己 whichCommand + spawnSync 一遍（那种写法会让「探测失败」在
 *  两个地方各有一套说法，正是 Issue #576 里「同一件事两个口径」的形态）。
 *
 *  @param {string} [root] @returns {{ version: string, expected: string, tip: string | null } | null} */
export function reconcilePnpmVersion(root = ROOT) {
  const expected = packageManagerVersion(root);
  if (!expected) return null;
  const probe = probePnpm({ root });
  if (!probe.ok) return null; // 门禁已就「不可用」给过提示，这里不再叠一句
  const actual = probe.version ?? "";
  if (actual.replace(/^v/, "") === expected.replace(/^v/, "")) {
    log(`pnpm 版本匹配：${actual}（packageManager: pnpm@${expected}）`, "OK");
    return { version: actual, expected, tip: null };
  }
  log(`pnpm 版本不匹配：本机 ${actual}，package.json 要求 ${expected}`, "WARN");
  // 对齐动作就是「按 packageManager 重建」——与门禁里的自动修复同一个实现。
  const prepare = preparePnpm({ root, expected });
  const after = probePnpm({ root });
  const now = after.version ?? "";
  if (after.ok && now.replace(/^v/, "") === expected.replace(/^v/, "")) {
    log(`corepack 已自动切换 pnpm 至 ${now}`, "OK");
    return { version: now, expected, tip: null };
  }
  log(
    `corepack 对齐未生效（${prepare.description}，当前 ${now || "未知"}）`,
    "WARN",
  );
  return {
    version: actual,
    expected,
    tip:
      `pnpm 版本不匹配（本机 ${actual}，项目要求 ${expected}）；` +
      `请执行 corepack enable && corepack prepare pnpm@${expected} --activate 后重启应用`,
  };
}

/** 旧版桌面壳提醒（判据与 .ps1 的 Test-ShellFreshness 同源：比时间戳）。 */
/** @param {string} shellExe @param {string} [root] @returns {string | null} */
export function shellStaleWarning(shellExe, root = ROOT) {
  let exeTime = 0;
  try {
    exeTime = fs.statSync(shellExe).mtimeMs;
  } catch {
    return null;
  }
  const targets = [
    path.join(root, "src-tauri", "tauri.conf.json"),
    path.join(root, "src-tauri", "build.rs"),
    path.join(root, "src-tauri", "src"),
    path.join(root, "src-tauri", "splash-assets"),
  ];
  let newest = 0;
  for (const target of targets) {
    let stat = null;
    try {
      stat = fs.statSync(target);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      for (const file of walkFiles(target)) {
        try {
          newest = Math.max(newest, fs.statSync(file).mtimeMs);
        } catch {
          /* 忽略读不到的条目 */
        }
      }
    } else {
      newest = Math.max(newest, stat.mtimeMs);
    }
  }
  if (newest <= exeTime) return null;
  return (
    `正在运行旧版桌面壳（编译于 ${localTimestamp(new Date(exeTime)).slice(5, 16)}，源码此后有改动），` +
    "界面可能不是最新逻辑；建议重编：cd src-tauri && cargo build --release --features custom-protocol"
  );
}

/** 递归列出目录下的文件（用于壳时效判据）。 */
/** @param {string} dir @returns {string[]} */
function walkFiles(dir) {
  /** @type {string[]} */
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

/** 把壳/pnpm 提醒补录进应用日志面板可见的 app-runtime 通道。
 *  （此刻 dev server 尚未启动，无法走写入端点，按面板可解析的行格式直接追加。） */
/** @param {string} message @param {string} [root] */
function appendRuntimeWarning(message, root = ROOT) {
  try {
    const dir = path.join(root, "log", "services");
    fs.mkdirSync(dir, { recursive: true });
    const ts = localTimestamp();
    fs.appendFileSync(
      path.join(dir, "app-runtime.log"),
      `[${ts}] [WARN] [launcher] ${message}\n`,
      "utf8",
    );
  } catch {
    /* 提醒落不进面板不影响启动 */
  }
}

// ── 端口 / 回收 ────────────────────────────────────────────────────────────

/** 端口占用扫描范围：本端口与 +1/+2（Next 在端口被占时会静默顺延，导致
 *  「服务起来了但连着旧实例」——§1.1 的端口契约因此必须连同邻位一起看）。 */
/** @param {number} port @returns {number[]} */
export function scanPorts(port) {
  return [port, port + 1, port + 2];
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
  const specifier = "../src/lib/process/kill-process-tree.ts";
  const mod = await import(specifier);
  return mod.killProcessTree(options);
}

/** 收尾：回收本次会话拉起的**整棵进程树**，并清理会话锚点。 */
export async function reapAll() {
  for (const child of spawned) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    try {
      if (child.pid) {
        const via = await reapProcessTree({
          pid: child.pid,
          detached: !isWindows(),
          force: true,
        });
        log(`回收子进程树 PID ${child.pid}：${via.via}`, "STEP");
      }
    } catch (error) {
      log(
        `回收子进程树失败：${error instanceof Error ? error.message : String(error)}`,
        "WARN",
      );
    }
  }
  clearSession(ROOT);
}

/** 回收上一次运行遗留的进程树（崩溃 / 被 SIGKILL 时留下的孤儿）。
 *  判据是**心跳 + PID**两条（见 dev-launcher-session）：只判 PID 会被 PID 复用
 *  骗过，只判心跳会把卡死的实例当成死的。
 *  @param {string} [root] @returns {Promise<number[] | null>} 被回收的 PID */
export async function reapStaleSession(root = ROOT) {
  if (isSessionOwnerAlive(root)) return null;
  const session = readSession(root);
  if (!session) return null;
  const pids = Array.isArray(session.child_pids) ? session.child_pids : [];
  if (pids.length === 0) {
    clearSession(root);
    return null;
  }
  for (const pid of pids) {
    await reapProcessTree({ pid, detached: !isWindows(), force: true });
  }
  clearSession(root);
  return pids;
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
 *  @param {string} cmdline @param {string} root @returns {boolean} */
export function isAppDevServerCmdline(cmdline, root = ROOT) {
  /** @param {string} value */
  const norm = (value) => value.replace(/\\/g, "/").toLowerCase();
  const text = norm(cmdline);
  const base = norm(root).replace(/\/+$/, "");
  if (!text || !base || !text.includes(base)) return false;
  if (text.includes(`${base}/scripts/${APP_DEV_SCRIPT_MARKER}`)) return true;
  if (text.includes(`${base}/scripts/${APP_START_SCRIPT_MARKER}`)) return true;
  if (/next(\.cmd|\.ps1)?\s+(dev|start)\b/.test(text)) return true;
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
 *  @param {number} port @param {string} [root]
 *  @param {{ explicit?: boolean }} [options] explicit = 端口由调用方显式指定
 *  @returns {Promise<string>} 结论摘要 */
export async function reconcilePort(
  port,
  root = ROOT,
  { explicit = false } = {},
) {
  const summary = [];
  for (const p of scanPorts(port)) {
    // 自证只对「本次真正要用的那个端口」成立：扫描范围内的 +1/+2 是「Next 会不会
    // 顺延」的探测位，本次并不打算用它们，谈不上回收。
    const verdict = await inspectPort(p, {
      listenPids: listeningPidsOnPort,
      belongsToRoot: pidBelongsToRoot,
      root,
    });
    const decision = await portOwnershipVerdict({
      requestedPort: explicit && p === port ? port : null,
      verdict,
      cmdlineOf: processCommandLine,
      isAppProcess: (_pid, cmdline) => isAppDevServerCmdline(cmdline, root),
    });
    if (decision.ownership === PORT_OWNERSHIP.free) {
      summary.push(`${p} 空闲`);
      continue;
    }
    if (decision.ownership === PORT_OWNERSHIP.own) {
      // 自证路径要交代清楚「为什么敢动它」：这条路径上 `pidBelongsToRoot` 是
      // 否定的（否则走的是旧分支），只凭「显式端口 + 应用服务自证」回收。
      log(
        `端口 ${p} 被本检出上一次启动的进程占用（PID ${decision.ownPids.join(", ")}），正在回收…`,
        "WARN",
      );
      for (const pid of decision.ownPids) {
        const via = await reapProcessTree({
          pid,
          detached: !isWindows(),
          force: true,
        });
        log(`  回收 PID ${pid}：${via.via}`, "INFO");
      }
      summary.push(`${p} 已回收自己的残留`);
      continue;
    }
    summary.push(
      `${p} 被其它进程占用（PID ${decision.foreignPids.join(", ")}）`,
    );
    log(
      `端口 ${p} 被非本检出的进程占用（PID ${decision.foreignPids.join(", ")}）——多检出并行保护，不清理。` +
        `若与本检出冲突，请改 .env 的 COMFYAPP_PORT。`,
      "WARN",
    );
  }
  return summary.join("；");
}

// ── 桌面壳 ──────────────────────────────────────────────────────────────────

/** 解析预编译壳的可执行文件（Windows `app.exe`、POSIX 无后缀）。 */
/** @param {string} [root] @returns {string | null} */
export function defaultShellExe(root = ROOT) {
  const candidates = isWindows()
    ? ["src-tauri/target/release/app.exe", "src-tauri/target/debug/app.exe"]
    : ["src-tauri/target/release/app", "src-tauri/target/debug/app"];
  for (const rel of candidates) {
    const full = path.join(root, rel);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

/**
 * 确保 Tauri 启动页资源就位（frontendDist 编译期嵌入，运行时同步保证下次编对）。
 *
 * 副本清单（`splash.html` + `index.html`）与同步动作在
 * `launcher-core/splash-assets.mjs` 一处定义，这里只接线与记日志 ——
 * **不要在本文件里再写一份副本名清单**：此前正是这里手写了一份、只同步了
 * `splash.html`，`index.html` 于是长期停在旧版（症状与根因见该模块的文件头注释）。
 *
 * @param {string} [root]
 */
export function ensureSplashResource(root = ROOT) {
  const result = syncSplashAssets(root);
  if (result.status === "missing-source") {
    log("未找到 public/splash.html，Tauri 启动页可能无法显示", "WARN");
    return result;
  }
  if (result.status === "error") {
    log(`同步启动页失败：${result.message}`, "WARN");
    return result;
  }
  if (result.status === "ok") {
    log(
      `已同步启动页 → src-tauri/splash-assets/（${result.written.join(" + ")}，frontendDist，编译期嵌入）`,
      "INFO",
    );
  }
  return result;
}

/** 拉起预编译壳，并把 PID 落盘（启动器先退出时的兜底回收锚点）。 */
/**
 * 预编译壳的拉起参数。
 * @param {string} shellExe 壳可执行文件路径
 * @param {number} port 应用端口
 * @param {{ root?: string, foreground?: string | null }} options 检出根与前台开关
 */
export function spawnShell(
  shellExe,
  port,
  { root = ROOT, foreground = null } = {},
) {
  const child = spawnInGroup({
    command: shellExe,
    args: [],
    cwd: root,
    env: {
      ...process.env,
      COMFYAPP_PROJECT_ROOT: root,
      COMFYAPP_DEV_URL: `http://127.0.0.1:${port}/workspace`,
      COMFYAPP_PORT: String(port),
      COMFYAPP_FOREGROUND: foreground ?? process.env.COMFYAPP_FOREGROUND ?? "0",
    },
  });
  spawned.push(child);
  try {
    fs.writeFileSync(
      path.join(launcherLogDir, "tauri-shell.pid"),
      String(child.pid ?? ""),
      "ascii",
    );
  } catch {
    /* 兜底锚点写不进去不影响本次启动 */
  }
  return child;
}

/** 清掉上一轮留下的壳 PID 文件（在拉起之前调用）。
 *
 *  文件是「上一次 run 的残留」，而本编排器是被启动器另起的进程 —— 在写到新 PID
 *  之前，文件里还是旧 PID。系统会复用 PID，旧号很可能已归某个无关进程，兜底
 *  回收路径读到它就会去杀不相干的东西。先删 = 窗口期内读不到，语义安全。 */
export function resetShellPidFile(root = ROOT) {
  try {
    fs.rmSync(path.join(root, "log", "launcher", "tauri-shell.pid"), {
      force: true,
    });
  } catch {
    /* 忽略 */
  }
}

/** 回收本次拉起的壳（整棵进程树）；PID 取不到/不是数字/已退出都直接返回。 */
/** @param {string} [root] @returns {Promise<boolean>} */
export async function killShellFromPidFile(root = ROOT) {
  const file = path.join(root, "log", "launcher", "tauri-shell.pid");
  let pid = Number.NaN;
  try {
    pid = Number.parseInt(fs.readFileSync(file, "utf8").trim(), 10);
  } catch {
    return false;
  } finally {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* 忽略 */
    }
  }
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const via = await reapProcessTree({
    pid,
    detached: !isWindows(),
    force: true,
  });
  log(`兜底回收桌面壳（PID ${pid}）：${via.via}`, "STEP");
  return true;
}

// ── 收尾定性 ────────────────────────────────────────────────────────────────

/** dev server 先退出时的成因分类（判据 = 壳侧写下的**正标记** + 壳是否已退）。
 *
 *  为什么不拿退出码定性：「壳也退出了」是共同现象，用户放弃 / 壳崩溃 / 被任务
 *  管理器结束都会命中它；由现象反推成因会把真故障说成设计内行为（历史事故）。
 *  @param {{ shellExited: boolean, abandoned: boolean, shellCrashed: boolean }} input
 *  @returns {"dev-server" | "abandoned" | "shell-self-exited" | "shell-terminated"} */
export function downstreamExitKind({ shellExited, abandoned, shellCrashed }) {
  if (!shellExited) return "dev-server";
  if (abandoned) return "abandoned";
  if (shellCrashed) return "shell-self-exited";
  return "shell-terminated";
}

/** 取壳侧 stderr 的两个正标记（大小写不敏感）。 */
/** @param {string} [root] @returns {{ abandoned: boolean, crashed: boolean, file: string }} */
export function readShellMarkers(root = ROOT) {
  const file = path.join(root, "log", "launcher", "dev-launcher-stderr.log");
  return {
    abandoned: fileHasMarker(file, ABANDONED_MARKER),
    crashed: fileHasMarker(file, NONZERO_EXIT_MARKER),
    file,
  };
}

/** 把 dev server 提前退出翻译成可行动的报错（抛出的消息即用户可见的失败出口）。 */
/**
 * @param {string} kind
 * @param {{ devCode: number | null, shellCode: number | null, shellPid?: number | undefined,
 *           stderrFile: string, stdoutFile: string }} ctx
 * @returns {string}
 */
export function describeDownstreamExit(kind, ctx) {
  const errTail = readTail(ctx.stderrFile, 20) || "(无输出)";
  const outTail = readTail(ctx.stdoutFile, 20) || "(无输出)";
  const tail = `最近 stderr：\n${errTail}\n最近 stdout：\n${outTail}\n（完整输出见 ${ctx.stdoutFile} 与 ${ctx.stderrFile}）`;
  if (kind === "abandoned") {
    return "检测到启动页被关闭（壳日志含 launch abandoned 标记）：用户放弃本次启动，按正常收尾处理";
  }
  if (kind === "shell-self-exited") {
    return (
      `本地服务随桌面壳一起退出（壳自身以非零码结束，exit=${ctx.shellCode ?? "?"}）。` +
      "壳侧判据：log/launcher/dev-launcher-stderr.log 里的 `exiting with non-zero code`；" +
      "若附近还有 `another instance of this checkout is running`，说明这次启动只是把已在运行的窗口唤到前台" +
      "——本次双击没有启动新进程，属于设计内行为。\n" +
      tail
    );
  }
  if (kind === "shell-terminated") {
    return (
      `本地服务随桌面壳一起退出（exit=${ctx.shellCode ?? "?"}），且 log/launcher/dev-launcher-stderr.log 里` +
      "**没有**壳写下的任何收尾标记——说明壳是被强行收走的（另一次启动把它顶掉 / 任务管理器结束了任务 / 壳崩溃）。" +
      "这次双击等于**从未启动**：请只双击一次启动入口并等启动页自己切到主界面。" +
      "另请对照 log/shell/shell.log 与 dev-launcher-stderr.log。\n" +
      tail
    );
  }
  return (
    `Next.js dev server 提前退出（exit=${ctx.devCode ?? "?"}）。` +
    "壳仍在运行，属 dev server 自身退出（编译失败 / 端口被占 / pnpm 异常）。\n" +
    tail
  );
}

/** 打开浏览器：三平台各有入口，失败只提示不阻断（§9.2 第 3 条）。 */
/** @param {string} url */
export function openBrowser(url) {
  const command = isWindows()
    ? "cmd"
    : process.platform === "darwin"
      ? "open"
      : "xdg-open";
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
  child.on("error", () => log(`未能自动打开浏览器，请手动访问 ${url}`, "WARN"));
  child.unref();
  log(`已尝试打开浏览器：${url}`, "INFO");
}

/** 优雅中断（Ctrl-C / SIGTERM / SIGHUP）：回收整棵进程树后退出。 */
/** @param {number} code */
export async function shutdown(code) {
  log("正在回收整棵进程树…", "STEP");
  await reapAll();
  try {
    archiveRunLog(ROOT, currentLog);
  } catch {
    /* 归档失败不影响退出 */
  }
  process.exit(code);
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

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
    if (a === "--mode") args.mode = argv[++i] ?? args.mode;
    else if (a.startsWith("--mode=")) args.mode = a.slice("--mode=".length);
    else if (a === "--tauri") args.mode = "tauri";
    else if (a === "--prebuilt" || a === "-Prebuilt") args.mode = "prebuilt";
    else if (a === "--no-open") args.open = false;
    else if (a === "--cold-start" || a === "-ColdStart") args.coldStart = true;
    else if (a === "--host") args.host = argv[++i] ?? args.host;
    else if (a === "-p" || a === "--port") args.port = argv[++i] ?? null;
    else if (a === "--shell-exe") args.shellExe = argv[++i] ?? null;
  }
  return args;
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
    ensureSplashResource(ROOT);
    shell = spawnShell(shellExe, port, {
      root: ROOT,
      foreground: args.coldStart ? "1" : null,
    });
    log(`预编译 Tauri 壳已启动（PID ${shell.pid}）：${shellExe}`, "OK");
    log("Tauri 桌面壳已启动，正在启动本地服务…", "STEP");
    status("port-check", 0.05, "桌面壳已启动，正在检查端口占用…", {
      staleShell,
    });
  }

  // 4) 端口归属：只回收自己的残留（§1.4）。`explicit` 由 `portOrNull` 决定——
  // 编排器一律显式把端口传给 dev server（Next 不认 COMFYAPP_PORT），因此显式
  // 口上的本仓库应用服务只可能是残留；缺省解析链上则一律不碰（见 reconcilePort）。
  const portSummary = await reconcilePort(port, ROOT, {
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
  const nextDir = path.join(ROOT, "log", "nextjs");
  pruneTimestampedLogs(nextDir, ["nextjs-stdout-", "nextjs-stderr-"], 5);
  const nextOut = path.join(nextDir, `nextjs-stdout-${runTimestamp}.log`);
  const nextErr = path.join(nextDir, `nextjs-stderr-${runTimestamp}.log`);
  log(`启动 Next.js dev server（${args.host}:${port}）…`, "STEP");
  // dev 用 let：就绪阶段若检测到「路由表 404」的确切信号，会清缓存重启一次
  // （见步骤 9 的有界自愈），届时重新赋值 dev 供常驻循环与回收使用。
  let dev = spawnDevServer(port, args.host, nextOut, nextErr);
  log(`dev server 已启动（PID ${dev.pid}，输出见 ${nextOut}）`, "OK");

  // 6.5) 可选：拉起 ComfyUI 执行器独立宿主（P3 §5 第 2 期 · Phase 2-C）
  // 默认 `inline` —— Next 里跑 ComfyUI 执行编排；本步 **不 spawn 任何东西**。
  // `COMFY_EXECUTOR=host` 时把 `scripts/executor-host.mjs` 作为 launcher 的
  // **又一个受管子进程** 起起来；spawnInGroup 走同一份平台判据（POSIX 自建进程组 /
  // Windows taskkill 走 `/T`），因此回收、孤儿检测、会话锚点等既有语义一字不改。
  // Phase 2-B 骨架阶段**不接管 Next 的 inline 路径**（Next 侧仍按 inline 走），
  // 这一开关只是让 host 能作为独立进程活着 + 被 launcher 收；taskRepository
  // 注入与流量切换在 Phase 2-A / Phase 3 分别落地。
  const executorMode = (process.env.COMFY_EXECUTOR ?? "inline").toLowerCase();
  if (executorMode === "host") {
    const hostChild = spawnExecutorHost();
    log(
      `executor-host 已启动（PID ${hostChild?.pid ?? "?"}，COMFY_EXECUTOR=host 灰度中；inline 路径暂未停用）`,
      "OK",
    );
  } else if (executorMode !== "inline") {
    log(
      `COMFY_EXECUTOR="${executorMode}" 不识别，按默认 inline 处理（可选：inline|host）`,
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
    status(
      "dev-server-starting",
      progress,
      schemaNoticeSent
        ? `数据库表还没建，正在等待自动建表（还剩 ${left}s）…`
        : `正在等待本地服务就绪（还剩 ${left}s）…`,
      { staleShell },
    );
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (devExited()) {
    return await concludeDownstreamExit({
      dev,
      shell,
      heartbeat,
      staleShell,
      // 本次运行**自己起的**日志文件，不按名字重找（见函数注释）。
      stdoutFile: nextOut,
      stderrFile: nextErr,
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

  // 11) 常驻：任一子进程退出即收尾（与 .ps1 的「等任一退出」同语义）
  const exitCode = await new Promise((resolve) => {
    for (const child of [dev, shell]) {
      child?.once("exit", (code) => resolve(code ?? 0));
    }
    process.once("SIGINT", () => resolve(0));
    process.once("SIGTERM", () => resolve(0));
  });
  clearInterval(heartbeat);
  if (args.mode === "prebuilt") {
    log("桌面壳或 dev server 已退出，正在回收整棵进程树…", "STEP");
  } else {
    log("检到子进程退出，正在回收整棵进程树…", "STEP");
  }
  await shutdown(exitCode);
  return exitCode;
}

// ── 依赖与 lockfile 对齐（启动前的补装）─────────────────────────────────────
//
// 「装了」与「装的是不是当前 lockfile」是两件事：拉了更新（新依赖进 lockfile）后
// 没重装时，`.modules.yaml` 与 `.bin/next` 都在 → 被当成「已就绪」跳过安装，而
// 真正的新依赖缺席 —— 用户看到的是一堆「Cannot find module」，而日志里没有任何
// 「依赖没装」的线索（重新双击入口还会显示「依赖已就绪」）。
//
// 补装用 `pnpm install`（不是 `--frozen-lockfile`：漂移的正是「lockfile 比
// node_modules 新」，冻结只会立刻失败）。**安装结果看复核，不看退出码**
// （§9.2 第 4 条：`drizzle-kit push` 那条「报错 + exit 0 + 留空库」是同一族的坑）：
// 复核走 `verifyInstall()`（`.modules.yaml` + 关键依赖目录 + lockfile 一致），
// 判据是「目标状态有没有达成」，不是进程怎么退的。

/** 补装依赖（仅当 lockfile 漂移时）；返回 null = 无需补装或补装成功。
 *
 *  @param {string} root
 *  @param {{ status?: ((phase: string, progress: number, message: string, extra?: object) => void) | null,
 *            staleShell?: string | null }} [deps]
 *  @returns {Promise<string | null>} 失败原因（null = 通过）
 */
export async function syncDependencies(root, deps = {}) {
  const status = deps.status ?? null;
  const staleShell = deps.staleShell ?? null;
  const drift = lockfileDrift(root);
  if (drift.state === "fresh") return null;
  if (drift.state === "no-lockfile") {
    return "找不到仓库 pnpm-lock.yaml —— 检出可能不完整，请重新克隆后再试。";
  }
  const firstInstall = drift.state === "no-install";
  log(
    firstInstall
      ? "node_modules 尚未完整安装，正在执行 pnpm install（首次较久，请勿关闭窗口）…"
      : "检测到依赖与 lockfile 不一致（拉了更新后未重装），正在补装依赖…",
    "WARN",
  );
  if (drift.diff) {
    // 「不一致」只说了一半，用户接着要问的正是「哪儿不一致」（ISSUE #550）。
    log(
      "依赖与 lockfile 的不一致明细（仓库 lockfile 对比最近一次安装用的那份）：",
      "INFO",
    );
    for (const line of renderDriftReport(drift.diff, { maxPerSection: 8 }))
      log(line, "INFO");
  }
  status?.("deps-install", 0.03, "正在补装依赖（pnpm install）…", {
    staleShell,
  });

  const invocation = pnpmInvocation(["install"]);
  if (!invocation) {
    return "pnpm 不在 PATH 上，无法补装依赖（先执行 corepack enable）。";
  }
  const result = runSync(invocation.command, invocation.args, {
    cwd: root,
    timeoutMs: 30 * 60_000,
  });
  const tail = (result.stdout + result.stderr)
    .trim()
    .split("\n")
    .slice(-15)
    .join("\n");
  if (tail)
    log(`pnpm install 输出尾部：\n${tail}`, result.ok ? "INFO" : "ERROR");

  const verdict = verifyInstall(root);
  if (!verdict.ok) {
    return (
      `依赖补装后仍未就绪：${verdict.reason}\n` +
      "本次安装的输出可在上方日志里查看；修复后重新启动即可（不要只重试不改动）。"
    );
  }
  log("依赖补装完成并已复核（.modules.yaml + 关键依赖 + lockfile 一致）", "OK");
  return null;
}

/** 起 dev server：`pnpm dev -p <port> -H <host>`（端口由 app-port.mjs 解析后显式传入，
 *  不靠环境变量兜底 —— 裸 `next dev` 会落 Next 默认 3000，与 .env / 壳 / e2e 对不上）。 */
/**
 * 起子进程并把它接到日志文件。
 * @param {number} port 应用端口
 * @param {string} host 绑定主机
 * @param {string} outFile stdout 落盘路径
 * @param {string} errFile stderr 落盘路径
 */
export function spawnDevServer(port, host, outFile, errFile, extraEnv = {}) {
  // 起服务用的是**门禁验过的那个命令形态**（`commandInvocation`）：
  // `pnpm` 在 Windows 上常常只有 shebang shim 而 shim 起不来，此时真正能用的是
  // 同目录的 `pnpm.ps1`（经 PowerShell 宿主）。门禁选出来的形态必须在起服务这一
  // 步复用同一个实现，否则「探测过了、起服务却用另一种方式又失败一次」。
  // 判据只在 shell.mjs 一处（规范 §9.5），这里不自己拼可执行名。
  const candidate = whichCommand("pnpm");
  if (!candidate) throw new Error("pnpm 不在 PATH 上，无法启动 dev server");
  const invocation = commandInvocation(candidate, ["-v"]);
  const child = spawnInGroup({
    command: invocation.command,
    args: [...invocation.prefixArgs, "dev", "-p", String(port), "-H", host],
    cwd: ROOT,
    env: {
      ...process.env,
      COMFYAPP_PORT: String(port),
      PORT: String(port),
      /* 编排器已起过一份 schema 同步（本文件 950 行附近），通知 dev.mjs
       * 跳过它自己的那份 —— 否则一次启动两份 drizzle 并发写同一个库。 */
      [SKIP_SCHEMA_SYNC_ENV]: "1",
      ...extraEnv,
    },
    stdoutFile: outFile,
    stderrFile: errFile,
  });
  spawned.push(child);
  return child;
}

/** 拉起 `scripts/executor-host.mjs`（P3 §5 第 2 期 · Phase 2-C）。
 *
 *  为什么**不**走 pnpm：这不是一个「用户命令」，也没有 workspace 脚本要跑；
 *  它就是 launcher 拉一个 `.mjs` 起来。直接 `process.execPath` 起当前 Node 二进
 *  制 + 脚本路径，少一层 corepack/pnpm shim 的探测与启动开销；也避开 Windows 上
 *  pnpm.cmd shim 的 `.ps1` 分叉（AGENTS 硬规则 12）。
 *
 *  为什么 stdio=inherit：Phase 2-B 骨架里 host 只走 appendFileSync 落
 *  `log/services/executor-host.log`（可通过 COMFYAPP_HOST_LOG 覆盖），stdout/stderr
 *  都是空的；等 Phase 3 主循环真跑起来再补 stdoutFile/stderrFile 按次命名 + 轮转。
 *
 *  为什么不发 COMFYAPP_PORT：host 起 ComfyUI 用的是自己的 lifecycle，与 Next 端
 *  口不共享；Phase 2-C 骨架不 spawn ComfyUI，也就用不上端口。 */
export function spawnExecutorHost() {
  const hostScript = path.join(ROOT, "scripts", "executor-host.mjs");
  if (!fs.existsSync(hostScript)) {
    log(
      `未找到 ${path.relative(ROOT, hostScript)}，跳过 executor-host 拉起（COMFY_EXECUTOR=host 需先合入 Phase 2-B）`,
      "WARN",
    );
    return null;
  }
  const child = spawnInGroup({
    command: process.execPath,
    args: [hostScript],
    cwd: ROOT,
    env: {
      ...process.env,
      // 编排器把 boot id 传下去，让 host 日志与 launcher 日志能按同一时间戳串起来。
      COMFYAPP_HOST_BOOT_ID: runTimestamp,
    },
  });
  spawned.push(child);
  return child;
}
/**
 * `stdoutFile` / `stderrFile` 必须是**本次运行**起 dev server 时用的那两份
 * （`nextOut` / `nextErr`）—— 曾经这里是按文件名重找「最近一份」（`lastNextLog`），
 * 而它按**字典序**取最新：`nextjs-stdout-<ISO-T>` 与历史遗留的
 * `nextjs-stdout-<下划线>` 命名混在一个目录里时，`_`（0x5F）排在 `T`（0x54）之后，
 * 于是「最新」永远落到旧命名的**上一次运行**的日志上 —— 用户照着报错里的路径去看，
 * 看到的是别的失败现场，「日志里什么都查不出来」正是这么来的（ISSUE #576）。
 * 本次的路径本来就是已知量，没有任何理由再按名字猜一次。
 *
 * @param {{ dev: import("node:child_process").ChildProcess,
 *           shell: import("node:child_process").ChildProcess | null,
 *           heartbeat: NodeJS.Timeout, staleShell: string | null,
 *           stdoutFile: string, stderrFile: string }} ctx
 * @returns {Promise<number>}
 */
async function concludeDownstreamExit({
  dev,
  shell,
  heartbeat,
  staleShell,
  stdoutFile,
  stderrFile,
}) {
  clearInterval(heartbeat);
  const markers = readShellMarkers(ROOT);
  const shellExited = shell
    ? shell.exitCode !== null || shell.signalCode !== null
    : false;
  const kind = downstreamExitKind({
    shellExited,
    abandoned: markers.abandoned,
    shellCrashed: markers.crashed,
  });
  const detail = describeDownstreamExit(kind, {
    devCode: dev.exitCode,
    shellCode: shell?.exitCode ?? null,
    shellPid: shell?.pid,
    stderrFile,
    stdoutFile,
  });
  if (kind === "abandoned") {
    log(detail, "INFO");
    log(
      "（提示：要启动桌面应用请重新双击启动入口，启动页出现后请等它自动切换到主界面）",
      "INFO",
    );
    await shutdown(0);
    return 0;
  }
  log(detail, "ERROR");
  writeLaunchStatus(ROOT, {
    phase: "error",
    progress: 1,
    message: "启动失败，见 log/",
    error: true,
    staleShell,
  });
  await shutdown(1);
  return 1;
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
