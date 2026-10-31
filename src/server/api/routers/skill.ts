import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { skillRepository } from "~/lib/core/repository";
import { BUILTIN_SKILLS, CATEGORY_LABELS } from "~/lib/skills-seed";

export const skillRouter = createTRPCRouter({
  /* GET /api/skills —— 读：public, with category summary */
  list: authedProcedure
    .input(
      z
        .object({
          all: z.boolean().optional(),
          category: z.string().optional(),
          q: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      await skillRepository.ensureBuiltIns(BUILTIN_SKILLS);
      const skills = await skillRepository.list({
        category: input?.category ?? null,
        includeInactive: input?.all === true,
        q: input?.q?.trim() ?? undefined,
      });
      const parsed = skills.map((skill) => {
        const obj = /* SAFETY: 类型断言已复核 */ skill as unknown as Record<string, unknown>;
        let tags: unknown;
        try {
          tags = JSON.parse(/* SAFETY: 类型断言已复核 */ (obj.tags as string) ?? "[]");
        } catch {
          tags = [];
        }
        return { ...obj, tags };
      });
      const categories = await skillRepository.groupByActiveCategory();
      return {
        categories: categories.map((category) => ({
          count: category.count,
          id: category.category,
          label: CATEGORY_LABELS[category.category] ?? category.category,
        })),
        skills: parsed,
      };
    }),

  /* POST /api/skills —— 新建：create a user skill */
  create: authedProcedure
    .input(
      z.object({
        category: z.string().default("style"),
        coverUrl: z.string().optional(),
        defaultParams: z.record(z.string(), z.unknown()).optional(),
        description: z.string().min(1).max(200),
        icon: z.string().default("sparkles"),
        name: z.string().min(1).max(60),
        negativePrompt: z.string().optional(),
        promptTemplate: z.string().min(1),
        recommendedModel: z.string().optional(),
        slug: z
          .string()
          .min(1)
          .max(80)
          .regex(/^[a-z0-9-]+$/),
        sortOrder: z.number().int().default(0),
        tags: z.array(z.string()).default([]),
      }),
    )
    .mutation(async ({ input }) => {
      const existing = await skillRepository.findBySlug(input.slug);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "该 slug 已存在，换一个名字",
        });
      }
      const skill = await skillRepository.createUserSkill({
        category: input.category,
        coverUrl: input.coverUrl,
        defaultParams: input.defaultParams,
        description: input.description,
        icon: input.icon,
        name: input.name,
        negativePrompt: input.negativePrompt,
        promptTemplate: input.promptTemplate,
        recommendedModel: input.recommendedModel,
        slug: input.slug,
        sortOrder: input.sortOrder,
        tags: input.tags,
      });
      return { skill };
    }),
});
