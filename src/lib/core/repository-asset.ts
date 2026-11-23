/**
 * `repository-asset.ts` — 资产库仓储（Drizzle 版，ISSUE #4868）
 * @module core/repository-asset — 资产库仓储（Drizzle 版）
 */
import "server-only";

import { and, desc, eq, inArray, like, or } from "drizzle-orm";

import { db } from "~/lib/db";
import { asset, type Asset } from "~/server/db/schema";
import { DrizzleRepository } from "./repository-base";

/** 资产入库行（createFromTask / 手工上传共用）。 */
export type AssetInsertRow = {
  category: string;
  height?: number | null;
  id?: string;
  localPath: string;
  mediaType: string;
  name: string;
  negativePrompt?: string | null;
  params?: unknown;
  projectId?: string | null;
  prompt?: string | null;
  scope: string;
  sourceTaskId?: string | null;
  subdir?: string | null;
  userId: string;
  width?: number | null;
  workflowName?: string | null;
};

/** 列表过滤条件：归属 / 分类 / 媒体类型 / 关键词。 */
export type AssetListFilter = {
  category?: string;
  mediaType?: string;
  projectId?: string;
  q?: string;
  scope?: "all" | "public" | "project";
  skip?: number;
  take?: number;
  userId: string;
};

export class AssetRepository extends DrizzleRepository<Asset> {
  constructor() {
    super(asset, asset.id);
  }

  /**
   * 按过滤条件列资产（新到旧）。`scope = all` 时公共 + 项目一并出；
   * `scope = project` 时可再按 `projectId` 收窄（缺项目 = 该用户全部项目资产）。
   * 关键词命中名称或提示词。
   */
  async listByUser(filter: AssetListFilter): Promise<Array<Asset>> {
    const conditions = [eq(asset.userId, filter.userId)];
    if (filter.scope === "public") {
      conditions.push(eq(asset.scope, "public"));
    } else if (filter.scope === "project") {
      conditions.push(eq(asset.scope, "project"));
      if (filter.projectId !== undefined && filter.projectId !== "") {
        conditions.push(eq(asset.projectId, filter.projectId));
      }
    }
    if (filter.category !== undefined && filter.category !== "" && filter.category !== "all") {
      conditions.push(eq(asset.category, filter.category));
    }
    if (filter.mediaType !== undefined && filter.mediaType !== "" && filter.mediaType !== "all") {
      conditions.push(eq(asset.mediaType, filter.mediaType));
    }
    if (filter.q !== undefined && filter.q !== "") {
      const nameOrPrompt = or(
        like(asset.name, `%${filter.q}%`),
        like(asset.prompt, `%${filter.q}%`),
      );
      if (nameOrPrompt !== undefined) {
        conditions.push(nameOrPrompt);
      }
    }
    return db
      .select()
      .from(asset)
      .where(and(...conditions))
      .orderBy(desc(asset.createdAt))
      .limit(filter.take ?? 60)
      .offset(filter.skip ?? 0);
  }

  /** 各分类的资产数（列表页分类行角标；scope 语义与 listByUser 一致）。 */
  async countByCategory(
    filter: Omit<AssetListFilter, "category" | "take" | "skip">,
  ): Promise<Array<{ category: string; count: number }>> {
    const conditions = [eq(asset.userId, filter.userId)];
    if (filter.scope === "public") {
      conditions.push(eq(asset.scope, "public"));
    } else if (filter.scope === "project") {
      conditions.push(eq(asset.scope, "project"));
      if (filter.projectId !== undefined && filter.projectId !== "") {
        conditions.push(eq(asset.projectId, filter.projectId));
      }
    }
    if (filter.mediaType !== undefined && filter.mediaType !== "" && filter.mediaType !== "all") {
      conditions.push(eq(asset.mediaType, filter.mediaType));
    }
    if (filter.q !== undefined && filter.q !== "") {
      const nameOrPrompt = or(
        like(asset.name, `%${filter.q}%`),
        like(asset.prompt, `%${filter.q}%`),
      );
      if (nameOrPrompt !== undefined) {
        conditions.push(nameOrPrompt);
      }
    }
    const rows = await db
      .select({ category: asset.category })
      .from(asset)
      .where(and(...conditions));
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
    }
    return [...counts.entries()].map(([category, count]) => ({ category, count }));
  }

  /** 批量入库（一个任务的每张产物各成一条）。 */
  async createMany(rows: Array<AssetInsertRow>): Promise<Array<Asset>> {
    if (rows.length === 0) {
      return [];
    }
    return db
      .insert(asset)
      .values(
        rows.map((row) => ({
          ...(row.id === undefined ? {} : { id: row.id }),
          userId: row.userId,
          name: row.name,
          mediaType: row.mediaType,
          category: row.category,
          scope: row.scope,
          projectId: row.projectId ?? null,
          subdir: row.subdir ?? null,
          localPath: row.localPath,
          width: row.width ?? null,
          height: row.height ?? null,
          sourceTaskId: row.sourceTaskId ?? null,
          prompt: row.prompt ?? null,
          negativePrompt: row.negativePrompt ?? null,
          params: row.params,
          workflowName: row.workflowName ?? null,
        })),
      )
      .returning();
  }

  /** 归属校验 + 取单条（路由层的越权判据统一走这里，不再各写一份）。 */
  async findOwned(id: string, userId: string): Promise<Asset | null> {
    const rows = await db
      .select()
      .from(asset)
      .where(and(eq(asset.id, id), eq(asset.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** 按 id 集合取（弹窗回显等场景）。 */
  async findByIds(ids: Array<string>, userId: string): Promise<Array<Asset>> {
    if (ids.length === 0) {
      return [];
    }
    return db
      .select()
      .from(asset)
      .where(and(eq(asset.userId, userId), inArray(asset.id, ids)));
  }
}

export const assetRepository = new AssetRepository();
