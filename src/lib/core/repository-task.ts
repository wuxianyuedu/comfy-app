/**
 * `repository-task.ts` — Task 业务仓储（Drizzle 版）
 * @module core/repository-task — Task 业务仓储（Drizzle 版）
 */
import "server-only";

import { db } from "~/lib/db";
import { task, taskImage, type Task, type TaskImage } from "~/server/db/schema";
import { NotFoundError } from "./errors";
import { DrizzleRepository, type TaskWithCover } from "./repository-base";
import { TERMINAL_TASK_STATUSES } from "../task-state";
import {
  eq,
  and,
  inArray,
  notInArray,
  desc,
  asc,
  lt,
  isNull,
  isNotNull,
  sql,
} from "drizzle-orm";

/** 列表卡的行形状：`task.list` 的映射只需要十来个字段，而 `workflowSnapshot`
 *  （整份工作流 JSON）与 `logs`（全量日志）单行就能到数 MB —— take=60 的列表页
 *  会把它们整批拉回来、反序列化、然后立刻丢弃。列表查询排除这两列。 */
export type TaskCardRow = Omit<Task, "workflowSnapshot" | "logs">;

/**
 * SQLite 表达「不限条数，只跳过前 n 条」的写法是 `LIMIT -1 OFFSET n` ——
 * 光有 `OFFSET` 是**语法错误**（`near "offset": syntax error`）。
 *
 * 为什么不用 `.limit(-1)`：drizzle 的 `offset()` 在 SQLite 上会把链上的
 * `limit` **整个丢掉**（实测 `limit(-1).offset(1)` 生成的 SQL 里没有 limit，
 * 运行时直接抛语法错误）。传 `sql` 片段才不会被它吃掉。relational query
 * （`db.query.*.findMany`）更彻底 —— `limit: -1` 直接被忽略，所以那条路
 * 只能改用「普通 select 取页 + 按 id 装载关联」。
 *
 * 类型上 `limit()` 只声明 `number | Placeholder`，所以这里收成一个窄助手
 * （断言集中在**这一处**，而不是散在调用点）。
 */
const NO_LIMIT = sql`-1`;

/**
 * 终态集合的 SQL 形态：由 `~/lib/task-state` 的唯一定义摊平而来。
 *
 * 为什么必须摊平：drizzle 的 `where` 是 SQL 表达式，收不下 TS 谓词
 * （`isTerminalTaskStatus`），所以这里必然要有一份数组。但**判据只能有一处
 * 定义**（规范 §12.12）——因此这是派生值，新增状态时改那边即自动生效。
 */
const TERMINAL_STATES: string[] = [...TERMINAL_TASK_STATUSES];

/** 把「不限条数」作为 limit 传下去（run-time 是 `sql` 片段，见 NO_LIMIT 注释）。 */
function limitAll<Q extends { limit(n: number): unknown }>(q: Q): Q {
  return (q as unknown as { limit(n: unknown): Q }).limit(NO_LIMIT);
}

/**
 * 按 id 批量装载封面图（封面优先、再按 sortIndex 升序），保持入参顺序。
 *
 * 用途：`listByUser` 的「只给 skip 不给 take」分页走普通 select 取页（relational
 * query 表达不了无 limit 的 offset），但对外仍要返回带 images 的行 —— 与其在
 * 两处分头拼 `with`，不如把「按 id 装载」收到这里，保证两种取法给出同一形状。
 */
async function attachImages(rows: Task[]): Promise<TaskWithCover[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const images = await db
    .select()
    .from(taskImage)
    .where(inArray(taskImage.taskId, ids))
    .orderBy(desc(taskImage.isCover), asc(taskImage.sortIndex));
  const byTask = new Map<string, typeof images>();
  for (const img of images) {
    const list = byTask.get(img.taskId) ?? [];
    list.push(img);
    byTask.set(img.taskId, list);
  }
  return rows.map((r) => ({ ...r, images: byTask.get(r.id) ?? [] }));
}

export class TaskRepository extends DrizzleRepository<Task> {
  constructor() {
    super(task, task.id);
  }

  async createQueued(input: {
    userId: string;
    type: string;
    prompt: string;
    negativePrompt?: string | null;
    params: unknown;
    workflowName: string;
    projectId?: string | null;
    referenceImages?: unknown;
    workflowSnapshot?: unknown;
  }): Promise<Task> {
    const rows = await db
      .insert(task)
      .values({
        userId: input.userId,
        type: input.type,
        prompt: input.prompt,
        negativePrompt: input.negativePrompt ?? null,
        params: input.params,
        workflowName: input.workflowName,
        projectId: input.projectId ?? null,
        referenceImages: input.referenceImages ?? undefined,
        workflowSnapshot: input.workflowSnapshot ?? undefined,
        status: "QUEUED",
      })
      .returning();
    return rows[0]!;
  }

