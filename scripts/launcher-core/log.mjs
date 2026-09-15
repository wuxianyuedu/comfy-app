#!/usr/bin/env node
// 启动链路的日志落盘（跨平台）。
//
// 与 .ps1 版的契约一致（规范 §4 日志布局）：按子系统分区、**每次运行覆盖**
// 当前日志、历史归档到 log/archive/<yyyy-MM>/。不新增固定名的根级日志文件 ——
// 残留进程句柄会锁死固定名文件（历史事故：nextjs-stdout.log 被上一次的挂死
// 进程握住，下次启动重定向直接失败），因此按次命名的日志必须有，且轮转要保留。

import fs from "node:fs";
import path from "node:path";

/** 日志子目录（与 §4 同一布局，禁止新目录）。 */
export const LOG_DIRS = {
  launcher: "launcher",
  nextjs: "nextjs",
  services: "services",
  tools: "tools",
  archive: "archive",
};

/** 日志级别（与 .ps1 版的显示宽度对齐，便于两套日志并排看）。 */
const LEVELS = {
  STEP: "STEP ",
  OK: "OK   ",
  WARN: "WARN ",
  ERROR: "ERROR",
  INFO: "INFO ",
};
/** @typedef {"STEP" | "OK" | "WARN" | "ERROR" | "INFO"} LogLevel */

/** 本地时间戳（YYYY-MM-DD HH:mm:ss.mmm，与 app-runtime 面板可解析的格式一致）。 */
function localTimestamp(at = new Date()) {
  /** @param {number} n @param {number} [width] */
  const p = (n, width = 2) => String(n).padStart(width, "0");
  return (
    `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} ` +
    `${p(at.getHours())}:${p(at.getMinutes())}:${p(at.getSeconds())}.${p(at.getMilliseconds(), 3)}`
  );
}

/** 按次命名的运行戳（文件名安全：去掉冒号与点）。 */
/** @param {Date} [at] @returns {string} */
export function runStamp(at = new Date()) {
  return at.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/**
 * 创建一个日志接收器：stdout（终端可见，带 ANSI 颜色）+ 文件（纯文本双写）。
 *
 * 文件里**不写 ANSI**：非 TTY（CI / 重定向 / 壳内日志面板读取）时颜色控制码
 * 是纯噪声，而面板按文本解析。
 *
 * @param {string} root 检出根
 * @param {{ file?: string, timestampInFileName?: boolean }} [options]
 * @returns {{ file: string, write: (message: string, level?: LogLevel) => void, close: () => void }}
 */
export function createLogSink(root, { file, timestampInFileName = false } = {}) {
  const dir = path.join(root, "log", LOG_DIRS.launcher);
  fs.mkdirSync(dir, { recursive: true });
  const target = file ?? path.join(dir, timestampInFileName ? `dev-launcher-${runStamp()}.log` : "dev-launcher.log");
  try {
    fs.writeFileSync(target, "", "utf8");
  } catch {
    /* 落盘失败不影响启动本身（由失败路径的用户可见出口兜底） */
  }
  return {
    file: target,
    write(message, level = "INFO") {
      const line = `[${localTimestamp()}] [${LEVELS[level] ?? LEVELS.INFO}] ${message}`;
      process.stdout.write(`${line}\n`);
      try {
        fs.appendFileSync(target, `${line}\n`, "utf8");
      } catch {
        /* 见上 */
      }
    },
    close() {
      /* 目前无需释放句柄：追加写每次都开/关文件，避免锁住日志文件 */
    },
  };
}

/** 把本次运行的日志追加进按年月归档的文件。 */
/**
 * @param {string} root
 * @param {string} currentLog
 * @param {Date} [at]
 * @returns {string | null} 归档路径（失败返回 null）
 */
export function archiveRunLog(root, currentLog, at = new Date()) {
  const month = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`;
  const dir = path.join(root, "log", LOG_DIRS.archive, month);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `dev-launcher-${runStamp(at)}.log`);
    fs.appendFileSync(target, fs.readFileSync(currentLog, "utf8"), "utf8");
    return target;
  } catch {
    return null;
  }
}
