#!/usr/bin/env node
/**
 * dev-log.mjs — 启动 dev server 并把 stdout/stderr 按次命名落到 log/current/dev/。
 *
 * 为什么不用手敲 `pnpm dev 2>&1 | Tee-Object -FilePath …`：每个开发人员各写一套，
 * 落点不统一（临时目录 / 固定名），而固定名日志文件会被残留句柄锁死（硬规则 4）。
 * 这里把「启动 + 落盘」收成一条 `pnpm dev:log`，日志按次命名 + 轮转，位置固定
 * 在规范 §4 的 log/current/dev/ 分区。
 *
 * 子进程仍由 scripts/dev.mjs → dev-launcher 自己收整棵进程树（硬规则 3），
 * 本模块只负责转发信号与关闭自己的写流，不另起进程管理。
 */
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const LOG_DIR = path.join(ROOT, "log", "current", "dev");

/**
 * 按次命名：同一秒多次启动也不撞名（加 pid）。
 * @param {string} stamp
 * @param {number} pid
 */
export function logFileName(stamp, pid) {
  return `dev-${stamp}-${pid}.log`;
}

/**
 * 去掉超过 KEEP 份的旧日志（按文件名排序，保留最新）。
 * @param {ReadonlyArray<string>} files
 * @param {number} keep
 * @param {(file: string) => void} remove
 */
export function pruneOldLogs(files, keep, remove) {
  const sorted = [...files].sort();
  for (const name of sorted.slice(0, Math.max(0, sorted.length - keep))) {
    remove(path.join(LOG_DIR, name));
  }
}

function main() {
  mkdirSync(LOG_DIR, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const file = path.join(LOG_DIR, logFileName(stamp, process.pid));
  const out = createWriteStream(file, { flags: "a" });
  const child = spawn(process.execPath, [path.join(ROOT, "scripts", "dev.mjs")], {
    cwd: ROOT,
    stdio: ["inherit", "pipe", "pipe"],
    env: process.env,
  });

  /** @param {Buffer | string} chunk @param {NodeJS.WriteStream} stream */
  const forward = (chunk, stream) => {
    out.write(chunk);
    stream.write(chunk);
  };
  child.stdout.on("data", (chunk) => {
    forward(chunk, process.stdout);
  });
  child.stderr.on("data", (chunk) => {
    forward(chunk, process.stderr);
  });

  /** @param {NodeJS.Signals} signal */
  const stop = (signal) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };
  process.on("SIGINT", () => {
    stop("SIGINT");
  });
  process.on("SIGTERM", () => {
    stop("SIGTERM");
  });

  child.on("exit", (code, signal) => {
    out.end(() => {
      process.stdout.write(`[dev:log] 日志：${path.relative(ROOT, file)}\n`);
      process.exit(code ?? (signal ? 1 : 0));
    });
  });
}

/* 只在被直接执行时启动：测试 import 纯函数不能真的拉起 dev server。 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
