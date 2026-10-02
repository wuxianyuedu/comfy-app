/**
 * 宿主运行时图（P3 §5 ADR §13 的 3-E1）。
 *
 * 为什么单独有这一份：`scripts/executor-host.mjs` 原来在 `bootRuntime()` 里逐个
 * `await import("../src/lib/**.ts")` —— 那是**源码态**图，只有装了 `tsx` 的 dev 检出
 * 能加载，standalone/桌包产物里既没有 TS 源也没有 devDependency。把「宿主需要哪些
 * 模块」从入口里抽出来集中成一份静态图，构建期就能由打包器算出闭包并预编译成一个
 * 文件（见 `scripts/build-executor-host.mjs`），入口侧只留一次「用哪份图」的选择。
 *
 * 这里**不**放任何进程外壳职责（env 解析、日志通道、心跳、argv 钩子、领取节拍都留在
 * 入口），理由与 §18.4 一致：这份模块要能被两种加载形态复用（dev=tsx 载 TS 源，
 * 产物=预编译件），带上 `process.argv` / `process.exit` 之类就不可复用了。
 *
 * 出口形状就是入口要的依赖注入清单：加/减 seam 只改这一处，两侧（dev/产物）同形。
 */
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import { createTaskRepoImpl } from "../core/repository-task-impl";
import { logger } from "../core/logger";
import { isSchemaReady } from "../db-schema-ready";
import { applySqlitePragmas, SQLITE_BUSY_TIMEOUT_MS } from "../sqlite-pragmas";
import { configureDispatch, claimAndDispatchOnce } from "./executor-dispatch";
import { configureExecutorCli, cliProcs } from "./executor-cli";
import { configureExecutorFinalize } from "./executor-finalize";
import { configureExecutorWs } from "./executor-ws";
import { getView, interrupt, resolveComfyBase } from "./client";
import { configureEnqueue } from "./enqueue";
import { configureReaper, startReaper } from "./reaper";
import { configureRunner } from "./runner-state";
import { configureTraceLogPath } from "./trace";

import type { TaskRepoImpl } from "../core/repository-task-impl";

/** 建 host 片自己的仓储：libsql 文件库 + 那份共用 PRAGMA 清单，与 Next 侧同 schema。
 *
 *  `dbFile` 由入口算好传来（绝对路径判据在入口那侧：`ROOT` 与 `process.chdir` 都在
 *  它手里），这里不碰 `process.cwd()`，保证两种加载形态读到同一个库。
 *  PRAGMA 走 `~/lib/sqlite-pragmas` 那一份而不是本地再列两行：宿主与内嵌 server 写的
 *  是同一个库文件。等待预算则**只能**由 `timeout` 这个客户端选项给：`file:` 客户端是
 *  连接池，开机那条 `PRAGMA busy_timeout` 只落在它当时借到的那一条连接上，池后开的
 *  连接没有预算（实测：那种形状撞锁 11ms 就抛；带 `timeout` 才会等）。
 *  预算给在本侧、不给 Next 侧的理由见 `sqlite-pragmas` 文件头：同步等锁会占住本进程
 *  事件循环，宿主是为执行而生的进程，Next 还要响应界面。
 *  清单的应用走 `applySqlitePragmas`（撞锁有界重试）：三处站点要的是同一件事，
 *  各写一遍就必然漏一处（ISSUE #1282）。 */
export async function createHostRepo(dbFile: string): Promise<TaskRepoImpl> {
  const client = createClient({
    url: `file:${dbFile}`,
    timeout: SQLITE_BUSY_TIMEOUT_MS,
  });
  await applySqlitePragmas(client);
  return createTaskRepoImpl(drizzle(client), { owner: "host" });
}

/** 八条 seam 的注入器：入口按自己的顺序调，参数全是本进程那份 host 仓储。 */
export {
  claimAndDispatchOnce,
  cliProcs,
  configureDispatch,
  configureEnqueue,
  configureExecutorCli,
  configureExecutorFinalize,
  configureExecutorWs,
  configureReaper,
  configureRunner,
  configureTraceLogPath,
  getView,
  interrupt,
  isSchemaReady,
  logger,
  resolveComfyBase,
  startReaper,
};
