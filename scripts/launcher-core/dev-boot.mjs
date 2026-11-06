/**
 * 主流程的「起服务」桥段：缓存策略 → 起 dev server → 执行器宿主 → 会话锚点 →
 * 后台 schema 同步（ISSUE #1811 拆 R5 超限文件，对应 §3.3 主流程的步骤 5~8）。
 *
 * 这一段此前住在 `run()` 里。搬出来的是**每一步的实质逻辑与它的日志措辞**；
 * 编排器那层只负责把动作与状态注进来、把返回的句柄接上后面的就绪等待。
 *
 * **依赖靠注入**：本模块不 import 主文件（回引会成环）。`spawned` 是子进程账本
 * （写进会话锚点，也是收尾整树回收的依据），`spawnDevServer` / `spawnExecutorHost`
 * 住在 `downstream.mjs`、`syncNextCache`/`pruneTimestampedLogs` 住在 `worktree.mjs`。
 */
import path from "node:path";
import process from "node:process";

/**
 * 跑起服务桥段。
 *
 * @param {object} ctx
 * @param {(m: string, l?: import("./log.mjs").LogLevel) => void} ctx.log 日志出口
 * @param {string} ctx.root 检出根
 * @param {(phase: string, progress: number, message: string, extra?: object) => void} ctx.status 进度快照
 * @param {() => import("node:child_process").ChildProcess[]} ctx.spawnedChildren 本次会话的子进程账本
 * @param {(msg: string) => void} ctx.appendRuntimeWarning 把 pnpm 提醒补进 app-runtime 通道
 * @param {(root: string, env: Record<string, string | undefined>, fingerprint?: { hash: string, files: Record<string, string> }) => { cleaned: boolean, reason: string }} ctx.syncNextCache .next 缓存策略
 * @param {(root?: string) => { version: string, expected: string, tip: string | null } | null} ctx.reconcilePnpmVersion pnpm 版本一致性
 * @param {(name: string, root?: string) => string} ctx.currentDirOf log/current/<分区> 解析
 * @param {(dir: string, prefixes: string[], keep?: number) => void} ctx.pruneTimestampedLogs 按次日志轮转
 * @param {(port: number, host: string, out: string, err: string) => import("node:child_process").ChildProcess} ctx.spawnDevServer 起 dev server
 * @param {(root: string, name: string, pid: number | null) => void} ctx.recordPid 落 PID 锚点
 * @param {() => import("node:child_process").ChildProcess | null | undefined} ctx.spawnExecutorHost 起执行器宿主
 * @param {() => { mode: string, unknown: string | null }} ctx.resolveExecutorMode 执行器模式判据
 * @param {(root: string, session: import("../dev-launcher-session.mjs").LauncherSession) => void} ctx.writeSession 写会话锚点
 * @param {(root: string, at?: number) => void} ctx.touchHeartbeat 更新心跳
 * @param {(root: string) => { started: boolean, reason?: string }} ctx.spawnSchemaSync 后台 schema 同步
 * @param {object} target
 * @param {number} target.port
 * @param {string} target.host
 * @param {string} target.mode
 * @param {string | null} target.staleShell
 * @param {string} target.runTimestamp
 * @param {number} target.startedAt
 * @returns {{ dev: import("node:child_process").ChildProcess, nextOut: string, nextErr: string, staleShell: string | null }}
 */
