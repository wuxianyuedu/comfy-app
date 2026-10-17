#!/usr/bin/env node
/**
 * `ci-sh-exit.mjs` — POSIX 侧的外壳：起一条命令、**把输出边到边转发**、把退出码
 * 原样（含 `128 + 信号号`）转出去（ISSUE #1993）。
 *
 * ## 它为什么存在，以及在它之外还该有什么
 *
 * Windows 那条链上每个 stage 都包在 `ci-cp936-exit.mjs` 外面（ISSUE #1977），职责是三件：
 * 起命令、把子进程的输出**转成平台那一跳识得的编码**、把退出码原样转出去。
 * POSIX 上第一件与第三件同样需要，第二件**不存在**（UTF-8 就是那一跳识得的编码，
 * 平台抓取按宿主 ANSI 代码页解码这件事只发生在中文 Windows 上）。
 *
 * 于是本文件与它**不是孪生对**：这里刻意不转码。而第二件换成另一件只有长跑才暴露的事
 * —— **边到边发**：`ci-cp936-exit.mjs` 第六次上平台踩的那个坑（`close` 在被 kill 的
 * 进程上永不到来 ⇒ 36 分钟 stage 零行日志）与编码无关，**POSIX 上同样成立**，
 * 所以这里从第一行就按行发，而不是攒到结束。
 *
 * ## 退出码：`128 + 信号号`
 *
 * 一个被信号打死的子进程在 `close` 事件里给的是 `code === null`。把 `null` 当成 0
 * 是这类外壳最坏的失效形态 —— 「没跑完」被报成「通过了」，而且没有任何东西会说。
 * 所以按 shell 的惯例折成 `128 + signalNumber`（`SIGTERM` → 143、`SIGKILL` → 137，
 * 两者都是非零，流水线照旧红）。拿不到信号号时退 1（**不是** 0）。
 *
 * ## 形态
 *
 *   node scripts/ci-sh-exit.mjs -- <命令> [参数...]
 *
 * ## 边界（刻意不做的事）
 *
 *   · **不解释命令行**：token 原样递给 `spawn`（`shell: false`）。子命令（`pnpm run build`）
 *     由它自己的宿主解释，本文件不插第二层。
 *   · **解析口与 Windows 侧同一份**（`resolveShellInvocation` 背后的
 *     `resolveCommandInvocation`）：`node_modules/.bin/tsc` 在新检出的 POSIX 上是符号
 *     链接、`pnpm` 是 PATH 上的名字，两者都要落到同一个判据上 —— 自己写一个
 *     「POSIX 上直接 spawn 就行」就是把那条唯一出口抄了第二遍（§2.1.1 / §12.18）。
 *   · **不加 CP936 那半件**：这里转码会把 UTF-8 变成乱码，两件事反着做。
 */
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/* 解析口：与 `ci-cp936-exit.mjs` **同一份**（说明符带 `.ts` 是硬要求 —— `.mjs` 静态
 * import 一份 `.ts` 时 Node 的 ESM 解析器不补扩展名，ISSUE #1961 实测过这个形态）。 */
import { resolveCommandInvocation } from "../src/lib/process/executable-resolve.ts";

/** 信号名 → 退出码偏移（`128 + n` 是 shell 的惯例）。查不到时按 1 处理。 */
const SIGNAL_NUMBER = /** @type {Record<string, number>} */ ({
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGILL: 4,
  SIGABRT: 6,
  SIGFPE: 8,
  SIGKILL: 9,
  SIGSEGV: 11,
  SIGPIPE: 13,
  SIGALRM: 14,
  SIGTERM: 15,
});
/** 拿不到信号号时的退出码 —— **不是 0**：拿不到测量不等于测量结果是绿的。 */
export const UNKNOWN_SIGNAL_EXIT = 1;

/**
 * 把 `close` 事件的两个值折成一个退出码。
 *
 * @param {{code: number | null, signal: NodeJS.Signals | string | null}} state
 * @returns {number}
 */
export function exitCodeFrom({ code, signal }) {
  if (typeof code === "number") return code;
  if (!signal) return UNKNOWN_SIGNAL_EXIT;
  return 128 + (SIGNAL_NUMBER[signal] ?? 0) || UNKNOWN_SIGNAL_EXIT;
}

/**
 * 按行切一块流数据（残留留到下一块）—— 与 `ci-cp936-exit.mjs` 的
 * `splitStreamChunk()` 同一件事，但这里**不需要**保留多字节安全那半件：
 * 不转码，所以块边界落在字符中间也不会变成乱码字节。
 *
 * @param {string} carry
 * @param {string} chunk
 * @returns {{text: string, carry: string}}
 */
