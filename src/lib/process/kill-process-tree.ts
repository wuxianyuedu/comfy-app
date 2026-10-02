// 进程树回收的统一入口（AGENTS 硬规则 3：必须杀整棵树，禁止单杀）。
//
// 背景：Windows 与 POSIX 的「杀整棵树」是两套完全不同的机制，历史上散在
// 各服务生命周期里各写一遍，且 POSIX 分支只剩 `child.kill("SIGTERM")`
// 单杀 —— cmd/pnpm 外壳死了，node/python 子进程残留成孤儿（占端口、锁日志
// 文件），正是硬规则 3 明令禁止的形态。
//
// 平台判据集中在本模块，调用方只表达「我要回收这棵树」，不再各自摸
// `process.platform`：
//   - Windows：`taskkill /PID <pid> /T /F`。/F 走 TerminateProcess，
//     被杀进程没有清理机会——这也是「退出时再决定」不成立的根因
//     （见 process-launch.ts 的 bound / keepAlive 语义）。
//   - POSIX：向**进程组**发信号（`kill(-pgid)`），组内全部成员一并收到。
//
// 「组长是谁」必须由 OS 回答，不能由调用方猜（本模块的核心约定）：
// 曾经的实现按 `detached` 布尔值直接 `kill(-pid)`，隐含假设「我 spawn 出来的
// 子进程就是组长」。但经 `sh -c` / `pnpm exec` 两层中转后，组长往往是更上层
// 的 shell，于是 `kill(-pid)` 抛 ESRCH（该组不存在），静默落到单杀兜底 ——
// 反向验证时甚至看不到任何异常。实测（`pnpm dev` 真实进程树）：
//     进程 2866  组 2838  父 2838  命令：sh -c node scripts/dev.mjs
//     进程 2867  组 2838  父 2866  命令：node scripts/dev.mjs（真正的编排器）
//   组长是 2838、而传入的 leader pid 是 2866 → `kill(-2866)` ESRCH。
// 因此现在**运行时读取目标 pid 的 PGID**（`ps -o pgid=`），并以 PGID 为
// 信号目标：拿到 PGID 就杀进程组，拿不到（ps 缺失 / 目标已退 / 权限不足）
// 才退回按 pid 单杀。`detached` 只作为「ps 也不可用」时的最后提示，不再是
// 主判据。
//
// **必须防「杀到自己」**：bound 模式子进程是普通 spawn，**与调用者同进程组**
// （实测：runner 起 `sh -c` 后两者 PGID 相同）。若不加判据就 `kill(-pgid)`，
// 信号会打向调用者所在的整个进程组 —— 应用会把**自己**杀掉。因此读到的 PGID
// 若等于调用者自身 PGID，一律不走组路径，只按 pid 单杀（回收 leader；此时
// 组的归属是「调用者 + 目标」，不可能把整组当作目标的树）。keepAlive 的
// POSIX 分支是 `spawn({detached:true})`（独立新组），组的归属才是目标自身。
//
// 只用 Node 内建能力：`lsof`、`pstree` 这类外部命令在很多发行版默认不装，
// 依赖它们等于把「回收失败」变成静默失败。POSIX 进程组用 `ps`（POSIX 必备）
// 读 PGID，其余走 `process.kill`。

import { execFile, execFileSync, spawn } from "child_process";

/** 回收目标的描述。pid <= 0 一律视为「没有可回收目标」，直接返回 ok。 */
export interface KillProcessTreeOptions {
  /** 目标进程 PID（通常是 leader）。 */
  pid: number;
  /** 子进程是否以 detached 方式拉起。仅作为「连 ps 都拿不到 PGID」时的
   *  兜底提示：为 true 且 pid 恰好是组长时仍可尝试 `kill(-pid)`。
   *  **不再是主判据** —— 组长归属由 OS 回答（见文件头）。 */
  detached?: boolean;
  /** 是否忽略信号、直接强杀（Windows 映射到 /F，POSIX 映射到 SIGKILL）。 */
  force?: boolean;
  /** 回收模式：`tree`（默认）按 PID 杀整棵树；`image` 按**映像名**杀
   *  （Windows `/IM <name>`、POSIX `pkill -x <name>`）。`image` 用于目标不是
   *  本进程的直接子进程、只拿得到名字的场景（如外部拉起的 Ollama serve）。 */
  mode?: KillProcessTreeMode;
  /** 派发回收命令后是否**等到它真正结束**（默认 false = 只派发）。
   *
   *  服务生命周期不需要等：回收是尽力而为，随后由各自的「探测确认」收口。
   *  但「派发完就退出」的调用方必须等 —— Windows 上 taskkill 是独立进程，
   *  调用方立刻 `process.exit()` 会把还没跑起来的它一起带走，现象是
   *  **打印了命令、退出码 0、目标进程却还在**（命令行入口
   *  `scripts/reap-process.mjs` 正是这种形态）。 */
  wait?: boolean;
}

