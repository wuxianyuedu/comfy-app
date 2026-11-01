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
 * 一次同步子进程的**收场**：三种，不是两种。
 *
 * 为什么必须有这一层（ISSUE #1834）：`spawnSync` 在墙钟预算处砍掉子进程时
 * `status` 是 **null**，而调用方普遍写着 `res.status ?? 1` —— 于是「**测量没发生**」
 * 与「测量结果是红的」在退出码上逐字同形。两种收场的下一动作完全相反：前者去查
 * 预算 / 这台机器上还有谁在跑，后者去修用例。实测现场：全量档（10 分钟量级）
 * 撞上 `runPnpmSync` 的缺省 600_000，harness 打「退出码 信号 / 不记账」，
 * 而看的人只能去猜那是红的哪一种。
 *
 * 判据取**进程自己给的证据**，不取退出码的形状：
 *   · `error` 在 —— 命令压根没起来，或被预算砍（超时时 `error.code` 是 `ETIMEDOUT`）；
 *   · `error` 不在而 `status === null` —— 被信号打死（`signal` 会带着 `SIGTERM` 那一族）。
 *
 * 这一层**不替代**各自的判决（判据照样由调用方自己的退出码 / 指纹定），它只回答
 * 「这一遍到底有没有量到」—— 那是两份调用方都不该各写一遍的判据（§12.12）。
 *
 * @param {{status: number | null, error?: unknown, signal?: NodeJS.Signals | null}} res
 * @returns {"ran" | "aborted"} `aborted` = 没量到（跑不起来 / 被预算或信号砍掉）
 */
export function classifyOutcome(res) {
  if (res.error) {
    return "aborted";
  }
  if (res.status === null) {
    return "aborted";
  }
  /* 有信号、又拿到了退出码：`spawnSync` 只在被信号打死时给 `signal`，那种情况下
   * `status` 本来就是 null（上一条已经收了）。这里不再按 `signal` 二次判 ——
   * 多一条永远走不到的判据就是一条会静默失效的账。 */
  return "ran";
}

/**
 * 「被预算砍」与「跑完了但非零」要长得不一样 —— 一段给调用方直接打的话术。
 *
 * @param {{label: string, timeoutMs: number}} args `label` 是这一档的名字（如「全量单测 + 覆盖率」）
 * @returns {string}
 */
export function abortedAdvice({ label, timeoutMs }) {
  return (
    `${label}的子进程**在墙钟预算处被砍**（${Math.round(timeoutMs / 60_000)} 分钟）—— ` +
    "这是**测量没发生**，不是判据红：\n" +
    "        · 它不该被记进任何一份新鲜度账（账记的是「上一次真跑绿」）；\n" +
    "        · **要修的不是用例** —— 先看这台机器上还有谁在跑，让开再跑一次；\n" +
    "        · **不要**按「判据红」去隔离重跑单份文件，那回答的是另一个问题。\n"
  );
}

/**
 * 同步跑一个命令（`shell: false`，参数按字面量传递，不做引号解析）。
 *
 * @param {string} command @param {string[]} [args]
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number, stdio?: "pipe"|"inherit"|"ignore" }} [options]
 * @returns {{ ok: boolean, stdout: string, stderr: string, status: number | null }}
 *   `stdout` / `stderr` 声明成 `string | undefined`：`spawnSync` 起不来时（ENOENT / 超时）
 *   这两个字段**实测就是 `undefined`**，而 `@types/node` 按 `encoding` 把它们写成 `string`
 *   —— 下面那两处 `?? ""` 是给运行时兜的，不是给编译器兜的（§5.10 第①格）。
 */
export function runSync(
  command,
  args = [],
  { cwd, env, timeoutMs = 600_000, stdio = "pipe" } = {},
) {
  // 回显与真正 spawn 的是同一个 (command, args)：跑起来之前先留一行证据。
  echoCommandLine(command, args);
  const result = /** @type {{ status: number | null, stdout?: string, stderr?: string }} */ (
    spawnSync(command, args, {
      cwd,
      env,
      encoding: "utf8",
      timeout: timeoutMs,
      windowsHide: true,
      shell: false,
      stdio: stdio === "pipe" ? ["ignore", "pipe", "pipe"] : stdio,
    })
  );
  return {
    ok: result.status === 0,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
    status: result.status ?? null,
  };
}

/**
 * 「这一串参数在 PowerShell 宿主那一跳会被切开」的形状 —— **本机逐形状实测**出来的边界：
 *
 * | 参数形态                        | 到达程序时               |
 * | ------------------------------- | ------------------------ |
 * | `--out=C:\dir\a.xml`            | `--out=C` + `\dir\a.xml` |
 * | `--out=C:/dir/a.xml`            | `--out=C` + `/dir/a.xml` |
 * | `--out=./C:\x`                  | `--out=./C` + `\x`       |
 * | `--out=1:\x` / `--out=:\x`      | 同样在冒号处切           |
 * | `C:\dir\a.xml`（裸绝对路径）    | **原样**                 |
 * | `out=C:\dir\a.xml`（无前置破折）| **原样**                 |
 * | `/p=C:\x`                       | **原样**                 |
 * | `a=b:c`                         | **原样**                 |
 * | `--out=C\dir\a.xml`（无冒号）   | **原样**                 |
 *
 * 所以坏的是**一个**交集：以破折号开头、带 `=`、且 `=` 之后还有冒号 —— 切点在第一个冒号。
 * 「参数里有绝对路径」不是判据（裸路径那一行原样到达），按那个写就会拦掉本来能跑的命令。
 *
 * 判据与 {@link runPnpmSync} 里那段注释是同一条机制；导出是为了让用例能对**形状**本身
 * 下判，而不必真起一次宿主（一次宿主要 2–4s 且依赖这台机器上的 PowerShell 版本）。
 */