export function splitLines(carry, chunk) {
  const all = `${carry}${chunk}`;
  const at = all.lastIndexOf("\n");
  if (at < 0) return { text: "", carry: all };
  return { text: all.slice(0, at + 1), carry: all.slice(at + 1) };
}

/**
 * 从 argv 里取出 `--` 之后的 token（`--` 之前的一律忽略：本文件只有一个用法）。
 *
 * @param {string[]} argv
 * @returns {{command: string, args: string[], usage: string}}
 */
export function parseInvocation(argv) {
  const at = argv.indexOf("--");
  if (at < 0) {
    return {
      command: "",
      args: [],
      usage:
        "[sh-exit] 用法：node scripts/ci-sh-exit.mjs -- <命令> [参数...]\n" +
        "  例：node scripts/ci-sh-exit.mjs -- node scripts/check-file-structure.cjs\n" +
        "  它起那条命令、把输出边到边转发、把退出码（含 128+信号号）原样转出去",
    };
  }
  const rest = argv.slice(at + 1);
  return {
    command: rest[0] ?? "",
    args: rest.slice(1),
    usage: "",
  };
}

/**
 * 起的命令在 PATH 上找不到时的退出码（shell 惯例；与 `ci-cp936-exit.mjs` 同值）。
 */
export const NOT_FOUND_EXIT = 127;

/**
 * 起命令、转发输出、返回退出码。
 *
 * @param {string[]} argv
 * @param {{spawnProc?: typeof spawn,
 *          resolve?: (cmd: string, args: string[]) => {command: string, args: string[], resolved: boolean},
 *          out?: (chunk: string) => void}} [ports]
 * @returns {Promise<number>}
 */
/** @param {string[]} argv */
export function runWithShExit(
  /** @type {string[]} */ argv,
  {
    spawnProc = spawn,
    resolve = resolveCommandInvocation,
    out,
  } = /** @type {{
    spawnProc?: typeof spawn,
    resolve?: (cmd: string, args: string[]) => {command: string, args: string[], resolved: boolean},
    out?: (chunk: string) => void,
  }} */ ({}),
) {
  const { command, args, usage } = parseInvocation(argv);
  const emit = out ?? ((/** @type {string} */ chunk) => process.stdout.write(chunk));
  if (!command) {
    emit(`${usage}\n`);
    return Promise.resolve(2);
  }
  const invocation = resolve(command, args);
  if (
    !Array.isArray(invocation?.args) ||
    typeof invocation?.resolved !== "boolean" ||
    !invocation?.command
  ) {
    throw new TypeError(
      "[sh-exit] 命令解析口没有交出 {command, args, resolved} —— " +
        "它该是 resolveCommandInvocation 或一个同形状的注入面",
    );
  }
  if (!invocation.resolved) {
    emit(
      `[sh-exit] PATH 上找不到这条命令：${command} —— ` +
        "已按 PATH 找过，它不在盘上（`pnpm install` 了没有？）\n",
    );
    return Promise.resolve(NOT_FOUND_EXIT);
  }
  return new Promise((settle) => {
    const child = spawnProc(invocation.command, invocation.args, {
      stdio: ["inherit", "pipe", "pipe"],
      windowsHide: true,
    });
    let carry = "";
    const flush = (/** @type {string} */ text) => {
      if (text) emit(text);
    };
    for (const stream of [child.stdout, child.stderr]) {
      stream?.setEncoding?.("utf8");
      stream?.on("data", (/** @type {string | Buffer} */ d) => {
        const split = splitLines(carry, String(d));
        carry = split.carry;
        flush(split.text);
      });
    }
    child.on("error", (/** @type {NodeJS.ErrnoException} */ err) => {
      emit(
        `[sh-exit] 起不了这条命令：${command}（失败码 ${err?.code ?? "未知"}，` +
          `当前目录 ${process.cwd()}）\n`,
      );
      settle(NOT_FOUND_EXIT);
    });
    child.on("close", (/** @type {number | null} */ code, /** @type {NodeJS.Signals | null} */ signal) => {
      flush(carry);
      carry = "";
      settle(exitCodeFrom({ code, signal }));
    });
  });
}

/* 判「是不是被直接运行」用两侧都过 `path.resolve` 的比较（拼 `file://${argv[1]}` 在
 * Windows 上恒不相等，那段就一次都不跑 —— `tests/script-main-guard.test.ts` 判这一形态）。 */
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  process.exit(await runWithShExit(process.argv.slice(2)));
}
