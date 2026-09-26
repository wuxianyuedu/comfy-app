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

/** 跑一个命令并拿到 stdout（失败返回空串，不抛）。 */
/**
 * @param {string} command
 * @param {string[]} args
 * @param {number} [timeoutMs]
 * @returns {Promise<string>}
 */
export function runCapture(command, args, timeoutMs = 10_000) {
  // 探测命令同样回显：这些调用（netstat / PowerShell CIM / ps）决定了「端口上是谁」
  // 与「这个 PID 属不属于本检出」——回收残留实例之前的判据全在这里，出问题时
  // 第一句要问的就是「到底探了什么」，而探测结果本身（空串）看不出来。
  echoCommandLine(command, args);
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, encoding: "utf8", windowsHide: true },
      (err, stdout) => {
        resolve(err ? "" : String(stdout ?? ""));
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
 *  @param {number} port @returns {Promise<number[]>} */
export async function listeningPidsOnPort(port) {
  const raw = isWindows()
    ? await listeningPidsWindows(port)
    : await listeningPidsPosix(port);
  return [...new Set(raw)].sort((a, b) => a - b);
}

/* netstat 原始输出的短缓存：`scanPorts` 对相邻三个端口各调一次
 * `listeningPidsWindows`，而 `netstat -ano -p TCP` 的输出覆盖**全部**端口 ——
 * 三次调用等于同一份输出跑三遍子进程。1s 内复用同一份快照：探测语义本来就是
 * 「这一瞬间谁在听」，相邻毫秒级调用间不存在需要区分的状态变化；真正要重新
 * 看一眼的是下一轮轮询（早已超出 TTL）。并发调用合并为同一次在途探测。 */
const NETSTAT_SNAPSHOT_TTL_MS = 1000;
let netstatSnapshot = { at: 0, text: "" };
let netstatInFlight = null;

/** @returns {Promise<string>} */
async function netstatTcpSnapshot() {
  if (Date.now() - netstatSnapshot.at < NETSTAT_SNAPSHOT_TTL_MS) {
    return netstatSnapshot.text;
  }
  netstatInFlight ??= runCapture("netstat", ["-ano", "-p", "TCP"]).then(
    (text) => {
      netstatSnapshot = { at: Date.now(), text };
      netstatInFlight = null;
      return text;
    },
  );
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
    if (cols.length < 5 || cols[0] !== "TCP" || cols[3] !== "LISTENING")
      continue;
    if (!cols[1]?.endsWith(`:${port}`)) continue;
    const pid = Number.parseInt(cols[4] ?? "", 10);
    if (Number.isInteger(pid) && pid > 0) pids.push(pid);
  }
  return pids;
}

/** @param {number} port @returns {Promise<number[]>} */
async function listeningPidsPosix(port) {
  const inodes = new Set();
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      // 列：sl local_address rem_address st … inode（st = 0A 即 LISTEN）
      if (cols.length < 10 || cols[3] !== "0A") continue;
      const local = cols[1] ?? "";
      const localPort = Number.parseInt(local.split(":")[1] ?? "", 16);
      if (localPort !== port) continue;
      inodes.add(cols[9]);
    }
  }
  if (inodes.size === 0) return [];
  /** @type {number[]} */
  const pids = [];
  let entries = [];
  try {
    entries = fs.readdirSync("/proc");
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    let fds = [];
    try {
      fds = fs.readdirSync(path.join("/proc", entry, "fd"));
    } catch {
      continue; // 已退出 / 权限不足
    }
    for (const fd of fds) {
      let link = "";
      try {
        link = fs.readlinkSync(path.join("/proc", entry, "fd", fd));
      } catch {
        continue;
      }
      const inode = /^socket:\[(\d+)\]$/.exec(link)?.[1];
      if (inode && inodes.has(inode)) {
        pids.push(Number.parseInt(entry, 10));
        break;
      }
    }
  }
  return pids;
}

/** 某 PID 的工作目录（判「这个进程属不属于本检出」）。
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
  if (!cwd) return false;
  /** @param {string} value */
  const norm = (value) => value.replace(/\\/g, "/").toLowerCase();
  return norm(cwd).includes(norm(root));
}

/** 进程是否还活着（尽力而为：探测本身失败时返回 false）。 */
/** @param {number} pid @returns {Promise<boolean>} */
export async function pidAlive(pid) {
  if (!pid || pid <= 0) return false;
  if (!isWindows()) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return /** @type {NodeJS.ErrnoException} */ (error).code === "EPERM";
    }
  }
  const out = await runCapture("powershell", [
    "-NoProfile",
    "-Command",
    `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Id`,
  ]);
  return out.trim() === String(pid);
}
