/**
 * `repository-lora.ts` — LoraTrainingJob 业务仓储（Drizzle 版）
 * @module core/repository-lora — LoraTrainingJob 业务仓储（Drizzle 版）
 */
import "server-only";

import { db } from "~/lib/db";
import { clampPct } from "~/lib/progress";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { loraTrainingJob, type LoraTrainingJob } from "~/server/db/schema";
import { DrizzleRepository } from "./repository-base";
import { tailWindow } from "~/lib/page-window";
import { eq, and, desc } from "drizzle-orm";

/** 单个训练任务的日志行数上限（理由同 `repository-film` 的 `appendLog`：
 *  `logs` 是 JSON 列，读改写整列的成本随条数线性变贵）。 */
const LOGS_MAX = 500;

export class LoraTrainingJobRepository extends DrizzleRepository<LoraTrainingJob> {
  constructor() {
    super(loraTrainingJob, loraTrainingJob.id);
  }

  async listByUser(userId: string): Promise<LoraTrainingJob[]> {
    return db
      .select()
      .from(loraTrainingJob)
      .where(eq(loraTrainingJob.userId, userId))
      .orderBy(desc(loraTrainingJob.createdAt))
      .limit(100);
  }

  async createQueued(input: {
    userId: string;
    name: string;
    baseModel: string;
    triggerWord: string;
    classWord?: string | null;
    datasetImages: unknown;
    resolution: number;
    steps: number;
    batchSize: number;
    learningRate: number;
    rankDim: number;
    networkAlpha: number;
    optimizer: string;
    scheduler: string;
    seed: number;
  }): Promise<LoraTrainingJob> {
    const rows = await db
      .insert(loraTrainingJob)
      .values({
        userId: input.userId,
        name: input.name,
        baseModel: input.baseModel,
        triggerWord: input.triggerWord,
        classWord: input.classWord ?? null,
        datasetImages: input.datasetImages,
        resolution: input.resolution,
        steps: input.steps,
        batchSize: input.batchSize,
        learningRate: input.learningRate,
        rankDim: input.rankDim,
        networkAlpha: input.networkAlpha,
        optimizer: input.optimizer,
        scheduler: input.scheduler,
        seed: input.seed,
        status: "QUEUED",
      })
      .returning();
    return rows[0]!;
  }

  /** 按用户取一条训练任务。
   *  `select` 收的是 **Drizzle 的列引用**（`{ id: loraTrainingJob.id }` 这种）。
   *  ⚠️ 迁移期这一度是 `select?: unknown` + `db.select(select as never)`：调用点写回
   *  Prisma 那套布尔投影（`{ id: true, status: true }`）时编译器一声不响，运行时生成
   *  的是空投影 → SQL 语法错，`train.cancel` 自 Prisma→Drizzle 迁移起每次都是 500，
   *  而这条路由没有执行者，所以没有任何一条红。类型收紧就是这条的判据：
   *  要减列就传列引用，别把布尔值递进来。 */
  async findByIdForUser(
    userId: string,
    id: string,
    select?: Record<string, AnySQLiteColumn>,
  ): Promise<LoraTrainingJob | null> {
    const rows = await (select ? db.select(select) : db.select())
      .from(loraTrainingJob)
      .where(
        and(eq(loraTrainingJob.id, id), eq(loraTrainingJob.userId, userId)),
      )
      .limit(1);
    return (rows[0] as LoraTrainingJob | undefined) ?? null;
  }

  async findStatusById(jobId: string): Promise<{ status: string } | null> {
    const rows = await db
      .select({ status: loraTrainingJob.status })
      .from(loraTrainingJob)
      .where(eq(loraTrainingJob.id, jobId))
      .limit(1);
    return rows[0] ?? null;
  }

  async appendLog(
    jobId: string,
    entry: {
      t: number;
      level: "info" | "progress" | "warn" | "error" | "success";
      msg: string;
    },
  ): Promise<void> {
    const job = await db
      .select({ logs: loraTrainingJob.logs })
      .from(loraTrainingJob)
      .where(eq(loraTrainingJob.id, jobId))
      .limit(1);
    const arr = (job[0]?.logs as unknown[] | null) ?? [];
    arr.push(entry);
    await db
      .update(loraTrainingJob)
      .set({ logs: tailWindow(arr, LOGS_MAX), updatedAt: new Date() })
      .where(eq(loraTrainingJob.id, jobId));
  }

  async markRunning(jobId: string): Promise<void> {
    await db
      .update(loraTrainingJob)
      .set({ status: "RUNNING", progress: 0 })
      .where(eq(loraTrainingJob.id, jobId));
  }

  async updateProgress(jobId: string, pct: number): Promise<void> {
    await db
      .update(loraTrainingJob)
      .set({ progress: clampPct(pct), status: "RUNNING" })
      .where(eq(loraTrainingJob.id, jobId));
  }

  async markDone(jobId: string, outputName: string): Promise<void> {
    await db
      .update(loraTrainingJob)
      .set({ status: "DONE", progress: 100, outputName, updatedAt: new Date() })
      .where(eq(loraTrainingJob.id, jobId));
  }

  async markFailed(jobId: string, error: string): Promise<void> {
    await db
      .update(loraTrainingJob)
      .set({ status: "FAILED", error, updatedAt: new Date() })
      .where(eq(loraTrainingJob.id, jobId));
  }

  async markCancelled(jobId: string): Promise<void> {
    await db
      .update(loraTrainingJob)
      .set({ status: "CANCELLED", updatedAt: new Date() })
      .where(eq(loraTrainingJob.id, jobId));
  }
}

export const loraTrainingJobRepository = new LoraTrainingJobRepository();
