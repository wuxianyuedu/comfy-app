// OS 进程识别工具：确认某个 main.py 对应的 ComfyUI 进程是否在运行，
// 并定位该进程实际监听的端口。
//
// 场景：ComfyUI 端口被占用时会自动 +1 递增，因此「配置端口有响应」不一定
// 等于「配置路径的实例在运行」——端口上可能跑着别的 ComfyUI。要判断配置
// 的实例是否真的启动了，需要在 OS 层查进程命令行里的 main.py 路径。
//
// Windows 用 PowerShell Get-CimInstance（过滤下推到 WMI）查命令行、用系统自带的
// `netstat -ano -p TCP` 查 PID 的监听端口 —— 两者都不需要额外的第三方二进制，
// 也不用付两次 PowerShell 的进程启动开销；POSIX 用 ps 查命令行、用
// /proc/net/tcp + /proc/<pid>/fd 查监听端口（纯 Node 内建，不依赖 lsof）。
//
// §18.4 三选一：本模块走第三类（纯 Node 宿主），依赖登记在
// `tests/lib-node-only-declarations.test.ts` 的 `PURE_NODE_HOSTS`。
// 只用 `child_process.execFile` + `fs` 做本机进程/端口探测，与 lifecycle /
// runner-state 一样属于「未来 executor host 也要能直接 import」的执行链地基。
import { execFile } from "node:child_process";
import { readdirSync, readlinkSync, readFileSync } from "node:fs";

/** 带「成功与否」标记的 execFile 包装：ok=false 表示命令本身失败（超时 /
 *  无法启动 / 非零退出），此时输出不可信——调用方不得把「没查到」当作
 *  「进程不存在」的证据。 */
async function execFilePTried(
  cmd: string,
  args: string[],
  timeoutMs = 3000,
): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, windowsHide: true },
      (err, stdout) => {
        if (err) resolve({ ok: false, out: "" });
        else resolve({ ok: true, out: stdout.toString() });
      },
    );
  });
}

/**
 * 在 OS 进程列表中查找运行指定 main.py 的进程 PID。
 * 返回 null 表示没有匹配的进程。
 */
export async function findPidForMainPy(mainPy: string): Promise<number | null> {
  return (await findPidForMainPyDetailed(mainPy)).pid;
}

export type PidLookup = {
  /** 命中的进程 PID；未命中为 null。 */
  pid: number | null;
  /** 查询本身失败（超时 / powershell 无法启动等）：结果不可信，
   *  「pid=null」不能作为「进程不存在」的证据。 */
  failed: boolean;
};

/**
 * findPidForMainPy 的区分版：把「确认不存在」（failed=false, pid=null）与
 * 「查询失败」（failed=true）分开。
 *
 * 背景：不带结果的版本把 execFile 错误（含 10s 超时）静默成空串，上层只看到
 * 「没找到进程」。ComfyUI 启动初期机器高负载（CUDA 初始化 / 大量 IO）时
 * PowerShell 查询很容易超时，把正在启动的实例误判成「没有在运行」，
 * probeComfyUi 随之整体跳过 HTTP 探测——设置页状态行显示「未运行」，
 * 但进程和端口都活着（ISSUE #114：点「打开查看」后状态回退）。
 */
