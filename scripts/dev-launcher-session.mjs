#!/usr/bin/env node
// 启动会话的**落盘锚点**（跨平台启动编排与回收共用，单一事实源）。
//
// 为什么要有它：`.ps1` 版编排器的「回收」依赖两层口头约定——Windows 的
// `Job Object`（KILL_ON_JOB_CLOSE）+ `taskkill /T`，POSIX 没有 Job Object，
// 只能靠**自己写下的 PID 文件**在崩溃/被 SIGKILL 后仍能善后。没有这份锚点，
// 孤儿进程会继续占着端口与日志文件（AGENTS 硬规则 3 禁止的形态），而且下次启动
// 根本不知道要回收谁。
//
// 文件布局（与 §4 日志布局同分区，不引入新的固定名日志）：
//   run/launch-status.json —— 进度快照，启动页/壳读它（契约见 §9.4）
//   run/launcher-session.json —— 本次会话：launcher pid + 它拉起的子进程 pid
//   run/launcher-heartbeat.txt —— 心跳毫秒时间戳，用于判「上一位 launcher 还活着吗」
//
// 心跳判据（而不是「PID 是否存在」）的理由：PID 会被系统复用，单看「这个号还
// 在不在」会把自己的另一份实例误判成孤儿。心跳超过阈值没更新 = 上一位已经死了。

import fs from "node:fs";
import path from "node:path";

/**
 * 启动会话的持久化形状（`run/launcher-session.json`）。
 * @typedef {object} LauncherSession
 * @property {number} launcher_pid 持有会话的编排器 PID
 * @property {number[]} child_pids 它拉起的子进程（回收对象）
 * @property {number} app_port 本次使用的端口
 * @property {string} mode web / tauri / prebuilt
 * @property {string} started_at ISO 时间戳
 */

/** 心跳超过该毫秒数未更新，即判定上一位 launcher 已死（孤儿检测阈值）。 */
export const HEARTBEAT_STALE_MS = 30_000;

/** 会话运行时目录（run/，被 .gitignore 忽略）。
 * @param {string} root @returns {string} */
export function runDir(root) {
  return path.join(root, "run");
}

/** @param {string} root @returns {string} */
export function sessionFilePath(root) {
  return path.join(runDir(root), "launcher-session.json");
}

/** @param {string} root @returns {string} */
export function heartbeatFilePath(root) {
  return path.join(runDir(root), "launcher-heartbeat.txt");
}

/** @param {string} root @returns {string} */
export function statusFilePath(root) {
  return path.join(runDir(root), "launch-status.json");
}

/** @param {string} root */
function ensureRunDir(root) {
  try {
    fs.mkdirSync(runDir(root), { recursive: true });
  } catch {
    /* 落盘失败不影响启动本身，由调用方的日志与失败出口兜底 */
  }
}

/** 进程是否还活着（POSIX 用 signal 0 探测，Windows 用 tasklist 由调用方另判）。
 * @param {number} pid @returns {boolean} */
export function isPidAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM：进程存在但没权限发信号 —— 仍算活着。
    return /** @type {NodeJS.ErrnoException} */ (error).code === "EPERM";
  }
}

/** 读上一位 launcher 留下的会话（不存在 / 损坏一律返回 null）。
 * @param {string} root @returns {LauncherSession | null} */
export function readSession(root) {
  try {
    const raw = fs.readFileSync(sessionFilePath(root), "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 写本次会话（原子写：先写临时文件再 rename，避免读到半截 JSON）。
 * @param {string} root @param {LauncherSession} session @returns {string} 写入路径 */
export function writeSession(root, session) {
  ensureRunDir(root);
  const target = sessionFilePath(root);
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(session, null, 2), "utf8");
    fs.renameSync(tmp, target);
  } catch {
    /* 见 ensureRunDir 注释 */
  }
  return target;
}

/** 更新心跳（有它才谈得上「上一位是否已死」）。
 * @param {string} root @param {number} [at] */
export function touchHeartbeat(root, at = Date.now()) {
  ensureRunDir(root);
  try {
    fs.writeFileSync(heartbeatFilePath(root), String(at), "utf8");
  } catch {
    /* 见 ensureRunDir 注释 */
  }
}

/** 读心跳时间戳；缺失 / 损坏返回 null。
 * @param {string} root @returns {number | null} */
export function readHeartbeat(root) {
  try {
    const value = Number.parseInt(
      fs.readFileSync(heartbeatFilePath(root), "utf8").trim(),
      10,
    );
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * 上一位 launcher 是否还在（心跳新鲜 **且** 它的 PID 还活着）。
 *
 * 两条都要：心跳新但进程已死（写完心跳立刻被杀）也算死；进程活但心跳陈旧
 * （卡死 / 被 SIGSTOP）也算死——后者正是需要回收的场景。
 * @param {string} root @param {number} [now] @returns {boolean}
 */
export function isSessionOwnerAlive(root, now = Date.now()) {
  const session = readSession(root);
  if (!session) return false;
  const beat = readHeartbeat(root);
  if (beat === null || now - beat > HEARTBEAT_STALE_MS) return false;
  return isPidAlive(Number(session.launcher_pid));
}

/** 清理会话锚点（正常收尾时调用；崩溃时留下的那份正是下次启动的回收线索）。
 * @param {string} root */
export function clearSession(root) {
  for (const file of [sessionFilePath(root), heartbeatFilePath(root)]) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* 忽略：下一次启动会重新覆盖 */
    }
  }
}