  async listByUser(
    userId: string,
    opts: {
      projectId?: string;
      take?: number;
      skip?: number;
      statusList?: string[];
      includeImages: true;
    },
  ): Promise<Array<TaskCardRow & { images: TaskImage[] }>>;
  async listByUser(
    userId: string,
    opts?: {
      projectId?: string;
      take?: number;
      skip?: number;
      statusList?: string[];
      includeImages?: boolean;
    },
  ): Promise<Task[]>;
  async listByUser(
    userId: string,
    opts?: {
      projectId?: string;
      take?: number;
      skip?: number;
      statusList?: string[];
      includeImages?: boolean;
    },
  ): Promise<
    Task[] | TaskWithCover[] | Array<TaskCardRow & { images: TaskImage[] }>
  > {
    const where = and(
      eq(task.userId, userId),
      opts?.projectId ? eq(task.projectId, opts.projectId) : undefined,
      opts?.statusList?.length
        ? inArray(task.status, opts.statusList)
        : undefined,
    );
    if (opts?.includeImages) {
      const withImages = (rows: Task[]) => attachImages(rows);
      // 分页口径与下面普通 select 分支**必须一致**：drizzle 的 relational
      // query 只认 `limit`（`limit: -1` 会被整个丢掉，实测），所以「只给 skip」
      // 那条路走不了它 —— 先用普通 select 取到这一页的 id，再按 id 装载图片。
      // 两条路都产出「同一页 + 同一份 images」，顺序由外层 orderBy 保证。
      if (opts.skip !== undefined && opts.take === undefined) {
        const page = await limitAll(
          db.select().from(task).where(where).orderBy(desc(task.createdAt)),
        ).offset(opts.skip);
        return withImages(page);
      }
      const rows = await db.query.task.findMany({
        where,
        orderBy: [desc(task.createdAt)],
        ...(opts.take !== undefined ? { limit: opts.take } : {}),
        /* 列表卡只要十来个字段：`workflowSnapshot` 与 `logs` 单行可达数 MB，
         * take=60 时是几十 MB 的白拉白反序列化（router 只映射卡片字段）。
         * 详情查询（findByIdWithImages）不受影响，仍取全列。 */
        columns: { workflowSnapshot: false, logs: false },
        with: {
          images: {
            orderBy: [desc(taskImage.isCover), asc(taskImage.sortIndex)],
          },
        },
      });
      return rows;
    }
    const q = db.select().from(task).where(where).orderBy(desc(task.createdAt));
    if (opts?.skip === undefined) {
      return opts?.take !== undefined ? q.limit(opts.take) : q;
    }
    // `skip` 单独给时补 `LIMIT -1`（见上方 NO_LIMIT 的注释：不能写数字 -1，
    // drizzle 的 offset() 会把数字 limit 丢掉）。此前这条路径生成的是不带
    // limit 的 `… offset ?`，better-sqlite3 抛 `near "offset": syntax error`
    // —— 调用方拿到的是一次 500，而不是「第二页」。
    const paged = opts.take !== undefined ? q.limit(opts.take) : limitAll(q);
    return paged.offset(opts.skip);
  }

  async findByIdForUser(userId: string, id: string): Promise<Task | null> {
    const t = await this.findById(id);
    return t?.userId === userId ? t : null;
  }

  async updateStatusForUser(
    userId: string,
    id: string,
    status: string,
    extra?: Partial<Task>,
  ): Promise<Task> {
    const existing = await this.findByIdForUser(userId, id);
    if (!existing) throw new NotFoundError(`任务不存在: ${id}`);
    const data: Partial<Task> = { status };
    if (extra) Object.assign(data, extra);
    const rows = await db
      .update(task)
      .set(data)
      .where(eq(task.id, id))
      .returning();
    return rows[0]!;
  }

  async findByIdWithImages(id: string) {
    return db.query.task.findFirst({
      where: eq(task.id, id),
      with: {
        images: {
          orderBy: [desc(taskImage.isCover), asc(taskImage.sortIndex)],
        },
      },
    });
  }

