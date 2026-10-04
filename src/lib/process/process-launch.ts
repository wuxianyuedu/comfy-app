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
// POSIX 用 spawn({detached:true}) + unref()；Windows 经**中介进程**拉起：
// 中介立即退出，目标挂在已退出的中介之下成为孤儿，树级 taskkill 遍历不到。
// Windows 的中介有两种形态，优先走前者，判据是壳有没有发布自己的路径
// （`COMFYAPP_SHELL_EXE`）：
//   1. 壳的 CLI 形态（`app.exe --spawn-detached`）——它带
//      `CREATE_BREAKAWAY_FROM_JOB` 创建目标，连**壳的 Job Object** 一起逃掉；
//   2. powershell `Start-Process`——只能做到「孤儿」，逃不出 job。
// 为什么必须逃 job：壳给编排器挂了 `KILL_ON_JOB_CLOSE`，job 成员身份在创建时
// 继承，壳一退出 job 关闭就把被保活的服务一并终止（详见被调用处注释）。
//
// 注意：keepAlive 路径没有直连的 stdio 管道（真实子进程是孙进程），调用方
// 应改用「端口/PID 存活探测」判断就绪，不要再依赖子进程的 stdout/stderr 或
// exit 事件。PowerShell 重定向写出的 stdout 是 UTF-16LE，直接按 utf-8 读会
// 变乱码，这里提供 decodePowerShellOutput() 收尾。

// §18.4 三选一：本模块走第三类（P3 迁移第 1 期·lib 层地基批）。同目录同族的
// `kill-process-tree.ts` 就是这形态的原型；lifecycle-launch 静态引本模块做
// spawn，只有本模块也摘掉 server-only、lifecycle-launch 才能在纯 Node 里加载。
// 依赖：`child_process` / `fs` / `~/lib/core/logger`（经 app-runtime-log #1075
// + log-paths #1074 通链，纯 Node 可加载） / `~/lib/with-timeout`（纯函数）。
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { logger } from "~/lib/core/logger";
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
  /** keepAlive 的两条平台分支的分叉判据。缺省 `process.platform`。
   *
   *  **为什么它是一个入参**：`process.platform` 在 POSIX 宿主上是不可覆盖的
   *  自有属性（实测 descriptor = `{writable:false, configurable:true}`，
   *  值恒为宿主平台），于是「Windows 中介形态」那组判据在 Linux/CI 上**根本
   *  进不到被测分支** —— 实测 `spawn` 收到的是 POSIX 形态
   *  （`{detached:true, stdio:全 ignore}`），而断言写的是 `powershell.exe`，
   *  五条用例恒红；把判据搬到入参之后，两端机器判的是同一个结论。
   *  注入的是**判据的输入**，不是把假信号发给真进程。 */
  platform?: NodeJS.Platform;
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
 * 中介句柄**真正被读到的那两样**（不是整包 `ChildProcess`）。
 *
 * 写成结构类型有两个理由：其一，这个函数确实只订阅 `exit` 事件与 stderr 流，
 * 把 stdin / stdio / send / disconnect 全拖进契约里等于承诺了一个它不用的接口；
 * 其二，用例因此能造出**真形状**的中介句柄，而不是 `as unknown as ChildProcess`
 * —— 那种cast 会把「调用点到底喂了什么」这一格重新变成 tsc 看不见的地方
 *（台账 F13 那一族的成因）。真的 `ChildProcess` 天然满足这个形状。
 */
export interface DetachMediatorHandle {
  once(event: "exit", listener: (code: number | null) => void): unknown;
  stderr?: {
    on(event: "data", listener: (chunk: Buffer) => void): unknown;
  } | null;
}

/**
 * 等 Windows keepAlive 的 powershell 中介退出，带出它的 stderr。
 * Start-Process 参数被拒等拉起失败都发生在中介里（目标进程完全没被拉起、
 * 也没有任何子进程可探测），不读中介就只能靠端口轮询无限等待。
 * 只对 Windows 中介进程使用；POSIX 的 keepAlive child 是真实长驻进程。
 */
