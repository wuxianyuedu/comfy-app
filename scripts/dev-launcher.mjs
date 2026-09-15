#!/usr/bin/env node
// 跨平台启动编排器（Linux / macOS 主路径；Windows 仍以 scripts/dev-launcher.ps1
// 为主路径，见 §3.2/§9.4）。把「启动一个能用的桌面/Web 开发环境」这件事里
// 与平台无关的部分收在一处，与 .ps1 版**同契约、同产物、同日志布局**。
//
// 为什么需要它（ISSUE #489）：全项目 11 个 scripts/*.ps1 + 29 个 tools/**/*.ps1，
// 唯一的编排者 dev-launcher.ps1（1324 行 / 19 处 Windows 专属调用：taskkill、
// Get-CimInstance、Job Object、cmd.exe）在 Linux / macOS 上不可用，而仓库里
// **没有任何 .sh 启动脚本** —— 即「跨平台」这一侧此前根本没有实现，不是漏了几个
// 平台判断。
//
// 与 .ps1 的职责分工：
//   · 端口解析 → scripts/app-port.mjs（同一事实源，禁止各写一遍）
//   · 进程树回收 → 进程组（`detached: true` 建组 + 组信号），而不是 taskkill
//   · 会话锚点 → scripts/dev-launcher-session.mjs（PID/心跳落盘，崩溃后可回收）
//   · 进度快照 → run/launch-status.json（与 .ps1 / python 启动器同一契约）
//   · 日志布局 → log/launcher/ 与 log/nextjs/（与 §4 一致，不新增固定名日志）
//
// 用法：
//   node scripts/dev-launcher.mjs [--mode web|tauri|prebuilt] [--no-open]
//   直跑等价于 `dev` 模式（前台：Ctrl-C 收尾并回收整棵进程树）。

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveAppPort } from "./app-port.mjs";
import { probeSchemaSync } from "./db-schema-state.mjs";
import { checkEnvFile } from "./env-preflight.mjs";
import {
  clearSession,
  isSessionOwnerAlive,
  readSession,
  statusFilePath,
  touchHeartbeat,
  writeSession,
} from "./dev-launcher-session.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Next 缓存指纹只覆盖「构建配置与依赖」：源码改动由 Turbopack 增量编译 +
 *  HMR 处理，把 src/ 纳入指纹会导致「改一行 API 就清空 .next 全量重编译」
 *  （与 .ps1 版同一口径，见 §7 缓存策略）。 */
const FINGERPRINT_TARGETS = ["next.config.js", "tsconfig.json", "package.json", "pnpm-lock.yaml"];

/** 心跳间隔：必须明显小于 dev-launcher-session 的孤儿判定阈值（30s），
 *  否则正常运行的 launcher 会被下一次启动误判成已死。 */
const HEARTBEAT_INTERVAL_MS = 5_000;

/** 等服务就绪的上限（与 .ps1 的 180 次 × 1s 同口径）。 */
const READY_TIMEOUT_MS = 180_000;

// ── 日志：log/launcher/dev-launcher.log（当前运行，实时读）+ 历史归档 ──
const logRoot = path.join(ROOT, "log");
const launcherLogDir = path.join(logRoot, "launcher");
const nextjsLogDir = path.join(logRoot, "nextjs");
const archiveDir = path.join(logRoot, "archive", new Date().toISOString().slice(0, 7));
for (const dir of [launcherLogDir, nextjsLogDir, archiveDir]) {
  fs.mkdirSync(dir, { recursive: true });
}
const runStamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const currentLog = path.join(launcherLogDir, "dev-launcher.log");
const archiveLog = path.join(archiveDir, `dev-launcher-${runStamp}.log`);
fs.writeFileSync(currentLog, "", "utf8");
// 供壳侧 get_launch_log 的 sentinel 机制定位本次运行日志（与 .ps1 版同文件）。
fs.writeFileSync(
  path.join(launcherLogDir, "dev-launcher-current.txt"),
  currentLog,
  "utf8",
);

