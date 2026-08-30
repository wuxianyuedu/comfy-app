import { z } from "zod";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { getLLMConfig, completeLLM } from "@/lib/llm/server";
import type { LLMProviderType } from "@/lib/llm/types";

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
        provider: z.string().optional(),
        apiKey: z.string().optional(),
        baseUrl: z.string().optional(),
        model: z.string().optional(),
        temperature: z.number().optional(),
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
        provider: z.string().optional(),
        model: z.string().optional(),
        temperature: z.number().optional(),
        maxTokens: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const cfg = await getLLMConfig({
        // 原 `as any`:字符串透传。非 "local"/"remote" 的值在 getLLMConfig 里按非 remote
        // 处理,加守卫反而会改变该退化行为,这里只恢复静态类型。
        provider: input.provider as LLMProviderType | undefined,
        model: input.model,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
      });
      const content = await completeLLM(cfg, input.messages);
      return { content };
    }),
});