/** 回收模式（见 `KillProcessTreeOptions.mode`）。 */
export type KillProcessTreeMode = "tree" | "image";

export interface KillProcessTreeResult {
  ok: boolean;
  /** 实际使用的命令 / 信号，便于写进运行日志与断言。 */
  via: string;
}

/** 当前平台是否是 Windows（进程树机制的分叉点）。 */
export function isWindowsPlatform(
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32";
}

/**
 * 读目标 PID 所在进程组的 PGID（POSIX）。返回 null 表示拿不到
 * （`ps` 缺失 / 目标已退 / 输出不可解析）——调用方据此退回单杀兜底。
 *
 * 用 `ps -o pgid= -p <pid>`：`=` 去掉表头，输出只剩一个数字。
 * 这是 POSIX 必备命令，不像 `lsof` / `pstree` 属于发行版可选。
 */
export function readPgid(
  pid: number,
  timeoutMs = 2000,
): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(
      "ps",
      ["-o", "pgid=", "-p", String(pid)],
      { timeout: timeoutMs },
      (err, stdout) => {
        if (err) return resolve(null);
        const pgid = Number.parseInt(stdout.trim().split(/\s+/)[0] ?? "", 10);
        resolve(Number.isInteger(pgid) && pgid > 0 ? pgid : null);
      },
    );
  });
}

/** 调用者自身所在进程组的 PGID（POSIX）。读不到时返回 null。
 *
 *  用途：**防止 `kill(-pgid)` 打到调用者自己**（bound 模式子进程与调用者同组，
 *  见文件头）。读不到时保守起见按「视同为自身组」处理，即禁用组路径 ——
 *  宁可退化成单杀，也不冒把应用整组杀掉的风险。 */
export function readOwnPgid(timeoutMs = 2000): Promise<number | null> {
  return readPgid(process.pid, timeoutMs);
}

/** 同步版 readPgid：给 killProcessTreeSync 用（收尾路径要立刻返回）。 */
function readPgidSync(pid: number): number | null {
  try {
    // 同步路径用 execFileSync 直取：调用方（收尾）要立刻拿到结论。
    const out = execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], {
      timeout: 2000,
      encoding: "utf8",
    });
    const pgid = Number.parseInt(String(out).trim().split(/\s+/)[0] ?? "", 10);
    return Number.isInteger(pgid) && pgid > 0 ? pgid : null;
  } catch {
    return null;
  }
}

/** POSIX 的信号名（force 只换这一格，不换目标）。 */
type PosixSignal = "SIGTERM" | "SIGKILL";

/** POSIX 一次回收的**决策**（不含发信号本身）。 */
interface PosixKillPlan {
  /** 要发的信号（Windows 侧不用它）。 */
  sig: PosixSignal;
  /** 首选目标：负数 = 进程组；null = 不冒组的风险，直接兜底。 */
  primary: { target: number; via: string } | null;
  /** 首选被拒、或本来就不走组时的兜底目标。 */
  fallback: { target: number; via: string };
}

