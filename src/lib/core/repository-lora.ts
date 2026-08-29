/**
 * `repository-lora.ts` — LoraTrainingJob 业务仓储（LoRA 训练任务）
 * ===========================================================================
 *
 * LoRA 训练任务仓储。所有查询按 `userId` 隔离；创建时由训练队列参数
 * （steps/batchSize/learningRate 等）给出默认值，路由不再手写 `prisma.loraTrainingJob`。
 *
 * @module core/repository-lora
 */
import { prisma } from "@/lib/db";
import { type LoraTrainingJob, type Prisma } from "../../../generated/prisma";
import { PrismaRepository, type PrismaDelegate } from "./repository-base";

/**
 * LoRA 训练任务仓储。所有查询按 `userId` 隔离；创建时由训练队列参数
 * （steps/batchSize/learningRate 等）给出默认值，路由不再手写 `prisma.loraTrainingJob`。
 */
export class LoraTrainingJobRepository extends PrismaRepository<
  LoraTrainingJob,
  LoraTrainingJob,
  Partial<LoraTrainingJob>,
  { id: string }
> {
  constructor() {
    super(
      prisma.loraTrainingJob as unknown as PrismaDelegate<
        LoraTrainingJob,
        LoraTrainingJob,
        Partial<LoraTrainingJob>,
        { id: string }
      >
    );
  }

  /** 取某用户的训练任务（最近 100 条）。 */
  async listByUser(userId: string): Promise<LoraTrainingJob[]> {
    return prisma.loraTrainingJob.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  /** 创建排队中的训练任务（datasetImages 等 JSON 字段在此收口）。 */
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
    return prisma.loraTrainingJob.create({
      data: {
        userId: input.userId,
        name: input.name,
        baseModel: input.baseModel,
        triggerWord: input.triggerWord,
        classWord: input.classWord ?? null,
        datasetImages: input.datasetImages as Prisma.InputJsonValue,
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
      },
    });
  }

  /** 取单条且仅当归属该用户；可选投影（cancel 只需 id/status）。 */
  async findByIdForUser<S extends Prisma.LoraTrainingJobSelect | undefined = undefined>(
    userId: string,
    id: string,
    select?: S
  ): Promise<
    S extends Prisma.LoraTrainingJobSelect
      ? Prisma.LoraTrainingJobGetPayload<{ select: S }> | null
      : LoraTrainingJob | null
  > {
    return prisma.loraTrainingJob.findFirst({
      where: { id, userId },
      select,
    }) as never;
  }

  // ── 训练执行层（trainer.ts）──
  // 训练编排器按 jobId 精确寻址，不重复注入 userId；日志数组在此收口。

  /** 仅取状态（cancel 判断是否终态用）。 */
  async findStatusById(jobId: string): Promise<{ status: string } | null> {
    return prisma.loraTrainingJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
  }

  /** 追加一条训练日志（读 logs → push → 覆写，updatedAt 一并刷新）。 */
  async appendLog(
    jobId: string,
    entry: { t: number; level: "info" | "progress" | "warn" | "error" | "success"; msg: string }
  ): Promise<void> {
    const job = await prisma.loraTrainingJob.findUnique({
      where: { id: jobId },
      select: { logs: true },
    });
    const arr = (job?.logs as unknown[] | null) ?? [];
    arr.push(entry);
    await prisma.loraTrainingJob.update({
      where: { id: jobId },
      data: { logs: arr as Prisma.InputJsonValue, updatedAt: new Date() },
    });
  }

  /** 后端确认接收后标记 RUNNING（progress 归零）。 */
  async markRunning(jobId: string): Promise<void> {
    await prisma.loraTrainingJob.update({
      where: { id: jobId },
      data: { status: "RUNNING", progress: 0 },
    });
  }

  /** 训练进度回写（钳制到 0-100，保持 RUNNING）。 */
  async updateProgress(jobId: string, pct: number): Promise<void> {
    await prisma.loraTrainingJob.update({
      where: { id: jobId },
      data: { progress: Math.min(100, Math.max(0, pct)), status: "RUNNING" },
    });
  }

  /** 训练成功收口：DONE + 100% + 产出文件名。 */
  async markDone(jobId: string, outputName: string): Promise<void> {
    await prisma.loraTrainingJob.update({
      where: { id: jobId },
      data: { status: "DONE", progress: 100, outputName, updatedAt: new Date() },
    });
  }

  /** 训练失败收口。 */
  async markFailed(jobId: string, error: string): Promise<void> {
    await prisma.loraTrainingJob.update({
      where: { id: jobId },
      data: { status: "FAILED", error, updatedAt: new Date() },
    });
  }

  /** 用户取消训练。 */
  async markCancelled(jobId: string): Promise<void> {
    await prisma.loraTrainingJob.update({
      where: { id: jobId },
      data: { status: "CANCELLED", updatedAt: new Date() },
    });
  }
}

/** 进程内单例。 */
export const loraTrainingJobRepository = new LoraTrainingJobRepository();
