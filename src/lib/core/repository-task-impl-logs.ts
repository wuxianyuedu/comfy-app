/**
 * `repository-task-impl-logs.ts` — 任务日志**增量三件套**的 impl 子工厂（#4605）。
 * ===========================================================================
 *
 * 从 `repository-task-impl.ts` 按职责拆出（§12.13：主工厂顶到 900 行长度硬闸，
 * #4604 的收口方法把它顶破了）——与 `createQueueScanSection` 同一拆分形态：
 * 拆的是函数/职责，不是类型或行数；`TaskRepoImpl` 的形状不变（主工厂 `...` 并入）。
 *
 * 不带归属守卫：追加只发生在**正在执行该任务的那个进程**（inline / host
 * 各自只写自己领到的任务），不存在 `replaceLogs` 那种两方覆写同一行的竞争；
 * 外键保证任务行存在。`seq` 由写入侧分配（写入侧不变式：批内每条都带），
 * 缺席按 0 落库——同批多条缺 seq 会撞复合主键，那属于写入侧违约，当场红。
 */
import { and, count, desc, eq, gt, lte, max } from "drizzle-orm";

import { taskLog } from "~/server/db/schema";

import type { TaskRepoDb } from "./repository-task-impl-types";

/** 与 `runner-state.LOGS_MAX_LINES` 同一口径的单任务行数上限。core 不反向
 *  import comfyui（分层方向），字面量在此另立，两侧一致由用例钉住。 */
const TASK_LOG_MAX_LINES = 5000;

/** 每追加多少行做一次裁剪检查：裁剪要付一次计数扫描，逐批做太勤；
 *  靠 seq 取模触发，行有空洞时最坏多留一个检查窗的行，可接受。 */
const TASK_LOG_TRIM_EVERY = 1000;

/** 把某任务的增量日志裁到最近 `TASK_LOG_MAX_LINES` 行（与内存视图同窗）。
 *  旧形态下这一步由内存 5000 行封顶 + 整包重写顺手完成；增量表自己长，
 *  得自己收。按 seq 上界删，行有空洞时保留条数 ≤ 上限，方向安全。
 *  db 由调用点（impl 工厂作用域）传入——本文件刻意不引全局 db。 */
async function trimTaskLogs(db: TaskRepoDb, taskId: string): Promise<void> {
  const counted = await db
    .select({ total: count() })
    .from(taskLog)
    .where(eq(taskLog.taskId, taskId));
  const total = counted[0]?.total ?? 0;
  if (total <= TASK_LOG_MAX_LINES) {
    return;
  }
  const headed = await db
    .select({ maxSeq: max(taskLog.seq) })
    .from(taskLog)
    .where(eq(taskLog.taskId, taskId));
  const upper = headed[0]?.maxSeq;
  if (upper === null || upper === undefined) {
    return;
  }
  await db
    .delete(taskLog)
    .where(and(eq(taskLog.taskId, taskId), lte(taskLog.seq, upper - TASK_LOG_MAX_LINES)));
}

/** 增量日志行的读出形状（`seq` 必有；`level` 保留写入侧原值）。 */
export type TaskLogRow = {
  level: string;
  msg: string;
  seq: number;
  src?: string;
  t: number;
};

/** 任务日志增量三件套：追加 / 全量读回 / 按游标读尾段 / 重跑清场。 */
export function createTaskLogSection(db: TaskRepoDb) {
  return {
    /** 任务日志**增量**落库：按 `(taskId, seq)` 追加一小批，取代「整包防抖重写
     *  `task.logs` 列」。单次 INSERT 的体积与防抖窗口内的增量成正比，不再随
     *  日志总量增长 —— 这是 SQLITE_BUSY 写放大的主要治理点。行数裁剪与内存
     *  视图同窗（`LOGS_MAX_LINES`，core 不反向 import comfyui，字面量另立、
     *  由用例钉住一致），按每千行一次的节奏顺手收，不逐批扫。
     *  `onConflictDoNothing`（ISSUE #4732 / #3850）：防抖 flush 与收口点
     *  `persistLogs` 并发进入时，双方可能在对方推进游标前用旧游标算出同一批
     *  delta 各自追加——第二批撞 `(taskId, seq)` 复合主键。追加是幂等操作
     *  （同 seq 同内容），撞键即跳过，不再让那一次整列写被 catch 吞掉。 */
    async appendLogs(
      taskId: string,
      entries: Array<{ level: string; msg: string; seq?: number; src?: string; t: number }>,
    ): Promise<void> {
      if (entries.length === 0) {
        return;
      }
      await db
        .insert(taskLog)
        .values(
          entries.map((entry) => ({
            taskId,
            seq: entry.seq ?? 0,
            t: entry.t,
            level: entry.level,
            msg: entry.msg,
            src: entry.src ?? null,
          })),
        )
        .onConflictDoNothing({ target: [taskLog.taskId, taskLog.seq] });
      const lastSeq = entries.at(-1)?.seq ?? 0;
      if (lastSeq % TASK_LOG_TRIM_EVERY === 0) {
        await trimTaskLogs(db, taskId);
      }
    },

    /** 全量读某任务的增量日志（SSE 初始回放兜底之一：内存为空时接住防抖窗前
     *  的行）。行数上限与裁剪口径一致；超出时取**最新**一段（与内存视图的
     *  「丢最旧」同向），不是最旧的 5000 行。 */
    async readAllLogs(taskId: string): Promise<Array<TaskLogRow>> {
      const rows = await db
        .select({
          seq: taskLog.seq,
          t: taskLog.t,
          level: taskLog.level,
          msg: taskLog.msg,
          src: taskLog.src,
        })
        .from(taskLog)
        .where(eq(taskLog.taskId, taskId))
        .orderBy(desc(taskLog.seq))
        .limit(TASK_LOG_MAX_LINES);
      return rows.reverse().map((row) => ({
        seq: row.seq,
        t: row.t,
        level: row.level,
        msg: row.msg,
        src: row.src ?? undefined,
      }));
    },

    /** 读「游标之后」的日志尾段（SSE 轮询专用）：只取增量行，不再每 3s 整列
     *  读回 MB 级 JSON。跨归属（读侧给用户看，与 `findRawCli` 同一取向）。
     *  `limit` 兜住落后过多的连接：一拍最多补这么多，下一拍继续。 */
    async readLogsSince(taskId: string, afterSeq: number, limit = 500): Promise<Array<TaskLogRow>> {
      const rows = await db
        .select({
          seq: taskLog.seq,
          t: taskLog.t,
          level: taskLog.level,
          msg: taskLog.msg,
          src: taskLog.src,
        })
        .from(taskLog)
        .where(and(eq(taskLog.taskId, taskId), gt(taskLog.seq, afterSeq)))
        .orderBy(taskLog.seq)
        .limit(limit);
      return rows.map((row) => ({
        seq: row.seq,
        t: row.t,
        level: row.level,
        msg: row.msg,
        src: row.src ?? undefined,
      }));
    },

    /** 重跑清场：同一任务行再次领取时删掉上一轮的增量行，与内存缓冲的
     *  「领取重开」同一口径（重跑不混上一轮的尾巴）。执行侧写，跨归属无需判。 */
    async resetLogs(taskId: string): Promise<void> {
      await db.delete(taskLog).where(eq(taskLog.taskId, taskId));
    },
  };
}
