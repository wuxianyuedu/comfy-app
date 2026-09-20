// 子进程「绑定 / 保活」拉起抽象。
//
// 背景：桌面壳退出路径（dev-launcher.ps1）会对 dev server 进程树执行
// `taskkill /PID <pid> /T /F`（AGENTS 硬规则 3）。/F 走 TerminateProcess，
// 被杀进程没有任何清理机会——Node 的 exit/SIGTERM 钩子与 Rust 侧退出回调
// 在双击退出场景都不保证跑完。因此「应用退出后后台服务是否保活」不能在
// 退出那一刻再决定，只能在 **拉起时** 决定子进程挂载方式：
//
//   - bound（默认）：子进程挂在应用进程树里 → 应用退出被 taskkill 整树带走；
//   - keepAlive：子进程脱离应用进程树成为孤儿 → 应用退出后继续存活，下次复用。
//
// POSIX 用 spawn({detached:true}) + unref()；Windows 经 powershell
// Start-Process 中介拉起——Start-Process 自己立即退出，目标进程挂在已退出
// powershell 之下成为孤儿，树级 taskkill 遍历不到。
//
// 注意：keepAlive 路径没有直连的 stdio 管道（真实子进程是孙进程），调用方
// 应改用「端口/PID 存活探测」判断就绪，不要再依赖子进程的 stdout/stderr 或
// exit 事件。PowerShell 重定向写出的 stdout 是 UTF-16LE，直接按 utf-8 读会
// 变乱码，这里提供 decodePowerShellOutput() 收尾。

import "server-only";
import { spawn, type ChildProcess } from "child_process";
import { closeSync, openSync } from "fs";
import { withTimeoutResult } from "~/lib/with-timeout";

/** 拉起方式：bound = 随应用进程树一起结束；keepAlive = 脱离进程树保活。 */
export type DetachMode = "bound" | "keepAlive";

export type ManagedSpawnResult =
  { child: ChildProcess; error?: never } | { child?: never; error: string };

export interface ManagedSpawnOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** keepAlive 生效时恒忽略；bound 模式下透传给 spawn。 */
  windowsHide?: boolean;
  mode: DetachMode;
  /** spawn 找不到可执行文件时是否静默吞掉（默认 false）。 */
  ignoreMissing?: boolean;
  /** keepAlive 专用：把子进程 stdout / stderr 重定向到这两个按次命名的文件
   *  （脱离进程树的进程没有管道可读，落文件才能保住启动日志）。
   *  Windows 经 Start-Process -RedirectStandardOutput/-Error；POSIX 直接把
   *  文件描述符交给 stdio。两文件必须不同路径。 */
  redirectStdoutFile?: string;
  redirectStderrFile?: string;
}

/** 把单个参数安全地包进 PowerShell 单引号（' 转义为 ''）。 */
export function escapePwshSingle(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * Start-Process -ArgumentList 的单个元素：值里自带双引号。
 * Start-Process 把数组元素用空格拼进子进程命令行时**不会自己加引号**，
 * 含空格的参数必须由元素自带引号才不会被拆分。
 */
function toStartProcessElement(arg: string): string {
  return escapePwshSingle(`"${arg.replace(/"/g, '\\"')}"`);
}

/**
 * Start-Process -ArgumentList 的数组字面量 @('…','…')。
 * 必须整体写成一个数组：裸排多个引号串会被 Windows PowerShell 5.1 当成
 * 多个位置参数导致绑定失败（实测报「找不到接受实际参数 … 的位置形式参数」，
 * Start-Process 完全不执行，目标进程根本不会被拉起）。
 */
export function buildStartProcessArgumentList(args: string[]): string {
  return `@(${args.map(toStartProcessElement).join(",")})`;
}

/**
 * 解码 powershell -RedirectStandardOutput/-Error 写出的输出。
 * PowerShell 重定向文件默认编码 UTF-16LE（带 BOM）；按 utf-8 直接读会得到
 * 每个可见字符间夹 \x00 的乱码。这里剥 BOM 后按 utf16le 解码。
 */
export function decodePowerShellOutput(buf: Buffer): string {
  if (!buf || buf.length === 0) return "";
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.subarray(2).toString("utf16le");
  }
  // 无 BOM 的宽字符串（偶数字节且多为 \x00 交错）也按 utf16le 处理。
  if (buf.length % 2 === 0 && buf.length >= 2) {
    const highBytes = buf.subarray(1, buf.length).filter((b) => b === 0).length;
    if (highBytes >= buf.length / 4) {
      return buf.toString("utf16le");
    }
  }
  return buf.toString("utf8");
}