/**
 * 「该向谁发信号」这张表**唯一的定义处**。
 *
 * 抽成纯函数的理由不是好看：异步版（`killPosix`）与同步版（`killProcessTreeSync`）
 * 此前各抄了一遍同样的三段判断，而「自身 PGID 读不到时禁组」这条保守侧只写在
 * `readOwnPgid` 的注释里、两边代码都没实现 —— 于是一处修好、另一处仍是旧的。
 * 判据与发信号分开之后，同步版只剩「拿结论去执行」这一件事，测试也能在**任意平台**
 * 把整张表跑一遍（见 kill-process-tree.posix.test.ts）。
 *
 * `ownPgid === null`（读不到调用者自己的组）时**视同为自身组**：无法证明目标不在
 * 我们组里，就不许发组信号 —— 宁可退化成单杀（可能留孤儿，可再探测补救），
 * 也不冒「应用把自己整组杀掉」这种无法补救的风险。
 */
function planPosixKill(input: {
  pid: number;
  pgid: number | null;
  ownPgid: number | null;
  detached: boolean;
  force: boolean;
}): PosixKillPlan {
  const { pid, pgid, ownPgid, detached, force } = input;
  const sig: PosixSignal = force ? "SIGKILL" : "SIGTERM";
  const sharesCallerGroup =
    pgid !== null && (ownPgid === null || ownPgid === pgid);

  const fallback: PosixKillPlan["fallback"] = sharesCallerGroup
    ? {
        target: pid,
        via: `kill -${sig} ${pid}（单进程兜底·与调用者同组，禁杀组）`,
      }
    : { target: pid, via: `kill -${sig} ${pid}（单进程兜底）` };

  // 1) 向 OS 问「这个 pid 属于哪个进程组」——不猜。
  if (pgid !== null && !sharesCallerGroup) {
    return {
      sig,
      primary: { target: -pgid, via: `kill -${sig} -${pgid}（进程组）` },
      fallback,
    };
  }
  // 2) 拿不到 PGID 时，若调用方声明了 detached（= 它认为 pid 就是组长），仍试一次
  //    `kill(-pid)`：这不是主判据，只是 ps 不可用时的补救。同组时跳过（会误伤自己）。
  if (pgid === null && detached && !sharesCallerGroup) {
    return {
      sig,
      primary: { target: -pid, via: `kill -${sig} -${pid}（进程组·未探测）` },
      fallback,
    };
  }
  // 3) 不冒组的风险：直接单杀 leader（拿不到组 / 与调用者同组时不静默失败）。
  return { sig, primary: null, fallback };
}

/** POSIX 发信号：按 `planPosixKill` 的结论执行 —— 优先进程组，被拒再单杀。
 *
 *  返回 via 描述便于日志与断言。 */
async function killPosix(
  pid: number,
  detached: boolean,
  force: boolean,
  ownPgid: number | null,
): Promise<{ ok: boolean; via: string }> {
  const plan = planPosixKill({
    pid,
    pgid: await readPgid(pid),
    ownPgid,
    detached,
    force,
  });
  return executePosixPlan(plan);
}

/** 把决策变成信号：异步与同步两个入口共用这一段。 */
function executePosixPlan(plan: PosixKillPlan): {
  ok: boolean;
  via: string;
} {
  if (plan.primary) {
    try {
      process.kill(plan.primary.target, plan.sig);
      return { ok: true, via: plan.primary.via };
    } catch {
      // 组已回收 / 权限不足 → 落到按 pid 单杀。
    }
  }
  try {
    process.kill(plan.fallback.target, plan.sig);
    return { ok: true, via: plan.fallback.via };
  } catch {
    return {
      ok: false,
      via: `kill -${plan.sig} ${plan.fallback.target} 失败（目标可能已退出）`,
    };
  }
}

/**
 * 用官方 shell 插件托管的 sidecar 句柄回收整棵进程树（可从 Rust 壳调用）。
 *
 * 「跨平台机制由插件选」这条不该只属于 Rust 一侧：sidecar 的句柄在壳里，
 * 而**回调到本模块**才能让 Windows 与 POSIX 走同一份判据与日志（`via`）。
 * 壳主线程把句柄以原始整数转交过来（`CommandChild` 非 Send，不能跨线程移动）。
 */
