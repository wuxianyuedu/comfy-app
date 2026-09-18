/**
 * `repository-workflow-template.ts` — WorkflowTemplate 业务仓储（Drizzle 版）
 * @module core/repository-workflow-template — WorkflowTemplate 业务仓储（Drizzle 版）
 */
import "server-only";

import { db } from "~/lib/db";
import {
  workflowTemplate,
  workflowModelTagToWorkflowTemplate,
  type WorkflowTemplate,
} from "~/server/db/schema";
import { DrizzleRepository } from "./repository-base";
import { eq, and, desc, type SQL } from "drizzle-orm";

export class WorkflowTemplateRepository extends DrizzleRepository<WorkflowTemplate> {
  constructor() {
    super(workflowTemplate, workflowTemplate.id);
  }

  async listByUser(userId: string): Promise<WorkflowTemplate[]> {
    return db
      .select()
      .from(workflowTemplate)
      .where(eq(workflowTemplate.userId, userId))
      .orderBy(desc(workflowTemplate.createdAt));
  }

  async findByIdForUser(
    userId: string,
    id: string,
  ): Promise<WorkflowTemplate | null> {
    const wf = await this.findById(id);
    return wf?.userId === userId ? wf : null;
  }

  async findByIdForUserSelect(
    userId: string,
    id: string,
    _select?: unknown,
  ): Promise<WorkflowTemplate | null> {
    const rows = await db
      .select()
      .from(workflowTemplate)
      .where(
        and(eq(workflowTemplate.id, id), eq(workflowTemplate.userId, userId)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async listForUser(
    userId: string,
    opts: { where?: SQL; orderBy?: SQL[] } = {},
  ): Promise<WorkflowTemplate[]> {
    return db
      .select()
      .from(workflowTemplate)
      .where(and(eq(workflowTemplate.userId, userId), opts.where))
      .orderBy(...(opts.orderBy ?? [desc(workflowTemplate.createdAt)]));
  }

  async createImported(input: {
    userId: string;
    name: string;
    taskType: string;
    graph: unknown;
    paramMap?: unknown;
    rawJson?: unknown;
    positions?: unknown;
    sourcePath?: string | null;
    sourceChecksum?: string | null;
    sourceMtime?: number | null;
    modes?: string[];
    defaultMode?: string | null;
    /** API 列从哪来：`user` = 用户导出 API 格式；`derived` = 早年导入 RAW 时
     *  转出来存下的。只有 API 格式导入才写（RAW 导入不产 API 图）。 */
    apiSource?: "user" | "derived" | null;
  }): Promise<WorkflowTemplate> {
    const rows = await db
      .insert(workflowTemplate)
      .values({
        userId: input.userId,
        name: input.name,
        taskType: input.taskType,
        graph: input.graph,
        paramMap: input.paramMap,
        rawJson: input.rawJson,
        positions: input.positions,
        sourcePath: input.sourcePath ?? undefined,
        sourceChecksum: input.sourceChecksum ?? undefined,
        sourceMtime: input.sourceMtime ?? undefined,
        modes: input.modes?.length ? JSON.stringify(input.modes) : "[]",
        defaultMode: input.defaultMode ?? undefined,
        apiSource: input.apiSource ?? undefined,
      })
      .returning();
    return rows[0]!;
  }

  async relinkSourcePath(
    id: string,
    data: { sourcePath: string; sourceMtime: number },
  ): Promise<void> {
    await db
      .update(workflowTemplate)
      .set({ sourcePath: data.sourcePath, sourceMtime: data.sourceMtime })
      .where(eq(workflowTemplate.id, id));
  }

  async setModelTags(id: string, tagIds: string[]): Promise<void> {
    await db
      .delete(workflowModelTagToWorkflowTemplate)
      .where(eq(workflowModelTagToWorkflowTemplate.workflowTemplate, id));
    if (tagIds.length) {
      await db
        .insert(workflowModelTagToWorkflowTemplate)
        .values(
          tagIds.map((t) => ({ workflowModelTag: t, workflowTemplate: id })),
        );
    }
  }
}

export const workflowTemplateRepository = new WorkflowTemplateRepository();
