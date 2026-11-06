#!/usr/bin/env node
// 进程/端口探测（跨平台启动编排用）。
//
// 为什么不复用 src/lib/comfyui/proc-detect.ts：那个模块的判据面向 ComfyUI
// 实例（按 main.py 命令行定位进程），而编排器要回答的是完全不同的问题：
//   · 端口上是谁在听？（回收残留 dev server 之前的判据）
//   · 这个 PID 的工作目录是不是本检出？（§1.4 多检出并行保护）
// 两者的平台机制相同、语义不同，强行合并会让两边都变成带一堆开关的怪物。
//
// 平台实现与 AGENTS 硬规则 3 同源：Windows 用系统自带命令（netstat / PowerShell
// CIM），POSIX 用 /proc 与 ps —— **不依赖 lsof / ss**（很多发行版默认不装，
// 缺它们会让探测静默返回空，比报错更难查）。

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { echoCommandLine } from "./command-echo.mjs";

/** 探测没跑起来：把「没量到」与「量到空」分开，不许被下游当成后者的空串。
 *
 *  为什么用可识别的类而不是裸 Error：调用方只该拦**这一族**（探测失效），
 *  不该把业务异常一并吞掉。判据读不到 ≠ 判过了且没问题（§13.6.3）。 */
export class ProbeUnavailableError extends Error {
  /** @param {string} command @param {string[]} args @param {string} reason */
  constructor(command, args, reason) {
    super(`探测命令没跑起来：${[command, ...args].join(" ")}（${reason}）`);
    this.name = "ProbeUnavailableError";
    this.command = command;
    this.args = args;
    this.reason = reason;
  }
}

/** 跑一个命令并拿到 stdout（失败返回空串，不抛）。
 *
 *  这是**宽松档**：给「拿不到就按空处理」的尽力而为查询用（进程是否还活着、
 *  命令行 / cwd 取不到时按「不是本检出」处理，猜着杀比说清楚危险得多）。
 *  端口归属判据这类**不能 fail-open** 的调用一律走 `runCaptureStrict()`。
 *  @param {string} command
 *  @param {string[]} args
 *  @param {number} [timeoutMs]
 *  @returns {Promise<string>}
 */
export function runCapture(command, args, timeoutMs = 10_000) {
  echoCommandLine(command, args);
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, encoding: "utf8", windowsHide: true },
      // `stdout` 在命令起不来时实测是 `undefined`（`@types/node` 的 `execFile` 回调把它
      // 声明成 `string`）⇒ 这个 `?? ""` 是给运行时兜的，不是多余的。
      (err, stdout) => {
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- execFile 回调的 stdout 在命令起不来时实测 undefined（上方注释已记）
        resolve(err ? "" : String(stdout ?? ""));
      },
    );
  });
}

/** 跑一个命令并拿到 stdout；**命令起不来就抛 `ProbeUnavailableError`**。
 *
 *  「探测失败」与「探测成功且结果为空」在宽松档里是同一个值 `""`，下游解析函数
 *  一律按后者处理 —— 端口归属判据会因此静默判成「端口上没有本检出的应用服务」
 *  （fail-open，硬规则 9 那一问等于没问）。这一层把两者分开：成功时空串是
 *  合法读数，失败时是可识别的异常。真正抛还是转成第三态读数，由调用方决定。
 *  @param {string} command
 *  @param {string[]} args
 *  @param {number} [timeoutMs]
 *  @returns {Promise<string>}
 */
export function runCaptureStrict(command, args, timeoutMs = 10_000) {
  echoCommandLine(command, args);
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, encoding: "utf8", windowsHide: true },
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- execFile 回调的 stdout 在命令起不来时实测 undefined（runCapture 上方注释已记）
      (err, stdout) => {
        if (err) {
          reject(new ProbeUnavailableError(command, args, err.message));
          return;
        }
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- 同上
        resolve(String(stdout ?? ""));
      },
    );
  });
}

/** 是否是 Windows（进程机制的分叉点，与 src/lib/process/kill-process-tree.ts 同一判据）。 */
/**
 * @param {NodeJS.Platform} [platform]
 * @returns {boolean}
 */
export function isWindows(platform = process.platform) {
  return platform === "win32";
}

