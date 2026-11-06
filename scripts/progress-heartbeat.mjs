#!/usr/bin/env node
// progress-heartbeat.mjs — 长命令的「进行中」读数（ISSUE #3144）。
//
// 两套输出、一条入口：本地终端原地刷新一行（`\r`），CI / 非 TTY 按固定间隔逐行打
// 纯文本心跳（带时间戳、可 grep）。一律写 stderr，stdout 保持机器可读输出不变。
//
// 判定：`stderr.isTTY` 为真且 `CI` / `GITHUB_ACTIONS` / `CNB_*` 等未置位 ⇒ 本地模式；
// 否则日志模式。两种模式由 `startProgress()` 驱动，调用方只给 `step()` / `done()`。
//
// 时间戳复用 `launcher-core/log.mjs` 的 `localTimestamp()`（本仓日志时间的唯一形态）；
// 开发机与平台的时区都是 Asia/Shanghai，所以那一行就是北京时间。

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { localTimestamp } from "./launcher-core/log.mjs";

/** 默认心跳间隔：够密（读得出第几秒停住），又不至于把 CI 日志撑爆。 */
export const DEFAULT_INTERVAL_MS = 15_000;

/** @typedef {"terminal" | "log"} ProgressMode */

/** 置位即走日志模式的环境变量（`CNB_` 前缀单独判，平台会塞一批）。 */
const CI_ENV_KEYS = ["CI", "GITHUB_ACTIONS", "GITLAB_CI", "BUILDKITE", "CONTINUOUS_INTEGRATION"];

/**
 * 这个环境是不是「CI / 非交互」—— 是则必须走日志模式。
 *
 * 空串、`0`、`false` 一律不算置位：`CI=false` 在本地调试时是常见写法。
 *
 * @param {Record<string, string | undefined>} env
 * @returns {boolean}
 */
function ciEnvSet(env) {
  for (const key of CI_ENV_KEYS) {
    const value = String(env[key] ?? "")
      .trim()
      .toLowerCase();
    if (value !== "" && value !== "0" && value !== "false") {
      return true;
    }
  }
  return Object.keys(env).some((key) => {
    if (!key.startsWith("CNB_")) {
      return false;
    }
    const value = String(env[key] ?? "")
      .trim()
      .toLowerCase();
    return value !== "" && value !== "0" && value !== "false";
  });
}

/**
 * 选模式：**本地** = stderr 是 TTY 且没有 CI 标记；其余一律按日志处理。
 *
 * @param {{isTTY?: boolean, env?: Record<string, string | undefined>}} [context]
 * @returns {ProgressMode}
 */
export function progressMode(context = {}) {
  const isTTY = context.isTTY ?? Boolean(process.stderr.isTTY);
  const env = context.env ?? /** @type {Record<string, string | undefined>} */ (process.env);
  return isTTY && !ciEnvSet(env) ? "terminal" : "log";
}

/**
 * 秒级读数：心跳只读整秒（毫秒在这里没有意义），超过一分钟换成 `XmYYs`。
 *
 * @param {number} ms
 * @returns {string}
 */
