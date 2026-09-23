/**
 * `repository-production.ts` — 统一生产模型仓储（Phase 3b，Drizzle 版）
 * @module core/repository-production — 生产模型（镜头/场景/角色/进度）按 proj_* 读写
 */
import "server-only";

import { db } from "~/lib/db";
import { production, type Production } from "~/server/db/schema";
import { DrizzleRepository } from "./repository-base";
import { and, eq } from "drizzle-orm";
import type { ProductionRun } from "~/lib/production/run-types";

/** 写一条生产数据（按 proj_* upsert）的入参；JSON 列传对象，Drizzle 负责序列化。 */
export interface ProductionInput {
  id: string;
  title?: string;
  type?: string;
  tone?: string;
  logline?: string;
  scriptMarkdown?: string;
  scenes?: unknown;
  characters?: unknown;
  shots?: unknown;
  progress?: unknown;
}

export class ProductionRepository extends DrizzleRepository<Production> {
  constructor() {
    super(production, production.id);
  }

  /** 读某用户某项目的生产数据；不存在或不属于该用户 → null。 */
  async getForUser(userId: string, id: string): Promise<Production | null> {
    const rows = await db
      .select()
      .from(production)
      .where(and(eq(production.id, id), eq(production.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * 只更新 `run` 列（AI 自主执行协调态），不碰内容字段 —— 字段所有权：run 由控制端点写、
   * 工坊自动保存写内容，两条路各写各的列，互不覆盖。行不存在（项目还没生产数据）→ false。
   */
  async updateRun(
    userId: string,
    id: string,
    run: ProductionRun,
  ): Promise<boolean> {
    const rows = await db
      .update(production)
      .set({ run, updatedAt: new Date() })
      .where(and(eq(production.id, id), eq(production.userId, userId)))
      .returning({ id: production.id });
    return rows.length > 0;
  }

  /** 按 proj_* upsert 生产数据（不存在则建、存在则更新，带归属）。 */
  async upsertForUser(
    userId: string,
    data: ProductionInput,
  ): Promise<Production> {
    const existing = await db
      .select()
      .from(production)
      .where(eq(production.id, data.id))
      .limit(1);
    if (!existing[0]) {
      const rows = await db
        .insert(production)
        .values({ ...data, userId })
        .returning();
      const created = rows[0];
      if (!created) {
        throw new Error("production upsert 失败：insert 未返回行");
      }
      return created;
    }
    const rows = await db
      .update(production)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(production.id, data.id))
      .returning();
    const updated = rows[0];
    if (!updated) {
      throw new Error("production upsert 失败：update 未返回行");
    }
    return updated;
  }
}

export const productionRepository = new ProductionRepository();