export interface KillHostedChildOptions {
  /** 供 shell 插件按 id 寻址的任意整数（壳侧通常传 `CommandChild::pid()`）。 */
  handle: number;
  /** 句柄的真实形态由宿主注入：不同 tauri 版本里 `CommandChild::kill` 的
   *  调用形态不同（`self` / `&mut self`），因此变换由壳侧提供、本模块只负责
   *  调用与记账。 */
  kill: () => void;
}

/** 按**映像名**回收整棵树（目标不是本进程直接子进程、只拿得到名字时用）。
 *
 *  Windows：`taskkill /IM <name> /T /F`；POSIX：`pkill -x <name>`（精确匹配
 *  进程名，避免误伤 `ollama-something`）。
 *
 *  与 `killProcessTree` 同属硬规则 3 的执行面：散在业务路由里各写一遍平台判据
 *  与命令，才是历史「单杀留孤儿」反复出现的原因。
 */
export async function killProcessTreeByImage(
  image: string,
): Promise<KillProcessTreeResult> {
  if (!image.trim()) return { ok: false, via: "无映像名（跳过）" };
  if (isWindowsPlatform()) {
    return { ok: true, via: spawnTaskkill(windowsKillArgs(image, "image")) };
  }
  return await new Promise<KillProcessTreeResult>((resolve) => {
    const child = spawn("pkill", ["-x", image], { stdio: "ignore" });
    // pkill 的退出码 1 = 「没有匹配的进程」，对回收语义来说是成功（目标已经不在）。
    child.on("error", (error) =>
      resolve({ ok: false, via: `pkill -x ${image} 失败（${error.message}）` }),
    );
    child.on("close", (code) =>
      resolve({
        ok: code === 0 || code === 1,
        via: `pkill -x ${image}（exit=${code}）`,
      }),
    );
  });
}

/** Windows 的 taskkill 可执行路径（**唯一出处**，AGENTS 硬规则 3）。
 *
 *  为什么允许覆盖：Windows 上 `taskkill` 是系统自带命令，但启动链路要能被
 *  **自动化测试**驱动（真起进程树、真回收、数残留），而测试不能去动本机无关
 *  进程。`COMFYAPP_TASKKILL` 因此是一个显式的注入口，只在测试里用。
 *
 *  回收失败的后果是孤儿进程继续占端口与日志文件，而调用方以为已经回收，
 *  因此命令原文一律写进 `via`，让运行日志能给出可复现线索。 */
export function windowsTaskkillPath(): string {
  // 空白串等于没给（否则会 spawn 一个空命令名，报错形态与「命令不存在」完全不同）。
  const override = process.env.COMFYAPP_TASKKILL?.trim() ?? "";
  return override.length > 0 ? override : "taskkill";
}

/** 构造 Windows 的回收命令参数（tree = `/PID <pid> /T /F`，image = `/IM <name> /T /F`）。 */
export function windowsKillArgs(
  target: string,
  mode: KillProcessTreeMode,
): string[] {
  return mode === "image"
    ? ["/IM", target, "/T", "/F"]
    : ["/PID", target, "/T", "/F"];
}

/** 发起一次 taskkill（异步派发，不阻塞；调用方随后自行探测确认）。
 *
 *  spawn 会**同步抛错**的情形（目标不是可执行映像，如注入了一个批处理；
 *  或命令名取不到）在这里一并收成 `onDone(false)`：本模块对外承诺「回收失败
 *  不抛错」，让调用方按同一条路径处理（记 via、走自己的探测兜底）。 */
export function spawnTaskkill(
  args: string[],
  onDone?: (ok: boolean) => void,
): string {
  const exe = windowsTaskkillPath();
  const via = `${exe} ${args.join(" ")}`;
  try {
    const child = spawn(exe, args, { stdio: "ignore", windowsHide: true });
    child.on("error", () => onDone?.(false));
    child.on("close", (code) => onDone?.(code === 0));
  } catch {
    onDone?.(false);
  }
  return via;
}

/**
 * 回收一棵进程树。
 *
 * Windows：taskkill /T /F（杀整棵树，硬规则 3 的原始要求）。
 * POSIX：读目标 PGID 后向进程组发信号；拿不到组才单杀兜底。
 *
 * 永不抛错：回收失败是「已经不在」还是「没权限」对调用方不重要——两边
 * 都只能继续走「探测确认 + 提示用户」的兜底路径（各服务生命周期自己那份）。
 */
