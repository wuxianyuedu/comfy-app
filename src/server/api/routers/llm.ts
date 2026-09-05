import { z } from "zod";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { getLLMConfig, completeLLM } from "@/lib/llm/server";

/** 合法的任务类型 key（用于温度覆盖） */
const taskTypeKeys = ["txt2img", "img2video", "chat", "code", "creative"] as const;

/** 候选模型条目：兼容旧纯名字字符串与新对象（远端条目可带独立接口 / 密钥） */
const extraModelsSchema = z.array(
  z.union([
    z.string(),
    z.object({
      name: z.string().min(1),
      baseUrl: z.string().nullish(),
      apiKey: z.string().nullish(),
    }),
  ]),
);

export const llmRouter = createTRPCRouter({
  /** GET /api/llm/config */
  configGet: authedProcedure.query(async () => {
    const cfg = await getLLMConfig();
    return { config: cfg };
  }),

  /** POST /api/llm/config — update singleton config */
  configSave: authedProcedure
    .input(
      z.object({
        provider: z.enum(["local", "remote"]).optional(),
        apiKey: z.string().optional(),
        baseUrl: z.string().optional(),
        model: z.string().optional(),
        extraModels: extraModelsSchema.optional(),
        temperature: z.number().optional(),
        temperatureByTask: z.record(z.enum(taskTypeKeys), z.number()).optional(),
        maxTokens: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { llmConfigRepository } = await import("@/lib/core/repository");
      const config = await llmConfigRepository.upsertSingleton(input);
      return { config };
    }),

  /** POST /api/llm — non-streaming completion */
  complete: authedProcedure
    .input(
      z.object({
        messages: z.array(
          z.object({
            role: z.enum(["system", "user", "assistant"]),
            content: z.string(),
          })
        ),
        provider: z.enum(["local", "remote"]).optional(),
        model: z.string().optional(),
        temperature: z.number().optional(),
        maxTokens: z.number().optional(),
        taskType: z.enum(taskTypeKeys).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const cfg = await getLLMConfig({
        // P0:provider 收紧为 enum——垃圾值此前会静默按 local 误路由,
        // 现在输入非法直接 400(Zod),不再静默回退。
        provider: input.provider,
        model: input.model,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        taskType: input.taskType,
      });
      const content = await completeLLM(cfg, input.messages);
      return { content };
    }),
});