const LEVELS = { STEP: "STEP ", OK: "OK   ", WARN: "WARN ", ERROR: "ERROR", INFO: "INFO " };
/** @typedef {"STEP" | "OK" | "WARN" | "ERROR" | "INFO"} LogLevel */
/**
 * 进度快照的写入参数。
 * @typedef {object} LaunchStatusOptions
 * @property {boolean} [ready]
 * @property {boolean} [error]
 * @property {number | null} [appPort]
 * @property {string | null} [staleShell]
 * @property {string | null} [pnpmMismatch]
 * @property {number} [startedAt]
 */

/** 写一行日志：stdout（终端可见）与 dev-launcher.log（壳内日志面板可读）双写。
 *  `.ps1` 版用 ANSI 着色 + 双写绕开 Start-Transcript 缓冲，这里只用纯文本：
 *  非 TTY（CI / 重定向）时 ANSI 反而污染日志。
 *  @param {string} message @param {LogLevel} [level] */
export function log(message, level = "INFO") {
  const ts = new Date().toTimeString().slice(0, 8);
  const line = `[${ts}] [${LEVELS[level] ?? LEVELS.INFO}] ${message}`;
  process.stdout.write(`${line}\n`);
  try {
    fs.appendFileSync(currentLog, `${line}\n`, "utf8");
  } catch {
    /* 日志落盘失败不影响启动本身 */
  }
}

/** 进度快照（与 .ps1 / python 启动器同一契约字段，壳内启动页据此显示）。
 *  `stale_shell` / `pnpm_mismatch` 保留在字段表里：启动页读它们做可见提醒，
 *  缺字段与空值等价（splash.html 判的是真值）。 */
/** 写进度快照（见 LaunchStatusOptions）。
 * @param {string} phase @param {number} progress @param {string} message
 * @param {LaunchStatusOptions} [options] */
export function writeLaunchStatus(
  phase,
  progress,
  message,
  {
    ready = false,
    error = false,
    appPort,
    staleShell = null,
    pnpmMismatch = null,
    startedAt,
  } = {},
) {
  const elapsed = startedAt ? Math.round((Date.now() - startedAt) / 100) / 10 : 0;
  const payload = {
    phase,
    progress: Math.round(progress * 1000) / 1000,
    message,
    elapsed,
    ready,
    error,
    app_url: `http://127.0.0.1:${appPort ?? 3100}/workspace`,
    stale_shell: staleShell,
    pnpm_mismatch: pnpmMismatch,
    updated_at: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(statusFilePath(ROOT), JSON.stringify(payload), "utf8");
  } catch {
    /* 见 log 注释 */
  }
}

// ── 预检 ────────────────────────────────────────────────────────────────────
/** 工具链门禁：pnpm 可用 + node_modules 已装。与 .ps1 的 Test-ToolchainGate
 *  同判据（只做致命快检，不做 install 自愈——那是窗口出现之后的事）。 */
/** @param {string} [root] @returns {string | null} 失败原因（null = 通过） */
export function runToolchainGate(root = ROOT) {
  const pnpm = spawnSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["-v"], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (pnpm.status !== 0 || !/\d+\.\d+/.test(pnpm.stdout ?? "")) {
    const detail = `${pnpm.stderr ?? ""}${pnpm.stdout ?? ""}`.trim().split("\n").slice(0, 3).join(" ");
    return `pnpm 工具链不可用（exit=${pnpm.status ?? "?"}）：${detail || "未知错误"}\n修复：corepack enable && corepack prepare pnpm@<项目版本> --activate`;
  }
  if (!fs.existsSync(path.join(root, "node_modules", ".modules.yaml"))) {
    return "node_modules 缺失或不完整（找不到 node_modules/.modules.yaml）。\n修复：pnpm install（或 pnpm env:init 之后重跑）";
  }
  return null;
}

