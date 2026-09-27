/**
 * `repository-task-impl.ts` — Task 仓储**执行链侧** 14 个方法的实现（工厂）
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
import { and, eq, inArray, isNull, lt, notInArray, or } from "drizzle-orm";

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

/** `ownedBy()` 的内存侧同判据（行已经在手里、只需分类「为什么没写进去」时用）。
 *  两条必须同步改：SQL 侧漏一行、内存侧多认一行，就会把别人的行判成「归我」。 */
function isOwnedBy(claimedBy: string | null, owner: TaskClaimMode): boolean {
  return owner === "host"
    ? claimedBy === "host"
    : claimedBy === null || claimedBy === "inline";
}

/**
 * 一次收口写入的结果（P3 §5 ADR §14 D4）。
 *
 * 为什么要四态而不是 boolean：调用点在「0 行受影响」时真正需要知道的是**原因**——
 * 「这一行已经被别处收口了（我的结果该丢）」和「这一行不归我这个宿主（我根本不该
 * 动它）」走的是两条完全不同的排障路径，混成一个 false 就只能靠日志猜。
 */
export type TaskWriteOutcome =
  "written" | "skipped-terminal" | "skipped-not-owned" | "skipped-missing";

/**
 * 14 个 exec-chain 方法的实现工厂（12 个 delegate 自 class + Phase 3-A 新增的
 * `claimNextQueued` + 3-B1 新增的 `findExecJob`；两者暂不进 class delegate——
 * 领取循环是 host 独占的 pull，直接调 impl）。
 *
 * Next 侧：`createTaskRepoImpl(db, { owner: "inline" })`（`repository-task.ts`
 * 模块顶层，`db` 来自 `~/lib/db`）；host 侧：`createTaskRepoImpl(drizzle(
 * createClient({url: "file:./db.sqlite"})), { owner: "host" })`——同一份 SQL、
 * 两种客户端注入，加上各自的归属声明。
 *
 * `owner` 是**构造期声明**而不是逐调用点传参：一条行的归属只能由写它的那个宿主
 * 声明，漏传比错传更危险（默认成 inline 会让 host 悄悄改写别人的行），所以形参
 * 故意做成必填。
 *
 * `TaskRepoDb` 是结构最小约束（见 `./repository-task-impl-types`），只锁本
 * 文件用到的 `.select()/.update()/.insert()` 三条 builder；drizzle 的
 * libsql / better-sqlite3 两种 adapter 都天然满足，测试里可以直接把
 * `createTestDb()` 传进来（走 `as unknown as TaskRepoDb` 一次性断言）。
 */
