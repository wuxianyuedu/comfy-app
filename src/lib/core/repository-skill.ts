/**
 * `repository-skill.ts` — Skill 业务仓储（Drizzle 版）
 * @module core/repository-skill
 */
import "server-only";

import { db } from "@/lib/db";
import { skill, type Skill } from "~/server/db/schema";
import { DrizzleRepository } from "./repository-base";
import { eq, and, like, or, asc, desc, count } from "drizzle-orm";

export interface SkillSeed {
  name: string;
  slug: string;
  description: string;
  icon: string;
  category: string;
  promptTemplate: string;
  negativePrompt?: string;
  defaultParams?: Record<string, unknown>;
  recommendedModel?: string;
  tags: string[];
  coverUrl?: string;
  sortOrder: number;
}

export class SkillRepository extends DrizzleRepository<Skill> {
  constructor() {
    super(skill, skill.id);
  }

  async ensureBuiltIns(seeds: SkillSeed[]): Promise<void> {
    const [row] = await db
      .select({ v: count() })
      .from(skill)
      .where(eq(skill.isBuiltIn, true));
    if ((row?.v ?? 0) > 0) return;
    await db.insert(skill).values(
      seeds.map((s) => ({
        name: s.name,
        slug: s.slug,
        description: s.description,
        icon: s.icon,
        category: s.category,
        promptTemplate: s.promptTemplate,
        negativePrompt: s.negativePrompt,
        defaultParams: s.defaultParams,
        recommendedModel: s.recommendedModel,
        coverUrl: s.coverUrl,
        sortOrder: s.sortOrder,
        isBuiltIn: true,
        isActive: true,
        tags: JSON.stringify(s.tags),
      })),
    );
  }

  async list(opts: {
    category?: string | null;
    q?: string;
    includeInactive?: boolean;
  }): Promise<Skill[]> {
    const conditions = [];
    if (!opts.includeInactive) conditions.push(eq(skill.isActive, true));
    if (opts.category && opts.category !== "all")
      conditions.push(eq(skill.category, opts.category));
    if (opts.q) {
      conditions.push(
        or(
          like(skill.name, `%${opts.q}%`),
          like(skill.description, `%${opts.q}%`),
          like(skill.tags, `%${opts.q}%`),
        )!,
      );
    }
    return db
      .select()
      .from(skill)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(skill.sortOrder), desc(skill.createdAt));
  }

  async groupByActiveCategory(): Promise<
    Array<{ category: string; count: number }>
  > {
    const rows = await db
      .select({ category: skill.category, count: count() })
      .from(skill)
      .where(eq(skill.isActive, true))
      .groupBy(skill.category);
    return rows.map((r) => ({ category: r.category, count: Number(r.count) }));
  }

  async findBySlug(slug: string): Promise<Skill | null> {
    const rows = await db
      .select()
      .from(skill)
      .where(eq(skill.slug, slug))
      .limit(1);
    return rows[0] ?? null;
  }

  async createUserSkill(input: {
    name: string;
    slug: string;
    description: string;
    icon: string;
    category: string;
    promptTemplate: string;
    negativePrompt?: string | null;
    defaultParams?: unknown;
    recommendedModel?: string | null;
    coverUrl?: string | null;
    sortOrder: number;
    tags: string[];
  }): Promise<Skill> {
    const rows = await db
      .insert(skill)
      .values({
        name: input.name,
        slug: input.slug,
        description: input.description,
        icon: input.icon,
        category: input.category,
        promptTemplate: input.promptTemplate,
        negativePrompt: input.negativePrompt ?? undefined,
        defaultParams: input.defaultParams,
        recommendedModel: input.recommendedModel ?? undefined,
        coverUrl: input.coverUrl ?? undefined,
        sortOrder: input.sortOrder,
        tags: JSON.stringify(input.tags),
        isBuiltIn: false,
        isActive: true,
      })
      .returning();
    return rows[0]!;
  }
}

export const skillRepository = new SkillRepository();