/** 端口占用扫描范围：本端口与 +1/+2（Next 在端口被占时会静默顺延，导致
 *  「服务起来了但连着旧实例」——§1.1 的端口契约因此必须连同邻位一起清）。 */
/** @param {number} port @returns {number[]} */
export function scanPorts(port) {
  return [port, port + 1, port + 2];
}

/** 该端口上是否已有本检出的实例在监听（只回收自己的，不动别人的实例——
 *  多检出并行保护，§1.4）。 */
/** @param {number} port @param {string} [host] @returns {Promise<boolean>} */
export async function isPortInUse(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    /** @param {boolean} value */
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(500);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

// ── .next 缓存指纹 ─────────────────────────────────────────────────────────
/**
 * 关键配置指纹（内容 hash）。与 .ps1 的 Get-ConfigFingerprint 同口径：
 * 逐文件 sha256 + 组合 hash，并保留逐文件明细以便回答「到底哪个文件变了」。
 * @param {string} [root]
 * @param {string} [root] @returns {{ hash: string, files: Record<string, string> }}
 */
export function configFingerprint(root = ROOT) {
  const combined = crypto.createHash("sha256");
  /** @type {Record<string, string>} */
  const files = {};
  for (const rel of FINGERPRINT_TARGETS) {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) continue;
    const digest = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
    files[rel] = digest;
    combined.update(`${rel}\0${digest}\0`);
  }
  return { hash: combined.digest("hex"), files };
}

/**
 * 按指纹决定是否清空 .next（FORCE_CLEAN=1 强制清、SKIP_CLEAN=1 强制留）。
 * 返回是否执行了清理，供日志与测试断言（**不猜**：调用方据返回值写结论）。
 */
/**
 * @param {string} [root]
 * @param {Record<string, string | undefined>} [env]
 * @param {{ hash: string, files: Record<string, string> }} [fingerprint]
 * @returns {{ cleaned: boolean, reason: string }} */
export function syncNextCache(
  root = ROOT,
  env = /** @type {Record<string, string | undefined>} */ (process.env),
  fingerprint = configFingerprint(root),
) {
  const nextDir = path.join(root, ".next");
  const hashFile = path.join(nextDir, "config-fingerprint");
  const filesFile = path.join(nextDir, "config-fingerprint-files.json");
  const writeMarks = () => {
    try {
      fs.writeFileSync(hashFile, fingerprint.hash, "utf8");
      fs.writeFileSync(filesFile, JSON.stringify(fingerprint.files), "utf8");
    } catch {
      /* 缓存标记写不进去最多导致下次全量重编译，不阻断启动 */
    }
  };
  /** @param {string} reason @returns {string} */
  const wipe = (reason) => {
    fs.rmSync(nextDir, { recursive: true, force: true });
    fs.mkdirSync(nextDir, { recursive: true });
    writeMarks();
    return reason;
  };

  if (env.FORCE_CLEAN === "1") {
    return { cleaned: fs.existsSync(nextDir), reason: wipe("FORCE_CLEAN=1") };
  }
  if (env.SKIP_CLEAN === "1") {
    return { cleaned: false, reason: "SKIP_CLEAN=1" };
  }
  if (!fs.existsSync(nextDir)) {
    fs.mkdirSync(nextDir, { recursive: true });
    writeMarks();
    return { cleaned: false, reason: "首次启动：写入初始指纹，执行全量编译" };
  }
  const saved = fs.existsSync(hashFile) ? fs.readFileSync(hashFile, "utf8").trim() : "";
  if (saved === fingerprint.hash) {
    return { cleaned: false, reason: "配置指纹未变，保留缓存" };
  }
  return { cleaned: true, reason: wipe(`指纹变化 ${saved.slice(0, 12) || "(无)"} → ${fingerprint.hash.slice(0, 12)}`) };
}