export async function findPidForMainPyDetailed(
  mainPy: string,
): Promise<PidLookup> {
  if (!mainPy) return { pid: null, failed: false };
  // 规范化路径用于命令行匹配（Windows 大小写不敏感）
  const normalized = mainPy.replace(/[\\/]+/g, "/").toLowerCase();

  try {
    if (process.platform === "win32") {
      // 用 PowerShell 查询命令行含目标路径的进程。
      // 三个坑（都实测踩过）：
      //  ① 整条命令只能出现单引号 —— execFile argv → PS -Command 的引号转义
      //     链路会把内嵌双引号变形，`-Filter "Name LIKE …"` 恒空匹配。WQL 的
      //     字符串定界符恰恰是双引号，因此过滤条件在运行时用 `[char]34` 拼；
      //  ② 字面反斜杠在引号链路里同样会被吞（'\\' 到 PS 手里剩几个不可控），
      //     Replace 的反斜杠用 [char]92 运行时构造，路径分隔符归一才生效；
      //  ③ **过滤必须下推到 WMI**：不带 `-Filter` 的 `Get-CimInstance
      //     Win32_Process` 会把系统上每个进程的整份属性（含几 KB 的 CommandLine）
      //     拉过来、再让 `Where-Object` 在 PowerShell 侧挑，本机实测 ~2.5s，
      //     冷启动高负载下直接顶到超时。`-Filter` 交给 WMI 仓储层过滤后，
      //     只有命中 `Name LIKE 'python%'` 的少数进程被物化。
      const safeMain = normalized.replace(/'/g, "''");
      const ps =
        `$q=[char]34; ` +
        `Get-CimInstance Win32_Process -Filter ('Name LIKE '+$q+'python%'+$q) -ErrorAction SilentlyContinue | ` +
        `Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Replace([string][char]92,'/').Contains('${safeMain}') } | ` +
        `Select-Object -First 1 -ExpandProperty ProcessId`;
      const { ok, out } = await execFilePTried(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", ps],
        10_000,
      );
      if (!ok) return { pid: null, failed: true };
      const pid = parseInt(out.trim().split(/\r?\n/)[0] ?? "", 10);
      return { pid: isNaN(pid) ? null : pid, failed: false };
    } else {
      // POSIX：ps 输出包含 main.py 的行 → 提取 PID
      const { ok, out } = await execFilePTried("ps", ["-eo", "pid,args"]);
      if (!ok) return { pid: null, failed: true };
      for (const line of out.split("\n")) {
        const ll = line.toLowerCase();
        if (ll.includes(normalized)) {
          const pidStr = line.trim().split(/\s+/)[0];
          const pid = parseInt(pidStr ?? "", 10);
          if (!isNaN(pid)) return { pid, failed: false };
        }
      }
      return { pid: null, failed: false };
    }
  } catch {
    return { pid: null, failed: true };
  }
}

/** 解析 `/proc/net/tcp{,6}` 里 state=0A（LISTEN）的项。
 *  返回 inode → 端口 的映射。行格式依次是：
 *  序号、本端地址、对端地址、状态、队列、计时器、uid、超时、inode。
 *  端口是 `地址:端口` 里冒号后的 4 位十六进制（大端序的端口号）。 */
export function parseProcNetTcpListeners(content: string): Map<string, number> {
  const out = new Map<string, number>();
  const lines = content.split("\n");
  // 第 0 行是表头，跳过。
  for (let i = 1; i < lines.length; i++) {
    const f = (lines[i] ?? "").trim().split(/\s+/);
    if (f.length < 10) continue;
    if (f[3] !== "0A") continue; // 0A = TCP_LISTEN
    const local = f[1] ?? "";
    const colon = local.lastIndexOf(":");
    if (colon < 0) continue;
    const port = Number.parseInt(local.slice(colon + 1), 16);
    const inode = f[9] ?? "";
    if (Number.isInteger(port) && port > 0 && inode) {
      // 同一 inode 只记一次（tcp / tcp6 可能重复）。
      out.set(inode, port);
    }
  }
  return out;
}

/** 收集某 PID 持有的 socket inode（读 /proc/<pid>/fd 的符号链接目标
 *  `socket:[<inode>]`）。拿不到（进程已退 / 权限不足 / 非 Linux）时返回空集。 */
export function socketInodesOfPid(pid: number): Set<string> {
  const set = new Set<string>();
  let entries: string[];
  try {
    entries = readdirSync(`/proc/${pid}/fd`);
  } catch {
    return set;
  }
  for (const fd of entries) {
    try {
      const target = readlinkSync(`/proc/${pid}/fd/${fd}`);
      const m = /^socket:\[(\d+)\]$/.exec(target);
      if (m?.[1]) set.add(m[1]);
    } catch {
      /* 单个 fd 读不到（如已关闭）不影响其余 */
    }
  }
  return set;
}

/** POSIX 监听端口探测：/proc/net/tcp{,6} 的 LISTEN inode ∩ 目标 pid 的 socket
 *  inode。纯 Node 内建，不依赖 lsof / ss / netstat。非 Linux（无 /proc）时
 *  返回 null —— 调用方按「探测不可用」处理。 */
export function findListeningPortViaProc(pid: number): number | null {
  const owned = socketInodesOfPid(pid);
  if (owned.size === 0) return null;
  let listeners: Map<string, number>;
  try {
    // tcp 与 tcp6 都要读：只监听 IPv6 或双栈的进程只在 tcp6 里有记录。
    const tcp = readFileSync("/proc/net/tcp", "utf8");
    const tcp6 = (() => {
      try {
        return readFileSync("/proc/net/tcp6", "utf8");
      } catch {
        return "";
      }
    })();
    listeners = parseProcNetTcpListeners(tcp + "\n" + tcp6);
  } catch {
    return null;
  }
  for (const inode of owned) {
    const port = listeners.get(inode);
    if (port) return port;
  }
  return null;
}

/** 解析 Windows `netstat -ano -p TCP` 的输出，取指定 PID 的 LISTEN 端口。
 *  行形如（空白分列，最后一列是 PID）：
 *  `TCP    127.0.0.1:8188    0.0.0.0:0    LISTENING    12345`
 *  IPv6 行为 `TCP    [::1]:8188   [::]:0  LISTENING  12345` —— 端口分隔符是
 *  **最后一个冒号**，两种形态都靠它切出来。 */
export function parseNetstatListeningPort(
  content: string,
  pid: number,
): number | null {
  for (const line of content.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5) continue;
    if (cols[0] !== "TCP" || cols[3] !== "LISTENING") continue;
    if (parseInt(cols[4] ?? "", 10) !== pid) continue;
    const local = cols[1] ?? "";
    const port = parseInt(local.slice(local.lastIndexOf(":") + 1), 10);
    if (Number.isInteger(port) && port > 0) return port;
  }
  return null;
}

