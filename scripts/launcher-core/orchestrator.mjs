#!/usr/bin/env node
// 启动编排的共用件：进度快照、就绪等待、收尾证据判定（跨平台）。
//
// 「同一契约两套实现」是历史漂移的温床（Windows 侧的 .ps1 与 POSIX 侧的 .mjs
// 各写一份编排）。因此凡是**语义与平台无关**的部分都收在本模块：两侧都 import
// 它，改一处即两侧生效；平台机制差异只留在 procs / shell 两个模块里。

import fs from "node:fs";
import path from "node:path";

/** 进度快照的写入参数（字段口径与 .ps1 / splash.html 同一契约）。 */
/**
 * @typedef {object} LaunchStatusPayload
 * @property {string} phase
 * @property {number} progress
 * @property {string} message
 * @property {boolean} [ready]
 * @property {boolean} [error]
 * @property {number | null | undefined} [appPort]
 * @property {string | null} [staleShell]
 * @property {string | null} [pnpmMismatch]
 * @property {number | null} [startedAt]
 */

/**
 * 写 `run/launch-status.json`（启动页读它显示进度）。
 *
 * JSON **无 BOM**（启动页 JSON.parse 遇 BOM 会失败），非 ASCII 字符由 JSON
 * 转义自动处理。写失败一律静默：进度快照是体验，不是启动的必要条件。
 * @param {string} root
 * @param {LaunchStatusPayload} payload
 */
export function writeLaunchStatus(
  root,
  { phase, progress, message, ready = false, error = false, appPort = null, staleShell = null, pnpmMismatch = null, startedAt = null },
) {
  const elapsed = startedAt ? Math.round((Date.now() - startedAt) / 100) / 10 : 0;
  const body = {
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
    const dir = path.join(root, "run");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "launch-status.json"), JSON.stringify(body), "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * 等 HTTP 就绪：有界重试，不需要 lsof/ss（直接问服务本身）。
 * @param {{ port: number, host?: string, timeoutMs?: number, path?: string,
 *           onTick?: ((secondsLeft: number) => void) | null, isAlive?: (() => boolean) | null }} spec
 * @returns {Promise<boolean>}
 */
export async function waitForReady({
  port,
  host = "127.0.0.1",
  timeoutMs = 180_000,
  path: probePath = "/api/health",
  onTick = null,
  isAlive = null,
}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isAlive && !isAlive()) return false;
    try {
      const res = await fetch(`http://${host}:${port}${probePath}`, { cache: "no-store" });
      if (res.ok) return true;
    } catch {
      /* 还没起来：继续等 */
    }
    if (onTick) onTick(Math.round((deadline - Date.now()) / 1000));
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/** 读文件尾部（失败诊断用；文件不存在返回空串）。 */
/**
 * @param {string} file @param {number} [lines] @returns {string}
 */
export function readTail(file, lines = 20) {
  try {
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .slice(-lines)
      .join("\n")
      .trim();
  } catch {
    return "";
  }
}

/**
 * 文件里是否出现过某标记（大小写不敏感）。
 *
 * 用途：**收尾定性只认壳侧的「正标记」**。「壳也退出了」是一个共同现象，
 * 用户主动放弃、壳自己崩、被任务管理器结束都会命中它；由现象反推成因会把真
 * 故障说成设计内行为（历史事故），因此这里只提供「有没有写下这句话」的判据。
 * @param {string} file @param {string} marker
 * @returns {boolean}
 */
export function fileHasMarker(file, marker) {
  try {
    return fs.readFileSync(file, "utf8").toLowerCase().includes(marker.toLowerCase());
  } catch {
    return false;
  }
}

/** 端口归属：空闲 / 自己的残留 / 别人的。 */
export const PORT_OWNERSHIP = {
  free: "free",
  own: "own",
  foreign: "foreign",
};

/**
 * 端口归属判定（多检出并行保护，§1.4）。
 *
 * **只回收属于本检出的实例**：别的检出的 dev server、用户自己的程序占着端口时
 * 一律不碰 —— 判据不清时「猜着杀」比「说清楚怎么办」危险得多。
 * @param {number} port
 * @param {{ listenPids: (port: number) => Promise<number[]>,
 *           belongsToRoot: (pid: number, root: string) => Promise<boolean>,
 *           root: string }} deps
 * @returns {Promise<{ ownership: string, pids: number[], ownPids: number[], foreignPids: number[] }>}
 */
export async function inspectPort(port, { listenPids, belongsToRoot, root }) {
  const pids = await listenPids(port);
  if (pids.length === 0) {
    return { ownership: PORT_OWNERSHIP.free, pids, ownPids: [], foreignPids: [] };
  }
  const ownPids = [];
  const foreignPids = [];
  for (const pid of pids) {
    if (await belongsToRoot(pid, root)) ownPids.push(pid);
    else foreignPids.push(pid);
  }
  return {
    ownership: ownPids.length > 0 ? PORT_OWNERSHIP.own : PORT_OWNERSHIP.foreign,
    pids,
    ownPids,
    foreignPids,
  };
}