// ── 进程编排 ───────────────────────────────────────────────────────────────

/**
 * 回收一棵进程树的**跨平台入口**。
 *
 * 为什么不直接 import `src/lib/kill-process-tree.ts`：那是 TS 模块，而本脚本与
 * sidecar 一起跑在**纯 Node**（无 TS loader）下 —— `import "….ts"` 在运行时会
 * ENOENT，在 tsc 下又需要 allowImportingTsExtensions。因此这里改为在需要时
 * **动态 import**：优先用仓库内那份唯一实现（Node ≥ 22.6 可加载 .ts），失败
 * 则退回到本函数内的最小等价实现（判据与 src/lib/kill-process-tree.ts 对齐：
 * POSIX 读 PGID 后按组发信号、与自身同组则禁走组路径）。
 *
 * 也就是说平台判据只有一份语义、两条加载路径，而不是两处各写一套判据。
 * @param {{ pid: number, detached?: boolean, force?: boolean }} options
 * @returns {Promise<{ ok: boolean, via: string }>}
 */
export async function reapProcessTree(options) {
  try {
    // 路径用变量拼接：tsc 对字符串字面量的 .ts 扩展名会报 TS5097
    //（allowImportingTsExtensions 未开），而运行时需要的就是它。
    const specifier = `../src/lib/kill-process-tree.ts`;
    const mod = await import(/* @vite-ignore */ specifier);
    return await mod.killProcessTree(options);
  } catch {
    return reapProcessTreeFallback(options);
  }
}

/**
 * 动态加载失败时的等价实现（纯 Node，语义与 src/lib/kill-process-tree.ts 一致）。
 * @param {{ pid: number, detached?: boolean, force?: boolean }} options
 * @returns {{ ok: boolean, via: string }}
 */
function reapProcessTreeFallback({ pid, detached = false, force = false }) {
  if (!pid || pid <= 0) return { ok: false, via: "无有效 PID（跳过）" };
  if (process.platform === "win32") {
    const cmd = `taskkill /PID ${pid} /T /F`;
    spawnSync(cmd, { shell: true, stdio: "ignore" });
    return { ok: true, via: cmd };
  }
  const sig = force ? "SIGKILL" : "SIGTERM";
  /** @param {number} target @returns {number | null} */
  const pgidOf = (target) => {
    try {
      const out = spawnSync("ps", ["-o", "pgid=", "-p", String(target)], {
        encoding: "utf8",
        timeout: 2000,
      });
      const value = Number.parseInt(String(out.stdout ?? "").trim(), 10);
      return Number.isInteger(value) && value > 0 ? value : null;
    } catch {
      return null;
    }
  };
  const pgid = pgidOf(pid);
  const own = pgidOf(process.pid);
  // 与调用者同组时禁走组路径：bound 模式子进程与调用者同组，
  // kill(-pgid) 会连带把编排器自己杀掉（src/lib/kill-process-tree.ts 同款判据）。
  if (pgid !== null && pgid !== own) {
    try {
      process.kill(-pgid, sig);
      return { ok: true, via: `kill -${sig} -${pgid}（进程组）` };
    } catch {
      /* 落到单杀 */
    }
  }
  if (pgid === null && detached && pgid !== own) {
    try {
      process.kill(-pid, sig);
      return { ok: true, via: `kill -${sig} -${pid}（进程组·未探测）` };
    } catch {
      /* 落到单杀 */
    }
  }
  try {
    process.kill(pid, sig);
    return { ok: true, via: `kill -${sig} ${pid}（单进程兜底）` };
  } catch {
    return { ok: false, via: `kill -${sig} ${pid} 失败（目标可能已退出）` };
  }
}
/** 本次会话拉起的子进程（收尾时全部回收）。
 *  @type {import("node:child_process").ChildProcess[]} */
const spawned = [];

