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
//     （双击 .ps1 / 启动器 exe）。前者收在 src/lib/kill-process-tree.ts，
//     后者收在平台判据模块（scripts/launcher-core/*），本文件不再摸平台。
//
// 职责（与 .ps1 版逐项对齐，两侧同契约同产物）：
//   预检（.env / 工具链 / node_modules / pnpm 版本）→ 端口（app-port.mjs 单一
//   事实源）→ .next 缓存指纹 → 拉起 dev server（自建进程组）→ 可选拉起桌面壳
//   → 等就绪 → 进度快照 run/launch-status.json → 任一子进程退出即整树回收。
//
// 用法：
//   node scripts/dev-launcher.mjs [--mode web|tauri|prebuilt] [--no-open]
//   node scripts/dev-launcher.mjs --shell-exe <app.exe>   # 由启动器指定的壳
//   直跑等价于 web 模式（前台：Ctrl-C 收尾并回收整棵进程树）。
//
// 环境变量开关（与 .ps1 版同名同义）：SKIP_CLEAN / FORCE_CLEAN / NO_OPEN /
// COMFYAPP_FOREGROUND / COMFYAPP_PREBUILT_SHELL。

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveAppPort } from "./app-port.mjs";
import { probeSchemaSync } from "./db-schema-state.mjs";
import { checkEnvFile } from "./env-preflight.mjs";
import { archiveRunLog, createLogSink, runStamp } from "./launcher-core/log.mjs";
import {
  PORT_OWNERSHIP,
  fileHasMarker,
  inspectPort,
  readTail,
  waitForReady,
  writeLaunchStatus,
} from "./launcher-core/orchestrator.mjs";
import { listeningPidsOnPort, pidBelongsToRoot } from "./launcher-core/procs.mjs";
import { isWindows, spawnInGroup, whichCommand } from "./launcher-core/shell.mjs";
import {
  checkNodeModules,
  pruneTimestampedLogs,
  syncNextCache,
} from "./launcher-core/worktree.mjs";
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
export { configFingerprint, syncNextCache, checkNodeModules } from "./launcher-core/worktree.mjs";
export { waitForReady, readTail, fileHasMarker, writeLaunchStatus } from "./launcher-core/orchestrator.mjs";
export { listeningPidsOnPort, pidBelongsToRoot, processCwd } from "./launcher-core/procs.mjs";

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

// ── 预检 ────────────────────────────────────────────────────────────────────

/** 工具链门禁：node 可用 + pnpm 可用 + node_modules 已装。
 *
 *  双击链路里这一步尤其重要：**在弹壳之前**拦下致命损坏，用户才能看到一句
 *  「pnpm 坏了，怎么修」，而不是先弹出黑窗口再在启动页里慢慢报错。
 *  @param {string} [root] @returns {string | null} 失败原因（null = 通过） */
export function runToolchainGate(root = ROOT) {
  const pnpm = whichCommand("pnpm");
  if (!pnpm) {
    return "未找到 pnpm 命令（需 corepack enable）。\n修复：corepack enable && corepack prepare pnpm@<项目版本> --activate，再重启应用。";
  }
  const probe = spawnSync(pnpm, ["-v"], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
  });
  const output = `${probe.stdout ?? ""}${probe.stderr ?? ""}`;
  if (probe.status !== 0 || !/\d+\.\d+/.test(output)) {
    const detail = output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(" ");
    return (
      `pnpm 工具链不可用（exit=${probe.status ?? "?"}）：${detail || "未知错误"}\n` +
      "疑似 corepack 切换版本时本地缓存损坏。\n修复：corepack enable && corepack prepare pnpm@<项目版本> --activate，再重启应用。"
    );
  }
  const modules = checkNodeModules(root);
  if (!modules.healthy) {
    return (
      `node_modules 缺失或不完整（${modules.reasons.join("；")}）。\n` +
      "修复：pnpm install（或先跑 tools/start/run-local.ps1 完成本地初始化）"
    );
  }
  return null;
}

/** pnpm 版本一致性：不一致时尝试 corepack 对齐；失败只提示（不阻断启动）。 */
/**
 * @param {string} [root] @returns {{ version: string, expected: string, tip: string | null } | null}
 */