export function createTaskRepoImpl(
  db: TaskRepoDb,
  options: { owner: TaskClaimMode },
) {
  const { owner } = options;

  /** 收口写入的共用守卫：终态不再被改写 + 只动自己那一片（ADR §14 D4）。 */
  function writeGuard(taskId: string) {
    return and(
      eq(task.id, taskId),
      notInArray(task.status, TERMINAL_STATES),
      ownedBy(owner),
    );
  }

  /** 「0 行受影响」时的原因分类——只在输掉的那条路径上多付一次读。 */
  async function classifySkipped(taskId: string): Promise<TaskWriteOutcome> {
    const rows = await db
      .select({ status: task.status, claimedBy: task.claimedBy })
      .from(task)
      .where(eq(task.id, taskId))
      .limit(1);
    const row = rows[0];
    if (!row) return "skipped-missing";
    if (!isOwnedBy(row.claimedBy, owner)) return "skipped-not-owned";
    return "skipped-terminal";
  }

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
     * 进度回写（顺带把行标成 RUNNING）：**只在非终态、且归本宿主的行上生效**。
     *
     * 判据与旧注释一致（`repository-task.ts` 里原 JSDoc 完整解释过）：执行
     * 路径异步，ComfyUI 的 WS progress 帧与本任务被别的路径收口可能交错；一条
     * 收口之后迟到的进度回写会把行从 SUCCEEDED/FAILED/CANCELLED 打回 RUNNING、
     * SSE 客户端就永远卡在「生成中…」。返回是否真的更新了行。
     *
     * `node`（P3 §5 ADR §13-3C D1）是当前执行节点快照，SSE 纯轮询化后画布
     * 「当前节点 + 步数」只能从 DB 读；`undefined` = 本帧无节点信息，**不覆写**
     * 原值（保留上一个节点，标签不闪没）。
     */
    async updateProgress(
      taskId: string,
      pct: number,
      node?: { id: string; label?: string; value: number; max: number },
    ): Promise<boolean> {
      const updated = await db
        .update(task)
        .set({
          progress: pct,
          status: "RUNNING",
          ...(node !== undefined ? { progressNode: node } : {}),
        })
        .where(writeGuard(taskId))
        .returning({ id: task.id });
      return updated.length > 0;
    },

    /** 记下 promptId 并标 RUNNING（守卫同 updateProgress：非终态 + 归本宿主）。 */
    async markRunning(taskId: string, promptId: string): Promise<boolean> {
      const updated = await db
        .update(task)
        .set({ status: "RUNNING", promptId })
        .where(writeGuard(taskId))
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

    /** host 领取后重建 Job 的行读（P3 §5 ADR §13-3B1 决定 1）：执行载荷取
     *  `execPayload`（提交时刻的 RAW 原件）、覆盖项取 `params.workflowInputs`，
     *  **不经 workflowName 回查模板**——模板被改/删不影响在队任务执行提交时的图。
     *  找不到行返回 null（行已被回收/删除，调用方跳过并记日志即可）。
     *
     *  带归属条件是刻意的：这条读出来的就是**要交给 ComfyUI 执行的图**，跨片读到
     *  别人的载荷（比如误把 inline 的 id 递进 host 的 tick）等于替别的宿主起跑。 */
    async findExecJob(taskId: string): Promise<{
      workflowName: string;
      execPayload: unknown;
      params: unknown;
    } | null> {
      const rows = await db
        .select({
          workflowName: task.workflowName,
          execPayload: task.execPayload,
          params: task.params,
        })
        .from(task)
        .where(and(eq(task.id, taskId), ownedBy(owner)))
        .limit(1);
      return rows[0] ?? null;
    },

    /** 成功收口：写 SUCCEEDED + progress=100 + finishedAt；有 workflowSnapshot
     *  时一并落，允许后续按产物完整复现（种子已经在 resultImages / params 里）。
     *  受 `writeGuard` 约束：已终态的行与不归本宿主的行都不改写（ADR §14 D4）。 */
    async finalizeSuccess(
      taskId: string,
      data: {
        resultImages: unknown;
        params: unknown;
        workflowSnapshot?: unknown;
      },
    ): Promise<TaskWriteOutcome> {
      const updated = await db
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
        .where(writeGuard(taskId))
        .returning({ id: task.id });
      return updated.length > 0 ? "written" : classifySkipped(taskId);
    },

    /** 失败收口：写 FAILED + error + finishedAt；`validationErrors` 空数组与
     *  undefined 都归一存 null，非空才 stringify。
     *
     *  守卫前这里是**无条件 UPDATE**：host 把用户取消的行 SIGKILL 之后，被杀进程
     *  的 close 回调会走到这里，把 `CANCELLED` 改写回 `FAILED`（用户体感「点了
     *  取消却显示失败」）。见 ADR §14 签字前核实的事实 2。 */
    async finalizeFailure(
      taskId: string,
      error: string,
      validationErrors?: unknown[],
    ): Promise<TaskWriteOutcome> {
      const updated = await db
        .update(task)
        .set({
          status: "FAILED",
          error,
          validationErrors: validationErrors?.length
            ? JSON.stringify(validationErrors)
            : null,
          finishedAt: new Date(),
        })
        .where(writeGuard(taskId))
        .returning({ id: task.id });
      return updated.length > 0 ? "written" : classifySkipped(taskId);
    },

    /** 用户取消：写 CANCELLED + finishedAt。
     *
     * **归属例外的唯一一处**（ADR §14 D4）：取消这个动作只活在 Next 进程里，而
     * host 名下的行也必须能被取消，所以这里刻意不叠 `ownedBy(owner)`——叠了就等于
     * 把「Next 取消 host 任务」这条合法路径堵死。跨归属的只有**状态标记**：
     * 「kill 在飞执行」仍归 owner 自己做（host 的 `reconcileCancelled` /
     * inline 的自己名下 `cliProcs`），非 owner 不越界碰执行细节。
     *
     * 终态守卫照常叠：对已结束的任务点取消不该把 SUCCEEDED 翻成 CANCELLED。 */
    async cancel(taskId: string): Promise<TaskWriteOutcome> {
      const updated = await db
        .update(task)
        .set({ status: "CANCELLED", finishedAt: new Date() })
        .where(
          and(eq(task.id, taskId), notInArray(task.status, TERMINAL_STATES)),
        )
        .returning({ id: task.id });
      return updated.length > 0 ? "written" : classifySkipped(taskId);
    },

    /** reaper 判决后的收口：从 ComfyUI 的 /history、/queue 对账回来才落，
     *  所以状态由调用方指定（SUCCEEDED 或 FAILED）、error 允许 null。
     *  受 `writeGuard` 约束：reaper 的 repo 实例 owner 必须与 `configureReaper`
     *  传的 owner 同源，否则这里会静默 skip（判成 `skipped-not-owned`）。 */
    async finalizeFromReaper(
      taskId: string,
      status: "SUCCEEDED" | "FAILED",
      error: string | null,
    ): Promise<TaskWriteOutcome> {
      const updated = await db
        .update(task)
        .set({ status, finishedAt: new Date(), error })
        .where(writeGuard(taskId))
        .returning({ id: task.id });
      return updated.length > 0 ? "written" : classifySkipped(taskId);
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
     *  没持久化不影响业务；真故障由上层的 `deps.log.warn` 走镜像通道。
     *
     *  只带归属守卫、**不带终态守卫**：收口之后仍会有尾随日志（耗时、产物路径、
     *  取消原因），按终态挡掉就等于把失败原因从面板上抹掉——那条正是排障要看的。 */
    async replaceLogs(taskId: string, logs: unknown[]): Promise<void> {
      await db
        .update(task)
        .set({ logs })
        .where(and(eq(task.id, taskId), ownedBy(owner)))
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

    /** reaper 扫 RUNNING 孤儿（ISSUE #1184 起**不再要求 `promptId` 非空**）：
     *  曾经带一条 `promptId IS NOT NULL`，于是「已被领取、但 comfy-cli 还没把
     *  `prompt_id` 回传落库」的 RUNNING 行两边都不匹配——`listStaleQueued` 只要
     *  `QUEUED`、本条不要空 promptId——宿主在那段窗口里崩溃就再没有任何回收兜底，
     *  界面永久停「生成中」。现在这类行也交出来，由判决侧按「本进程是否还认领它」
     *  定夺（`reaper.ts` 的 `isTaskClaimedInProcess` + 两轮观察）。 */
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