export function formatElapsed(ms) {
  const total = Math.max(0, Math.round(Number(ms) / 1000));
  if (total < 60) {
    return `${total}s`;
  }
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) {
    return `${minutes}m${String(seconds).padStart(2, "0")}s`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h${String(minutes % 60).padStart(2, "0")}m`;
}

/**
 * 一行进度正文（两种模式共用，只是外面套的壳不同）。
 *
 * @param {{label: string, prefix: string, note: string, total: number, index: number, stepLabel: string}} state
 * @param {number} elapsedMs
 * @returns {string}
 */
function lineText(state, elapsedMs) {
  const index = state.total > 0 ? ` (${state.index}/${state.total})` : "";
  const step = state.stepLabel ? ` · ${state.stepLabel}` : "";
  const note = state.note ? `（${state.note}）` : "";
  return `${state.prefix} ${state.label}${index}${step} · 已跑 ${formatElapsed(elapsedMs)}${note}`;
}

/**
 * 日志模式的时间戳前缀（北京时间，`YYYY-MM-DD HH:mm:ss`）。
 *
 * @param {number} ms
 * @returns {string}
 */
function stampOf(ms) {
  return `[${localTimestamp(new Date(ms)).slice(0, 19)}]`;
}

/**
 * 启动一条进度线。
 *
 * 返回的两个动作对调用方是同一套：本地模式 `step()` 立刻重绘同一行，日志模式
 * `step()` 只更新状态、由固定间隔把「当前段 + 已耗时」逐行打出去 —— 节流是
 * 有意的，CI 日志不该被每步一行刷屏，而「没动静」这件事必须能被 15 秒一次的
 * 时间戳证明是「还在跑」。
 *
 * @param {{
 *   label?: string,
 *   total?: number,
 *   intervalMs?: number,
 *   note?: string,
 *   prefix?: string,
 *   mode?: ProgressMode,
 *   isTTY?: boolean,
 *   env?: Record<string, string | undefined>,
 *   write?: (text: string) => void,
 *   now?: () => number,
 * }} [options]
 * @returns {{step: (label?: string) => void, done: (summary?: string) => void, mode: ProgressMode}}
 */
export function startProgress(options = {}) {
  const state = {
    label: String(options.label ?? "progress"),
    prefix: String(options.prefix ?? "[progress]"),
    note: options.note ? String(options.note) : "",
    total: Number(options.total) || 0,
    index: 0,
    stepLabel: "",
  };
  const intervalMs = Math.max(1, Number(options.intervalMs) || DEFAULT_INTERVAL_MS);
  const mode = options.mode ?? progressMode({ isTTY: options.isTTY, env: options.env });
  const write = options.write ?? ((text) => process.stderr.write(text));
  const now = options.now ?? Date.now;
  const startedAt = now();

  let timer = /** @type {ReturnType<typeof setInterval> | null} */ (null);
  let finished = false;
  let lineShown = false;

  const renderTerminal = () => {
    write(`\r${lineText(state, now() - startedAt)}\u001B[K`);
    lineShown = true;
  };

  const renderLog = () => {
    write(`${stampOf(now())} ${lineText(state, now() - startedAt)}\n`);
  };

  const clearLine = () => {
    if (mode === "terminal" && lineShown) {
      write("\r\u001B[K");
      lineShown = false;
    }
  };

  /* 终端模式下进程异常退出（抛出 / `process.exit`）也要把那一行擦掉 ——
   * 残留的刷新行会把后面那截报错顶到同一行上，看起来像丢字。 */
  const onExit = () => {
    clearLine();
  };

  timer = setInterval(() => {
    if (mode === "terminal") {
      renderTerminal();
    } else {
      renderLog();
    }
  }, intervalMs);
  // 进度线不该独自把宿主进程吊住：真正的收场由 `done()` 决定。
  /** @type {{unref?: () => void}} */ (timer).unref?.();
  if (mode === "terminal") {
    process.once("exit", onExit);
    renderTerminal();
  } else {
    write(
      `${stampOf(startedAt)} ${state.prefix} ${state.label} 开始${state.note ? `（${state.note}）` : ""}\n`,
    );
  }

  /**
   * 进入下一段（可带段名）。段序号由本模块累加，调用方只报「现在在哪儿」。
   *
   * @param {string} [label]
   */
  const step = (label) => {
    if (finished) {
      return;
    }
    state.index = state.total > 0 ? Math.min(state.index + 1, state.total) : state.index + 1;
    if (label) {
      state.stepLabel = String(label);
    }
    if (mode === "terminal") {
      renderTerminal();
    }
  };

  /**
   * 收尾：清掉定时器与刷新行，落一行总结。重复调用是空操作。
   *
   * @param {string} [summary] 不给就当「完成 · 共 Ns」
   */
  const done = (summary) => {
    if (finished) {
      return;
    }
    finished = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    process.removeListener("exit", onExit);
    const elapsed = formatElapsed(now() - startedAt);
    const text = String(summary ?? "").trim() || `完成 · 共 ${elapsed}`;
    if (mode === "terminal") {
      clearLine();
      write(`${text}\n`);
    } else {
      write(`${stampOf(now())} ${state.prefix} ${state.label} · ${text}\n`);
    }
  };

  return { step, done, mode };
}

/**
 * 同步调用方的进度线：`premerge-check` / `base-check` 用 `spawnSync` 跑判据，
 * 主线程一阻塞，进程内的 `setInterval` **整段不跳** —— 那种场景下心跳必须来自
 * 另一个进程。这里拉起一个只读状态文件的子进程（stderr 继承同一 fd），父进程
 * 每次 `step()` 原子重写状态文件；子进程每拍读一次，所以段名照样跟得上。
 *
 * 子进程自检父进程还活着（父被 Ctrl-C 掉时不会留下孤儿守着终端）。
 *
 * @param {{
 *   label?: string,
 *   total?: number,
 *   intervalMs?: number,
 *   note?: string,
 *   prefix?: string,
 *   mode?: ProgressMode,
 *   isTTY?: boolean,
 *   env?: Record<string, string | undefined>,
 *   now?: () => number,
 * }} [options]
 * @returns {{step: (label?: string) => void, done: (summary?: string) => void, mode: ProgressMode}}
 */
export function startProgressSync(options = {}) {
  const state = {
    label: String(options.label ?? "progress"),
    prefix: String(options.prefix ?? "[progress]"),
    note: options.note ? String(options.note) : "",
    total: Number(options.total) || 0,
    index: 0,
    stepLabel: "",
  };
  const intervalMs = Math.max(1, Number(options.intervalMs) || DEFAULT_INTERVAL_MS);
  const mode = options.mode ?? progressMode({ isTTY: options.isTTY, env: options.env });
  const now = options.now ?? Date.now;
  const startedAt = now();
  const statePath = path.join(
    os.tmpdir(),
    `comfy-progress-${process.pid}-${startedAt}-${Math.random().toString(36).slice(2, 8)}.json`,
  );

  const flush = () => {
    const snapshot = { ...state, startedAt, mode };
    const tmp = `${statePath}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(snapshot));
      fs.renameSync(tmp, statePath);
    } catch {
      // 进度是观测面，不是判据：落盘失败不该把那一跳带红。
    }
  };
  flush();

  /** @type {ReturnType<typeof spawn> | null} */
  let child = null;
  try {
    child = spawn(
      process.execPath,
      [
        import.meta.filename,
        "--heartbeat-child",
        statePath,
        String(intervalMs),
        String(process.pid),
      ],
      { stdio: ["ignore", "ignore", "inherit"], windowsHide: true },
    );
  } catch {
    child = null; // 拉不起心跳子进程时退化成「只有收尾那一行」，判据照跑。
  }

  let finished = false;
  const stop = () => {
    if (child && !child.killed) {
      try {
        child.kill();
      } catch {
        // 已经收过场：重复 kill 不值一条日志。
      }
    }
    child = null;
    try {
      fs.unlinkSync(statePath);
    } catch {
      // 文件可能被子进程先删/已不存在。
    }
  };
  const onExit = () => {
    stop();
  };
  process.once("exit", onExit);

  /**
   * @param {string} [label]
   */
  const step = (label) => {
    if (finished) {
      return;
    }
    state.index = state.total > 0 ? Math.min(state.index + 1, state.total) : state.index + 1;
    if (label) {
      state.stepLabel = String(label);
    }
    flush();
  };

  /**
   * @param {string} [summary]
   */
  const done = (summary) => {
    if (finished) {
      return;
    }
    finished = true;
    process.removeListener("exit", onExit);
    stop();
    const elapsed = formatElapsed(now() - startedAt);
    const text = String(summary ?? "").trim() || `完成 · 共 ${elapsed}`;
    if (mode === "terminal") {
      process.stderr.write(`\r\u001B[K${text}\n`);
    } else {
      process.stderr.write(`${stampOf(now())} ${state.prefix} ${state.label} · ${text}\n`);
    }
  };

  return { step, done, mode };
}