export function reconcilePnpmVersion(root = ROOT) {
  let expected = "";
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const match = /^pnpm@(\S+)$/.exec(String(pkg.packageManager ?? ""));
    if (match) expected = match[1] ?? "";
  } catch {
    return null;
  }
  if (!expected) return null;
  const pnpm = whichCommand("pnpm");
  if (!pnpm) return null;
  const probe = spawnSync(pnpm, ["-v"], { cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true });
  const actual = String(probe.stdout ?? "").trim().split("\n")[0]?.trim() || "";
  if (!actual) return null;
  if (actual.replace(/^v/, "") === expected.replace(/^v/, "")) {
    log(`pnpm 版本匹配：${actual}（packageManager: pnpm@${expected}）`, "OK");
    return { version: actual, expected, tip: null };
  }
  log(`pnpm 版本不匹配：本机 ${actual}，package.json 要求 ${expected}`, "WARN");
  const corepack = whichCommand("corepack");
  if (corepack) {
    log("检测到 corepack，尝试自动切换到要求的 pnpm 版本…", "STEP");
    const prepare = spawnSync(corepack, ["prepare", `pnpm@${expected}`, "--activate"], {
      cwd: root,
      encoding: "utf8",
      timeout: 600_000,
      windowsHide: true,
    });
    const after = spawnSync(pnpm, ["-v"], { cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true });
    const now = String(after.stdout ?? "").trim().split("\n")[0]?.trim() ?? "";
    if (prepare.status === 0 && now.replace(/^v/, "") === expected.replace(/^v/, "")) {
      log(`corepack 已自动切换 pnpm 至 ${now}`, "OK");
      return { version: now, expected, tip: null };
    }
    log(`corepack prepare 未生效（exit=${prepare.status ?? "?"}，当前 ${now || "未知"}）`, "WARN");
  }
  const tip =
    `pnpm 版本不匹配（本机 ${actual}，项目要求 ${expected}）；` +
    `请执行 corepack enable && corepack prepare pnpm@${expected} --activate 后重启应用`;
  return { version: actual, expected, tip };
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
    `正在运行旧版桌面壳（编译于 ${new Date(exeTime).toISOString().slice(5, 16).replace("T", " ")}，源码此后有改动），` +
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
    const ts = new Date().toISOString().replace("T", " ").slice(0, 23);
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
 * 回收一棵进程树的**跨平台入口**（实现见 src/lib/kill-process-tree.ts，唯一出处）。
 *
 * 为什么不直接 `import "….ts"`：那是 TS 模块，在纯 Node 下需要运行时类型剥离
 * （Node ≥ 22.6 默认开启）。用动态 import 而非静态 import，是为了在旧 Node 上
 * 仍能给出可行动的报错，而不是让整个编排在加载阶段就崩。
 * @param {{ pid: number, detached?: boolean, force?: boolean }} options
 * @returns {Promise<{ ok: boolean, via: string }>}
 */
export async function reapProcessTree(options) {
  const specifier = ["..", "src", "lib", "kill-process-tree.ts"].join("/");
  const mod = await import(specifier);
  return mod.killProcessTree(options);
}

