/**
 * `repository-project.ts` — Project 业务仓储（Drizzle 版）
 * @module core/repository-project — Project 业务仓储（Drizzle 版）
 */
import "server-only";

import { TRPCError } from "@trpc/server";
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

  /** 按 proj_* upsert 画布项目（不存在则建、存在且归属当前用户则更新）。
   *  并发首存用 `onConflictDoNothing` 避免 PK 竞态 500（ISSUE #3835）；命中冲突后
   *  复核归属：同一用户则更新，不同用户则拒绝，避免不安全原语被复用（#3839 同族）。 */
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
    const inserted = await db
      .insert(project)
      .values(values)
      .onConflictDoNothing({ target: project.id })
      .returning();
    if (inserted[0]) {
      return inserted[0];
    }
    const existing = await db.select().from(project).where(eq(project.id, data.id)).limit(1);
    if (!existing[0]) {
      throw new Error("项目 upsert 未返回行");
    }
    if (existing[0].userId !== userId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该项目" });
    }
    const rows = await db
      .update(project)
      .set({
        name: values.name,
        nodes: values.nodes,
        edges: values.edges,
        updatedAt: new Date(),
      })
      .where(and(eq(project.id, data.id), eq(project.userId, userId)))
      .returning();
    return firstRowOfExisting(rows, "项目 upsert 未返回行");
  }

  async deleteForUser(userId: string, id: string): Promise<void> {
    await db.delete(project).where(and(eq(project.id, id), eq(project.userId, userId)));
  }
}

export const projectRepository = new ProjectRepository();
