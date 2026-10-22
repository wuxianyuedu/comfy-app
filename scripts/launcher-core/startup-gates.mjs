/**
 * 主流程的预检桥段：孤儿回收 → 环境/工具链门禁 → 依赖对齐 → 备份恢复 → 端口解析
 * （ISSUE #1811 拆 R5 超限文件，对应 §3.3 主流程的步骤 0~2）。
 *
 * 这一段此前住在 `run()` 里，与端口归属、缓存策略、就绪等待同处一个 400 行的函数。
 * 搬出来的是**判决逻辑**（每一步是继续还是早退），编排器那层只负责把出口接上
 * 「写启动页 + 退 1」。
 *
 * **内部顺序是契约，不是排版**：
 *   · 孤儿回收在起任何新进程之前（否则新旧实例抢同一端口，§1.7）；
 *   · 备份恢复在**任何会开库的东西**之前（壳 / Next / 执行宿主 / schema 同步）——
 *     运行期多个进程持有同一个库，此时换文件是唯一安全的时刻（§9.1）。
 * 两条都有回归判据（`tests/db-backup-wiring.test.ts`、`cross-platform-launcher`）。
 *
 * **依赖靠注入**：本模块不 import 主文件（回引会成环），三个主文件侧的能力
 * （进度快照、工具链门禁、依赖补装）走 `ctx`。
 */
import process from "node:process";

/**
 * 跑预检桥段。返回 `{ error }` 时调用方写启动页并退 1；否则带回解析出的端口。
 *
 * @param {object} ctx
 * @param {(m: string, l?: import("./log.mjs").LogLevel) => void} ctx.log 日志出口
 * @param {string} ctx.root 检出根
 * @param {(phase: string, progress: number, message: string, extra?: object) => void} ctx.status 进度快照
 * @param {(root: string) => Promise<number[] | null>} ctx.reapStaleSession 回收上次孤儿
 * @param {(root: string) => { message: string } | null} ctx.checkEnvFile 环境文件门禁
 * @param {(root: string) => string | null} ctx.envInitHint 非阻断读数：`.env` 缺哪些 `env:init` 会补的键
 * @param {(root: string) => string | null} ctx.runToolchainGate 工具链门禁
 * @param {(root: string, deps: object) => Promise<string | null>} ctx.syncDependencies 依赖补装
 * @param {(root: string, opts: { write?: (line: string) => void }) => import("../db-backup-core.mjs").RestoreResult} ctx.applyPendingRestoreAtBoot 待恢复备份
 * @param {(root: string) => number} ctx.resolveAppPort 端口单一事实源
 * @param {object} target
 * @param {number | null} target.portOrNull 显式端口（`--port` 且为正整数），否则 null
 * @param {string} target.mode
 * @returns {Promise<{ ok: true, port: number } | { ok: false, error: { message: string, statusMessage: string, staleShell?: string | null } }>}
 */
export async function runStartupGates(ctx, target) {
  const { log, root, status } = ctx;
  const { portOrNull, mode } = target;

  log(`project_root=${root}`, "INFO");
  log(`平台=${process.platform}，模式=${mode}`, "INFO");

  // 0) 上一次的孤儿回收（必须在起新进程之前：否则新旧实例抢同一端口）
  const reaped = await ctx.reapStaleSession(root);
  if (reaped)
    log(`回收上一次运行遗留的进程树：PID ${reaped.join(", ")}`, "WARN");

  // 1) 预检：环境文件（与 dev.mjs / start.mjs 同判据）+ 工具链
  const envProblem = ctx.checkEnvFile(root);
  if (envProblem) {
    return {
      ok: false,
      error: {
        message: `环境配置未就绪，**不会**启动服务。\n${envProblem.message}`,
        statusMessage: "环境配置未就绪：先执行 pnpm env:init",
      },
    };
  }
  // 1.1) 非阻断读数（ISSUE #2205）：必填项齐了，但 `.env` 还缺 `.env.example` 里的
  //      键（典型是后来新增的 COMFYAPP_DEV_HANDLE）⇒ 念一句 `pnpm env:init`。
  //      只念不改：不写文件、不改退码。启动是人人都会碰到的时刻，而 `env:init`
  //      此前没有任何时刻提醒人去跑它 —— 不经过 `pnpm ship` 的人永远看不到。
  const envHint = ctx.envInitHint(root);
  if (envHint) log(`环境配置提醒：${envHint}`, "WARN");

  const gateProblem = ctx.runToolchainGate(root);
  if (gateProblem) {
    // 多行提示分两条写：`status` 的 message 是启动页**一行**标题位，塞整段
    // 会把「先做什么」挤没；完整提示（含修复命令）放 stale_shell 横幅，
    // 启动页是多行渲染（见 splash.html 的 renderNotice）。
    return {
      ok: false,
      error: {
        message: gateProblem,
        statusMessage: gateProblem.split("\n")[0] ?? "工具链不可用",
        staleShell: gateProblem,
      },
    };
  }
  log("工具链门禁：pnpm 可用、node_modules 已安装", "OK");

  // 1.5) 依赖与 lockfile 对齐：拉了更新但没重装时，`node_modules` 是「在但陈旧」的，
  //      报错会落在业务模块解析失败上，与「依赖没装」这句结论长得完全不一样。
  //      判据是 lockfile 的**实质差异**（`lockfileDrift`），差异明细复用
  //      scripts/lockfile/ 的既有实现（唯一出处，质量门禁同源）。
  const syncProblem = await ctx.syncDependencies(root, { status });
  if (syncProblem) {
    return {
      ok: false,
      error: {
        message: syncProblem,
        statusMessage: syncProblem.split("\n")[0] ?? "依赖未对齐",
        staleShell: syncProblem,
      },
    };
  }
  log("依赖与 lockfile 一致（无需补装）", "OK");

  // 1.6) 待恢复的备份：**必须**排在起任何会打开数据库的东西之前（壳、Next、
  //      执行宿主、后台 schema 同步）。运行期多个进程持有同一个库，运行期覆盖
  //      `db.sqlite` 等于在别人握着句柄时换掉文件 —— 这里换是唯一安全的时刻。
  //      空转（没有标记）是绝大多数启动的形态。
  const restore = ctx.applyPendingRestoreAtBoot(root, {
    write: (/** @type {string} */ line) =>
      log(line.replace(/^\[db-backup\] /, "").trimEnd(), "INFO"),
  });
  if (restore.status === "restored") {
    log(`数据库已从备份恢复（${restore.from}）`, "OK");
  } else if (restore.status === "failed") {
    log(`数据库恢复没能完成：${restore.reason}`, "WARN");
  }

  // 2) 端口（单一事实源：app-port.mjs，绝不在这里重算）
  const port = portOrNull ?? ctx.resolveAppPort(root);
  log(
    `使用端口 ${port}（.env 显式值优先，否则按检出路径推导，见 §1.1）`,
    "INFO",
  );
  status("port-check", 0.05, "正在检查端口占用…");
  return { ok: true, port };
}
