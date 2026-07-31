import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getServerUser } from "@/lib/auth-server";
import { enqueueTraining, isTrainerConfigured } from "@/lib/comfyui/trainer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  baseModel: z.string().min(1),
  triggerWord: z.string().min(1).max(120),
  classWord: z.string().max(120).optional(),
  datasetImages: z.array(z.object({ name: z.string() })).min(1, "至少需要一张数据集图片"),
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

export async function GET() {
  const user = await getServerUser();
  const jobs = await prisma.loraTrainingJob.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({
    jobs,
    backendConfigured: isTrainerConfigured(),
    trainerUrl: process.env.LORA_TRAINER_URL ?? null,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数错误" }, { status: 400 });
  }
  const d = parsed.data;
  const user = await getServerUser();

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
  return NextResponse.json({ jobId: job.id });
}