export function bootDevServerStage(ctx, target) {
  const { log, root, status } = ctx;
  const { port, host, mode, runTimestamp, startedAt } = target;
  let staleShell = target.staleShell;

  // 5) .next 缓存策略（与 .ps1 同一指纹口径）
  const cache = ctx.syncNextCache(root, process.env);
  log(
    cache.cleaned
      ? `清空 .next 全量重编译（${cache.reason}）`
      : `保留 .next 缓存（${cache.reason}）`,
    cache.cleaned ? "STEP" : "OK",
  );
  const pnpm = ctx.reconcilePnpmVersion(root);
  if (pnpm?.tip) {
    ctx.appendRuntimeWarning(pnpm.tip);
    staleShell = staleShell ? `${staleShell}；${pnpm.tip}` : pnpm.tip;
  }
  status("cache", 0.2, "正在启动本地服务（Next.js dev server）…", {
    staleShell,
  });

  // 6) 起 dev server（输出重定向到 log/nextjs/，按次命名后轮转保留 5 份）
  const nextDir = ctx.currentDirOf("nextjs", root);
  ctx.pruneTimestampedLogs(nextDir, ["nextjs-stdout-", "nextjs-stderr-"], 5);
  const nextOut = path.join(nextDir, `nextjs-stdout-${runTimestamp}.log`);
  const nextErr = path.join(nextDir, `nextjs-stderr-${runTimestamp}.log`);
  log(`启动 Next.js dev server（${host}:${port}）…`, "STEP");
  const dev = ctx.spawnDevServer(port, host, nextOut, nextErr);
  ctx.recordPid(root, "nextjs", dev.pid ?? null);
  log(`dev server 已启动（PID ${dev.pid}，输出见 ${nextOut}）`, "OK");

  // 6.5) 可选：拉起 ComfyUI 执行器独立宿主（P3 §5 第 2 期 · Phase 2-C）
  // 默认 `inline` —— Next 里跑 ComfyUI 执行编排；本步 **不 spawn 任何东西**。
  // `COMFY_EXECUTOR=host` 时把 `scripts/executor-host.mjs` 作为 launcher 的
  // **又一个受管子进程** 起起来；spawnInGroup 走同一份平台判据（POSIX 自建进程组 /
  // Windows taskkill 走 `/T`），因此回收、孤儿检测、会话锚点等既有语义一字不改。
  // 3-B1 起 host 会真正领取 claimedBy='host' 的行；判据与 Next 侧
  // `resolveExecutorClaim()`（src/lib/comfyui/executor-mode.ts）读同一个 key、
  // 同一套归一化——这里额外回读 `.env` 是因为纯 Node 不注入 .env，而 Next
  // server 的 process.env 里有它（@next/env），不回读会造成「Next 写 host 片、
  // launcher 却不拉 host」的任务停摆组合。
  // 4-A4 起归一化收在 `launcher-core/executor-mode.mjs`（纯 Node 侧唯一定义，
  // host 脚本共用同一份），两侧判决是否同值由 tests/executor-mode-consistency.test.ts
  // 逐值比对（ADR §14 D5）。
  /* 判据（进程 env → `.env` 回读 → 归一化）住在 `executor-mode.mjs`，由编排器
   * 注入 —— 门控形状不变：只认 `host`，未知值 warn 后走 inline 分支。 */
  const { mode: executorMode, unknown: unknownExecutor } = ctx.resolveExecutorMode();
  if (executorMode === "host") {
    const hostChild = ctx.spawnExecutorHost();
    log(
      `executor-host 已启动（PID ${hostChild?.pid ?? "?"}，COMFY_EXECUTOR=host 灰度中；host 领取 claimedBy='host' 的行）`,
      "OK",
    );
  } else if (unknownExecutor) {
    log(
      `COMFY_EXECUTOR="${unknownExecutor}" 不识别，按默认 inline 处理（可选：inline|host）`,
      "WARN",
    );
  }

  // 7) 会话锚点：把 PID 与心跳落盘，让「进程被杀后仍能回收」成立
  ctx.writeSession(root, {
    launcher_pid: process.pid,
    child_pids: ctx
      .spawnedChildren()
      .map((c) => c.pid)
      .filter((pid) => typeof pid === "number"),
    app_port: port,
    mode,
    started_at: new Date(startedAt).toISOString(),
  });
  ctx.touchHeartbeat(root);

  // 8) DB schema 自检 + **后台同步**（§9.1）。「拉了含 schema 变更的代码后忘了
  //    跑 db:push」由这里兜住，但**不阻塞启动** —— drizzle 同步一次 15~30 秒，
  //    等它等于让用户盯着空窗。判据见 db-schema-state.mjs 的 spawnSchemaSync；
  //    不一致时它会自动同步，页面经 GET /api/schema 显示「已同步，请刷新」。
  const schema = ctx.spawnSchemaSync(root);
  if (schema.started) {
    log("数据库结构核对已在后台开始（不一致时自动同步，页面会提示刷新）", "INFO");
  } else {
    log(
      `无法后台核对数据库结构：${schema.reason ?? "原因未知"}（必要时手动跑 pnpm db:push）`,
      "WARN",
    );
  }

  return { dev, nextOut, nextErr, staleShell };
}
