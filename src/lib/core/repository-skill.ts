/**
 * `repository-skill.ts` — Skill 业务仓储（Drizzle 版）
 * @module core/repository-skill — Skill 业务仓储（Drizzle 版）
 */
import "server-only";

import { db } from "~/lib/db";
import { skill, type Skill } from "~/server/db/schema";
import { DrizzleRepository } from "./repository-base";
import { eq, and, like, or, asc, desc, count, inArray } from "drizzle-orm";
import { firstRowRequired } from "./repository-row";

export type SkillSeed = {
  category: string;
  coverUrl?: string;
  defaultParams?: Record<string, unknown>;
  description: string;
  icon: string;
  name: string;
  negativePrompt?: string;
  promptTemplate: string;
  recommendedModel?: string;
  slug: string;
  sortOrder: number;
  tags: Array<string>;
};

export class SkillRepository extends DrizzleRepository<Skill> {
  constructor() {
    super(skill, skill.id);
  }

  /** 确保内置技能存在（应用首批请求时补种）。
   *  补缺式 seed（ISSUE #3835）：按 slug 查出已存在的，只插缺的，再挂
   *  `onConflictDoNothing`（`slug` 唯一索引）兜底。原先「count>0 就返回」有
   *  两个洞：并发冷启动（不同筛选条件的 list 各自带起一次 seed）会同抢唯一
   *  索引让后到者 500；insert 中途失败残留部分行后 count>0，缺的技能永不自愈。
   *  现在每次调用都补缺、重复执行成功且无害。 */
  async ensureBuiltIns(seeds: Array<SkillSeed>): Promise<void> {
    if (seeds.length === 0) {
      return;
    }
    const existing = await db
      .select({ slug: skill.slug })
      .from(skill)
      .where(
        and(
          eq(skill.isBuiltIn, true),
          inArray(
            skill.slug,
            seeds.map((s) => s.slug),
          ),
        ),
      );
    const known = new Set(existing.map((r) => r.slug));
    const missing = seeds.filter((s) => !known.has(s.slug));
    if (missing.length === 0) {
      return;
    }
    await db
      .insert(skill)
      .values(
        missing.map((s) => ({
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
      )
      .onConflictDoNothing();
  }

  async list(opts: {
    category?: string | null;
    includeInactive?: boolean;
    q?: string;
  }): Promise<Array<Skill>> {
    const conditions = [];
    if (opts.includeInactive !== true) {
      conditions.push(eq(skill.isActive, true));
    }
    /* 过滤值空串与缺省同义 = 不加该条件（查询参数可能出现空串） */
    if (
      opts.category !== undefined &&
      opts.category !== null &&
      opts.category !== "" &&
      opts.category !== "all"
    ) {
      conditions.push(eq(skill.category, opts.category));
    }
    if (opts.q !== undefined && opts.q !== "") {
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

  async groupByActiveCategory(): Promise<Array<{ category: string; count: number }>> {
    const rows = await db
      .select({ category: skill.category, count: count() })
      .from(skill)
      .where(eq(skill.isActive, true))
      .groupBy(skill.category);
    return rows.map((r) => ({ category: r.category, count: Number(r.count) }));
  }

  async findBySlug(slug: string): Promise<Skill | null> {
    const rows = await db.select().from(skill).where(eq(skill.slug, slug)).limit(1);
    return rows[0] ?? null;
  }

  async createUserSkill(input: {
    category: string;
    coverUrl?: string | null;
    defaultParams?: unknown;
    description: string;
    icon: string;
    name: string;
    negativePrompt?: string | null;
    promptTemplate: string;
    recommendedModel?: string | null;
    slug: string;
    sortOrder: number;
    tags: Array<string>;
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
    return firstRowRequired(rows, "技能插入");
  }
}

export const skillRepository = new SkillRepository();
