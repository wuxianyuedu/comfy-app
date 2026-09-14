// 进程树回收的统一入口（AGENTS 硬规则 3：必须杀整棵树，禁止单杀）。
//
// 背景：Windows 与 POSIX 的「杀整棵树」是两套完全不同的机制，历史上散在
// 各服务生命周期里各写一遍，且 POSIX 分支只剩 `child.kill("SIGTERM")`
// 单杀 —— cmd/pnpm 外壳死了，node/python 子进程残留成孤儿（占端口、锁日志
// 文件），正是硬规则 3 明令禁止的形态。实测复现：给一个含 3 个子进程的
// shell 发 SIGTERM 后，3 个子进程全部残留。
//
// 平台判据集中在本模块，调用方只表达「我要回收这棵树」，不再各自摸
// `process.platform`：
//   - Windows：`taskkill /PID <pid> /T /F`。/F 走 TerminateProcess，
//     被杀进程没有清理机会——这也是「退出时再决定」不成立的根因
//     （见 process-launch.ts 的 bound / keepAlive 语义）。
//   - POSIX：`process.kill(-pid)` 向**进程组**发信号。前提是子进程以
//     `detached: true` 拉起（成为组长），组内全部成员一并收到信号；
//     拿不到组（未 detached / 权限不足 / 组长已退）时按 pid 单杀兜底。
//
//
// 实测对照（`pnpm dev` 真实进程树，6 个进程同属一个进程组）：
//   单杀 leader → 4 个进程残留；`kill -<pgid>`（进程组）→ 0 残留。
// 因此调用方**知道目标是组长时必须传 `detached: true`** —— 传错不报错，
// 只会静默留下孤儿；而调用方的探测确认通常只看端口，孤儿继续占着端口，
// 表现为「点了关闭但没关掉」。
//
// 只用 Node 内建能力：`lsof`、`pstree` 这类外部命令在很多发行版默认不装，
// 依赖它们等于把「回收失败」变成静默失败。

import { exec } from "child_process";

/** 回收目标的描述。pid <= 0 一律视为「没有可回收目标」，直接返回 ok。 */
export interface KillProcessTreeOptions {
  /** 目标进程 PID（通常是 leader）。 */
  pid: number;
  /** 子进程是否以 detached 方式拉起（POSIX 下即进程组组长）。 */
  detached?: boolean;
  /** 是否忽略信号、直接强杀（Windows 映射到 /F，POSIX 映射到 SIGKILL）。 */
  force?: boolean;
}

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
 * 回收一棵进程树。
 *
 * Windows：taskkill /T /F（杀整棵树，硬规则 3 的原始要求）。
 * POSIX：先向进程组发 SIGTERM（`kill(-pid)`），组不存在或抛 ESRCH 时
 *        退回单杀 pid；`force` 用 SIGKILL。
 *
 * 永不抛错：回收失败是「已经不在」还是「没权限」对调用方不重要——两边
 * 都只能继续走「探测确认 + 提示用户」的兜底路径（各服务生命周期自己那份）。
 */
export async function killProcessTree(
  opts: KillProcessTreeOptions,
): Promise<KillProcessTreeResult> {
  const { pid, detached = false, force = false } = opts;
  if (!pid || pid <= 0) return { ok: false, via: "无有效 PID（跳过）" };

  if (isWindowsPlatform()) {
    const cmd = `taskkill /PID ${pid} /T /F`;
    await new Promise<void>((resolve) => {
      exec(cmd, () => resolve());
    });
    return { ok: true, via: cmd };
  }

  // POSIX：优先杀进程组 —— 组内成员都收到信号，不留孤儿。
  // 进程组 ID == 组长 PID；子进程 detached 时它自己就是组长。
  const sig = force ? "SIGKILL" : "SIGTERM";
  if (detached) {
    try {
      process.kill(-pid, sig);
      return { ok: true, via: `kill -${sig} -${pid}（进程组）` };
    } catch {
      // 组不存在（组长已退、组已回收）或权限不足 → 落到单杀兜底。
    }
  }
  try {
    process.kill(pid, sig);
    return { ok: true, via: `kill -${sig} ${pid}（单进程兜底）` };
  } catch {
    return { ok: false, via: `kill -${sig} ${pid} 失败（目标可能已退出）` };
  }
}

/**
 * 同步版本：给「已经拿到子进程句柄、只差发一个信号」的收尾路径用
 * （如 spawn 之后立刻失败要清理）。
 */
export function killProcessTreeSync(
  opts: KillProcessTreeOptions,
): KillProcessTreeResult {
  const { pid, detached = false, force = false } = opts;
  if (!pid || pid <= 0) return { ok: false, via: "无有效 PID（跳过）" };

  if (isWindowsPlatform()) {
    // 同步路径不阻塞等 taskkill 退出：Windows 侧命令本身是异步派发的，
    // 调用方后续都会自行探测确认。
    const cmd = `taskkill /PID ${pid} /T /F`;
    exec(cmd, () => {
      /* 结果由调用方的探测确认兜底 */
    });
    return { ok: true, via: cmd };
  }

  const sig = force ? "SIGKILL" : "SIGTERM";
  if (detached) {
    try {
      process.kill(-pid, sig);
      return { ok: true, via: `kill -${sig} -${pid}（进程组）` };
    } catch {
      /* 落到单杀 */
    }
  }
  try {
    process.kill(pid, sig);
    return { ok: true, via: `kill -${sig} ${pid}（单进程兜底）` };
  } catch {
    return { ok: false, via: `kill -${sig} ${pid} 失败（目标可能已退出）` };
  }
}
