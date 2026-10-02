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

import { echoCommandLine } from "./command-echo.mjs";

/* ── 可执行形态的判据：**不在本文件实现**（唯一实现在 src/lib/process）──────────
 *
 * `isWindows` / `whichCommand` / `executableExts` / `executableKind` /
 * `usableCommand` / `powershellHost` / `commandInvocation` / `pnpmInvocation`
 * 的实现在 `src/lib/process/executable-resolve.ts`。
 *
 * 为什么搬过去（ISSUE #1327）：同一个坑在应用内控制台又踩了一次 ——
 * `src/lib/console/console-run.ts` 直接 `spawn("pnpm")`，在 Windows 上回
 * 「无法启动命令：spawn pnpm ENOENT」，而本文件早已把「怎么起才起得来」判清楚了。
 * 判据只能有一份（硬规则 24 / §12.12），所以下沉到 `src/lib/process`，两侧都
 * import 它；这里只 re-export，既有调用方与用例的导入路径一字不变。
 *
 * **为什么 `.mjs` 能静态 import `.ts`**：Node 24（`.nvmrc` 钉死的版本）默认开启
 * TypeScript 类型擦除，不需要 `tsx`、不需要构建步骤。这是本文件能用上那份唯一
 * 实现的机械前提 —— 换 Node 大版本时先看这里。
 * 被搬走的函数带类型注解（`.mjs` 调用方不受影响，Node 擦掉注解后就是普通 JS）。 */
import {
  clearWhichCommandCache,
  commandInvocation,
  executableExts,
  executableKind,
  isWindows,
  powershellHost,
  pnpmInvocation,
  usableCommand,
  whichCommand,
} from "../../src/lib/process/executable-resolve.ts";

/* 本文件自己也要用其中几个（`spawnInGroup` 的 `isWindows`、`runPnpmSync` 的
 * `pnpmInvocation`），所以上面是**真 import** 而不是 `export … from`
 * （后者不引入本地绑定，用了就是 `ReferenceError: isWindows is not defined`）。
 * 这一行再把它们原样转出去，保持既有调用方与用例的导入路径不变。 */
export {
  clearWhichCommandCache,
  commandInvocation,
  executableExts,
  executableKind,
  isWindows,
  powershellHost,
  pnpmInvocation,
  usableCommand,
  whichCommand,
};

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
  // 起之前先把命令行打出来：长驻服务一旦起来就接管终端（或把输出重定向进日志），
  // 事后没人看得出当时跑的是哪条命令；`>>>` 一行留在编排日志里即可对照时间线。
  echoCommandLine(command, args);
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
export function runSync(
  command,
  args = [],
  { cwd, env, timeoutMs = 600_000, stdio = "pipe" } = {},
) {
  // 回显与真正 spawn 的是同一个 (command, args)：跑起来之前先留一行证据。
  echoCommandLine(command, args);
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

/**
 * 同步跑一条 `pnpm …` 命令，形态由 `pnpmInvocation()` 一处判定。
 *
 * 存在的理由：`pnpmInvocation` 只解决了「**服务**怎么起」（`dev.mjs` / `start.mjs`
 * / `dev-launcher.mjs`），而**门禁与工具脚本**仍在自己拼可执行名 —— `check-format.cjs`
 * 写着 `process.platform === "win32" ? "pnpm.cmd" : "pnpm"`。那条判据在 Windows 上
 * 必错：批处理只有 cmd.exe 会解释，Node 起它直接 `EINVAL`（`res.error.code`），
 * 于是 `pnpm format:ratchet` / `check:all` 在提交门槛上直接崩 ——
 * `node scripts/check-format.cjs` 只打印一句
 * `[format] 无法执行 prettier:spawnSync pnpm.cmd EINVAL` 就 exit 2
 * （ISSUE #638）。同一条坑在 §2.1.1 已解决过三次，这里是第四次，所以不再逐处修，
 * 而是把「同步跑一条 pnpm」也收成**唯一出口**。
 *
 * 契约（与既有 `pnpmInvocation` 一致）：
 *   · 调用方只给 pnpm 后面的参数，不拼可执行名、不按平台分叉；
 *   · 命令压根没起来（`spawnSync` 的 `error` / `status === null`）必须与「跑完但
 *     非零退出」分开报 —— 前者 stderr 通常是空的，只报退出码等于没说原因，
 *     而旧写法 `status ?? 0` 会把它读成**成功**（ISSUE #576 的形态）。
 *
 * @param {string[]} [args] 接在 pnpm 后面的参数
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number,
 *           stdio?: "pipe"|"inherit"|"ignore", name?: string, platform?: NodeJS.Platform }} [options]
 * @returns {{ ok: boolean, stdout: string, stderr: string, status: number | null,
 *             error: NodeJS.ErrnoException | null, command: string, args: string[] }}
 *   `status === null && error` = 命令没起来（判据是 `error`，不是退出码）
 */
export function runPnpmSync(
  args = [],
  {
    cwd,
    env = process.env,
    timeoutMs = 600_000,
    stdio = "pipe",
    name = "pnpm",
    platform = process.platform,
  } = {},
) {
  const invocation = pnpmInvocation(args, { env, platform, name });
  if (!invocation) {
    return {
      ok: false,
      stdout: "",
      stderr:
        `PATH 上找不到可用的 pnpm（未发现 ${name} 的任何可执行形态）。\n` +
        "  自查：pnpm check:toolchain（或 node scripts/check-pnpm-available.mjs）",
      status: null,
      error: Object.assign(new Error(`${name} not found on PATH`), {
        code: "ENOENT",
      }),
      command: name,
      args,
    };
  }
  // 回显的是**形态判据选出来的**那条（宿主 + `-File <shim>` 都带上）：源码里的
  // `pnpm <args>` 与这台机器上真正被执行的命令常常不是同一条（见 pnpmInvocation）。
  echoCommandLine(invocation.command, invocation.args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    shell: false,
    stdio: stdio === "pipe" ? ["ignore", "pipe", "pipe"] : stdio,
  });
  const error = /** @type {NodeJS.ErrnoException | null} */ (
    result.error ?? null
  );
  return {
    ok: !error && result.status === 0,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
    // 「没起来」时 status 为 null：保留 null 而不是 `?? 0`，调用方必须显式分流。
    status: error ? null : (result.status ?? null),
    error,
    command: invocation.command,
    args: invocation.args,
  };
}
