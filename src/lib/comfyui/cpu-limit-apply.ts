// ── 把 CPU 档位**施加**到已拉起的 ComfyUI 子进程上（平台副作用层）──────
//
// 判据（该上哪一档、翻成什么命令）在纯模块 `./cpu-limit`；这里只负责
// 「拿着命令去执行、失败不惊动业务」。分开的理由与 `lifecycle-derive`
// / `status` 一族同源：判据要能被逐条断言，副作用只能靠真起进程验。
//
// ## 三条硬约束
//
//   1. **不许拦住启动**：调优先级要在进程起来**之后**做，而启动路径正在
//      等端口就绪。所以施加是 fire-and-forget（不 await 结果），失败只写
//      一行日志 —— 一个可选的性能开关不该有把「启动」拖慢或弄挂的权力。
//   2. **失败必须留痕**：`renice` / `taskset` / PowerShell 都可能在目标
//      机器上不存在或权限不足。静默吞掉的表现是「设置页说限了、实际没限」
//      （硬规则 4 禁止的形态），所以每次失败都写一行可读的原因。
//   3. **不引入平台分叉的第二处**：平台判据只在 `./cpu-limit` 里分，
//      本模块拿到的已经是「要跑什么命令」。
//
// §18.4 三选一：本模块走第三类（纯 Node 宿主）—— 只用 `child_process.execFile`
// 调本机命令，与 `proc-detect` / `gpu-vram` 同族。登记进
// `tests/lib-node-only-declarations.test.ts` 的 `PURE_NODE_HOSTS`。

import { execFile } from "node:child_process";

import { cpuLimitCommands, type resolveCpuLimitMode } from "./cpu-limit";

/** 施加结果的形状：给调用方写日志 / 给用例断言（纯数据，无副作用）。 */
export interface CpuLimitOutcome {
  /** 生效档位（`off` 表示什么都不做）。 */
  mode: ReturnType<typeof resolveCpuLimitMode>;
  /** 每条命令的执行结论（命令不存在 / 权限不足 / 超时都在这里）。 */
  results: Array<{ describe: string; ok: boolean; detail: string }>;
}

/** 一条命令的执行：stderr 也收进来（`renice` 的「权限不足」只在 stderr 上）。 */
function runCommand(
  command: string,
  args: string[],
  timeoutMs = 5000,
): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, windowsHide: true },
      (err, _stdout, stderr) => {
        if (err) {
          /* `err.message` 对 ENOENT（命令不存在）与 EPERM（权限不足）是两句话，
           * 直接带出去 —— 这两条恰好是用户唯一能动手修的情况。 */
          resolve({
            ok: false,
            detail: (stderr || err.message || "未知错误").trim().slice(0, 200),
          });
          return;
        }
        resolve({ ok: true, detail: stderr.trim().slice(0, 200) });
      },
    );
  });
}

/**
 * 按设置给刚拉起的 ComfyUI 进程施加 CPU 档位。
 *
 * 调用点：`lifecycle-launch.ts` 起进程后（bound 拿得到 `child.pid`；
 * keepAlive 拿不到 —— 那条路径按 `main.py` 反查，见调用方）。
 *
 * `exec` 可注入：用例要断言「调了哪条命令」而不真去改自己机器上的优先级
 * （那会污染跑用例的机器，且需要管理员权益才能跑通）。
 */
export async function applyComfyCpuLimit(input: {
  pid: number | null;
  mode: ReturnType<typeof resolveCpuLimitMode>;
  platform?: NodeJS.Platform;
  cpuCount?: number;
  exec?: (
    command: string,
    args: string[],
  ) => Promise<{
    ok: boolean;
    detail: string;
  }>;
}): Promise<CpuLimitOutcome> {
  const mode = input.mode;
  /* pid 拿不到（keepAlive 的孙进程还没出现在进程表里 / 探测失败）→ 不施加，
   * 但**不是错误**：调用方随后由退出监督器按 main.py 反查到 PID，那时再补一次。
   * 这里如实回报空结果，让调用方决定要不要补。 */
  if (mode === "off" || input.pid === null || input.pid <= 0) {
    return { mode, results: [] };
  }
  const { priority, affinity } = cpuLimitCommands({
    mode,
    platform: input.platform ?? process.platform,
    pid: input.pid,
    cpuCount: input.cpuCount ?? 2,
  });
  const executed = input.exec ?? runCommand;
  const results: CpuLimitOutcome["results"] = [];
  /* 逐条串行：两条命令都很快（毫秒级），并行只会让日志里的顺序不确定，
   * 而顺序正是排查时读的唯一线索。 */
  for (const cmd of [priority, affinity]) {
    if (!cmd) continue;
    const r = await executed(cmd.command, cmd.args);
    results.push({ describe: cmd.describe, ok: r.ok, detail: r.detail });
  }
  return { mode, results };
}