/** 找到指定 PID 正在监听的 TCP 端口号（取第一个 LISTEN 端口）。 */
export async function findPidListeningPort(
  pid: number,
): Promise<number | null> {
  if (!pid || pid <= 0) return null;

  try {
    if (process.platform === "win32") {
      /* `netstat -ano -p TCP` 是系统自带的原生程序（毫秒级），而
       * `Get-NetTCPConnection` 要先起一个 PowerShell（固定 0.5~2s 启动开销）
       * 再枚举**全部** TCP 连接（`-OwningProcess` 不是服务端过滤，实测 ~2.5s）。
       * 状态判定链上这一跳与「找 main.py 的进程表查询」原本是两次串行
       * PowerShell（5s 左右），换掉其中一次即省掉一半（ISSUE #346/#339 的
       * 「打开设置页要等一会才显示运行中」）。
       *
       * 与启动器侧同一口径：`scripts/launcher-core/procs.mjs` 的
       * `listeningPidsOnPort()` 也用 `netstat -ano`，理由相同。 */
      const { ok, out } = await execFilePTried(
        "netstat.exe",
        ["-ano", "-p", "TCP"],
        4000,
      );
      if (!ok) return null;
      return parseNetstatListeningPort(out, pid);
    } else {
      // POSIX：纯 Node 内建读取监听端口，**不依赖 lsof**。
      //
      // 历史实现是 `lsof -Pan -p <pid> -iTCP -sTCP:LISTEN`，但 lsof 在不少
      // 发行版（含本项目 CI 用的精简镜像）默认不装；静默吞错的版本会把 ENOENT
      // 变成空串 → 函数返回 null，正是规范 §9.2 第 3 条禁止的「静默失败」。
      // 文档 §9.1 也曾声称「不依赖 lsof」，但代码实际就是 lsof —— 文档与实现
      // 互相打架（本次一并纠正）。
      //
      // 改用内核接口（零外部依赖）：
      //   ① /proc/net/tcp（+ tcp6）里 state=0A 的项 = LISTEN，字段 2 是
      //      `地址:端口`（端口为 4 位大写十六进制），字段 10 是 socket inode；
      //   ② /proc/<pid>/fd/* 里指向 `socket:[<inode>]` 的链接 → 该 pid 持有的
      //      socket inode 集合；
      //   ③ 两者取交集即「该 pid 正在监听的端口」。
      return findListeningPortViaProc(pid);
    }
  } catch {
    return null;
  }
}
