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

/** 建 host 片自己的仓储：libsql 文件库 + WAL/外键两条 PRAGMA，与 Next 侧同 schema。
 *
 *  `dbFile` 由入口算好传来（绝对路径判据在入口那侧：`ROOT` 与 `process.chdir` 都在
 *  它手里），这里不碰 `process.cwd()`，保证两种加载形态读到同一个库。 */
export async function createHostRepo(dbFile: string): Promise<TaskRepoImpl> {
  const client = createClient({ url: `file:${dbFile}` });
  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA foreign_keys = ON");
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
