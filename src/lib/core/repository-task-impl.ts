/**
 * `repository-task-impl.ts` — Task 仓储**执行链侧** 13 个方法的实现（工厂）
 * ===========================================================================
 *
 * P3 §5 第 1 期·Phase 2-A-1：从 `repository-task.ts` 抽出的 exec 侧 SQL 主体，
 * 让 Next 与未来的 `scripts/executor-host.mjs` 用**同一份实现**、只是把 `db`
 * 从各自的 drizzle 客户端传进来。设计依据见 P3 §5 ADR 附录（`docs/superpowers/specs/`
 * 目录下 `p3-phase2-executor-host-design.md`）§11.1。
 *
 * 为什么走「impl + delegate」而不是「把类参数化 db」：
 *   · 现 `repository-task.ts` 里的 `TaskRepository` class  extends 基类
 *     `DrizzleRepository<Task>`，基类也静态引 `db`；把整条构造链改成 db-param
 *     会波及全部 12 个 repository-\*.ts 子类，是「数据层整体双宿主」议题
 *     （ADR §11 明确不做）。
 *   · exec 链**只用**这 12 个方法，它们全部是普通 `.select()/.update()/.insert()`
 *     的 drizzle builder，**没有一个**走 relational query（`db.query.task.findMany`），
 *     所以抽出来的 scope 很小、破坏面为零。relational 那三个方法（`findById`
 *     / `listByUser` / `findByProject`）留在 `repository-task.ts`，是 UI 列表
 *     卡与详情页专用，host 侧完全不需要。
 *
 * 为什么不孪生（§12.12 判据：逐行重合 ≥75% 且两边 ≥60 行）：SQL 主体只活在
 * 本文件；`repository-task.ts` 对应 12 个方法各 delegate 一行 `(id, ...) =>
 * impl.xxx(id, ...)`，形态与本文件的 select/where 完全不同——`check-code-
 * duplication.cjs` 逐行比对不会命中。
 *
 * §18.4 三选一：本模块走第三类（纯 Node 宿主），无 `import "server-only"`；
 * 依赖 `~/server/db/schema`（drizzle 表定义、无 server-only 内部）+ `drizzle-orm`
 * + `../task-state`（纯常量）+ `./repository-task-impl-types`（本地类型）。
 * 顶层**没有** Node 内建 value import，因此不进 scanner 的 `nodeImports` /
 * `unguarded`；登记 PURE_NODE_HOSTS 只是**给未来**「impl 里若加了 node: 前缀
 * import」留的锚，当前 scanner 视角不严格必要。
 */
import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  notInArray,
  or,
} from "drizzle-orm";

import { TERMINAL_TASK_STATUSES } from "../task-state";
import { task, taskImage } from "~/server/db/schema";

import type { TaskRepoDb } from "./repository-task-impl-types";

/**
 * 终态集合的 SQL 形态：由 `~/lib/task-state` 的唯一定义摊平而来。
 *
 * 与 `repository-task.ts` 里同名 const 各留一份的原因：本文件不能从
 * `repository-task.ts` import——那条路会把 `import "server-only"`（在
 * `repository-task.ts` 顶层）带进 host 的加载链、throw。摊平逻辑一行、
 * 且**判据的唯一定义**在 `../task-state` 的 `TERMINAL_TASK_STATUSES`，
 * 两边只是各自的 `[...tuple]`，语义与来源同步。
 */
const TERMINAL_STATES: string[] = [...TERMINAL_TASK_STATUSES];

/** `claimedBy` 列的值域（ADR §6 的两种执行器归属）。提交侧（tRPC `generate`，
 *  3-B 接线）按 `COMFY_EXECUTOR` env 决定写哪个值；NULL 语义归 inline。 */
export type TaskClaimMode = "inline" | "host";

/** 归属谓词——领取（`claimNextQueued`）与 reaper 分片（`listStale*` 的 `owner`）
 *  共用同一条判据：host 只碰显式 `'host'` 的行；inline 碰 NULL（历史行与未带
 *  归属的建行）与 `'inline'`。两侧共用防的是「领取看得见、回收看不见」这类
 *  归属漂移：一条行的归属判定必须全局只有一个定义。 */
function ownedBy(owner: TaskClaimMode) {
  return owner === "host"
    ? eq(task.claimedBy, "host")
    : or(isNull(task.claimedBy), eq(task.claimedBy, "inline"));
}

/**
 * 13 个 exec-chain 方法的实现工厂（12 个 delegate 自 class + Phase 3-A 新增的
 * `claimNextQueued`，后者暂不进 class delegate——3-B 的领取循环直接调 impl）。
 *
 * Next 侧：`createTaskRepoImpl(db)`（`repository-task.ts` 模块顶层，`db` 来自
 * `~/lib/db`）；host 侧：`createTaskRepoImpl(drizzle(createClient({url:
 * "file:./db.sqlite"})))`——同一份 SQL、两种客户端注入。
 *
 * `TaskRepoDb` 是结构最小约束（见 `./repository-task-impl-types`），只锁本
 * 文件用到的 `.select()/.update()/.insert()` 三条 builder；drizzle 的
 * libsql / better-sqlite3 两种 adapter 都天然满足，测试里可以直接把
 * `createTestDb()` 传进来（走 `as unknown as TaskRepoDb` 一次性断言）。
 */
