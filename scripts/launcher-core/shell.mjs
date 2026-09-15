#!/usr/bin/env node
// 子进程拉起（跨平台启动编排用）。
//
// 两条硬约束（AGENTS 硬规则 3、§3.1）：
//   1. POSIX 上必须**自建进程组**（`detached: true`）——否则子进程与编排器同组，
//      回收会命中「与调用者同组禁走组路径」的防自杀判据、退化成单杀 leader，
//      其下的 pnpm / next / turbopack worker 三层全部残留成孤儿。
//   2. 不经 shell 解释器（`shell: false`）：多一层 `cmd /C` / `sh -c` 就多一层
//      中转进程，也让「谁是组长」变得不确定。

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** 是否是 Windows（与 src/lib/kill-process-tree.ts 同一判据）。 */
/**
 * @param {NodeJS.Platform} [platform]
 * @returns {boolean}
 */
export function isWindows(platform = process.platform) {
  return platform === "win32";
}

/**
 * 在 PATH 上解析可执行文件，返回可直接 spawn 的**绝对路径**。
 *
 * 为什么必须自己解析：Windows 上 Node 的 `spawn` 不认 PATHEXT —— `spawn("pnpm")`
 * 直接 ENOENT，必须给 `pnpm.cmd`（或它的绝对路径）；而 Linux 上给 `pnpm.cmd`
 * 又同样 ENOENT。写死平台后缀会在「一种平台能用、另一种静默失败」，因此按
 * PATH × PATHEXT 自己扫一遍。
 *
 * @param {string} name
 * @param {{ env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform }} [options]
 * @returns {string | null}
 */
export function whichCommand(name, { env = process.env, platform = process.platform } = {}) {
  const dirs = String(env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const exts = isWindows(platform)
    ? String(env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        /* 继续找下一个候选 */
      }
    }
  }
  return null;
}

/**
 * 起一个子进程并**单独建进程组**（POSIX）。
 *
 * @param {{ command: string, args?: string[], cwd?: string, env?: NodeJS.ProcessEnv,
 *           stdoutFile?: string, stderrFile?: string, platform?: NodeJS.Platform }} spec
 * @returns {import("node:child_process").ChildProcess}
 */
export function spawnInGroup({
  command,
  args = [],
  cwd = process.cwd(),
  env = process.env,
  stdoutFile,
  stderrFile,
  platform = process.platform,
}) {
  /** @type {import("node:child_process").StdioOptions} */
  let stdio = "inherit";
  if (stdoutFile && stderrFile) {
    const outFd = fs.openSync(stdoutFile, "a");
    const errFd = fs.openSync(stderrFile, "a");
    stdio = ["ignore", outFd, errFd];
    const child = spawn(command, args, {
      cwd,
      env,
      stdio,
      // POSIX：自建进程组（setsid 语义），收尾可整组回收；
      // Windows：detached 会另开控制台窗口且无组语义，回收走 taskkill /T。
      detached: !isWindows(platform),
      windowsHide: true,
      shell: false,
    });
    // 父进程这一侧的文件描述符副本已交给子进程，立刻关掉，
    // 否则「启动器退出后日志文件仍被锁」会伪装成「文件被占用」。
    fs.closeSync(outFd);
    fs.closeSync(errFd);
    return child;
  }
  return spawn(command, args, {
    cwd,
    env,
    stdio,
    detached: !isWindows(platform),
    windowsHide: true,
    shell: false,
  });
}

/**
 * 同步跑一个命令（`shell: false`，参数按字面量传递，不做引号解析）。
 *
 * @param {string} command @param {string[]} [args]
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number, stdio?: "pipe"|"inherit"|"ignore" }} [options]
 * @returns {{ ok: boolean, stdout: string, stderr: string, status: number | null }}
 */
export function runSync(command, args = [], { cwd, env, timeoutMs = 600_000, stdio = "pipe" } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    shell: false,
    stdio: stdio === "pipe" ? ["ignore", "pipe", "pipe"] : stdio,
  });
  return {
    ok: result.status === 0,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
    status: result.status ?? null,
  };
}