/**
 * 心跳子进程：每拍读一次父进程写的状态文件，把同一行进度打到继承来的 stderr。
 *
 * @param {string[]} argv `[状态文件, 间隔ms, 父进程pid]`
 */
function runHeartbeatChild(argv) {
  const statePath = String(argv[0] ?? "");
  const intervalMs = Math.max(1, Number(argv[1]) || DEFAULT_INTERVAL_MS);
  const parentPid = Number(argv[2]);
  const parentAlive = () => {
    try {
      process.kill(parentPid, 0);
      return true;
    } catch {
      return false;
    }
  };
  setInterval(() => {
    /** @type {{label: string, prefix: string, note: string, total: number, index: number, stepLabel: string, startedAt: number, mode: ProgressMode}} */
    let snapshot;
    try {
      snapshot = JSON.parse(fs.readFileSync(statePath, "utf8"));
    } catch {
      return; // 父进程还没来得及写第一份：这一拍跳过。
    }
    const elapsed = Date.now() - snapshot.startedAt;
    if (snapshot.mode === "terminal") {
      process.stderr.write(`\r${lineText(snapshot, elapsed)}\u001B[K`);
    } else {
      process.stderr.write(`${stampOf(Date.now())} ${lineText(snapshot, elapsed)}\n`);
    }
    if (!parentAlive()) {
      process.exit(0);
    }
  }, intervalMs);
}