/** 列出「在指定端口上监听」的 PID（拿不到返回空数组）。
 *
 *  这是编排器回收残留实例的**唯一入口**：Windows 走 `netstat -ano`（系统自带，
 *  无需 PowerShell 启动开销），POSIX 读 `/proc/net/tcp{,6}` 的 LISTEN inode
 *  再与 `/proc/<pid>/fd` 的 `socket:[…]` 求交集。
 *  **返回 Promise，两个平台分支都是**：Windows 的 netstat 是子进程，而上层
 *  （`orchestrator.mjs` 的 `inspectPort`、`port-reap.mjs` 的 `runningAppInstances`）
 *  本来就 `await`。让这一层同步，等于要求「在途探测的 Promise」当场是字符串，
 *  冷缓存首次调用必然抛 TypeError。平台可注入，好让 Windows 分支在任何平台上都能测。
 *
 *  ⚠️ **探测命令起不来就抛**（`ProbeUnavailableError` / `ProbeUnavailableError`
 *  同族）：不返回空数组 —— 空数组会被 `inspectPort` 判成「端口空闲」、
 *  被 `runningAppInstances` 判成「没有本检出的实例在跑」，两者都是 fail-open。
 *  @param {number} port
 *  @param {NodeJS.Platform} [platform]
 *  @returns {Promise<number[]>} */
export async function listeningPidsOnPort(port, platform = process.platform) {
  const raw = isWindows(platform) ? await listeningPidsWindows(port) : listeningPidsPosix(port);
  return [...new Set(raw)].sort((a, b) => a - b);
}

/* netstat 原始输出的短缓存：`scanPorts` 对相邻三个端口各调一次
 * `listeningPidsWindows`，而 `netstat -ano -p TCP` 的输出覆盖**全部**端口 ——
 * 三次调用等于同一份输出跑三遍子进程。1s 内复用同一份快照：探测语义本来就是
 * 「这一瞬间谁在听」，相邻毫秒级调用间不存在需要区分的状态变化；真正要重新
 * 看一眼的是下一轮轮询（早已超出 TTL）。并发调用合并为同一次在途探测。
 * 失败的那一份**不进缓存**：让下一次调用能真的重试，而不是把「没量到」缓存 1s。 */
const NETSTAT_SNAPSHOT_TTL_MS = 1000;
let netstatSnapshot = { at: 0, text: "" };
/** @type {Promise<string> | null} */
let netstatInFlight = null;

/** netstat 全量快照。**恒返回 Promise**：命中缓存也包成已决 Promise，
 *  否则返回值随冷 / 热在 string 与 Promise 之间摇摆，调用方永远写不对。
 *  @returns {Promise<string>} */
function netstatTcpSnapshot() {
  if (Date.now() - netstatSnapshot.at < NETSTAT_SNAPSHOT_TTL_MS) {
    return Promise.resolve(netstatSnapshot.text);
  }
  netstatInFlight ??= runCaptureStrict("netstat", ["-ano", "-p", "TCP"])
    .then((text) => {
      netstatSnapshot = { at: Date.now(), text };
      return text;
    })
    .finally(() => {
      netstatInFlight = null;
    });
  return netstatInFlight;
}

/** @param {number} port @returns {Promise<number[]>} */
async function listeningPidsWindows(port) {
  const out = await netstatTcpSnapshot();
  /** @type {number[]} */
  const pids = [];
  for (const line of out.split(/\r?\n/)) {
    // 形如：TCP    127.0.0.1:3311    0.0.0.0:0    LISTENING    12345
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || cols[0] !== "TCP" || cols[3] !== "LISTENING") {
      continue;
    }
    if (!cols[1]?.endsWith(`:${port}`)) {
      continue;
    }
    const pid = Number.parseInt(cols[4] ?? "", 10);
    if (Number.isInteger(pid) && pid > 0) {
      pids.push(pid);
    }
  }
  return pids;
}

/** @param {number} port @returns {number[]} */
function listeningPidsPosix(port) {
  const inodes = new Set();
  let readable = false;
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
      readable = true;
    } catch {
      continue;
    }
    for (const line of text.split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      // 列：sl local_address rem_address st … inode（st = 0A 即 LISTEN）
      if (cols.length < 10 || cols[3] !== "0A") {
        continue;
      }
      const local = cols[1] ?? "";
      const localPort = Number.parseInt(local.split(":")[1] ?? "", 16);
      if (localPort !== port) {
        continue;
      }
      inodes.add(cols[9]);
    }
  }
  /* 两份 /proc/net/tcp* 一份都读不到 ⇒ 这一路同样「没量到」。空串与「量到空」
   * 不能是同一个返回值：抛同族异常，让调用方转成第三态而不是 fail-open。 */
  if (!readable) {
    throw new ProbeUnavailableError("/proc/net/tcp", [], "两份 tcp 表都读不到");
  }
  if (inodes.size === 0) {
    return [];
  }
  /** @type {number[]} */
  const pids = [];
  let entries;
  try {
    entries = fs.readdirSync("/proc");
  } catch {
    /* /proc 整个读不到：与上面同族，不能把「没量到」念成「没有监听者」。 */
    throw new ProbeUnavailableError("/proc", [], "进程表读不到");
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) {
      continue;
    }
    let fds;
    try {
      fds = fs.readdirSync(path.join("/proc", entry, "fd"));
    } catch {
      continue; // 已退出 / 权限不足
    }
    for (const fd of fds) {
      let link;
      try {
        link = fs.readlinkSync(path.join("/proc", entry, "fd", fd));
      } catch {
        continue;
      }
      const inode = /^socket:\[(?<inode>\d+)\]$/.exec(link)?.groups?.inode;
      if (inode && inodes.has(inode)) {
        pids.push(Number.parseInt(entry, 10));
        break;
      }
    }
  }
  return pids;
}

