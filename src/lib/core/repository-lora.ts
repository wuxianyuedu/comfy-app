/**
 * `repository-lora.ts` — LoraTrainingJob 业务仓储（Drizzle 版）
 * @module core/repository-lora
 */
import { db } from "@/lib/db";
import { loraTrainingJob, type LoraTrainingJob } from "~/server/db/schema";
import { DrizzleRepository } from "./repository-base";
import { eq, and, desc } from "drizzle-orm";

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

  async findByIdForUser(
    userId: string,
    id: string,
    select?: unknown
  ): Promise<LoraTrainingJob | null> {
    if (select) {
      const rows = await db
        .select(select as never)
        .from(loraTrainingJob)
        .where(and(eq(loraTrainingJob.id, id), eq(loraTrainingJob.userId, userId)))
        .limit(1);
      return rows[0] ?? null;
    }
    const rows = await db
      .select()
      .from(loraTrainingJob)
      .where(and(eq(loraTrainingJob.id, id), eq(loraTrainingJob.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
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
    entry: { t: number; level: "info" | "progress" | "warn" | "error" | "success"; msg: string }
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
      .set({ logs: arr, updatedAt: new Date() })
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
      .set({ progress: Math.min(100, Math.max(0, pct)), status: "RUNNING" })
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