export const PS_UNSAFE_ARG_RE = /^-.*=[^:]*:/;

/**
 * 给定「调用方给的参数」与「这一跳是否走 PowerShell 宿主」，回那些会被切开的参数。
 *
 * 抽成纯函数是因为这条判据的**两个方向**都得能被执行：宿主形态下 `--x=C:\a.xml` 必须被
 * 挑出来，而同一批参数里的裸绝对路径与非宿主形态下的同一条必须**不被挑出来**（拦错了
 * 就是把一条本来能跑的命令拒掉，那比不拦更坏 —— 上表里后四行是这条边界的反面证据）。
 * 真起一次宿主来做这件事既慢又依赖机器，拿这一格判就够。
 *
 * @param {string[]} args 调用方给 pnpm 的参数（不含宿主自己的前缀）
 * @param {boolean} viaHost 这一跳是否经 `-File <shim>` 的宿主形态
 * @returns {string[]} 会被切开的参数（空 = 安全）
 */
export function hostUnsafeArgs(args, viaHost) {
  return viaHost ? args.filter((a) => PS_UNSAFE_ARG_RE.test(a)) : [];
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
 * `command` 是**已经解析好的形态**（`{command, prefixArgs}`）：给了就照它起，
 * 不再走 `pnpmInvocation()`。它存在是因为「PATH 上没有 pnpm、但盘上找到了它」
 * 这条路（平台的服务账号会话，ISSUE #2281）：那一侧的**发现**由
 * `ci-install-deps.mjs` 的 `ensurePnpmOnPath()` / `pnpmCli()` 做（它真起过 `-v`），
 * 而这里的形态判据按 `PATH × 扩展名` 找候选、看不到 `pnpm-native.exe` 这种名字 ——
 * 再把两者串起来只会得到「判据看得见、安装看不见」。**判据仍然只有一份**：
 * 这里不重新判定，只接受调用方给出的、已经被验证过的形态。
 *
 * @param {string[]} [args] 接在 pnpm 后面的参数
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number,
 *           stdio?: "pipe"|"inherit"|"ignore", name?: string, platform?: NodeJS.Platform,
 *           command?: { command: string, prefixArgs: string[] } | null }} [options]
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
    command = null,
  } = {},
) {
  const invocation = command
    ? {
        command: command.command,
        args: [...command.prefixArgs, ...args],
        viaHost: command.prefixArgs.length > 0,
      }
    : pnpmInvocation(args, { env, platform, name });
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
  /* ⚠️ **走 PowerShell 宿主时，`--x=…` 里不许有冒号**（`--outputFile.junit=C:\…` 那种）。
   * 实测机制（本机逐形状复现，边界表见 {@link PS_UNSAFE_ARG_RE}）：以破折号开头、带 `=`、
   * `=` 之后还有冒号的那一串，到达脚本时是**两个**参数（`--x=C` + `\dir\a.xml`）——
   * 切点在第一个冒号，所以驱动器前缀只是**最常见的那一种触发形状**。裸绝对路径与不带破折号
   * 的 `k=v:` 都原样到达，**不在拦的范围内**（拦了就是拒掉一条能跑的命令）。包引号没用
   * （`-File` 不剥引号，脚本收到的是带引号的字面量）。
   * 后果不是「报错看不懂」而是**语义被换掉**：CI 上那半截残参变成了 vitest 的位置过滤器，
   * 整跑以 `No test files found` 收场，看起来像「这个仓没有用例」（`cnb-2in-1k589j0kp`）。
   *
   * 所以这里**当场拒**（返回「命令没起来」那一族，与 `error` 同一条分流），而不是让
   * 一次坏翻译去冒充一次真失败。`viaHost === false`（直接可执行 / `cmd` 批处理形态）
   * 没有这个切分问题，一律不拦。修的方向：把值换成不含冒号的形式 —— 落点是文件时就是
   * **仓库内的相对路径**（`full-suite-run.mjs` 的 `toTransportSafePath()` 就是这么做的）。 */
  const unsafe = hostUnsafeArgs(args, invocation.viaHost);
  if (unsafe.length > 0) {
    const message =
      `参数里有 \`--x=…:…\` 这种形态，而这一跳走的是 PowerShell 宿主` +
      `（${invocation.command}）：\n${
      unsafe.map((a) => `      · ${a}`).join("\n")
      }\n  PS 的 \`-File\` 会在第一个冒号处把一个参数切成两个（实测），于是被切剩的那半截会` +
      `变成程序的**位置参数** —— 表现是「什么都没匹配上」，不是「路径写错了」。\n` +
      `  出路：值里不要出现冒号（文件落点改成仓库内的相对路径，见 scripts/full-suite-run.mjs` +
      ` 的 toTransportSafePath）。`;
    return {
      ok: false,
      stdout: "",
      stderr: message,
      status: null,
      error: Object.assign(new Error(message), { code: "EINVAL" }),
      command: invocation.command,
      args: invocation.args,
    };
  }
  // 回显的是**形态判据选出来的**那条（宿主 + `-File <shim>` 都带上）：源码里的
  // `pnpm <args>` 与这台机器上真正被执行的命令常常不是同一条（见 pnpmInvocation）。
  echoCommandLine(invocation.command, invocation.args);
  const result = /** @type {{ status: number | null, stdout?: string, stderr?: string,
   *   error?: NodeJS.ErrnoException | null }} */ (
    spawnSync(invocation.command, invocation.args, {
      cwd,
      env,
      encoding: "utf8",
      timeout: timeoutMs,
      windowsHide: true,
      shell: false,
      stdio: stdio === "pipe" ? ["ignore", "pipe", "pipe"] : stdio,
    })
  );
  const error = result.error ?? null;
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