  async findStatusById(id: string): Promise<{ status: string } | null> {
    const rows = await db
      .select({ status: task.status })
      .from(task)
      .where(eq(task.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findSnapshotById(
    id: string,
  ): Promise<{ workflowSnapshot: unknown; projectId: string | null } | null> {
    const rows = await db
      .select({
        workflowSnapshot: task.workflowSnapshot,
        projectId: task.projectId,
      })
      .from(task)
      .where(eq(task.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByProjectIdWithImages(projectId: string) {
    return db.query.task.findMany({
      where: eq(task.projectId, projectId),
      orderBy: [desc(task.createdAt)],
      with: { images: { orderBy: [asc(taskImage.sortIndex)] } },
    });
  }

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
  }

  async findExecutionProgress(taskId: string): Promise<{
    status: string;
    progress: number;
    resultImages: unknown;
  } | null> {
    const rows = await db
      .select({
        status: task.status,
        progress: task.progress,
        resultImages: task.resultImages,
      })
      .from(task)
      .where(eq(task.id, taskId))
      .limit(1);
    return rows[0] ?? null;
  }

  /** `findExecutionProgress` 的批量版。
   *
   * 成片监看每 4s 一轮、每轮要按镜头取十几个任务的进度，逐个查就是每轮 N 次
   * 往返（N = 镜头数），跑满 240 轮是上万次查询；批量版一轮只发一条 `IN`。
   * 这里连 `resultImages` 一起取（成片镜头要从中挑视频路径），避免调用方
   * 为拿它再查一遍。 */
  async findExecutionProgressMany(taskIds: string[]): Promise<
    Array<{
      id: string;
      status: string;
      progress: number;
      resultImages: unknown;
    }>
  > {
    if (!taskIds.length) return [];
    return db
      .select({
        id: task.id,
        status: task.status,
        progress: task.progress,
        resultImages: task.resultImages,
      })
      .from(task)
      .where(inArray(task.id, taskIds));
  }

  /** SSE 轮询的轻量快照：只要状态与进度这几个字段。
   *
   *  每条 SSE 连接各挂一个轮询、每几秒一次，原先用 `findById` 全行查询 ——
   *  `workflowSnapshot`（整份工作流 JSON）与 `logs`（全量日志）单行可达数 MB，
   *  拉回来只为了读状态和进度。 */
  async findSseSnapshot(id: string): Promise<{
    status: string;
    progress: number;
    error: string | null;
    validationErrors: string | null;
    workflowName: string | null;
  } | null> {
    const rows = await db
      .select({
        status: task.status,
        progress: task.progress,
        error: task.error,
        validationErrors: task.validationErrors,
        workflowName: task.workflowName,
      })
      .from(task)
      .where(eq(task.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * 进度回写（顺带把行标成 RUNNING）：**只在非终态行上生效**。
   *
   * 为什么必须加 `NOT IN (...)` 这个 where 条件：执行路径是异步的，
   * ComfyUI 的 WS `progress` 帧与「本任务已被别的路径收口（reaper 判终态 /
   * 用户取消）」可能交错到达。一条收口之后迟到的进度回写会把 DB 行从
   * SUCCEEDED / FAILED / CANCELLED **改回 RUNNING**，于是：
   *   • `/api/tasks/[id]/stream` 的 3s「数据库实情」轮询先看到终态 → 关流；
   *     之后再看到 RUNNING → 客户端已经关掉的流不会重开，卡片永远停在
   *     「生成中…」；
   *   • 终态行还带着 `finishedAt`，与 status 自相矛盾。
   *
   * 返回是否真的更新了行（调用方据此判断「本任务是否已被别人收口」）。
   */
  async updateProgress(taskId: string, pct: number): Promise<boolean> {
    const updated = await db
      .update(task)
      .set({ progress: pct, status: "RUNNING" })
      .where(and(eq(task.id, taskId), notInArray(task.status, TERMINAL_STATES)))
      .returning({ id: task.id });
    return updated.length > 0;
  }

  /** 记下 promptId 并标 RUNNING（同样只对非终态行生效，理由见 updateProgress）。 */
  async markRunning(taskId: string, promptId: string): Promise<boolean> {
    const updated = await db
      .update(task)
      .set({ status: "RUNNING", promptId })
      .where(and(eq(task.id, taskId), notInArray(task.status, TERMINAL_STATES)))
      .returning({ id: task.id });
    return updated.length > 0;
  }

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
  }

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
  }

  async cancel(taskId: string): Promise<void> {
    await db
      .update(task)
      .set({ status: "CANCELLED", finishedAt: new Date() })
      .where(eq(task.id, taskId));
  }

  async finalizeFromReaper(
    taskId: string,
    status: "SUCCEEDED" | "FAILED",
    error: string | null,
  ): Promise<void> {
    await db
      .update(task)
      .set({ status, finishedAt: new Date(), error })
      .where(eq(task.id, taskId));
  }

  async findStatusAndPromptById(
    taskId: string,
  ): Promise<{ status: string; promptId: string | null } | null> {
    const rows = await db
      .select({ status: task.status, promptId: task.promptId })
      .from(task)
      .where(eq(task.id, taskId))
      .limit(1);
    return rows[0] ?? null;
  }

  async replaceLogs(taskId: string, logs: unknown[]): Promise<void> {
    await db
      .update(task)
      .set({ logs })
      .where(eq(task.id, taskId))
      .catch(() => undefined);
  }

  async listStaleQueued(
    cutoff: Date,
    take: number,
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
        ),
      )
      .limit(take);
  }

  async listStaleRunning(
    cutoff: Date,
    take: number,
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
        ),
      )
      .limit(take);
  }

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
  }
}

export const taskRepository = new TaskRepository();
