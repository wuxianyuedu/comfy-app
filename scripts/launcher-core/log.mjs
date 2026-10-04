#!/usr/bin/env node
// 启动链路的日志落盘（跨平台）。
//
// 布局（规范 §4）：进程**始终**写 log/current/<分区>/，固定路径、不按次命名目录
// —— 退出时由 `run.mjs` 的 archiveCurrent() 把整个 current/ 复制进
// log/runs/<日期>_<时分秒>-<runId>/，再清空内容。所以这里的每一个路径都必须是
// **固定名**（改布局先读 §4，路径常量只在 `run.mjs` 与 `log-paths.ts` 各定义一次）。
//
// 为什么不再按次命名目录：进程只持有一个文件句柄，日志库一旦初始化就不好重配；
// 而退出时把目录改名/搬走，正在写的句柄会指向不存在的路径 —— 早期日志静默丢失。
// 历史事故是反向的同一个问题：固定名的**文件**被上一次的挂死进程握住（nextjs-
// stdout.log），下次启动重定向直接失败 —— 那一处仍然靠**文件名**带 runStamp 解决，
// 见 `dev-launcher.mjs` 的 nextjs-stdout|stderr。

import fs from "node:fs";
import path from "node:path";

/** current/ 下的分区（与 §4 同一布局，禁止新目录）。 */
export const LOG_DIRS = {
  launcher: "launcher",
  nextjs: "nextjs",
  services: "services",
  shell: "shell",
  tools: "tools",
  comfyui: "comfyui",
};

/** log/ 根下的固定名（与 `run.mjs` 的 LOG_LAYOUT 同源；这里只读，不在这里定义）。 */
const CURRENT_DIR = "current";

/** current/ 的绝对路径（日志写方一律从这里往下拼）。 */
/**
 * @param {string} [root]
 * @returns {string}
 */
export function currentRoot(root = process.cwd()) {
  // 字符串字面量与 `run.mjs` 的 LOG_LAYOUT.current 同源；刻意不 import ——
  // `run.mjs` 引本模块（要 localTimestamp），反向引会成环。
  return path.join(root, "log", CURRENT_DIR);
}

/** 某个分区在 current/ 下的绝对路径（不存在则建）。
 * @param {string} name @param {string} [root] @returns {string} */
