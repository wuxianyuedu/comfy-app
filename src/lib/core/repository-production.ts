/**
 * `repository-production.ts` — 统一生产模型仓储（Phase 3b，Drizzle 版）
 * @module core/repository-production — 生产模型（镜头/场景/角色/进度）按 proj_* 读写
 */
import "server-only";

import { TRPCError } from "@trpc/server";
import { db } from "~/lib/db";
import { production, type Production } from "~/server/db/schema";
import { DrizzleRepository } from "./repository-base";
import type { DbExecutor } from "./repository-executor-types";
import { and, eq } from "drizzle-orm";
import type { ProductionRun } from "~/lib/production/run-types";

/** 写一条生产数据（按 proj_* upsert）的入参；JSON 列传对象，Drizzle 负责序列化。 */
export type ProductionInput = {
  characters?: unknown;
  id: string;
  logline?: string;
  progress?: unknown;
  scenes?: unknown;
  scriptMarkdown?: string;
  /** 剧本评审位（FR-QA-07）：形状见 `~/lib/production/review-types` 的 ScriptReviewState。 */
  scriptReview?: unknown;
  shots?: unknown;
  title?: string;
  tone?: string;
  type?: string;
};

export class ProductionRepository extends DrizzleRepository<Production> {
  constructor() {
    super(production, production.id);
  }

  /** 读某用户某项目的生产数据；不存在或不属于该用户 → null。
   *  `executor`：由事务入口（如工坊自动保存那条 immediate 事务）传入，读走事务里
   *  的连接，避免读到提交前的旧行（§18.10.1 的同一条纪律）。 */
  async getForUser(userId: string, id: string, executor?: DbExecutor): Promise<Production | null> {
    const exec = executor ?? db;
    const rows = await exec
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
  async updateRun(userId: string, id: string, run: ProductionRun): Promise<boolean> {
    const rows = await db
      .update(production)
      .set({ run, updatedAt: new Date() })
      .where(and(eq(production.id, id), eq(production.userId, userId)))
      .returning({ id: production.id });
    return rows.length > 0;
  }

  /**
   * 只更新内容列（剧本 / 角色 / 镜头）—— 供服务端 run 引擎写回阶段产物用。刻意**不碰 run /
   * progress**（引擎写 run 走 updateRun、进度走别处），字段各写各的列、互不覆盖。只给出现在想改的
   * 字段即可（缺省字段不动）。行不存在 → false。
   */
  async patchContent(
    userId: string,
    id: string,
    patch: {
      characters?: unknown;
      scriptMarkdown?: string;
      /** 剧本评审位（FR-QA-07）：评审器写判定与轮次历史；工坊自动保存不传 = 不碰。 */
      scriptReview?: unknown;
      shots?: unknown;
    },
  ): Promise<boolean> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.scriptMarkdown !== undefined) {
      set.scriptMarkdown = patch.scriptMarkdown;
    }
    if (patch.characters !== undefined) {
      set.characters = patch.characters;
    }
    if (patch.shots !== undefined) {
      set.shots = patch.shots;
    }
    if (patch.scriptReview !== undefined) {
      set.scriptReview = patch.scriptReview;
    }
    const rows = await db
      .update(production)
      .set(set)
      .where(and(eq(production.id, id), eq(production.userId, userId)))
      .returning({ id: production.id });
    return rows.length > 0;
  }

  /**
   * 只更新 shots 与 progress 两列（成片合成回写专用，ISSUE #3832）：合成回写
   * 「逐镜 clip + 进度」是会重复触发的收尾动作（进程重启重跑 / 手动重新合成），
   * 原先 `syncFilmToProject` 把整行读出的旧快照**全部内容列**写回，合成期间
   * 其他写入者（工坊自动保存 / run 引擎 / 评审器）改的字段被回滚成旧值。
   * 字段所有权：这两列归成片链路，其余内容列一概不碰。行不存在 → false。
   */
  async patchShotsAndProgress(
    userId: string,
    id: string,
    patch: { progress?: unknown; shots?: unknown },
  ): Promise<boolean> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.progress !== undefined) {
      set.progress = patch.progress;
    }
    if (patch.shots !== undefined) {
      set.shots = patch.shots;
    }
    const rows = await db
      .update(production)
      .set(set)
      .where(and(eq(production.id, id), eq(production.userId, userId)))
      .returning({ id: production.id });
    return rows.length > 0;
  }

  /** 按 proj_* upsert 生产数据（不存在则建、存在且归属当前用户则更新）。
   *  并发首存用 `onConflictDoNothing` 避免 PK 竞态 500（ISSUE #3832）；命中冲突后
   *  复核归属：同一用户则更新，不同用户则拒绝（#3839），杜绝跨用户越权覆盖。 */
  async upsertForUser(
    userId: string,
    data: ProductionInput,
    executor?: DbExecutor,
  ): Promise<Production> {
    const exec = executor ?? db;
    const inserted = await exec
      .insert(production)
      .values({ ...data, userId })
      .onConflictDoNothing({ target: production.id })
      .returning();
    if (inserted[0]) {
      return inserted[0];
    }
    const existing = await exec
      .select()
      .from(production)
      .where(eq(production.id, data.id))
      .limit(1);
    if (!existing[0]) {
      throw new Error("production upsert 失败：冲突后未找到行");
    }
    if (existing[0].userId !== userId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该生产数据" });
    }
    const rows = await exec
      .update(production)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(production.id, data.id), eq(production.userId, userId)))
      .returning();
    const row = rows[0];
    if (!row) {
      throw new Error("production upsert 失败：update 未返回行");
    }
    return row;
  }
}

export const productionRepository = new ProductionRepository();