/**
 * 起一个子进程并**单独建进程组**（POSIX）。这是跨平台回收的地基：
 * 不显式建组时子进程与 launcher 同组，回收只能单杀 leader，其下的
 * node/pnpm/next 会残留成孤儿（AGENTS 硬规则 3 明令禁止的形态）。
 * @returns {import("node:child_process").ChildProcess}
 */
/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, redirectTo?: { out: string, err: string } | null }} [options]
 * @returns {import("node:child_process").ChildProcess}
 */
export function spawnInGroup(
  command,
  args,
  { cwd = ROOT, env = process.env, redirectTo = null } = {},
) {
  /** @type {import("node:child_process").StdioOptions} */
  const stdio = redirectTo
    ? ["ignore", fs.openSync(redirectTo.out, "a"), fs.openSync(redirectTo.err, "a")]
    : ["ignore", "inherit", "inherit"];
  const child = spawn(command, args, {
    cwd,
    env,
    stdio,
    // POSIX：自建进程组（setsid 语义），收尾时可整组回收；
    // Windows：detached 会另开控制台窗口且无组语义，回收走 taskkill /T。
    detached: process.platform !== "win32",
    shell: false,
  });
  spawned.push(child);
  return child;
}

/**
 * 收尾：回收本次会话拉起的**整棵进程树**，并清理会话锚点。
 * 平台分支收在 src/lib/kill-process-tree.ts（AGENTS 硬规则 3），这里只表达
 * 「回收这些树」的意图，不自己摸 process.platform。
 */
export async function reapAll() {
  for (const child of spawned) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    try {
      if (child.pid) {
        await reapProcessTree({ pid: child.pid, detached: process.platform !== "win32" });
      }
    } catch {
      /* killProcessTree 本身不抛，这里只是防御 */
    }
  }
  clearSession(ROOT);
}

/** 回收上一次运行遗留的进程树（崩溃 / 被 SIGKILL 时留下的孤儿）。
 *  判据是**心跳 + PID**两条（见 dev-launcher-session）：只判 PID 会被 PID 复用
 *  骗过，只判心跳会把卡死的实例当成死的。 */
/** @param {string} [root] @returns {Promise<number[] | null>} 被回收的 PID */
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
    await reapProcessTree({ pid, detached: process.platform !== "win32" });
  }
  clearSession(root);
  return pids;
}

/** 有界重试的 HTTP 就绪探测（不需要 lsof/ss：直接问服务本身）。 */
/**
 * @param {number} port
 * @param {{ timeoutMs?: number, host?: string, onTick?: ((secondsLeft: number) => void) | null }} [options]
 * @returns {Promise<boolean>} */
export async function waitForReady(
  port,
  { timeoutMs = READY_TIMEOUT_MS, host = "127.0.0.1", onTick = null } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://${host}:${port}/api/health`, { cache: "no-store" });
      if (res.ok) return true;
    } catch {
      /* 还没起来：继续等 */
    }
    if (onTick) onTick(Math.round((deadline - Date.now()) / 1000));
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/** @param {string[]} argv @returns {{ mode: string, open: boolean, host: string, port: string | null }} */
function parseArgs(argv) {
  /** @type {{ mode: string, open: boolean, host: string, port: string | null }} */
  const args = { mode: "web", open: true, host: "127.0.0.1", port: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--mode") args.mode = argv[++i] ?? args.mode;
    else if (a.startsWith("--mode=")) args.mode = a.slice("--mode=".length);
    else if (a === "--no-open") args.open = false;
    else if (a === "--host") args.host = argv[++i] ?? args.host;
    else if (a === "-p" || a === "--port") args.port = argv[++i] ?? null;
  }
  return args;
}

/**
 * 主流程：预检 → 端口 → 缓存 → 起服务 → 等就绪 → 常驻（心跳）。
 * @returns {Promise<number>} 退出码（0 正常，非 0 已打印可行动作）
 */