export function currentDirOf(name, root = process.cwd()) {
  const dir = path.join(currentRoot(root), name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 日志级别（与 .ps1 版的显示宽度对齐，便于两套日志并排看）。 */
const LEVELS = {
  STEP: "STEP ",
  OK: "OK   ",
  WARN: "WARN ",
  ERROR: "ERROR",
  INFO: "INFO ",
};
/** @typedef {"STEP" | "OK" | "WARN" | "ERROR" | "INFO"} LogLevel */

/** 本地时间戳（YYYY-MM-DD HH:mm:ss.mmm，与 app-runtime 面板可解析的格式一致）。
 *  本文件内所有时间形态的唯一来源：日志行内容与按次命名的文件名都由它派生，
 *  因此两侧时钟必然一致（曾出现文件名走 UTC、行内容走本地，同一份日志差 8 小时）。 */
export function localTimestamp(at = new Date()) {
  /** @param {number} n @param {number} [width] */
  const p = (n, width = 2) => String(n).padStart(width, "0");
  return (
    `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} ` +
    `${p(at.getHours())}:${p(at.getMinutes())}:${p(at.getSeconds())}.${p(at.getMilliseconds(), 3)}`
  );
}

/** 按次命名的运行戳（文件名安全：去掉冒号、点与空格）。
 * @param {Date} [at] @returns {string} */
export function runStamp(at = new Date()) {
  return localTimestamp(at).replace(/[:. ]/g, "-").slice(0, 19);
}

/**
 * 创建一个日志接收器：stdout（终端可见，带 ANSI 颜色）+ 文件（纯文本双写）。
 *
 * 文件里**不写 ANSI**：非 TTY（CI / 重定向 / 壳内日志面板读取）时颜色控制码
 * 是纯噪声，而面板按文本解析。
 *
 * 落点是 `log/current/launcher/dev-launcher.log`（**固定名** —— 归档靠整目录
 * 复制，见 `run.mjs`）或调用方指定的绝对路径。`timestampInFileName` 只给
 * 「文件名必须唯一」的那几处用（nextjs stdout/stderr：固定名会被上一次的挂死
 * 进程握住，下次重定向直接 EPERM）。
 *
 * `runId` 给定时每行前缀带上它（`[INFO][a1b2c3][launcher] …`）：目录怎么分只
 * 影响翻文件的手感，**跨运行分析靠这个字段**，别把查询能力绑死在目录结构上。
 *
 * @param {string} root 检出根
 * @param {{ file?: string, timestampInFileName?: boolean, runId?: string | null, tag?: string }} [options]
 * @returns {{ file: string, write: (message: string, level?: LogLevel) => void, close: () => void }}
 */
export function createLogSink(
  root,
  { file, timestampInFileName = false, runId = null, tag = "launcher" } = {},
) {
  const dir = currentDirOf(LOG_DIRS.launcher, root);
  fs.mkdirSync(dir, { recursive: true });
  const target =
    file ??
    path.join(
      dir,
      timestampInFileName
        ? `dev-launcher-${runStamp()}.log`
        : "dev-launcher.log",
    );
  try {
    fs.writeFileSync(target, "", "utf8");
  } catch {
    /* 落盘失败不影响启动本身（由失败路径的用户可见出口兜底） */
  }

  /* 缓冲落盘：编排器日志每条一次 `appendFileSync` 是 open/write/close × 每行，
   * 攒进缓冲、满 16KB / 500ms / 进程 exit 时一次落盘。exit 钩子保证
   * `archiveCurrent`（进程退出前的归档）读到的文件是完整的；
   * 崩溃（kill -9）最多丢一份未满缓冲，对启动日志可接受。 */
  let pending = "";
  /** @type {ReturnType<typeof setTimeout> | null} */
  let flushTimer = null;
  const flush = () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (!pending) return;
    const text = pending;
    pending = "";
    try {
      fs.appendFileSync(target, text, "utf8");
    } catch {
      /* 见上 */
    }
  };
  process.on("exit", flush);

  return {
    file: target,
    write(message, level = "INFO") {
      const name = LEVELS[level] ?? LEVELS.INFO;
      const line = `[${localTimestamp()}] [${name}] ${formatPrefix(runId, tag)}${message}`;
      process.stdout.write(`${line}\n`);
      pending += `${line}\n`;
      if (pending.length >= 16 * 1024) {
        flush();
        return;
      }
      flushTimer ??= setTimeout(() => {
        flushTimer = null;
        flush();
      }, 500);
    },
    close() {
      flush();
    },
  };
}

/** 行内前缀：`[runId][tag]`（runId 缺省时只剩 tag，形态与行首一致）。 */
/**
 * @param {string | null} runId
 * @param {string} tag
 * @returns {string}
 */
function formatPrefix(runId, tag) {
  return runId ? `[${runId}][${tag}] ` : `[${tag}] `;
}

/**
 * 行前缀（导出版）：给**不走 createLogSink** 的写方用。
 *
 * dev-launcher 之外还有几处直接 appendFile（executor-host / standalone-runtime／
 * 壳转发的 stderr），它们不在本模块的 sink 里，但同样必须带 runId —— 否则
 * 「grep runId 一把梭」会在这些通道上失效，而失效是静默的（那些文件里就是少了
 * 一列，没人会想到是前缀没写）。runId 从环境变量 `COMFYAPP_RUN_ID` 取：这些写方
 * 是被 spawn 的独立进程，进程内传一份是最省事又不会漂的做法。
 * @param {string} tag
 * @param {string | null} [runId]
 * @returns {string}
 */
export function linePrefix(tag, runId = process.env.COMFYAPP_RUN_ID ?? null) {
  return formatPrefix(runId, tag);
}