/**
 * CLI：把一个命令包进进度线跑完，退出码原样透出。
 *
 * 用法：`node scripts/progress-heartbeat.mjs --label <段名> [--interval <ms>] [--note <说明>] -- <命令…>`
 * stdio 用 `inherit`，所以子命令自己的输出一个字不变；本模块只在 stderr 上加心跳。
 * 这是 `.githooks` 那种 **sh 环境**也能走同一入口的接缝 —— 不在 shell 里再抄一份模式判定。
 *
 * @param {string[]} argv
 * @returns {Promise<number>} 退出码
 */
async function runCli(argv) {
  const at = argv.indexOf("--");
  if (at === -1 || at === argv.length - 1) {
    process.stderr.write(
      "[progress-heartbeat] 用法：node scripts/progress-heartbeat.mjs --label <段名> -- <命令…>\n",
    );
    return 2;
  }
  const head = argv.slice(0, at);
  /** @param {string} name @returns {string | undefined} */
  const value = (name) => {
    const i = head.indexOf(name);
    return i !== -1 && i + 1 < head.length ? head[i + 1] : undefined;
  };
  const label = value("--label") ?? "命令";
  const note = value("--note");
  const intervalRaw = Number(value("--interval"));
  const command = argv[at + 1];
  const args = argv.slice(at + 2);
  if (!command) {
    process.stderr.write("[progress-heartbeat] `--` 之后没有命令\n");
    return 2;
  }
  const progress = startProgress({
    label,
    note,
    intervalMs: Number.isFinite(intervalRaw) && intervalRaw > 0 ? intervalRaw : DEFAULT_INTERVAL_MS,
  });
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { stdio: "inherit" });
    } catch (error) {
      progress.done(`起不来：${String(error)}`);
      resolve(2);
      return;
    }
    child.on("error", (error) => {
      progress.done(`起不来：${error.message}`);
      resolve(2);
    });
    child.on("close", (code) => {
      progress.done();
      resolve(typeof code === "number" ? code : 1);
    });
  });
}

/* 只在被直接执行时跑 CLI（被 import 时只暴露纯函数给用例）。 */
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const argv = process.argv.slice(2);
  if (argv[0] === "--heartbeat-child") {
    runHeartbeatChild(argv.slice(1));
  } else {
    void runCli(argv).then((code) => process.exit(code));
  }
}
