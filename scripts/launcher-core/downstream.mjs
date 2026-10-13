/**
 * 下游收尾：依赖补装、起 dev server / executor host、下游退出后的结论（ISSUE #1811）。
 *
 * 从 `dev-launcher.mjs` 搬出来的这一层是「启动之后、用户看到界面之前」的那一段：
 * · `syncDependencies` —— lockfile 漂移时的补装（**看复核结果、不看退出码**，§9.2 第 4 条）；
 * · `spawnDevServer` / `spawnExecutorHost` —— 两个常驻子进程的拉起；
 * · `concludeDownstreamExit` —— 下游退出后判「是正常关窗还是要报错」。
 *
 * **依赖靠注入**：`ctx.log`、`ctx.spawned`（子进程账本）、`ctx.root`、
 * `ctx.shutdown`（收尾入口，住在主文件）。
 */
import process from "node:process";

import { SKIP_SCHEMA_SYNC_ENV } from "../db-schema-state.mjs";
import { maybeSpawnExecutorHost } from "./executor-host-spawn.mjs";
import {
  commandInvocation,
  pnpmInvocation,
  runSync,
  spawnInGroup,
  whichCommand,
} from "./shell.mjs";
import { lockfileDrift, verifyInstall } from "./worktree.mjs";
import { runningAppInstances } from "./port-reap.mjs";
import { writeLaunchStatus } from "./orchestrator.mjs";
import { writeAppServiceExit } from "../app-service-exit.mjs";
import {
  describeDownstreamExit,
  downstreamExitKind,
  readShellMarkers,
} from "./downstream-exit.mjs";
import { renderDriftReport } from "../lockfile/render-lock-diff.mjs";

//
// 「装了」与「装的是不是当前 lockfile」是两件事：拉了更新（新依赖进 lockfile）后
// 没重装时，`.modules.yaml` 与 `.bin/next` 都在 → 被当成「已就绪」跳过安装，而
// 真正的新依赖缺席 —— 用户看到的是一堆「Cannot find module」，而日志里没有任何
// 「依赖没装」的线索（重新双击入口还会显示「依赖已就绪」）。
//
// 补装用 `pnpm install`（不是 `--frozen-lockfile`：漂移的正是「lockfile 比
// node_modules 新」，冻结只会立刻失败）。**安装结果看复核，不看退出码**
// （§9.2 第 4 条：`drizzle-kit push` 那条「报错 + exit 0 + 留空库」是同一族的坑）：
// 复核走 `verifyInstall()`（`.modules.yaml` + 关键依赖目录 + lockfile 一致），
// 判据是「目标状态有没有达成」，不是进程怎么退的。

/** 补装依赖（仅当 lockfile 漂移时）；返回 null = 无需补装或补装成功。
 *
 *  @param {string} root
 *  @param {{ log: (m: string, l?: import("./log.mjs").LogLevel) => void }} ctx 日志出口
 *  @param {string} root 检出根
 *  @param {{ status?: ((phase: string, progress: number, message: string, extra?: object) => void) | null,
 *            staleShell?: string | null }} [deps]
 *  @returns {Promise<string | null>} 失败原因（null = 通过）
 */
