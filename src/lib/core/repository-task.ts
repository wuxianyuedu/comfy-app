/**
 * `repository-task.ts` — Task 业务仓储（Drizzle 版）
 * @module core/repository-task
 */
import "server-only";

import { db } from "@/lib/db";
import { task, taskImage, type Task } from "~/server/db/schema";
import { NotFoundError } from "./errors";
import { DrizzleRepository, type TaskWithCover } from "./repository-base";
import {
  eq,
  and,
  inArray,
  desc,
  asc,
  lt,
  isNull,
  isNotNull,
} from "drizzle-orm";

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
    }
  ): Promise<TaskWithCover[]>;
  async listByUser(
    userId: string,
    opts?: {
      projectId?: string;
      take?: number;
      skip?: number;
      statusList?: string[];
      includeImages?: boolean;
    }
  ): Promise<Task[]>;
  async listByUser(
    userId: string,
    opts?: {
      projectId?: string;
      take?: number;
      skip?: number;
      statusList?: string[];
      includeImages?: boolean;
    }
  ): Promise<Task[] | TaskWithCover[]> {
    const where = and(
      eq(task.userId, userId),
      opts?.projectId ? eq(task.projectId, opts.projectId) : undefined,
      opts?.statusList?.length
        ? inArray(task.status, opts.statusList)
        : undefined
    );
    if (opts?.includeImages) {
      const rows = await db.query.task.findMany({
        where,
        orderBy: [desc(task.createdAt)],
        ...(opts.take !== undefined ? { limit: opts.take } : {}),
        ...(opts.skip !== undefined ? { offset: opts.skip } : {}),
        with: { images: { orderBy: [desc(taskImage.isCover), asc(taskImage.sortIndex)] } },
      });
      return rows;
    }
    let q = db.select().from(task).where(where).orderBy(desc(task.createdAt));
    if (opts?.take !== undefined) q = q.limit(opts.take) as typeof q;
    if (opts?.skip !== undefined) q = q.offset(opts.skip) as typeof q;
    return q;
  }

  async findByIdForUser(userId: string, id: string): Promise<Task | null> {
    const t = await this.findById(id);
    return t?.userId === userId ? t : null;
  }

  async updateStatusForUser(
    userId: string,
    id: string,
    status: string,
    extra?: Partial<Task>
  ): Promise<Task> {
    const existing = await this.findByIdForUser(userId, id);
    if (!existing) throw new NotFoundError(`任务不存在: ${id}`);
    const data: Partial<Task> = { status };
    if (extra) Object.assign(data, extra);
    const rows = await db.update(task).set(data).where(eq(task.id, id)).returning();
    return rows[0]!;
  }

  async findByIdWithImages(id: string) {
    return db.query.task.findFirst({
      where: eq(task.id, id),
      with: { images: { orderBy: [desc(taskImage.isCover), asc(taskImage.sortIndex)] } },
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
    id: string
  ): Promise<{ workflowSnapshot: unknown; projectId: string | null } | null> {
    const rows = await db
      .select({ workflowSnapshot: task.workflowSnapshot, projectId: task.projectId })
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

  async findExecutionMeta(
    taskId: string
  ): Promise<{
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

  async findExecutionProgress(
    taskId: string
  ): Promise<{ status: string; progress: number; resultImages: unknown } | null> {
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

  async updateProgress(taskId: string, pct: number): Promise<void> {
    await db
      .update(task)
      .set({ progress: pct, status: "RUNNING" })
      .where(eq(task.id, taskId));
  }

  async markRunning(taskId: string, promptId: string): Promise<void> {
    await db
      .update(task)
      .set({ status: "RUNNING", promptId })
      .where(eq(task.id, taskId));
  }

  async finalizeSuccess(
    taskId: string,
    data: { resultImages: unknown; params: unknown; workflowSnapshot?: unknown }
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
    validationErrors?: unknown[]
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
    error: string | null
  ): Promise<void> {
    await db
      .update(task)
      .set({ status, finishedAt: new Date(), error })
      .where(eq(task.id, taskId));
  }

  async findStatusAndPromptById(
    taskId: string
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
    take: number
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
          isNull(task.promptId)
        )
      )
      .limit(take);
  }

  async listStaleRunning(
    cutoff: Date,
    take: number
  ): Promise<
    Array<{ id: string; promptId: string | null; createdAt: Date; workflowName: string }>
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
          isNotNull(task.promptId)
        )
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
    }>
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
      }))
    );
  }
}

export const taskRepository = new TaskRepository();