/** 批量取多个 PID 的命令行（键 = PID，取不到的键缺席）。
 *
 *  Windows 侧把「每 PID 一次 PowerShell 冷启动」（0.5~1.5s）合并为一次：
 *  `Get-CimInstance Win32_Process -Filter "ProcessId=a OR ProcessId=b …"`。
 *  POSIX 用 `ps -o pid=,args= -p a,b,c` 一条命令拿全（ps 本就支持逗号列表）。
 *  探测命令起不来就抛 —— 它是端口归属判据的一环，空 Map 会被念成
 *  「这些 PID 都不是本检出的应用服务」（fail-open）。
 *  @param {number[]} pids @returns {Promise<Map<number, string>>} */
export async function processCommandLines(pids) {
  const out = new Map();
  if (!pids.length) {
    return out;
  }
  if (!isWindows()) {
    const text = await runCaptureStrict("ps", ["-o", "pid=,args=", "-p", pids.join(",")]);
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const cut = trimmed.indexOf(" ");
      const pid = Number.parseInt(cut > 0 ? trimmed.slice(0, cut) : "", 10);
      if (Number.isInteger(pid)) {
        out.set(pid, trimmed.slice(cut + 1));
      }
    }
    return out;
  }
  const filter = pids.map((pid) => `ProcessId=${pid}`).join(" OR ");
  const text = await runCaptureStrict("powershell", [
    "-NoProfile",
    "-Command",
    `(Get-CimInstance Win32_Process -Filter "${filter}") | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress`,
  ]);
  let parsed;
  try {
    parsed = JSON.parse(text || "null");
  } catch {
    /* 命令起来了、输出却不是 JSON：这一格是「量到了但读不懂」，不是
     * 「命令没起来」（后者已由 runCaptureStrict 抛掉），与 runCapture 的
     * 返回值缺口无关，按原有的「取不到就缺席」处理，不在本次扩面。 */
    return out;
  }
  const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const pid = Number.parseInt(String(row.ProcessId ?? ""), 10);
    const cmdline = typeof row.CommandLine === "string" ? row.CommandLine : "";
    if (Number.isInteger(pid) && cmdline) {
      out.set(pid, cmdline);
    }
  }
  return out;
}

/** 某 PID 的工作目录（判「这个进程属不属于本检出」）。
 *  取不到返回 null：判据不清时按「不是本检出」处理（§1.4 猜着杀比说清楚危险）。
 *  @param {number} pid @returns {Promise<string | null>} */
export async function processCwd(pid) {
  if (isWindows()) {
    const out = await runCapture("powershell", [
      "-NoProfile",
      "-Command",
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
    ]);
    return out.trim() || null;
  }
  try {
    return fs.realpathSync(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}

/** 该 PID 是否属于本检出（工作目录 / 命令行落在检出根内）。
 *
 *  判据不清时**返回 false**：§1.4 的多检出并行保护要求「拿不准就不动别人的
 *  进程」——猜着杀比说清楚危险得多。
 *  @param {number} pid @param {string} root @returns {Promise<boolean>} */
export async function pidBelongsToRoot(pid, root) {
  const cwd = await processCwd(pid);
  if (!cwd) {
    return false;
  }
  /** @param {string} value */
  const norm = (value) => value.replaceAll("\\", "/").toLowerCase();
  return norm(cwd).includes(norm(root));
}

/** 进程是否还活着（尽力而为：探测本身失败时返回 false）。 */
/** @param {number} pid @returns {Promise<boolean>} */
export async function pidAlive(pid) {
  if (!pid || pid <= 0) {
    return false;
  }
  if (!isWindows()) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string" &&
        error.code === "EPERM"
      );
    }
  }
  const out = await runCapture("powershell", [
    "-NoProfile",
    "-Command",
    `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Id`,
  ]);
  return out.trim() === String(pid);
}