/** 等 Windows keepAlive 的 powershell 中介退出并收集其 stderr。 */
export interface DetachMediatorOutcome {
  /** 中介退出码；超时未退出为 null（调用方按「未知，继续外部探测」处理）。 */
  code: number | null;
  stderr: string;
}

/**
 * 等 Windows keepAlive 的 powershell 中介退出，带出它的 stderr。
 * Start-Process 参数被拒等拉起失败都发生在中介里（目标进程完全没被拉起、
 * 也没有任何子进程可探测），不读中介就只能靠端口轮询无限等待。
 * 只对 Windows 中介进程使用；POSIX 的 keepAlive child 是真实长驻进程。
 */
export function waitForDetachMediator(
  child: ChildProcess,
  timeoutMs = 5000,
): Promise<DetachMediatorOutcome> {
  const chunks: Buffer[] = [];
  child.stderr?.on("data", (d: Buffer) => chunks.push(d));
  return withTimeoutResult(
    new Promise<DetachMediatorOutcome>((resolve) => {
      child.once("exit", (code) =>
        resolve({
          code: code ?? -1,
          stderr: decodePowerShellOutput(Buffer.concat(chunks)),
        }),
      );
    }),
    timeoutMs,
    /* 超时不是「失败」而是「未知」：调用方按「继续外部探测」处理，
     * 故走 `withTimeoutResult` 给哨兵值（`code: null`），不抛。 */
    { code: null, stderr: decodePowerShellOutput(Buffer.concat(chunks)) },
  );
}

/**
 * 按 mode 拉起一个进程。
 *  - bound：直接 spawn（子进程在应用进程树内，可读 stdout/stderr、可听 exit）。
 *  - keepAlive：
 *      POSIX → spawn({detached:true}) 再 unref()（子进程随 init 收养）；
 *      Windows → powershell Start-Process 中介，目标成为孤儿。
 *    keepAlive 不返回可用的 child（stdio/exit 语义不可用），返回的 child 上
 *    pid 为中介进程 PID 而非目标，调用方不要依赖；就绪与否请用外部探测。
 */
export function spawnManaged(opts: ManagedSpawnOptions): ManagedSpawnResult {
  const { command, args, mode } = opts;
  if (mode === "bound") {
    try {
      const child = spawn(command, args, {
        cwd: opts.cwd,
        env: opts.env,
        windowsHide: opts.windowsHide ?? false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { child };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ── keepAlive ─────────────────────────────────────────────
  if (process.platform !== "win32") {
    try {
      // 有重定向文件时把文件描述符直接交给 stdio（脱离进程树后依然落盘），
      // 父进程侧的副本用完即关。
      let outFd: number | undefined;
      let errFd: number | undefined;
      let stdio: ("ignore" | number)[] = ["ignore", "ignore", "ignore"];
      if (opts.redirectStdoutFile && opts.redirectStderrFile) {
        outFd = openSync(opts.redirectStdoutFile, "w");
        errFd = openSync(opts.redirectStderrFile, "w");
        stdio = ["ignore", outFd, errFd];
      }
      const child = spawn(command, args, {
        cwd: opts.cwd,
        env: opts.env,
        detached: true,
        stdio,
      });
      child.unref();
      if (outFd !== undefined) closeSync(outFd);
      if (errFd !== undefined) closeSync(errFd);
      return { child };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  // Windows keepAlive：powershell Start-Process 中介。stderr 用 pipe 带出
  // （调用方经 waitForDetachMediator 读），拉起被拒时才有可行动的报错。
  const cwdArg = opts.cwd
    ? ` -WorkingDirectory ${escapePwshSingle(opts.cwd)}`
    : "";
  const redirectArg =
    opts.redirectStdoutFile && opts.redirectStderrFile
      ? ` -RedirectStandardOutput ${escapePwshSingle(opts.redirectStdoutFile)}` +
        ` -RedirectStandardError ${escapePwshSingle(opts.redirectStderrFile)}`
      : "";
  const ps =
    `Start-Process -FilePath ${escapePwshSingle(command)}` +
    ` -ArgumentList ${buildStartProcessArgumentList(args)}` +
    ` -WindowStyle Hidden${redirectArg}${cwdArg}; exit`;
  try {
    const mediator = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", ps],
      { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
    );
    mediator.unref();
    // 中介是立即退出的 powershell；返回它仅供调用方持有引用，pid 不代表目标。
    return { child: mediator };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
