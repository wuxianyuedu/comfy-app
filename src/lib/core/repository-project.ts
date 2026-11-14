/**
 * `repository-project.ts` — Project 业务仓储（Drizzle 版）
 * @module core/repository-project — Project 业务仓储（Drizzle 版）
 */
import "server-only";

import { db } from "~/lib/db";
import { project, type Project } from "~/server/db/schema";
import { DrizzleRepository } from "./repository-base";
import { eq, and, desc } from "drizzle-orm";
import { firstRowOfExisting } from "./repository-row";

export class ProjectRepository extends DrizzleRepository<Project> {
  constructor() {
    super(project, project.id);
  }

  async listByUser(userId: string): Promise<Array<Project>> {
    return db
      .select()
      .from(project)
      .where(eq(project.userId, userId))
      .orderBy(desc(project.updatedAt));
  }

  /** 按 proj_* upsert 画布项目（不存在则建、存在则更新，带归属）。
   *  单语句 `onConflictDoUpdate`（ISSUE #3835）：自动保存高频重复调用同一
   *  proj_* id，先查后插在并发首存会同抢主键让后到者 500 —— upsert 语义
   *  应当让重复执行成功且无害。 */
  async upsertForUser(
    userId: string,
    data: { edges?: unknown; id: string; name: string; nodes?: unknown },
  ): Promise<Project> {
    const values = {
      id: data.id,
      userId,
      name: data.name,
      nodes: data.nodes ?? "[]",
      edges: data.edges ?? "[]",
    };
    const rows = await db
      .insert(project)
      .values(values)
      .onConflictDoUpdate({
        target: project.id,
        set: {
          name: values.name,
          nodes: values.nodes,
          edges: values.edges,
          updatedAt: new Date(),
        },
      })
      .returning();
    return firstRowOfExisting(rows, "项目 upsert 未返回行");
  }

  async deleteForUser(userId: string, id: string): Promise<void> {
    await db.delete(project).where(and(eq(project.id, id), eq(project.userId, userId)));
  }
}

export const projectRepository = new ProjectRepository();
