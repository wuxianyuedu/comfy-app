/**
 * `repository-asset.ts` — 资产库仓储（Drizzle 版，ISSUE #4868）
 * @module core/repository-asset — 资产库仓储（Drizzle 版）
 */
import "server-only";

import { and, desc, eq, inArray, like, or, sql, type SQL } from "drizzle-orm";

import { db } from "~/lib/db";
import { likePrefixPattern } from "~/lib/media/asset-folders";
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

/** 列表过滤条件：归属 / 分类 / 媒体类型 / 关键词 / 目录前缀。 */
export type AssetListFilter = {
  category?: string;
  mediaType?: string;
  projectId?: string;
  q?: string;
  scope?: "all" | "public" | "project";
  skip?: number;
  /** 目录前缀：命中该目录本身与其全部后代目录（空串 / 缺省 = 不过滤）。 */
  subdirPrefix?: string;
  take?: number;
  userId: string;
};

/**
 * 列表 / 计数共用的过滤条件（同一口径，避免两处各写一套筛选语义）。
 * 目录前缀用原生 LIKE + ESCAPE：drizzle 的 `like()` 不带 escape 参数，
 * 而目录名是用户输入，`%` `_` `\` 必须转义后才能进模式串。
 */
function filterConditions(filter: AssetListFilter): Array<SQL> {
  const conditions: Array<SQL> = [eq(asset.userId, filter.userId)];
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
    const nameOrPrompt = or(like(asset.name, `%${filter.q}%`), like(asset.prompt, `%${filter.q}%`));
    if (nameOrPrompt !== undefined) {
      conditions.push(nameOrPrompt);
    }
  }
  if (filter.subdirPrefix !== undefined && filter.subdirPrefix !== "") {
    const prefix = filter.subdirPrefix;
    const inFolder = or(
      eq(asset.subdir, prefix),
      sql`${asset.subdir} like ${likePrefixPattern(prefix)} escape '\\'`,
    );
    if (inFolder !== undefined) {
      conditions.push(inFolder);
    }
  }
  return conditions;
}

export class AssetRepository extends DrizzleRepository<Asset> {
  constructor() {
    super(asset, asset.id);
  }

  /**
   * 按过滤条件列资产（新到旧）。`scope = all` 时公共 + 项目一并出；
   * `scope = project` 时可再按 `projectId` 收窄（缺项目 = 该用户全部项目资产）。
   * 关键词命中名称或提示词；`subdirPrefix` 命中目录本身与其后代。
   */
  async listByUser(filter: AssetListFilter): Promise<Array<Asset>> {
    return db
      .select()
      .from(asset)
      .where(and(...filterConditions(filter)))
      .orderBy(desc(asset.createdAt))
      .limit(filter.take ?? 60)
      .offset(filter.skip ?? 0);
  }

  /**
   * 按「分类 × 目录」分组的资产数（目录树角标）。一次带回全部维度，
   * 由调用方按 scope / category 切分并归并出子树计数。
   */
  async countBySubdir(
    filter: Omit<AssetListFilter, "subdirPrefix" | "take" | "skip">,
  ): Promise<Array<{ category: string; count: number; subdir: string | null }>> {
    const rows = await db
      .select({
        category: asset.category,
        subdir: asset.subdir,
        count: sql<number>`count(*)`,
      })
      .from(asset)
      .where(and(...filterConditions({ ...filter, subdirPrefix: undefined })))
      .groupBy(asset.category, asset.subdir);
    return rows.map((row) => ({
      category: row.category,
      subdir: row.subdir,
      count: Number(row.count),
    }));
  }

  /**
   * 重命名目录：把所选归属档下、该分类中落在 `oldPath` 及其后代的资产 `subdir`
   * 前缀整体改写。公共 / 项目两棵树互不影响，所以 scope 是必传的改写范围。
   * SQLite `substr` 从 1 起算：`substr(subdir, len(old)+1)` 取出「父路径之后」的
   * 尾巴（含分隔符），拼上新前缀即为新路径；目录本身（尾巴为空串）同样成立。
   */
  async renameSubdirPrefix(input: {
    category: string;
    newPath: string;
    oldPath: string;
    scope: "public" | "project";
    userId: string;
  }): Promise<number> {
    const rows = await db
      .update(asset)
      .set({
        subdir: sql`${input.newPath} || substr(${asset.subdir}, ${input.oldPath.length + 1})`,
      })
      .where(
        and(
          eq(asset.userId, input.userId),
          eq(asset.scope, input.scope),
          eq(asset.category, input.category),
          or(
            eq(asset.subdir, input.oldPath),
            sql`${asset.subdir} like ${likePrefixPattern(input.oldPath)} escape '\\'`,
          ),
        ),
      )
      .returning({ id: asset.id });
    return rows.length;
  }

  /** 单条资产移动目录（`subdir` 传 null = 移回分类根）。 */
  async updateSubdir(id: string, userId: string, subdir: string | null): Promise<Asset | null> {
    const rows = await db
      .update(asset)
      .set({ subdir })
      .where(and(eq(asset.id, id), eq(asset.userId, userId)))
      .returning();
    return rows[0] ?? null;
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
