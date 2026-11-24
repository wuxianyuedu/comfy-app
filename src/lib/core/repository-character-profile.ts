/**
 * `repository-character-profile.ts` — 角色库仓储（Drizzle 版，ISSUE #5009）
 * @module core/repository-character-profile — 角色库仓储（Drizzle 版）
 */
import "server-only";

import { and, desc, eq, inArray, like, or, sql, type SQL } from "drizzle-orm";

import { db } from "~/lib/db";
import { compareText } from "~/lib/ordered-set";
import { characterProfile, type CharacterProfile } from "~/server/db/schema";
import { DrizzleRepository } from "./repository-base";

/** 预置 / 手工入库行。 */
export type CharacterProfileInsertRow = {
  archetype?: string;
  description?: string;
  gender?: string;
  id?: string;
  name: string;
  source?: string;
  tags?: Array<string>;
  userId: string;
};

/** 列表过滤条件：关键词 / 标签（AND 语义）/ 状态。 */
export type CharacterProfileListFilter = {
  q?: string;
  skip?: number;
  /** 状态过滤（draft / generating / ready / failed；缺省 = 全部）。 */
  status?: string;
  /** 标签过滤：命中的角色必须**同时**带有这里列出的每个标签。 */
  tags?: Array<string>;
  take?: number;
  userId: string;
};

/**
 * 列表 / 计数共用的过滤条件（同一口径，避免两处各写一套筛选语义）。
 * 标签过滤用 SQLite 的 `json_each`：每个标签一条 `exists` 子查询，
 * 多标签即 AND（选得越多、结果越窄——分面筛选的自然语义）。
 */
function filterConditions(filter: CharacterProfileListFilter): Array<SQL> {
  const conditions: Array<SQL> = [eq(characterProfile.userId, filter.userId)];
  if (filter.status !== undefined && filter.status !== "" && filter.status !== "all") {
    conditions.push(eq(characterProfile.status, filter.status));
  }
  if (filter.q !== undefined && filter.q !== "") {
    const keyword = or(
      like(characterProfile.name, `%${filter.q}%`),
      like(characterProfile.archetype, `%${filter.q}%`),
      like(characterProfile.description, `%${filter.q}%`),
    );
    if (keyword !== undefined) {
      conditions.push(keyword);
    }
  }
  for (const tag of filter.tags ?? []) {
    conditions.push(
      sql`exists (select 1 from json_each(${characterProfile.tags}) where json_each.value = ${tag})`,
    );
  }
  return conditions;
}

export class CharacterProfileRepository extends DrizzleRepository<CharacterProfile> {
  constructor() {
    super(characterProfile, characterProfile.id);
  }

  /** 按过滤条件列角色（新到旧）。 */
  async listByUser(filter: CharacterProfileListFilter): Promise<Array<CharacterProfile>> {
    return db
      .select()
      .from(characterProfile)
      .where(and(...filterConditions(filter)))
      .orderBy(desc(characterProfile.createdAt))
      .limit(filter.take ?? 120)
      .offset(filter.skip ?? 0);
  }

  /**
   * 标签分面计数：当前过滤条件下，每个标签各命中多少角色。
   *
   * 实现走「把命中行的 tags 拉回 JS 里数」而不是 `json_each` 分组 SQL：
   * 单用户角色上限 1000、每行标签 ≤16，这个量级下 JS 计数更直白，也避开
   * `db.execute` 的返回形状随驱动漂移的问题。键顺序按计数降序、同数按名升序。
   */
  async countByTag(
    filter: Omit<CharacterProfileListFilter, "tags" | "take" | "skip">,
  ): Promise<Array<{ count: number; tag: string }>> {
    const rows = await db
      .select({ tags: characterProfile.tags })
      .from(characterProfile)
      .where(and(...filterConditions(filter)));
    const counts = new Map<string, number>();
    for (const row of rows) {
      /* json 列回读是 unknown：只认字符串数组，坏形状按「无标签」计。 */
      if (!Array.isArray(row.tags)) {
        continue;
      }
      for (const tag of row.tags) {
        if (typeof tag !== "string" || tag === "") {
          continue;
        }
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((left, right) => right.count - left.count || compareText(left.tag, right.tag))
      .slice(0, 80);
  }

  /** 各状态的角色数（页头角标）。 */
  async countByStatus(userId: string): Promise<Record<string, number>> {
    const rows = await db
      .select({ status: characterProfile.status, count: sql<number>`count(*)` })
      .from(characterProfile)
      .where(eq(characterProfile.userId, userId))
      .groupBy(characterProfile.status);
    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.status] = Number(row.count);
    }
    return counts;
  }

