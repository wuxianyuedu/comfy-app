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

/**
 * 会不会由编排器把端口**显式传给** dev server（`pnpm dev -p <port>`）。
 *
 * 这是「回收残留实例」的必要前提：编排器的残留判据里有**两条子判据**，而它们
 * 只在「端口被显式指定」时才互不打脸（见 `portOwnershipVerdict`）。
 * @param {unknown} portOrNull 调用方解析出的端口（非整数即视为未指定）
 * @returns {boolean}
 */
export function usesExplicitPort(portOrNull) {
  return Number.isInteger(portOrNull) && /** @type {number} */ (portOrNull) > 0;
}

/** 应用服务自证身份用的探针（`pnpm dev` / `pnpm start` / `next dev` 都带它）。 */
export const APP_DEV_SCRIPT_MARKER = "dev.mjs";
/** 同一份自证里可能出现的第二个 token（standalone / e2e 的启动脚本）。 */
export const APP_START_SCRIPT_MARKER = "start.mjs";

/**
 * 端口占用者的归属裁定：本检出（应用服务）/ 本检出（其它）/ 别的检出或别的程序。
 *
 * 为什么要拆出「本检出（其它）」这一档：`pidBelongsToRoot` 只回答「这个 PID 的
 * 命令行里有没有出现过检出根路径」——`node_modules`、缓存路径、用户给的相对路径
 * 参数**都会**带出检出根，于是「其它程序恰好从本检出目录启动」与「本检出上次留下的
 * dev server」在旧判据下无法区分，而这两种情形的正确动作完全相反（前者绝不许杀）。
 * 应用服务多一条**自证**：命令行里有 `scripts/dev.mjs`（`dev`）/ `scripts/start.mjs`
 * （`start`，e2e）这类**本仓库的启动脚本**。这条自证不依赖任何状态文件 ——
 * 那些文件在 `log/` / `run/` 里，是就地重建的历史包袱（见 dev-launcher-session）。
 *
 * ⚠️ **只在「端口由编排器显式指定」时才产出自证结论**：编排器一律用
 * `pnpm dev -p <port>` 拉起 dev server（Next 不认 COMFYAPP_PORT，必须显式传），
 * 显式口上的服务只可能是编排器起的（用户手跑 `pnpm dev` 不经编排器 -- 见 §1.1）。
 * 未指定端口时（缺省解析链上的服务）无法区分「端口被显式指定的实例」与「用了
 * 缺省端口的实例」，自证就不再成立，一律不回收（宁放过，不杀错）。
 *
 * @param {{ requestedPort: number | null,
 *           verdict: { ownership: string, ownPids?: number[], foreignPids?: number[] },
 *           cmdlineOf: (pid: number) => Promise<string>,
 *           isAppProcess: (pid: number, cmdline: string) => boolean }} deps
 * @returns {Promise<{ ownership: string, ownPids: number[], foreignPids: number[], reclaimed: boolean }>}
 */
export async function portOwnershipVerdict({ requestedPort, verdict, cmdlineOf, isAppProcess }) {
  // 空闲：没有占用者要裁。
  if (verdict.ownership === PORT_OWNERSHIP.free) {
    return { ownership: PORT_OWNERSHIP.free, ownPids: [], foreignPids: [], reclaimed: false };
  }
  // 旧判据已经认定属本检出（`pidBelongsToRoot` 命中）：不需要自证，照旧回收。
  if (verdict.ownership === PORT_OWNERSHIP.own) {
    return {
      ownership: PORT_OWNERSHIP.own,
      ownPids: [...(verdict.ownPids ?? [])],
      foreignPids: [],
      reclaimed: true,
    };
  }
  // 剩下的是「别的进程」：只有**显式端口 + 应用服务自证**两条都满足才改判。两条里
  // 缺任何一条都原样返回——`ownPids` 必须留空，它是调用方唯一的回收依据，在这里
  // 顺手塞满就等于给「不回收」的结论配了一份「可以杀」的数据。
  if (!usesExplicitPort(requestedPort)) {
    return { ownership: PORT_OWNERSHIP.foreign, ownPids: [], foreignPids: [...(verdict.foreignPids ?? [])], reclaimed: false };
  }

  const appPids = [];
  const restPids = [];
  for (const pid of verdict.foreignPids ?? []) {
    const cmdline = await cmdlineOf(pid);
    if (cmdline && isAppProcess(pid, cmdline)) appPids.push(pid);
    else restPids.push(pid);
  }
  if (appPids.length === 0) {
    return { ownership: PORT_OWNERSHIP.foreign, ownPids: [], foreignPids: restPids, reclaimed: false };
  }
  return {
    ownership: PORT_OWNERSHIP.own,
    ownPids: appPids,
    foreignPids: restPids,
    reclaimed: true,
  };
}
