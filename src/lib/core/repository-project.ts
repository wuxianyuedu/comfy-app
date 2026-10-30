/**
 * `repository-project.ts` — Project 业务仓储（Drizzle 版）
 * @module core/repository-project — Project 业务仓储（Drizzle 版）
 */
import "server-only";

import { db } from "~/lib/db";
import { project, type Project } from "~/server/db/schema";
import { DrizzleRepository } from "./repository-base";
import { eq, and, desc } from "drizzle-orm";
import { firstRowOfExisting, firstRowRequired } from "./repository-row";

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

  async upsertForUser(
    userId: string,
    data: { id: string; name: string; nodes?: unknown; edges?: unknown },
  ): Promise<Project> {
    const existing = await db.select().from(project).where(eq(project.id, data.id)).limit(1);
    if (!existing[0]) {
      const rows = await db
        .insert(project)
        .values({
          id: data.id,
          userId,
          name: data.name,
          nodes: data.nodes ?? "[]",
          edges: data.edges ?? "[]",
        })
        .returning();
      return firstRowRequired(rows, "项目插入");
    }
    const rows = await db
      .update(project)
      .set({
        name: data.name,
        nodes: data.nodes ?? "[]",
        edges: data.edges ?? "[]",
        updatedAt: new Date(),
      })
      .where(eq(project.id, data.id))
      .returning();
    return firstRowOfExisting(rows, `项目不存在: ${data.id}`);
  }

  async deleteForUser(userId: string, id: string): Promise<void> {
    await db.delete(project).where(and(eq(project.id, id), eq(project.userId, userId)));
  }
}

export const projectRepository = new ProjectRepository();