export async function syncDependencies(ctx, root, deps = {}) {
  const status = deps.status ?? null;
  const staleShell = deps.staleShell ?? null;
  const drift = lockfileDrift(root);
  if (drift.state === "fresh") return null;
  if (drift.state === "no-lockfile") {
    return "找不到仓库 pnpm-lock.yaml —— 检出可能不完整，请重新克隆后再试。";
  }
  /* AGENTS 硬规则 9 的现场拦截：**在决定要装之前**问一句「本检出的应用服务是不是
   * 正在跑」。顺序就是这条判据存在的理由 —— 编排主流程里端口检查（`reconcilePort`）
   * 排在补装**之后**几十行，而更早的 `reapStaleSession` 在「上一位 launcher 还活着」
   * 时刻意什么都不做，所以今天确实存在一条「实例活着 → 直接 pnpm install」的路。
   * 后果不是一句警告：better-sqlite3 那类原生模块（`.node`）被活进程锁住时 install 以
   * EPERM 失败，而它会连带后续每一条 pnpm 命令一起失败 —— 表现是「这个仓库忽然装不上
   * 也起不来」，排查方向还被指错（按 §13.6.3 会被读成「本机跑不了门禁」）。
   * 判据按**归属**而不是按端口有没有人：隔壁检出占着同一个端口不会锁本检出的
   * `node_modules`，拿「端口被占」当拦截条件会在多检出并行下天天误拦。 */
  const live = await runningAppInstances(root);
  if (live.running) {
    return (
      `本检出的应用服务正在运行（PID ${live.pids.join(", ") || "见 run/launcher-session.json"}），` +
      "已停止补装依赖。\n" +
      "dev server 在跑时执行 pnpm install，原生模块（`.node`）会被进程锁住而 EPERM 连锁失败，" +
      "并拖垮后续每一条 pnpm 命令（AGENTS 硬规则 9）。\n" +
      "出口：先关掉本检出的应用窗口（或停掉正在跑的 `pnpm dev`），再重新启动 —— " +
      "依赖补装会在下一次启动时自动接着做。"
    );
  }
  const firstInstall = drift.state === "no-install";
  ctx.log(
    firstInstall
      ? "node_modules 尚未完整安装，正在执行 pnpm install（首次较久，请勿关闭窗口）…"
      : "检测到依赖与 lockfile 不一致（拉了更新后未重装），正在补装依赖…",
    "WARN",
  );
  if (drift.diff) {
    // 「不一致」只说了一半，用户接着要问的正是「哪儿不一致」（ISSUE #550）。
    ctx.log(
      "依赖与 lockfile 的不一致明细（仓库 lockfile 对比最近一次安装用的那份）：",
      "INFO",
    );
    for (const line of renderDriftReport(drift.diff, { maxPerSection: 8 }))
      ctx.log(line, "INFO");
  }
  status?.("deps-install", 0.03, "正在补装依赖（pnpm install）…", {
    staleShell,
  });

  const invocation = pnpmInvocation(["install"]);
  if (!invocation) {
    return "pnpm 不在 PATH 上，无法补装依赖（先执行 corepack enable）。";
  }
  const result = runSync(invocation.command, invocation.args, {
    cwd: root,
    timeoutMs: 30 * 60_000,
  });
  const tail = (result.stdout + result.stderr)
    .trim()
    .split("\n")
    .slice(-15)
    .join("\n");
  if (tail)
    ctx.log(`pnpm install 输出尾部：\n${tail}`, result.ok ? "INFO" : "ERROR");

  const verdict = verifyInstall(root);
  if (!verdict.ok) {
    return (
      `依赖补装后仍未就绪：${verdict.reason}\n` +
      "本次安装的输出可在上方日志里查看；修复后重新启动即可（不要只重试不改动）。"
    );
  }
  ctx.log(
    "依赖补装完成并已复核（.modules.yaml + 关键依赖 + lockfile 一致）",
    "OK",
  );
  return null;
}

/** 起 dev server：`pnpm dev -p <port> -H <host>`（端口由 app-port.mjs 解析后显式传入，
 *  不靠环境变量兜底 —— 裸 `next dev` 会落 Next 默认 3000，与 .env / 壳 / e2e 对不上）。 */
/**
 * 起子进程并把它接到日志文件。
 * @param {number} port 应用端口
 * @param {{ spawned: import("node:child_process").ChildProcess[], root: string }} ctx 子进程账本与检出根
 * @param {number} port 应用端口
 * @param {string} host 绑定主机
 * @param {string} outFile stdout 落盘路径
 * @param {string} errFile stderr 落盘路径
 * @param {Record<string, string>} [extraEnv] 追加环境变量
 */
export function spawnDevServer(
  ctx,
  port,
  host,
  outFile,
  errFile,
  extraEnv = {},
) {
  // 起服务用的是**门禁验过的那个命令形态**（`commandInvocation`）：
  // `pnpm` 在 Windows 上常常只有 shebang shim 而 shim 起不来，此时真正能用的是
  // 同目录的 `pnpm.ps1`（经 PowerShell 宿主）。门禁选出来的形态必须在起服务这一
  // 步复用同一个实现，否则「探测过了、起服务却用另一种方式又失败一次」。
  // 判据只在 shell.mjs 一处（规范 §9.5），这里不自己拼可执行名。
  const candidate = whichCommand("pnpm");
  if (!candidate) throw new Error("pnpm 不在 PATH 上，无法启动 dev server");
  const invocation = commandInvocation(candidate, ["-v"]);
  const child = spawnInGroup({
    command: invocation.command,
    args: [...invocation.prefixArgs, "dev", "-p", String(port), "-H", host],
    cwd: ctx.root,
    env: {
      ...process.env,
      COMFYAPP_PORT: String(port),
      PORT: String(port),
      /* 编排器已起过一份 schema 同步（本文件 950 行附近），通知 dev.mjs
       * 跳过它自己的那份 —— 否则一次启动两份 drizzle 并发写同一个库。 */
      [SKIP_SCHEMA_SYNC_ENV]: "1",
      ...extraEnv,
    },
    stdoutFile: outFile,
    stderrFile: errFile,
  });
  ctx.spawned.push(child);
  return child;
}