export async function killProcessTree(
  opts: KillProcessTreeOptions,
): Promise<KillProcessTreeResult> {
  return killProcessTreeWith(opts, { windows: isWindowsPlatform() });
}

/** `killProcessTree` 的可注入版本：平台由调用方给出（默认就是运行时平台）。
 *
 *  为什么要这个入口：Windows 分支在 Linux CI 上不可执行，于是长期只能靠
 *  「断言命令字符串」——而这条判据连「命令真的发出去了吗」都答不了。把平台
 *  变成**显式参数**之后，测试可以注入一个同名的假 taskkill，把 Windows 分支
 *  在本机完整跑一遍（见 kill-process-tree.windows.test.ts）。
 *
 *  `image` 只在 `mode: "image"` 时使用：按映像名回收时目标不是 pid（Windows
 *  看 `/IM <name>`，POSIX 走 `pkill -x <name>`）。
 */
export async function killProcessTreeWith(
  opts: KillProcessTreeOptions,
  {
    windows = isWindowsPlatform(),
    image = "",
  }: { windows?: boolean; image?: string },
): Promise<KillProcessTreeResult> {
  const {
    pid,
    detached = false,
    force = false,
    mode = "tree",
    wait = false,
  } = opts;
  if (!pid || pid <= 0) return { ok: false, via: "无有效 PID（跳过）" };

  if (windows) {
    // taskkill 是异步派发：默认不等它退出，调用方随后用「探测确认」收尾
    // （与同步入口同一语义）。命令原文写进 via，便于运行日志给出可复现线索。
    const target = mode === "image" ? image : String(pid);
    const args = windowsKillArgs(target, mode);
    if (!wait) return { ok: true, via: spawnTaskkill(args) };

    // 等它结束（`wait: true`）：给「派发完立刻 exit」的调用方用 —— 否则那条命令
    // 可能随父进程一起消失，让人以为已经回收。退出码同时写进 via（taskkill 对
    // 「目标已不在」也返回非 0，因此这里只作线索，不据此判定成败）。
    return await new Promise<KillProcessTreeResult>((resolve) => {
      let via = "";
      via = spawnTaskkill(args, (ok) => {
        resolve({ ok, via: `${via}（exit ${ok ? "0" : "非 0"}）` });
      });
    });
  }

  return killPosix(pid, detached, force, await readOwnPgid());
}

/**
 * 同步版本：给「已经拿到子进程句柄、只差发一个信号」的收尾路径用
 * （如 spawn 之后立刻失败要清理）。
 */
export function killProcessTreeSync(
  opts: KillProcessTreeOptions,
): KillProcessTreeResult {
  const { pid, detached = false, force = false, mode = "tree" } = opts;
  if (!pid || pid <= 0) return { ok: false, via: "无有效 PID（跳过）" };
  /* `mode: "image"` 在同步入口上**没法兑现**：这张签名里只有一个 pid，没有映像名。
   * 照字面走下去会得到 `/IM 4321 /T /F`（去杀一个名字恰好叫「4321」的映像），
   * 在 POSIX 侧则静默退化成单杀 leader —— 两边都不是调用方要的那件事。
   * 按映像名回收请走 `killProcessTreeByImage`（异步版从参数里拿名字）。 */
  if (mode === "image") {
    return {
      ok: false,
      via: "同步入口只有 pid，按映像名回收请走 killProcessTreeByImage",
    };
  }

  if (isWindowsPlatform()) {
    // 同步路径不阻塞等 taskkill 退出：Windows 侧命令本身是异步派发的，
    // 调用方后续都会自行探测确认。
    return { ok: true, via: spawnTaskkill(windowsKillArgs(String(pid), mode)) };
  }

  /* 决策与异步版**同一份**（planPosixKill），差别只在读组用同步的 `ps`：
   * 收尾路径要立刻拿到结论，不能等一个 promise。 */
  return executePosixPlan(
    planPosixKill({
      pid,
      pgid: readPgidSync(pid),
      ownPgid: readPgidSync(process.pid),
      detached,
      force,
    }),
  );
}
