/**
 * `repository-model.ts` — Model 与 UserModelConfig 仓储（Drizzle 版）
 * @module core/repository-model
 */
import "server-only";

import { db } from "~/lib/db";
import {
  model,
  userModelConfig,
  type Model,
  type UserModelConfig,
} from "~/server/db/schema";
import { DrizzleRepository } from "./repository-base";
import { eq, and, like, inArray, desc, count } from "drizzle-orm";

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

  async listAvailableFileNamesByFolders(folders: string[]): Promise<string[]> {
    if (!folders.length) return [];
    const rows = await db
      .select({ fileName: model.fileName })
      .from(model)
      .where(and(eq(model.isAvailable, true), inArray(model.folder, folders)));
    return Array.from(new Set(rows.map((r) => r.fileName))).sort((a, b) =>
      a.localeCompare(b),
    );
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

  async registerLora(input: {
    fileName: string;
    name: string;
    baseModel: string;
    triggerWord: string;
  }): Promise<void> {
    await db
      .insert(model)
      .values({
        name: input.name,
        type: "LORA",
        fileName: input.fileName,
        folder: "loras",
        baseModel: input.baseModel,
        category: "USER",
        source: "LOCAL",
        isAvailable: true,
        description: `由炼丹训练产出 · 触发词 ${input.triggerWord}`,
      })
      .onConflictDoUpdate({
        target: [model.fileName, model.folder],
        set: {
          isAvailable: true,
          name: input.name,
          baseModel: input.baseModel,
          folder: "loras",
        },
      });
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
