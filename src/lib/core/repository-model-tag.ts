/**
 * `repository-model-tag.ts` — WorkflowModelTag 仓储（Drizzle 版）
 * @module core/repository-model-tag — WorkflowModelTag 仓储（Drizzle 版）
 */
import "server-only";

import { db } from "~/lib/db";
import {
  workflowModelTag,
  workflowModelTagToWorkflowTemplate,
  workflowTemplate,
  type WorkflowModelTag,
} from "~/server/db/schema";
import { DrizzleRepository } from "./repository-base";
import {
  eq,
  and,
  asc,
  count,
  inArray,
  exists,
  sql,
  type SQL,
} from "drizzle-orm";

export interface WorkflowModelTagView {
  id: string;
  name: string;
  count: number;
}

export class WorkflowModelTagRepository extends DrizzleRepository<WorkflowModelTag> {
  constructor() {
    super(workflowModelTag, workflowModelTag.id);
  }

  async listByUser(userId: string): Promise<WorkflowModelTagView[]> {
    const rows = await db
      .select({
        id: workflowModelTag.id,
        name: workflowModelTag.name,
        /* count(列) 而非 count(*)：LEFT JOIN 未命中时 COUNT(*) 会把那行
         * NULL 计成 1，导致每个未绑定标签都显示「1 个工作流」。 */
        count: count(workflowModelTagToWorkflowTemplate.workflowModelTag),
      })
      .from(workflowModelTag)
      .leftJoin(
        workflowModelTagToWorkflowTemplate,
        eq(
          workflowModelTagToWorkflowTemplate.workflowModelTag,
          workflowModelTag.id,
        ),
      )
      .where(eq(workflowModelTag.userId, userId))
      .groupBy(workflowModelTag.id)
      .orderBy(asc(workflowModelTag.name));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      count: Number(r.count),
    }));
  }

  async upsertByName(
    userId: string,
    name: string,
  ): Promise<WorkflowModelTagView> {
    const existing = await db
      .select()
      .from(workflowModelTag)
      .where(
        and(
          eq(workflowModelTag.userId, userId),
          eq(workflowModelTag.name, name),
        ),
      )
      .limit(1);
    const row =
      existing[0] ??
      (
        await db.insert(workflowModelTag).values({ userId, name }).returning()
      )[0]!;
    const [c] = await db
      .select({ v: count() })
      .from(workflowModelTagToWorkflowTemplate)
      .where(eq(workflowModelTagToWorkflowTemplate.workflowModelTag, row.id));
    return { id: row.id, name: row.name, count: Number(c?.v ?? 0) };
  }

  /** `upsertByName` 的批量版：保存工作流时一次要落一整套标签，逐个调用就是
   *  每个标签 2~3 次往返（查 → 插 → 计数）。批量版一次 `IN` 查出已有的、
   *  一条多值 INSERT 补齐缺的，最后按**输入顺序**返回 id（与逐个版同样确定；
   *  count 视图不需要，`setModelTags` 只吃 id）。 */
  async upsertByNames(userId: string, names: string[]): Promise<string[]> {
    if (!names.length) return [];
    const wanted = [...new Set(names)];
    const idByName = new Map<string, string>();
    const existing = await db
      .select({ id: workflowModelTag.id, name: workflowModelTag.name })
      .from(workflowModelTag)
      .where(
        and(
          eq(workflowModelTag.userId, userId),
          inArray(workflowModelTag.name, wanted),
        ),
      );
    for (const row of existing) idByName.set(row.name, row.id);
    const missing = wanted.filter((name) => !idByName.has(name));
    if (missing.length > 0) {
      const inserted = await db
        .insert(workflowModelTag)
        .values(missing.map((name) => ({ userId, name })))
        .returning({ id: workflowModelTag.id, name: workflowModelTag.name });
      for (const row of inserted) idByName.set(row.name, row.id);
    }
    return names
      .map((name) => idByName.get(name))
      .filter((id): id is string => id !== undefined);
  }

  async findByUserAndName(
    userId: string,
    name: string,
  ): Promise<{ id: string } | null> {
    const rows = await db
      .select({ id: workflowModelTag.id })
      .from(workflowModelTag)
      .where(
        and(
          eq(workflowModelTag.userId, userId),
          eq(workflowModelTag.name, name),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async rename(id: string, newName: string): Promise<WorkflowModelTagView> {
    const updated = await db
      .update(workflowModelTag)
      .set({ name: newName })
      .where(eq(workflowModelTag.id, id))
      .returning();
    const [c] = await db
      .select({ v: count() })
      .from(workflowModelTagToWorkflowTemplate)
      .where(eq(workflowModelTagToWorkflowTemplate.workflowModelTag, id));
    return {
      id: updated[0]!.id,
      name: updated[0]!.name,
      count: Number(c?.v ?? 0),
    };
  }

  async deleteById(id: string): Promise<void> {
    await db.delete(workflowModelTag).where(eq(workflowModelTag.id, id));
  }

  async listIdsByNames(
    userId: string,
    names: string[],
  ): Promise<{ id: string }[]> {
    if (!names.length) return [];
    return db
      .select({ id: workflowModelTag.id })
      .from(workflowModelTag)
      .where(
        and(
          eq(workflowModelTag.userId, userId),
          inArray(workflowModelTag.name, names),
        ),
      );
  }

  /** 批量取出模板→模型标签名映射，替代 router 内裸写 join。 */
  async getTemplateTagRows(
    templateIds: string[],
  ): Promise<{ templateId: string; name: string }[]> {
    if (!templateIds.length) return [];
    return db
      .select({
        templateId: workflowModelTagToWorkflowTemplate.workflowTemplate,
        name: workflowModelTag.name,
      })
      .from(workflowModelTagToWorkflowTemplate)
      .innerJoin(
        workflowModelTag,
        eq(
          workflowModelTagToWorkflowTemplate.workflowModelTag,
          workflowModelTag.id,
        ),
      )
      .where(
        inArray(
          workflowModelTagToWorkflowTemplate.workflowTemplate,
          templateIds,
        ),
      );
  }

  /** 返回 WHERE 条件：模板关联到给定 tagIds 中任意一个（供 router 组合 where）。 */
  templateHasTagIdsWhere(tagIds: string[]): SQL {
    return exists(
      db
        .select({ one: sql`1` })
        .from(workflowModelTagToWorkflowTemplate)
        .where(
          and(
            eq(
              workflowModelTagToWorkflowTemplate.workflowTemplate,
              workflowTemplate.id,
            ),
            inArray(
              workflowModelTagToWorkflowTemplate.workflowModelTag,
              tagIds,
            ),
          ),
        ),
    );
  }
}

export const workflowModelTagRepository = new WorkflowModelTagRepository();
