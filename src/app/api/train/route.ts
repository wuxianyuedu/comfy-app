import { z } from "zod";
import { prisma } from "@/lib/db";
import { defineRoute, ValidationError } from "@/lib/core";
import { enqueueTraining, isTrainerConfigured } from "@/lib/comfyui/trainer";
import { getSettingsSync } from "@/lib/app-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  baseModel: z.string().min(1),
  triggerWord: z.string().min(1).max(120),
  classWord: z.string().max(120).optional(),
  datasetImages: z.array(z.object({ name: z.string(), caption: z.string().optional() })).min(1, "至少需要一张数据集图片"),
  resolution: z.number().int().min(256).max(2048).optional(),
  steps: z.number().int().min(1).max(20000).optional(),
  batchSize: z.number().int().min(1).max(32).optional(),
  learningRate: z.number().min(0.000001).max(1).optional(),
  rankDim: z.number().int().min(1).max(256).optional(),
  networkAlpha: z.number().int().min(0).max(256).optional(),
  optimizer: z.string().max(40).optional(),
  scheduler: z.string().max(40).optional(),
  seed: z.number().int().optional(),
});

// 迁移说明：GET/POST 原手写 getServerUser + 400 {error:string}。
// 现统一到 defineRoute；zod 校验失败抛 ValidationError(400)，错误信封经
// legacyError:true 保持 {error:string}。GET 返回体 {jobs,backendConfigured,
// trainerUrl} 与 POST 返回体 {jobId} 均不变。

export const GET = defineRoute(async ({ user }) => {
  const jobs = await prisma.loraTrainingJob.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return {
    jobs,
    backendConfigured: isTrainerConfigured(),
    trainerUrl: getSettingsSync().trainerUrl || process.env.LORA_TRAINER_URL || null,
  };
}, { legacyError: true });

export const POST = defineRoute(async ({ req, user }) => {
  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "参数错误");
  }
  const d = parsed.data;

  const job = await prisma.loraTrainingJob.create({
    data: {
      userId: user.id,
      name: d.name,
      baseModel: d.baseModel,
      triggerWord: d.triggerWord,
      classWord: d.classWord ?? null,
      datasetImages: d.datasetImages as any,
      resolution: d.resolution ?? 512,
      steps: d.steps ?? 1500,
      batchSize: d.batchSize ?? 4,
      learningRate: d.learningRate ?? 0.0001,
      rankDim: d.rankDim ?? 32,
      networkAlpha: d.networkAlpha ?? 16,
      optimizer: d.optimizer ?? "AdamW8bit",
      scheduler: d.scheduler ?? "cosine",
      seed: d.seed ?? 0,
      status: "QUEUED",
    },
  });

  await enqueueTraining(job.id);
  return { jobId: job.id };
}, { legacyError: true });
