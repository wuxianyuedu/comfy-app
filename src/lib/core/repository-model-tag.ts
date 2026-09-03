/**
 * `repository-model-tag.ts` — WorkflowModelTag 仓储（Drizzle 版）
 * @module core/repository-model-tag
 */
import "server-only";

import { db } from "@/lib/db";
import {
  workflowModelTag,
  workflowModelTagToWorkflowTemplate,
  workflowTemplate,
  type WorkflowModelTag,
} from "~/server/db/schema";
import { DrizzleRepository } from "./repository-base";
import { eq, and, asc, count, inArray, exists, sql, type SQL } from "drizzle-orm";

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
        count: count(),
      })
      .from(workflowModelTag)
      .leftJoin(
        workflowModelTagToWorkflowTemplate,
        eq(workflowModelTagToWorkflowTemplate.workflowModelTag, workflowModelTag.id)
      )
      .where(eq(workflowModelTag.userId, userId))
      .groupBy(workflowModelTag.id)
      .orderBy(asc(workflowModelTag.name));
    return rows.map((r) => ({ id: r.id, name: r.name, count: Number(r.count) }));
  }

  async upsertByName(userId: string, name: string): Promise<WorkflowModelTagView> {
    const existing = await db
      .select()
      .from(workflowModelTag)
      .where(and(eq(workflowModelTag.userId, userId), eq(workflowModelTag.name, name)))
      .limit(1);
    const row =
      existing[0] ??
      (await db.insert(workflowModelTag).values({ userId, name }).returning())[0]!;
    const [c] = await db
      .select({ v: count() })
      .from(workflowModelTagToWorkflowTemplate)
      .where(eq(workflowModelTagToWorkflowTemplate.workflowModelTag, row.id));
    return { id: row.id, name: row.name, count: Number(c?.v ?? 0) };
  }

  async findByUserAndName(
    userId: string,
    name: string
  ): Promise<{ id: string } | null> {
    const rows = await db
      .select({ id: workflowModelTag.id })
      .from(workflowModelTag)
      .where(and(eq(workflowModelTag.userId, userId), eq(workflowModelTag.name, name)))
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
    return { id: updated[0]!.id, name: updated[0]!.name, count: Number(c?.v ?? 0) };
  }

  async deleteById(id: string): Promise<void> {
    await db.delete(workflowModelTag).where(eq(workflowModelTag.id, id));
  }

  async listIdsByNames(userId: string, names: string[]): Promise<{ id: string }[]> {
    if (!names.length) return [];
    return db
      .select({ id: workflowModelTag.id })
      .from(workflowModelTag)
      .where(and(eq(workflowModelTag.userId, userId), inArray(workflowModelTag.name, names)));
  }

  /** 批量取出模板→模型标签名映射，替代 router 内裸写 join。 */
  async getTemplateTagRows(templateIds: string[]): Promise<{ templateId: string; name: string }[]> {
    if (!templateIds.length) return [];
    return db
      .select({
        templateId: workflowModelTagToWorkflowTemplate.workflowTemplate,
        name: workflowModelTag.name,
      })
      .from(workflowModelTagToWorkflowTemplate)
      .innerJoin(
        workflowModelTag,
        eq(workflowModelTagToWorkflowTemplate.workflowModelTag, workflowModelTag.id)
      )
      .where(inArray(workflowModelTagToWorkflowTemplate.workflowTemplate, templateIds));
  }

  /** 返回 WHERE 条件：模板关联到给定 tagIds 中任意一个（供 router 组合 where）。 */
  templateHasTagIdsWhere(tagIds: string[]): SQL {
    return exists(
      db
        .select({ one: sql`1` })
        .from(workflowModelTagToWorkflowTemplate)
        .where(
          and(
            eq(workflowModelTagToWorkflowTemplate.workflowTemplate, workflowTemplate.id),
            inArray(workflowModelTagToWorkflowTemplate.workflowModelTag, tagIds)
          )
        )
    );
  }
}

export const workflowModelTagRepository = new WorkflowModelTagRepository();