  /** 批量入库（预置生成器一批）；(userId, name) 撞名时跳过该行（幂等重跑）。 */
  async createManyIgnoringConflicts(
    rows: Array<CharacterProfileInsertRow>,
  ): Promise<Array<CharacterProfile>> {
    if (rows.length === 0) {
      return [];
    }
    return db
      .insert(characterProfile)
      .values(
        rows.map((row) => ({
          ...(row.id === undefined ? {} : { id: row.id }),
          userId: row.userId,
          name: row.name,
          archetype: row.archetype ?? "",
          gender: row.gender ?? "",
          description: row.description ?? "",
          tags: row.tags ?? [],
          source: row.source ?? "seed",
        })),
      )
      .onConflictDoNothing({
        target: [characterProfile.userId, characterProfile.name],
      })
      .returning();
  }

  /** 归属校验 + 取单条（路由层的越权判据统一走这里）。 */
  async findOwned(id: string, userId: string): Promise<CharacterProfile | null> {
    const rows = await db
      .select()
      .from(characterProfile)
      .where(and(eq(characterProfile.id, id), eq(characterProfile.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** 按 id 集合取（批量生图指定部分角色时）。 */
  async findOwnedByIds(ids: Array<string>, userId: string): Promise<Array<CharacterProfile>> {
    if (ids.length === 0) {
      return [];
    }
    return db
      .select()
      .from(characterProfile)
      .where(and(eq(characterProfile.userId, userId), inArray(characterProfile.id, ids)));
  }

  /** 按状态取行（生成中角色的对账扫描走这条）。 */
  async listByStatus(userId: string, status: string): Promise<Array<CharacterProfile>> {
    return db
      .select()
      .from(characterProfile)
      .where(and(eq(characterProfile.userId, userId), eq(characterProfile.status, status)))
      .orderBy(desc(characterProfile.createdAt));
  }

  /** 更新档案字段（描述变了由路由层重提标签后一并写入）。 */
  async updateProfileFields(
    id: string,
    userId: string,
    fields: {
      archetype?: string;
      description?: string;
      gender?: string;
      name?: string;
      tags?: Array<string>;
    },
  ): Promise<CharacterProfile | null> {
    const rows = await db
      .update(characterProfile)
      .set({
        ...(fields.name === undefined ? {} : { name: fields.name }),
        ...(fields.archetype === undefined ? {} : { archetype: fields.archetype }),
        ...(fields.gender === undefined ? {} : { gender: fields.gender }),
        ...(fields.description === undefined ? {} : { description: fields.description }),
        ...(fields.tags === undefined ? {} : { tags: fields.tags }),
      })
      .where(and(eq(characterProfile.id, id), eq(characterProfile.userId, userId)))
      .returning();
    return rows[0] ?? null;
  }

  /** 标记进入生成中（记下任务 id 与参数快照，对账回写时用）。 */
  async markGenerating(
    id: string,
    userId: string,
    taskId: string,
    params: unknown,
  ): Promise<CharacterProfile | null> {
    const rows = await db
      .update(characterProfile)
      .set({ status: "generating", taskId, params })
      .where(and(eq(characterProfile.id, id), eq(characterProfile.userId, userId)))
      .returning();
    return rows[0] ?? null;
  }

  /** 生成成功回写：立绘地址 / 候选列表 / 宽高 / 参数快照。 */
  async markReady(
    id: string,
    userId: string,
    fields: {
      height?: number | null;
      params?: unknown;
      portraits: Array<unknown>;
      portraitUrl: string;
      taskId: string | null;
      width?: number | null;
    },
  ): Promise<CharacterProfile | null> {
    const rows = await db
      .update(characterProfile)
      .set({
        status: "ready",
        portraitUrl: fields.portraitUrl,
        portraits: fields.portraits,
        width: fields.width ?? null,
        height: fields.height ?? null,
        ...(fields.params === undefined ? {} : { params: fields.params }),
        taskId: fields.taskId,
      })
      .where(and(eq(characterProfile.id, id), eq(characterProfile.userId, userId)))
      .returning();
    return rows[0] ?? null;
  }

  /** 生成失败回写（保留原立绘，只更新状态；重新生图可再入队）。 */
  async markFailed(id: string, userId: string, taskId: string | null): Promise<void> {
    await db
      .update(characterProfile)
      .set({ status: "failed", taskId })
      .where(and(eq(characterProfile.id, id), eq(characterProfile.userId, userId)));
  }
}

export const characterProfileRepository = new CharacterProfileRepository();