/**
 * 拉起 `scripts/executor-host.mjs`（P3 §5 第 2 期 · Phase 2-C）。
 *
 * 判据与落点全在 `launcher-core/executor-host-spawn.mjs`（§12.18 / §12.12）：
 * 这条编排 6.5 步、`scripts/start.mjs` 的生产链路、以及桌包外壳那条形态不同的链
 * 各自都要起宿主，三处各写一遍的下场是「某一条忘了起」——而 host 模式下的现场
 * 恰恰是「任务永远停在队列、没有失败出口」（`scripts/start.mjs` 缺这一步的实测
 * 后果见 ISSUE #1767：两条 `@critical` 主链路用例各超时 60s 全红）。
 *
 * 本函数只做编排器这一侧独有的两件事：把子进程记进 `spawned`（回收整树用）、
 * 把 `reason` 转成编排日志。
 *
 *  为什么不发 COMFYAPP_PORT：host 起 ComfyUI 用的是自己的 lifecycle，与 Next 端
 *  口不共享；Phase 2-C 骨架不 spawn ComfyUI，也就用不上端口。
 *
 * @param {{ root: string, runTimestamp: string, log: (m: string, l?: import("./log.mjs").LogLevel) => void,
 *           spawned: import("node:child_process").ChildProcess[] }} ctx 注入上下文
 * @returns {import("node:child_process").ChildProcess | null}
 */
export function spawnExecutorHost(ctx) {
  const result = maybeSpawnExecutorHost({
    root: ctx.root,
    runTimestamp: ctx.runTimestamp,
    logLine: (message, level = "INFO") => ctx.log(message, level),
  });
  if (!result) return null;
  ctx.spawned.push(result.child);
  return result.child;
}
/**
 * `stdoutFile` / `stderrFile` 必须是**本次运行**起 dev server 时用的那两份
 * （`nextOut` / `nextErr`）—— 曾经这里是按文件名重找「最近一份」（`lastNextLog`），
 * 而它按**字典序**取最新：`nextjs-stdout-<ISO-T>` 与历史遗留的
 * `nextjs-stdout-<下划线>` 命名混在一个目录里时，`_`（0x5F）排在 `T`（0x54）之后，
 * 于是「最新」永远落到旧命名的**上一次运行**的日志上 —— 用户照着报错里的路径去看，
 * 看到的是别的失败现场，「日志里什么都查不出来」正是这么来的（ISSUE #576）。
 * 本次的路径本来就是已知量，没有任何理由再按名字猜一次。
 *
 * @param {{ log: (m: string, l?: import("./log.mjs").LogLevel) => void, root: string, runId: string,
 *           shutdown: (code: number) => Promise<void> }} ctx 注入上下文
 * @param {{ dev: import("node:child_process").ChildProcess,
 *           shell: import("node:child_process").ChildProcess | null,
 *           heartbeat: NodeJS.Timeout, staleShell: string | null,
 *           stdoutFile: string, stderrFile: string,
 *           port?: number | null }} ended 本次退出的现场
 * @returns {Promise<number>}
 */
export async function concludeDownstreamExit(
  ctx,
  { dev, shell, heartbeat, staleShell, stdoutFile, stderrFile, port = null },
) {
  clearInterval(heartbeat);
  const markers = readShellMarkers(ctx.root);
  const shellExited = shell
    ? shell.exitCode !== null || shell.signalCode !== null
    : false;
  const kind = downstreamExitKind({
    shellExited,
    abandoned: markers.abandoned,
    shellCrashed: markers.crashed,
  });
  const detail = describeDownstreamExit(kind, {
    devCode: dev.exitCode,
    shellCode: shell?.exitCode ?? null,
    shellPid: shell?.pid,
    stderrFile,
    stdoutFile,
  });
  /* 把这次的成因落盘（ISSUE #1692），**在回收整棵树之前**。应用服务此刻已经
   * 不在了，而探测它的通道正是它自己的 HTTP——事后问不到，只能由旁证人此刻
   * 写下。用户随后看到的「应用服务已断开」由界面配这句话讲清为什么。
   *
   * 退出事实取 dev 的（`kind` 也描述了它如何结束）：信号优先于退出码的取舍在
   * 读取侧统一做（`summarizeAppServiceExit`），这里只如实带上两者。 */
  writeAppServiceExit(ctx.root, {
    kind,
    code: dev.exitCode,
    signal: dev.signalCode,
    reason: detail.split("\n")[0] ?? detail,
    port,
    runId: ctx.runId,
  });
  if (kind === "abandoned") {
    ctx.log(detail, "INFO");
    ctx.log(
      "（提示：要启动桌面应用请重新双击启动入口，启动页出现后请等它自动切换到主界面）",
      "INFO",
    );
    await ctx.shutdown(0);
    return 0;
  }
  ctx.log(detail, "ERROR");
  writeLaunchStatus(ctx.root, {
    phase: "error",
    progress: 1,
    message: "启动失败，见 log/",
    error: true,
    staleShell,
  });
  await ctx.shutdown(1);
  return 1;
}