export function waitForDetachMediator(
  child: DetachMediatorHandle,
  timeoutMs = 5000,
): Promise<DetachMediatorOutcome> {
  const chunks: Buffer[] = [];
  child.stderr?.on("data", (d: Buffer) => chunks.push(d));
  const readSoFar = (): string => decodePowerShellOutput(Buffer.concat(chunks));
  /* 兜底必须**在超时那一刻**算，不能在这一行算：`withTimeoutResult` 的 fallback
   * 是值不是工厂（见 ~/lib/with-timeout 的口径），把 `{code:null, stderr:readSoFar()}`
   * 直接当实参传进去，读到的就是「调用那一刻」的空 chunks —— 超时那一路
   * 永远回空串。而「中介没退出」恰恰只在超时时发生，被拒的原因也只有这时最需要。 */
  return withTimeoutResult(
    new Promise<DetachMediatorOutcome | null>((resolve) => {
      child.once("exit", (code) =>
        resolve({
          code: code ?? -1,
          stderr: readSoFar(),
        }),
      );
    }),
    timeoutMs,
    null,
  ).then((outcome) => outcome ?? { code: null, stderr: readSoFar() });
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
  if ((opts.platform ?? process.platform) !== "win32") {
    /* fd 声明在 try **外面**：半途失败（第二个文件开不出来、spawn 自己抛错）时
     * 也要把已经开出来的那一个关掉。泄漏的句柄不是「少一个描述符」这么轻 ——
     * 父进程长期持有日志文件，Windows 上表现为文件锁死（轮转与删除都失败），
     * 而调用方拿到 error 之后并不知道自己还占着它。 */
    let outFd: number | undefined;
    let errFd: number | undefined;
    const closeOpenedFds = (): void => {
      for (const fd of [outFd, errFd]) {
        if (fd === undefined) continue;
        try {
          closeSync(fd);
        } catch {
          /* 关不掉不改变结论：子进程已经拿到自己的副本，这里是父侧的清理，
           * 把它当失败上报只会让调用方误判「这次拉起没发生」。 */
        }
      }
    };
    try {
      // 有重定向文件时把文件描述符直接交给 stdio（脱离进程树后依然落盘），
      // 父进程侧的副本用完即关。
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
      closeOpenedFds();
      return { child };
    } catch (e) {
      closeOpenedFds();
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  /* Windows keepAlive：**优先**走壳的 CLI 形态中介（`app.exe --spawn-detached`）。
   *
   * 为什么不能只靠 Start-Process：它确实把目标变成了孤儿（树级 `taskkill /T`
   * 遍历不到），但**孤儿仍在壳的 Job Object 里** —— job 成员身份在进程创建时继承，
   * 而壳给编排器挂了 `KILL_ON_JOB_CLOSE`。壳一退出 job 关闭，被保活的服务照样
   * 当场终止，「应用退出后不关闭」名存实亡。逃出 job 需要创建时带
   * `CREATE_BREAKAWAY_FROM_JOB`（父 job 已允许，见 shell_launch.rs 的
   * `JOB_OBJECT_LIMIT_BREAKAWAY_OK`），而 `child_process.spawn` 与 `Start-Process`
   * 都传不了这个创建标志 —— 只有壳自己（Rust）能，于是壳多出一个 CLI 形态
   * （见 src-tauri/src/detached_spawn.rs）。
   *
   * 壳把自身路径经 `COMFYAPP_SHELL_EXE` 发布给下游（编排器 → dev server）；
   * 拿不到时（例如 `pnpm tauri dev`：那时没有 job 要逃）退回下面的中介。
   * 两侧契约一致：中介立即退出，退出码非 0 表示拉起被拒，stderr 带原因。 */
  const shellExe = process.env.COMFYAPP_SHELL_EXE?.trim();
  if (shellExe) {
    const cliArgs = [
      "--spawn-detached",
      "--cmd",
      command,
      ...args.flatMap((a) => ["--arg", a]),
    ];
    if (opts.cwd) cliArgs.push("--cwd", opts.cwd);
    if (opts.redirectStdoutFile && opts.redirectStderrFile) {
      cliArgs.push(
        "--out",
        opts.redirectStdoutFile,
        "--err",
        opts.redirectStderrFile,
      );
    }
    try {
      // 不传 env：与下面的 powershell 中介同语义（继承本进程环境，目标再由它继承）。
      const mediator = spawn(shellExe, cliArgs, {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
      });
      mediator.unref();
      return { child: mediator };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  /* 拿不到壳路径 → 只能退回 Start-Process：它只把目标变成孤儿，**逃不出壳的
   * Job Object**，壳一退出 job 关闭就会把这个「保活」进程连杀，等于保活失效。
   *
   * 这条回退设计上是给「那时根本没有 job」的场景用的（如 `pnpm tauri dev`）；
   * 若在**打包运行**里走到这里，就是壳没有发布 COMFYAPP_SHELL_EXE 的征兆。
   * 必须留一条可见的警告 —— 否则用户只看到「关了应用 ComfyUI 也没了」，
   * 日志里却查不到任何原因。 */
  logger.warn(
    "[keepAlive] 未拿到 COMFYAPP_SHELL_EXE，退回 powershell Start-Process 中介：" +
      "目标只能成为孤儿、逃不出壳的 Job Object，本次保活不保证跨应用退出" +
      "（若这是打包运行，请检查壳是否发布了自身路径）",
  );

  // 退回：powershell Start-Process 孤儿中介。stderr 用 pipe 带出
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
