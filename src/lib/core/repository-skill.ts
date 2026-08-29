/**
 * `repository-skill.ts` — Skill 业务仓储（内置/用户技能库，公共可读）
 * ===========================================================================
 *
 * 技能库是**公共可读**的（不绑定用户），GET 走公共路由；写操作仅限管理员/
 * 本机场景。种子初始化（ensureBuiltIns）、列表过滤、分类计数、slug 唯一性
 * 校验与创建全部收口在本类。
 *
 * @module core/repository-skill
 */
import { prisma } from "@/lib/db";
import { type Prisma, type Skill } from "../../../generated/prisma";
import { PrismaRepository, type PrismaDelegate } from "./repository-base";

/** 内置技能种子数据的入参契约（数据本体见 `src/lib/skills-seed.ts`）。 */
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

/**
 * 技能仓储。技能库是**公共可读**的（不绑定用户），GET 走公共路由；
 * 写操作仅限管理员/本机场景。种子初始化（ensureBuiltIns）、列表过滤、
 * 分类计数、slug 唯一性校验与创建全部收口在本类。
 */
export class SkillRepository extends PrismaRepository<
  Skill,
  Skill,
  Partial<Skill>,
  { id: string }
> {
  constructor() {
    super(
      prisma.skill as unknown as PrismaDelegate<Skill, Skill, Partial<Skill>, { id: string }>
    );
  }

  /** 幂等种子：已有内置技能则跳过，否则整批写入。 */
  async ensureBuiltIns(seeds: SkillSeed[]): Promise<void> {
    const count = await prisma.skill.count({ where: { isBuiltIn: true } });
    if (count > 0) return;
    await prisma.skill.createMany({
      data: seeds.map((seed) =>({        name: seed.name,
        slug: seed.slug,
        description: seed.description,
        icon: seed.icon,
        category: seed.category,
        promptTemplate: seed.promptTemplate,
        negativePrompt: seed.negativePrompt,
        defaultParams: seed.defaultParams as unknown as Prisma.InputJsonValue,
        recommendedModel: seed.recommendedModel,
        coverUrl: seed.coverUrl,
        sortOrder: seed.sortOrder,
        isBuiltIn: true,
        isActive: true,
        tags: JSON.stringify(seed.tags),
      })),
    });
  }

  /** 列表查询：按分类 / 关键词 / 是否含未激活过滤（与旧 GET 行为等价）。 */
  async list(opts: {
    category?: string | null;
    q?: string;
    includeInactive?: boolean;
  }): Promise<Skill[]> {
    const where: Prisma.SkillWhereInput = {};
    if (!opts.includeInactive) where.isActive = true;
    if (opts.category && opts.category !== "all") where.category = opts.category;
    if (opts.q) {
      where.OR = [
        { name: { contains: opts.q } },
        { description: { contains: opts.q } },
        { tags: { contains: opts.q } },
      ];
    }
    return prisma.skill.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });
  }

  /** 按激活状态分组统计分类（含计数，按引用数倒序）。 */
  async groupByActiveCategory(): Promise<Array<{ category: string; count: number }>> {
    const rows = await prisma.skill.groupBy({
      by: ["category"],
      where: { isActive: true },
      _count: { category: true },
      orderBy: { _count: { category: "desc" } },
    });
    return rows.map((row) =>({      category: row.category,
      count: (row._count).category,
    }));
  }

  /** 按 slug 取唯一行（slug 全局唯一）。 */
  async findBySlug(slug: string): Promise<Skill | null> {
    return prisma.skill.findUnique({ where: { slug } });
  }

  /** 创建用户技能（非内置、默认激活）；tags 在此完成 JSON 序列化。 */
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
    return prisma.skill.create({
      data: {
        name: input.name,
        slug: input.slug,
        description: input.description,
        icon: input.icon,
        category: input.category,
        promptTemplate: input.promptTemplate,
        negativePrompt: input.negativePrompt ?? undefined,
        defaultParams: input.defaultParams as Prisma.InputJsonValue | undefined,
        recommendedModel: input.recommendedModel ?? undefined,
        coverUrl: input.coverUrl ?? undefined,
        sortOrder: input.sortOrder,
        tags: JSON.stringify(input.tags),
        isBuiltIn: false,
        isActive: true,
      },
    });
  }
}

/** 进程内单例。 */
export const skillRepository = new SkillRepository();
