import { z } from "zod";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { skillRepository } from "@/lib/core/repository";
import { BUILTIN_SKILLS, CATEGORY_LABELS } from "@/lib/skills-seed";

export const skillRouter = createTRPCRouter({
  /** GET /api/skills — public, with category summary */
  list: authedProcedure
    .input(
      z
        .object({
          category: z.string().optional(),
          q: z.string().optional(),
          all: z.boolean().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      await skillRepository.ensureBuiltIns(BUILTIN_SKILLS);
      const skills = await skillRepository.list({
        category: input?.category ?? null,
        q: input?.q?.trim() || undefined,
        includeInactive: input?.all === true,
      });
      const parsed = skills.map((skill) =>
{
        const obj = skill as unknown as Record<string, unknown>;
        let tags: unknown = [];
        try {
          tags = JSON.parse((obj.tags as string) ?? "[]");
        } catch {
          tags = [];
        }
        return { ...obj, tags };
      });
      const categories = await skillRepository.groupByActiveCategory();
      return {
        skills: parsed,
        categories: categories.map((category) =>({          id: category.category,
          label: CATEGORY_LABELS[category.category] ?? category.category,
          count: category.count,
        })),
      };
    }),

  /** POST /api/skills — create a user skill */
  create: authedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(60),
        slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/),
        description: z.string().min(1).max(200),
        icon: z.string().default("sparkles"),
        category: z.string().default("style"),
        promptTemplate: z.string().min(1),
        negativePrompt: z.string().optional(),
        defaultParams: z.record(z.unknown()).optional(),
        recommendedModel: z.string().optional(),
        tags: z.array(z.string()).default([]),
        coverUrl: z.string().optional(),
        sortOrder: z.number().int().default(0),
      })
    )
    .mutation(async ({ input }) => {
      const existing = await skillRepository.findBySlug(input.slug);
      if (existing) throw new Error("Slug already exists");
      const skill = await skillRepository.createUserSkill({
        name: input.name,
        slug: input.slug,
        description: input.description,
        icon: input.icon,
        category: input.category,
        promptTemplate: input.promptTemplate,
        negativePrompt: input.negativePrompt,
        defaultParams: input.defaultParams,
        recommendedModel: input.recommendedModel,
        coverUrl: input.coverUrl,
        sortOrder: input.sortOrder,
        tags: input.tags,
      });
      return { skill };
    }),
});