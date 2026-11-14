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
import { firstRowOfExisting, firstRowRequired } from "./repository-row";
import { eq, and, asc, count, inArray, exists, sql, type SQL } from "drizzle-orm";

export type WorkflowModelTagView = {
  count: number;
  id: string;
  name: string;
};

export class WorkflowModelTagRepository extends DrizzleRepository<WorkflowModelTag> {
  constructor() {
    super(workflowModelTag, workflowModelTag.id);
  }

  async listByUser(userId: string): Promise<Array<WorkflowModelTagView>> {
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
        eq(workflowModelTagToWorkflowTemplate.workflowModelTag, workflowModelTag.id),
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

  /** 确保同名标签存在并返回带绑定计数的视图。
   *  单语句 upsert（ISSUE #3835）：冲突目标 = `(userId, name)` 唯一索引
   *  `wmt_user_name_uniq`；冲突时把 name 原值回写（no-op update）换 returning。
   *  原先「先查后插」有唯一索引兜底不会重复建行，但并发重复调用（保存工作流
   *  双击 / 两页签同时保存）会让后到者撞索引 500 —— upsert 语义应当让重复
   *  执行成功且无害。 */
  async upsertByName(userId: string, name: string): Promise<WorkflowModelTagView> {
    const rows = await db
      .insert(workflowModelTag)
      .values({ userId, name })
      .onConflictDoUpdate({
        target: [workflowModelTag.userId, workflowModelTag.name],
        set: { name },
      })
      .returning();
    const row = firstRowRequired(rows, "模型标签插入");
    const [c] = await db
      .select({ v: count() })
      .from(workflowModelTagToWorkflowTemplate)
      .where(eq(workflowModelTagToWorkflowTemplate.workflowModelTag, row.id));
    return { id: row.id, name: row.name, count: Number(c?.v ?? 0) };
  }

  /** `upsertByName` 的批量版：保存工作流时一次要落一整套标签。单语句批量
   *  upsert（ISSUE #3835）：冲突目标 = `(userId, name)` 唯一索引，已存在的行
   *  no-op 回写换 returning，一次往返拿到全部 id，且并发重复调用不再撞唯一
   *  索引 500；按**输入顺序**返回 id（`setModelTags` 只吃 id）。 */
  async upsertByNames(userId: string, names: Array<string>): Promise<Array<string>> {
    if (!names.length) {
      return [];
    }
    const wanted = [...new Set(names)];
    const rows = await db
      .insert(workflowModelTag)
      .values(wanted.map((name) => ({ userId, name })))
      .onConflictDoUpdate({
        target: [workflowModelTag.userId, workflowModelTag.name],
        set: { name: sql`excluded.name` },
      })
      .returning({ id: workflowModelTag.id, name: workflowModelTag.name });
    const idByName = new Map(rows.map((row) => [row.name, row.id]));
    return names.map((name) => idByName.get(name)).filter((id): id is string => id !== undefined);
  }

  async findByUserAndName(userId: string, name: string): Promise<{ id: string } | null> {
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
    const renamed = firstRowOfExisting(updated, `模型标签不存在: ${id}`);
    return {
      id: renamed.id,
      name: renamed.name,
      count: Number(c?.v ?? 0),
    };
  }

  async deleteById(id: string): Promise<void> {
    await db.delete(workflowModelTag).where(eq(workflowModelTag.id, id));
  }

  async listIdsByNames(userId: string, names: Array<string>): Promise<Array<{ id: string }>> {
    if (!names.length) {
      return [];
    }
    return db
      .select({ id: workflowModelTag.id })
      .from(workflowModelTag)
      .where(and(eq(workflowModelTag.userId, userId), inArray(workflowModelTag.name, names)));
  }

  /** 批量取出模板→模型标签名映射，替代 router 内裸写 join。 */
  async getTemplateTagRows(
    templateIds: Array<string>,
  ): Promise<Array<{ name: string; templateId: string }>> {
    if (!templateIds.length) {
      return [];
    }
    return db
      .select({
        templateId: workflowModelTagToWorkflowTemplate.workflowTemplate,
        name: workflowModelTag.name,
      })
      .from(workflowModelTagToWorkflowTemplate)
      .innerJoin(
        workflowModelTag,
        eq(workflowModelTagToWorkflowTemplate.workflowModelTag, workflowModelTag.id),
      )
      .where(inArray(workflowModelTagToWorkflowTemplate.workflowTemplate, templateIds));
  }

  /** 返回 WHERE 条件：模板关联到给定 tagIds 中任意一个（供 router 组合 where）。 */
  templateHasTagIdsWhere(tagIds: Array<string>): SQL {
    return exists(
      db
        .select({ one: sql`1` })
        .from(workflowModelTagToWorkflowTemplate)
        .where(
          and(
            eq(workflowModelTagToWorkflowTemplate.workflowTemplate, workflowTemplate.id),
            inArray(workflowModelTagToWorkflowTemplate.workflowModelTag, tagIds),
          ),
        ),
    );
  }
}

export const workflowModelTagRepository = new WorkflowModelTagRepository();