export function createTaskRepoImpl(db: TaskRepoDb) {
  return {
    /** executor-finalize 收口时读归属与请求参数（projectId / params / prompt /
     *  negativePrompt / workflowName / referenceImages / createdAt）。 */
    async findExecutionMeta(taskId: string): Promise<{
      projectId: string | null;
      params: unknown;
      prompt: string;
      negativePrompt: string | null;
      workflowName: string;
      referenceImages: unknown;
      createdAt: Date;
    } | null> {
      const rows = await db
        .select({
          projectId: task.projectId,
          params: task.params,
          prompt: task.prompt,
          negativePrompt: task.negativePrompt,
          workflowName: task.workflowName,
          referenceImages: task.referenceImages,
          createdAt: task.createdAt,
        })
        .from(task)
        .where(eq(task.id, taskId))
        .limit(1);
      return rows[0] ?? null;
    },

    /**
     * 进度回写（顺带把行标成 RUNNING）：**只在非终态行上生效**。
     *
     * 判据与旧注释一致（`repository-task.ts` 里原 JSDoc 完整解释过）：执行
     * 路径异步，ComfyUI 的 WS progress 帧与本任务被别的路径收口可能交错；一条
     * 收口之后迟到的进度回写会把行从 SUCCEEDED/FAILED/CANCELLED 打回 RUNNING、
     * SSE 客户端就永远卡在「生成中…」。返回是否真的更新了行。
     */
    async updateProgress(taskId: string, pct: number): Promise<boolean> {
      const updated = await db
        .update(task)
        .set({ progress: pct, status: "RUNNING" })
        .where(
          and(eq(task.id, taskId), notInArray(task.status, TERMINAL_STATES)),
        )
        .returning({ id: task.id });
      return updated.length > 0;
    },

    /** 记下 promptId 并标 RUNNING（同样只对非终态行生效，理由见 updateProgress）。 */
    async markRunning(taskId: string, promptId: string): Promise<boolean> {
      const updated = await db
        .update(task)
        .set({ status: "RUNNING", promptId })
        .where(
          and(eq(task.id, taskId), notInArray(task.status, TERMINAL_STATES)),
        )
        .returning({ id: task.id });
      return updated.length > 0;
    },

    /**
     * 队列领取（P3 §5 ADR §6/§7 Phase 3-A）：单语句
     * `UPDATE ... WHERE id IN (SELECT ... ORDER BY createdAt LIMIT ?) RETURNING id`。
     *
     * 原子性由 SQLite「单写语句内子查询同语句求值」保证：inline/host 两个领取方
     * 各自最多领走互不重叠的行。刻意不用 `db.transaction` + 先 SELECT 后 UPDATE：
     * 本实现要同时跑在三种宿主（better-sqlite3 同步测试库 / libsql http /
     * libsql file）上，async 事务回调在同步驱动上于 continuation 之前就 COMMIT，
     * 原子性静默失效。
     *
     * 归属谓词跟 ADR §6：host 只领显式 `'host'` 的行；inline 领 NULL（历史行与
     * 未带归属的建行）与 `'inline'`。领取时把 `claimedBy` 覆写为 `mode`，NULL
     * 行由此转为显式归属；reaper 分片（`listStale*` 的 `owner`）用同一归属谓词。
     */
    async claimNextQueued(
      mode: TaskClaimMode,
      take: number,
    ): Promise<string[]> {
      const candidates = db
        .select({ id: task.id })
        .from(task)
        .where(and(eq(task.status, "QUEUED"), ownedBy(mode)))
        .orderBy(task.createdAt)
        .limit(take);
      const claimed = await db
        .update(task)
        .set({ status: "RUNNING", claimedBy: mode })
        .where(inArray(task.id, candidates))
        .returning({ id: task.id });
      return claimed.map((row) => row.id);
    },

    /** 成功收口：写 SUCCEEDED + progress=100 + finishedAt；有 workflowSnapshot
     *  时一并落，允许后续按产物完整复现（种子已经在 resultImages / params 里）。 */
    async finalizeSuccess(
      taskId: string,
      data: {
        resultImages: unknown;
        params: unknown;
        workflowSnapshot?: unknown;
      },
    ): Promise<void> {
      await db
        .update(task)
        .set({
          status: "SUCCEEDED",
          progress: 100,
          finishedAt: new Date(),
          resultImages: data.resultImages,
          params: data.params,
          ...(data.workflowSnapshot !== undefined
            ? { workflowSnapshot: data.workflowSnapshot }
            : {}),
        })
        .where(eq(task.id, taskId));
    },

    /** 失败收口：写 FAILED + error + finishedAt；`validationErrors` 空数组与
     *  undefined 都归一存 null，非空才 stringify。 */
    async finalizeFailure(
      taskId: string,
      error: string,
      validationErrors?: unknown[],
    ): Promise<void> {
      await db
        .update(task)
        .set({
          status: "FAILED",
          error,
          validationErrors: validationErrors?.length
            ? JSON.stringify(validationErrors)
            : null,
          finishedAt: new Date(),
        })
        .where(eq(task.id, taskId));
    },

    /** 用户取消：写 CANCELLED + finishedAt；调用方（enqueue.cancelTask）在
     *  此之前已经按需调过 `interrupt()` 让 ComfyUI 也丢掉 prompt。 */
    async cancel(taskId: string): Promise<void> {
      await db
        .update(task)
        .set({ status: "CANCELLED", finishedAt: new Date() })
        .where(eq(task.id, taskId));
    },

    /** reaper 判决后的收口：从 ComfyUI 的 /history、/queue 对账回来才落，
     *  所以状态由调用方指定（SUCCEEDED 或 FAILED）、error 允许 null。 */
    async finalizeFromReaper(
      taskId: string,
      status: "SUCCEEDED" | "FAILED",
      error: string | null,
    ): Promise<void> {
      await db
        .update(task)
        .set({ status, finishedAt: new Date(), error })
        .where(eq(task.id, taskId));
    },

    /** 用户取消路径的前置判：只取 status 与 promptId 两列，避免把 workflowSnapshot /
     *  logs 这种大字段拉回来。 */
    async findStatusAndPromptById(
      taskId: string,
    ): Promise<{ status: string; promptId: string | null } | null> {
      const rows = await db
        .select({ status: task.status, promptId: task.promptId })
        .from(task)
        .where(eq(task.id, taskId))
        .limit(1);
      return rows[0] ?? null;
    },

    /** 任务日志整包回写（`runner-state.persistLogs` 的落库边）。
     *  `.catch(→undefined)` 是**故意的**：日志面板的内存视图仍完整，这一次
     *  没持久化不影响业务；真故障由上层的 `deps.log.warn` 走镜像通道。 */
    async replaceLogs(taskId: string, logs: unknown[]): Promise<void> {
      await db
        .update(task)
        .set({ logs })
        .where(eq(task.id, taskId))
        .catch(() => undefined);
    },

    /** reaper 扫 QUEUED 孤儿：5 条件 AND（QUEUED + `finishedAt IS NULL` +
     *  `createdAt < cutoff` + `promptId IS NULL` + 归属 `owner` 片），逐个破一
     *  条都不返。`owner` 缺省 `'inline'`（NULL 归 inline，与现状全 NULL 的行
     *  集等价）；host 进程注入 `'host'` 后只收自己那份——灰度期两进程并存时
     *  互相看不见对方的孤儿，防跨片误杀。 */
    async listStaleQueued(
      cutoff: Date,
      take: number,
      owner: TaskClaimMode = "inline",
    ): Promise<Array<{ id: string; createdAt: Date; workflowName: string }>> {
      return db
        .select({
          id: task.id,
          createdAt: task.createdAt,
          workflowName: task.workflowName,
        })
        .from(task)
        .where(
          and(
            eq(task.status, "QUEUED"),
            isNull(task.finishedAt),
            lt(task.createdAt, cutoff),
            isNull(task.promptId),
            ownedBy(owner),
          ),
        )
        .limit(take);
    },

    /** reaper 扫 RUNNING 孤儿：与 Queued 版对偶，多一条 `promptId IS NOT NULL`
     *  （带 promptId 的行归 ComfyUI 负责、由 /history 与 /queue 对账）。归属
     *  分片同 Queued 版。 */
    async listStaleRunning(
      cutoff: Date,
      take: number,
      owner: TaskClaimMode = "inline",
    ): Promise<
      Array<{
        id: string;
        promptId: string | null;
        createdAt: Date;
        workflowName: string;
      }>
    > {
      return db
        .select({
          id: task.id,
          promptId: task.promptId,
          createdAt: task.createdAt,
          workflowName: task.workflowName,
        })
        .from(task)
        .where(
          and(
            eq(task.status, "RUNNING"),
            isNull(task.finishedAt),
            lt(task.createdAt, cutoff),
            isNotNull(task.promptId),
            ownedBy(owner),
          ),
        )
        .limit(take);
    },

    /** executor-finalize 成功后落 TaskImage 行（含封面/排序/媒体类型/种子/尺寸）。
     *  `width` / `height` 缺省时存 null（非图像类没有语义尺寸）。 */
    async createImages(
      taskId: string,
      images: Array<{
        localPath: string;
        sortIndex: number;
        isCover: boolean;
        mediaType: string;
        seed: string | null;
        width?: number | null;
        height?: number | null;
      }>,
    ): Promise<void> {
      await db.insert(taskImage).values(
        images.map((im) => ({
          taskId,
          localPath: im.localPath,
          sortIndex: im.sortIndex,
          isCover: im.isCover,
          mediaType: im.mediaType,
          seed: im.seed,
          width: im.width ?? null,
          height: im.height ?? null,
        })),
      );
    },
  };
}

/** impl 返回对象的形状；`repository-task.ts` 里 delegate 用
 *  `TaskRepoImpl["method"]` 反推签名，避免与 impl 漂移。 */
export type TaskRepoImpl = ReturnType<typeof createTaskRepoImpl>;