/** @param {string[]} [argv] @returns {Promise<number>} */
export async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const startedAt = Date.now();
  // 预检失败时也要能写出「本来打算用哪个端口」——此时还没解析端口，
  // 用显式参数（合法时）否则 null，让快照里不出现伪造的端口号。
  const explicitPort = Number.parseInt(args.port ?? "", 10);
  const portOrNull = Number.isInteger(explicitPort) && explicitPort > 0 ? explicitPort : null;
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
    writeLaunchStatus("error", 1, "环境配置未就绪：先执行 pnpm env:init", {
      error: true,
      appPort: portOrNull,
      startedAt,
    });
    return 1;
  }
  const gateProblem = runToolchainGate(ROOT);
  if (gateProblem) {
    log(gateProblem, "ERROR");
    writeLaunchStatus("error", 1, gateProblem.split("\n")[0] ?? "工具链不可用", {
      error: true,
      appPort: portOrNull,
      startedAt,
    });
    return 1;
  }
  log("工具链门禁：pnpm 可用、node_modules 已安装", "OK");

  // 2) 端口（单一事实源：app-port.mjs，绝不在这里重算）
  const port = portOrNull ?? resolveAppPort(ROOT);
  log(`使用端口 ${port}（.env 显式值优先，否则按检出路径推导，见 §1.1）`, "INFO");
  writeLaunchStatus("port-check", 0.05, "正在检查端口占用…", { appPort: port, startedAt });

  const busy = [];
  for (const p of scanPorts(port)) {
    if (await isPortInUse(p, args.host)) busy.push(p);
  }
  if (busy.length > 0) {
    // 只提示不擅自杀：端口可能属于另一份检出的实例（§1.4 多检出并行保护），
    // 也可能是用户自己的服务 —— 「猜着杀」比「清楚地说」危险得多。
    log(
      `端口 ${busy.join("/")} 已被占用。若属另一份检出或其它应用，请改 .env 的 COMFYAPP_PORT；` +
        `若是本检出上一次启动残留，先关闭它或删除 run/launcher-session.json 后重试。`,
      "WARN",
    );
  } else {
    log(`端口 ${scanPorts(port).join("/")} 空闲`, "OK");
  }
  writeLaunchStatus("port-ready", 0.12, "端口已就绪，处理编译缓存…", { appPort: port, startedAt });

  // 3) .next 缓存策略（与 .ps1 同一指纹口径）
  const cache = syncNextCache(ROOT);
  log(cache.cleaned ? `清空 .next 全量重编译（${cache.reason}）` : `保留 .next 缓存（${cache.reason}）`, cache.cleaned ? "STEP" : "OK");
  writeLaunchStatus("cache", 0.2, "正在启动本地服务（Next.js dev server）…", { appPort: port, startedAt });

  // 4) 起 dev server（重定向到 log/nextjs/，与 .ps1 同布局）
  const nextOut = path.join(nextjsLogDir, `nextjs-stdout-${runStamp}.log`);
  const nextErr = path.join(nextjsLogDir, `nextjs-stderr-${runStamp}.log`);
  log(`启动 Next.js dev server（127.0.0.1:${port}）…`, "STEP");
  const dev = spawnInGroup(
    "pnpm",
    ["dev", "-p", String(port), "-H", args.host],
    {
      cwd: ROOT,
      env: { ...process.env, COMFYAPP_PORT: String(port), PORT: String(port) },
      redirectTo: { out: nextOut, err: nextErr },
    },
  );
  log(`dev server 已启动（PID ${dev.pid}，输出见 ${nextOut}）`, "OK");

  // 5) 会话锚点：把 PID 与心跳落盘，让「进程被杀后仍能回收」成立
  writeSession(ROOT, {
    launcher_pid: process.pid,
    child_pids: spawned
      .map((c) => c.pid)
      .filter((pid) => typeof pid === "number"),
    app_port: port,
    mode: args.mode,
    started_at: new Date(startedAt).toISOString(),
  });
  const heartbeat = setInterval(() => touchHeartbeat(ROOT), HEARTBEAT_INTERVAL_MS);
  touchHeartbeat(ROOT);

  // 6) DB schema 就绪提示（只警告不退出：改纯前端页面不该被空库挡住，§9.1）
  if (probeSchemaSync(ROOT) !== "ready") {
    log("数据库表还没建（db.sqlite 缺失或为空）——真实业务页面会 500。先执行：pnpm db:push", "WARN");
  }

  // 7) 等就绪
  log(`等待服务就绪（http://${args.host}:${port}）…`, "STEP");
  writeLaunchStatus("dev-server-starting", 0.3, "本地服务已启动，等待就绪…", { appPort: port, startedAt });
  const ready = await waitForReady(port, {
    host: args.host,
    onTick: (left) => {
      const progress = 0.3 + Math.min(0.6, (READY_TIMEOUT_MS - left * 1000) / READY_TIMEOUT_MS * 0.6);
      writeLaunchStatus("dev-server-starting", progress, `正在等待本地服务就绪（还剩 ${left}s）…`, { appPort: port, startedAt });
    },
  });
  if (!ready) {
    const tail = readTail(nextErr, 20);
    log(`服务未在 ${READY_TIMEOUT_MS / 1000}s 内就绪。最近输出：\n${tail}`, "ERROR");
    writeLaunchStatus("error", 1, "服务未在超时内就绪，见 log/nextjs/", { error: true, appPort: port, startedAt });
    clearInterval(heartbeat);
    await reapAll();
    return 1;
  }
  log(`服务已就绪：http://${args.host}:${port}`, "OK");
  writeLaunchStatus("dev-server-ready", 0.9, "本地服务已就绪", { ready: true, appPort: port, startedAt });

  // 8) 打开浏览器（纯 Web 模式；桌面模式由壳自取）
  if (args.open && process.env.NO_OPEN !== "1" && args.mode === "web") {
    openBrowser(`http://localhost:${port}`);
  }

  // 9) 常驻：任一子进程退出即收尾（与 .ps1 的「等任一退出」同语义）
  const exitCode = await new Promise((resolve) => {
    dev.once("exit", (code) => resolve(code ?? 0));
    const onSignal = () => resolve(0);
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });
  clearInterval(heartbeat);
  log("检到子进程退出，正在回收整棵进程树…", "STEP");
  await reapAll();
  log("全部子进程已回收，启动器退出", "OK");
  archiveCurrentLog();
  return exitCode;
}

/** 读文件尾部（失败诊断用）。 */
/** @param {string} file @param {number} [lines] @returns {string} */
export function readTail(file, lines = 20) {
  try {
    const text = fs.readFileSync(file, "utf8");
    return text.split("\n").slice(-lines).join("\n").trim();
  } catch {
    return "(无输出)";
  }
}

/** 打开浏览器：三平台各有入口，失败只提示不阻断（§9.2 第 3 条）。 */
/** @param {string} url */
export function openBrowser(url) {
  const cmd =
    process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.on("error", () => {
    log(`未能自动打开浏览器，请手动访问 ${url}`, "WARN");
  });
  child.unref();
  log(`已尝试打开浏览器：${url}`, "INFO");
}

/** 归档本次运行日志（与 .ps1 的 archive 目录约定一致）。 */
export function archiveCurrentLog() {
  try {
    fs.appendFileSync(archiveLog, fs.readFileSync(currentLog, "utf8"), "utf8");
  } catch {
    /* 归档失败不影响退出 */
  }
}

// 直跑（被 import 时不执行）：供 tests 复用上面这些纯函数。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const isMain = process.env.COMFYAPP_LAUNCHER_DRY_RUN !== "1";
  if (!isMain) {
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
