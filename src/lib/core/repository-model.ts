/**
 * `repository-model.ts` — Model 与 UserModelConfig 仓储（Drizzle 版）
 * @module core/repository-model — Model 与 UserModelConfig 仓储（Drizzle 版）
 */
import "server-only";

import { uniqueSorted } from "~/lib/ordered-set";
import { db } from "~/lib/db";
import {
  model,
  userModelConfig,
  type Model,
  type UserModelConfig,
} from "~/server/db/schema";
import { DrizzleRepository } from "./repository-base";
import { eq, and, like, inArray, desc, count, sql } from "drizzle-orm";

/* 单条多值 INSERT 的行数上限：SQLite 的绑定变量有上限，一次塞几千行会直接报
 * 「参数过多」，因此批量 upsert 按这个大小切片。 */
const UPSERT_CHUNK = 400;

export class ModelRepository extends DrizzleRepository<Model> {
  constructor() {
    super(model, model.id);
  }

  async list(opts?: { type?: string; q?: string }): Promise<Model[]> {
    const where = and(
      eq(model.isAvailable, true),
      opts?.type ? eq(model.type, opts.type) : undefined,
      opts?.q ? like(model.name, `%${opts.q}%`) : undefined,
    );
    return db
      .select()
      .from(model)
      .where(where)
      .orderBy(desc(model.createdAt))
      .limit(300);
  }

  async setAvailabilityByFolder(
    folder: string,
    isAvailable: boolean,
  ): Promise<void> {
    await db.update(model).set({ isAvailable }).where(eq(model.folder, folder));
  }

  async disableAllLocal(): Promise<void> {
    await db
      .update(model)
      .set({ isAvailable: false })
      .where(eq(model.source, "LOCAL"));
  }

  async upsertScanned(input: {
    fileName: string;
    folder: string;
    name: string;
    type: string;
    baseModel: string;
  }): Promise<void> {
    await db
      .insert(model)
      .values({
        fileName: input.fileName,
        folder: input.folder,
        name: input.name,
        type: input.type,
        baseModel: input.baseModel,
        isAvailable: true,
        source: "LOCAL",
      })
      .onConflictDoUpdate({
        target: [model.fileName, model.folder],
        set: {
          isAvailable: true,
          name: input.name,
          type: input.type,
          baseModel: input.baseModel,
        },
      });
  }

  /* `upsertScanned` 的批量版。扫描一次模型目录就是几百到几千个文件，逐条
   * `await` 等于同数量的数据库往返；这里拼成多值 INSERT ... ON CONFLICT DO
   * UPDATE，往返数从 N 降到 N / UPSERT_CHUNK。语义与单条版一致：按
   * (fileName, folder) 冲突则更新为「可见 + 最新的 name/type/baseModel」。 */
  async upsertScannedMany(
    inputs: {
      fileName: string;
      folder: string;
      name: string;
      type: string;
      baseModel: string;
    }[],
  ): Promise<void> {
    if (!inputs.length) return;
    for (let start = 0; start < inputs.length; start += UPSERT_CHUNK) {
      const chunk = inputs.slice(start, start + UPSERT_CHUNK);
      await db
        .insert(model)
        .values(
          chunk.map((input) => ({
            fileName: input.fileName,
            folder: input.folder,
            name: input.name,
            type: input.type,
            baseModel: input.baseModel,
            isAvailable: true,
            source: "LOCAL" as const,
          })),
        )
        .onConflictDoUpdate({
          target: [model.fileName, model.folder],
          set: {
            isAvailable: true,
            name: sql`excluded.name`,
            type: sql`excluded.type`,
            baseModel: sql`excluded.baseModel`,
          },
        });
    }
  }

  async listAvailableFileNamesByFolders(folders: string[]): Promise<string[]> {
    if (!folders.length) return [];
    const rows = await db
      .select({ fileName: model.fileName })
      .from(model)
      .where(and(eq(model.isAvailable, true), inArray(model.folder, folders)));
    /* 「去重 + 按当前区域设置升序」走 `~/lib/ordered-set`（规范 16 §16.2.4.55）。 */
    return uniqueSorted(rows.map((r) => r.fileName));
  }

  async countsByFolder(): Promise<Record<string, number>> {
    const rows = await db
      .select({ folder: model.folder, count: count() })
      .from(model)
      .where(eq(model.isAvailable, true))
      .groupBy(model.folder);
    const out: Record<string, number> = {};
    for (const r of rows) if (r.folder) out[r.folder] = Number(r.count);
    return out;
  }
}

export class UserModelConfigRepository extends DrizzleRepository<UserModelConfig> {
  constructor() {
    super(userModelConfig, userModelConfig.id);
  }

  async listByUser(userId: string): Promise<UserModelConfig[]> {
    return db
      .select()
      .from(userModelConfig)
      .where(eq(userModelConfig.userId, userId));
  }

  async listEnabledFolders(): Promise<string[]> {
    const rows = await db
      .select({ folder: userModelConfig.folder })
      .from(userModelConfig)
      .where(eq(userModelConfig.enabled, true));
    return rows.map((r) => r.folder);
  }

  async addOrEnable(
    userId: string,
    folder: string,
    label: string | null,
  ): Promise<UserModelConfig> {
    const rows = await db
      .insert(userModelConfig)
      .values({
        userId,
        folder,
        type: folder,
        types: "[]",
        label,
        enabled: true,
        isCustom: true,
      })
      .onConflictDoUpdate({
        target: [userModelConfig.userId, userModelConfig.folder],
        set: { type: folder, types: "[]", label, enabled: true },
      })
      .returning();
    return rows[0]!;
  }

  async patchForUser(
    userId: string,
    folder: string,
    patch: { enabled?: boolean; label?: string | null },
  ): Promise<UserModelConfig> {
    const rows = await db
      .insert(userModelConfig)
      .values({
        userId,
        folder,
        type: folder,
        types: "[]",
        label: patch.label ?? null,
        enabled: patch.enabled ?? true,
        isCustom: true,
      })
      .onConflictDoUpdate({
        target: [userModelConfig.userId, userModelConfig.folder],
        set: patch,
      })
      .returning();
    return rows[0]!;
  }

  async deleteForUser(userId: string, folder: string): Promise<void> {
    await db
      .delete(userModelConfig)
      .where(
        and(
          eq(userModelConfig.userId, userId),
          eq(userModelConfig.folder, folder),
        ),
      )
      .catch(() => null);
  }
}

export const modelRepository = new ModelRepository();
export const userModelConfigRepository = new UserModelConfigRepository();
