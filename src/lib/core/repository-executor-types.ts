/**
 * `repository-executor-types.ts` — 仓库层「一条语句落在哪个执行者上」的**唯一定义处**。
 * @module core/repository-executor-types
 *
 * 为什么单独一份、而不是在两个方法里各写一遍 union（ISSUE #2592 期望 1）：跨表原子性
 * 要收进同一个事务，就意味着仓库层的每个方法都得能可选地接受「事务里的那条连接」。
 * 这个形状一旦被抄成两份，第三份一定会漂 —— 而漂的形态不是编译错，是「某个方法悄悄
 * 只用模块级 `db`，事务开到它那里就断了」。做法与 `repository-task-impl-types.ts`
 * 同一档：类型单独一个文件，实现与测试读同一份。
 *
 * `TxExecutor` 不手写：从 `db.transaction` 的**回调形参**上取 —— 那样它跟着 drizzle 的
 * 类型走，升级时不需要有人记得来同步（手写一份 union 就是这份记忆）。
 */
import "server-only";

import type { db } from "~/lib/db";

/** `db.transaction(async (tx) => …)` 里那个 `tx` 的类型（从签名上派生，不抄第二份）。 */
export type TxExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 一条语句允许落在的两个执行者之一：模块级连接（自开自 Commit 的单语句路径），
 * 或者一个已经在事务里的执行者（由 `saveLlmSettings` 那类跨表入口传进来）。
 *
 * 传进来的那一侧**必须**由调用方负责提交/回滚 —— 方法内部见到 `executor` 就不再
 * `db.transaction(`，否则 SQLite 会在嵌套事务上报 `cannot start a transaction
 * within a transaction`（drizzle 的代理宿主那侧则是发出一条多余的 `begin`）。
 */
export type DbExecutor = typeof db | TxExecutor;
