import { z } from "zod";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { loraTrainingJobRepository } from "@/lib/core/repository";
import { enqueueTraining, isTrainerConfigured } from "@/lib/comfyui/trainer";
import { getSettingsSync } from "@/lib/app-settings";

export const trainRouter = createTRPCRouter({
  /** GET /api/train */
  list: authedProcedure.query(async ({ ctx }) => {
    const jobs = await loraTrainingJobRepository.listByUser(ctx.user.id);
    return {
      jobs,
      backendConfigured: isTrainerConfigured(),
      trainerUrl: getSettingsSync().trainerUrl || process.env.LORA_TRAINER_URL || null,
    };
  }),

  /** POST /api/train — create a training job */
  create: authedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(120),
        baseModel: z.string().min(1),
        triggerWord: z.string().min(1).max(120),
        classWord: z.string().max(120).optional(),
        datasetImages: z
          .array(z.object({ name: z.string(), caption: z.string().optional() }))
          .min(1),
        resolution: z.number().int().min(256).max(2048).optional(),
        steps: z.number().int().min(1).max(20000).optional(),
        batchSize: z.number().int().min(1).max(32).optional(),
        learningRate: z.number().min(0.000001).max(1).optional(),
        rankDim: z.number().int().min(1).max(256).optional(),
        networkAlpha: z.number().int().min(0).max(256).optional(),
        optimizer: z.string().max(40).optional(),
        scheduler: z.string().max(40).optional(),
        seed: z.number().int().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const job = await loraTrainingJobRepository.createQueued({
        userId: ctx.user.id,
        name: input.name,
        baseModel: input.baseModel,
        triggerWord: input.triggerWord,
        classWord: input.classWord ?? null,
        datasetImages: input.datasetImages,
        resolution: input.resolution ?? 512,
        steps: input.steps ?? 1500,
        batchSize: input.batchSize ?? 4,
        learningRate: input.learningRate ?? 0.0001,
        rankDim: input.rankDim ?? 32,
        networkAlpha: input.networkAlpha ?? 16,
        optimizer: input.optimizer ?? "AdamW8bit",
        scheduler: input.scheduler ?? "cosine",
        seed: input.seed ?? 0,
      });
      await enqueueTraining(job.id);
      return { jobId: job.id };
    }),

  /** GET /api/train/[id] */
  detail: authedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const job = await loraTrainingJobRepository.findByIdForUser(
        ctx.user.id,
        input.id
      );
      if (!job) throw new Error("Training job not found");
      return { job };
    }),

  /** POST /api/train/[id]/cancel */
  cancel: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const job = await loraTrainingJobRepository.findByIdForUser(
        ctx.user.id,
        input.id,
        { id: true, status: true }
      );
      if (!job) throw new Error("Training job not found");
      const { cancelTraining } = await import("@/lib/comfyui/trainer");
      await cancelTraining(job.id);
      return { ok: true };
    }),
});