/** 收尾：回收本次会话拉起的**整棵进程树**，并清理会话锚点。 */
export async function reapAll() {
  for (const child of spawned) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    try {
      if (child.pid) {
        const via = await reapProcessTree({ pid: child.pid, detached: !isWindows(), force: true });
        log(`回收子进程树 PID ${child.pid}：${via.via}`, "STEP");
      }
    } catch (error) {
      log(`回收子进程树失败：${error instanceof Error ? error.message : String(error)}`, "WARN");
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

/** 端口检查：空闲 / 自己的残留（回收）/ 别人的（只提示，绝不擅自杀）。
 *
 *  「只回收自己的」是多检出并行的保护线（§1.4），因此这里必须**问得出归属**
 *  才动手。Windows 与 POSIX 的判据都由 launch-core/procs 提供，本函数不分平台。
 *  @param {number} port @param {string} [root] @returns {Promise<string>} 结论摘要 */
export async function reconcilePort(port, root = ROOT) {
  const summary = [];
  for (const p of scanPorts(port)) {
    const verdict = await inspectPort(p, {
      listenPids: listeningPidsOnPort,
      belongsToRoot: pidBelongsToRoot,
      root,
    });
    if (verdict.ownership === PORT_OWNERSHIP.free) {
      summary.push(`${p} 空闲`);
      continue;
    }
    if (verdict.ownership === PORT_OWNERSHIP.own) {
      log(`端口 ${p} 被本检出上一次启动的进程占用（PID ${verdict.ownPids.join(", ")}），正在回收…`, "WARN");
      for (const pid of verdict.ownPids) {
        const via = await reapProcessTree({ pid, detached: !isWindows(), force: true });
        log(`  回收 PID ${pid}：${via.via}`, "INFO");
      }
      summary.push(`${p} 已回收自己的残留`);
      continue;
    }
    summary.push(`${p} 被其它进程占用（PID ${verdict.foreignPids.join(", ")}）`);
    log(
      `端口 ${p} 被非本检出的进程占用（PID ${verdict.foreignPids.join(", ")}）——多检出并行保护，不清理。` +
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

/** 确保 Tauri 启动页资源就位（frontendDist 编译期嵌入，运行时同步保证下次编对）。 */
/** @param {string} [root] */
export function ensureSplashResource(root = ROOT) {
  const src = path.join(root, "public", "splash.html");
  const destDir = path.join(root, "src-tauri", "splash-assets");
  if (!fs.existsSync(src)) {
    log("未找到 public/splash.html，Tauri 启动页可能无法显示", "WARN");
    return;
  }
  try {
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src, path.join(destDir, "splash.html"));
    log("已同步 splash.html → src-tauri/splash-assets/splash.html（frontendDist，编译期嵌入）", "INFO");
  } catch (error) {
    log(`同步 splash.html 失败：${error instanceof Error ? error.message : String(error)}`, "WARN");
  }
}

/** 拉起预编译壳，并把 PID 落盘（启动器先退出时的兜底回收锚点）。 */
/** @param {string} shellExe @param {number} port @param {{ root?: string, foreground?: string | null }} options */
export function spawnShell(shellExe, port, { root = ROOT, foreground = null } = {}) {
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
    fs.writeFileSync(path.join(launcherLogDir, "tauri-shell.pid"), String(child.pid ?? ""), "ascii");
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
    fs.rmSync(path.join(root, "log", "launcher", "tauri-shell.pid"), { force: true });
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
  const via = await reapProcessTree({ pid, detached: !isWindows(), force: true });
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
  const command = isWindows() ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = isWindows() ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { stdio: "ignore", detached: true, windowsHide: true });
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
  const args = { mode: "web", open: true, host: "127.0.0.1", port: null, shellExe: null, coldStart: false };
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
  const portOrNull = Number.isInteger(explicitPort) && explicitPort > 0 ? explicitPort : null;
  /** 进度快照 + 提醒字段（一次运行内共享）。 */
  /** @param {string} phase @param {number} progress @param {string} message
   *  @param {Partial<import("./launcher-core/orchestrator.mjs").LaunchStatusPayload>} [extra] */
  const status = (phase, progress, message, extra = {}) =>
    writeLaunchStatus(ROOT, { phase, progress, message, appPort: portOrNull ?? currentPort, startedAt, ...extra });
  let currentPort = portOrNull;

  log(`project_root=${ROOT}`, "INFO");
  log(`平台=${process.platform}，模式=${args.mode}`, "INFO");

  // 0) 上一次的孤儿回收（必须在起新进程之前：否则新旧实例抢同一端口）
  const reaped = await reapStaleSession(ROOT);
  if (reaped) log(`回收上一次运行遗留的进程树：PID ${reaped.join(", ")}`, "WARN");

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
    status("error", 1, gateProblem.split("\n")[0] ?? "工具链不可用", { error: true });
    return 1;
  }
  log("工具链门禁：pnpm 可用、node_modules 已安装", "OK");

  // 2) 端口（单一事实源：app-port.mjs，绝不在这里重算）
  const port = portOrNull ?? resolveAppPort(ROOT);
  currentPort = port;
  log(`使用端口 ${port}（.env 显式值优先，否则按检出路径推导，见 §1.1）`, "INFO");
  status("port-check", 0.05, "正在检查端口占用…");

  // 3) 桌面壳（prebuilt 模式最先拉起：用户双击后第一件事是看见窗口）
  let shell = /** @type {import("node:child_process").ChildProcess | null} */ (null);
  let staleShell = null;
  if (args.mode === "prebuilt") {
    const shellExe = args.shellExe ?? process.env.COMFYAPP_PREBUILT_SHELL ?? defaultShellExe(ROOT);
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
    shell = spawnShell(shellExe, port, { root: ROOT, foreground: args.coldStart ? "1" : null });
    log(`预编译 Tauri 壳已启动（PID ${shell.pid}）：${shellExe}`, "OK");
    log("Tauri 桌面壳已启动，正在启动本地服务…", "STEP");
    status("port-check", 0.05, "桌面壳已启动，正在检查端口占用…", { staleShell });
  }

  // 4) 端口归属：只回收自己的残留（§1.4）
  const portSummary = await reconcilePort(port, ROOT);
  log(`端口检查：${portSummary}`, "OK");
  status("port-ready", 0.12, "端口已就绪，处理编译缓存…", { staleShell });

  // 5) .next 缓存策略（与 .ps1 同一指纹口径）
  const cache = syncNextCache(ROOT, process.env);
  log(cache.cleaned ? `清空 .next 全量重编译（${cache.reason}）` : `保留 .next 缓存（${cache.reason}）`, cache.cleaned ? "STEP" : "OK");
  const pnpm = reconcilePnpmVersion(ROOT);
  if (pnpm?.tip) {
    appendRuntimeWarning(pnpm.tip);
    staleShell = staleShell ? `${staleShell}；${pnpm.tip}` : pnpm.tip;
  }
  status("cache", 0.2, "正在启动本地服务（Next.js dev server）…", { staleShell });

  // 6) 起 dev server（输出重定向到 log/nextjs/，按次命名后轮转保留 5 份）
  const nextDir = path.join(ROOT, "log", "nextjs");
  pruneTimestampedLogs(nextDir, ["nextjs-stdout-", "nextjs-stderr-"], 5);
  const nextOut = path.join(nextDir, `nextjs-stdout-${runTimestamp}.log`);
  const nextErr = path.join(nextDir, `nextjs-stderr-${runTimestamp}.log`);
  log(`启动 Next.js dev server（${args.host}:${port}）…`, "STEP");
  const dev = spawnDevServer(port, args.host, nextOut, nextErr);
  log(`dev server 已启动（PID ${dev.pid}，输出见 ${nextOut}）`, "OK");

  // 7) 会话锚点：把 PID 与心跳落盘，让「进程被杀后仍能回收」成立
  writeSession(ROOT, {
    launcher_pid: process.pid,
    child_pids: spawned.map((c) => c.pid).filter((pid) => typeof pid === "number"),
    app_port: port,
    mode: args.mode,
    started_at: new Date(startedAt).toISOString(),
  });
  const heartbeat = setInterval(() => touchHeartbeat(ROOT), HEARTBEAT_INTERVAL_MS);
  touchHeartbeat(ROOT);
  clearIntervalGuard(heartbeat);

  // 8) DB schema 就绪提示（只警告不退出：改纯前端页面不该被空库挡住，§9.1）
  if (probeSchemaSync(ROOT) !== "ready") {
    log("数据库表还没建（db.sqlite 缺失或为空）——真实业务页面会 500。先执行：pnpm db:push", "WARN");
  }

  // 9) 等就绪（dev server 先退出则立刻定性，不空等 180s）
  log(`等待服务就绪（http://${args.host}:${port}）…`, "STEP");
  status("dev-server-starting", 0.3, "本地服务已启动，等待就绪…", { staleShell });
  const devExited = () => dev.exitCode !== null || dev.signalCode !== null;
  const ready = await waitForReady({
    port,
    host: args.host,
    timeoutMs: READY_TIMEOUT_MS,
    isAlive: () => !devExited(),
    onTick: (left) => {
      const progress = 0.3 + Math.min(0.6, ((READY_TIMEOUT_MS - left * 1000) / READY_TIMEOUT_MS) * 0.6);
      status("dev-server-starting", progress, `正在等待本地服务就绪（还剩 ${left}s）…`, { staleShell });
    },
  });

  if (devExited()) {
    return await concludeDownstreamExit({
      dev,
      shell,
      heartbeat,
      staleShell,
    });
  }
  if (!ready) {
    const tail = readTail(nextErr, 20) || "(无输出)";
    log(`服务未在 ${READY_TIMEOUT_MS / 1000}s 内就绪。最近输出：\n${tail}`, "ERROR");
    status("error", 1, "服务未在超时内就绪，见 log/nextjs/", { error: true, staleShell });
    await shutdown(1);
  }
  log(`服务已就绪：http://${args.host}:${port}`, "OK");
  status("dev-server-ready", 0.9, "本地服务已就绪", { ready: true, staleShell });

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

/** 起 dev server：`pnpm dev -p <port> -H <host>`（端口由 app-port.mjs 解析后显式传入，
 *  不靠环境变量兜底 —— 裸 `next dev` 会落 Next 默认 3000，与 .env / 壳 / e2e 对不上）。 */
/** @param {number} port @param {string} host @param {string} outFile @param {string} errFile */
export function spawnDevServer(port, host, outFile, errFile) {
  const pnpm = whichCommand("pnpm");
  if (!pnpm) throw new Error("pnpm 不在 PATH 上，无法启动 dev server");
  const child = spawnInGroup({
    command: pnpm,
    args: ["dev", "-p", String(port), "-H", host],
    cwd: ROOT,
    env: { ...process.env, COMFYAPP_PORT: String(port), PORT: String(port) },
    stdoutFile: outFile,
    stderrFile: errFile,
  });
  spawned.push(child);
  return child;
}

/** dev server 提前退出时定性并给出用户可见出口（失败即抛出可行动的报错）。 */
/**
 * @param {{ dev: import("node:child_process").ChildProcess,
 *           shell: import("node:child_process").ChildProcess | null,
 *           heartbeat: NodeJS.Timeout, staleShell: string | null }} ctx
 * @returns {Promise<number>}
 */
async function concludeDownstreamExit({ dev, shell, heartbeat, staleShell }) {
  clearInterval(heartbeat);
  const markers = readShellMarkers(ROOT);
  const shellExited = shell ? shell.exitCode !== null || shell.signalCode !== null : false;
  const kind = downstreamExitKind({
    shellExited,
    abandoned: markers.abandoned,
    shellCrashed: markers.crashed,
  });
  const detail = describeDownstreamExit(kind, {
    devCode: dev.exitCode,
    shellCode: shell?.exitCode ?? null,
    shellPid: shell?.pid,
    stderrFile: lastNextLog("nextjs-stderr-"),
    stdoutFile: lastNextLog("nextjs-stdout-"),
  });
  if (kind === "abandoned") {
    log(detail, "INFO");
    log("（提示：要启动桌面应用请重新双击启动入口，启动页出现后请等它自动切换到主界面）", "INFO");
    await shutdown(0);
    return 0;
  }
  log(detail, "ERROR");
  writeLaunchStatus(ROOT, { phase: "error", progress: 1, message: "启动失败，见 log/", error: true, staleShell });
  await shutdown(1);
  return 1;
}

/** 最近一份按次命名的 dev server 日志（壳侧报错要用它给出「现场」）。 */
/** @param {string} prefix @returns {string} */
function lastNextLog(prefix) {
  const dir = path.join(ROOT, "log", "nextjs");
  try {
    const names = fs
      .readdirSync(dir)
      .filter((name) => name.startsWith(prefix))
      .sort()
      .reverse();
    if (names[0]) return path.join(dir, names[0]);
  } catch {
    /* 目录不存在时退回到约定路径 */
  }
  return path.join(dir, `${prefix}${runTimestamp}.log`);
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
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
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
