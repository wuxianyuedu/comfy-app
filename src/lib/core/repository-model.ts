/**
 * `repository-model.ts` — Model 仓储（Drizzle 版）
 * @module core/repository-model — Model 仓储（Drizzle 版）
 */
import "server-only";

import { uniqueSorted } from "~/lib/ordered-set";
import { db } from "~/lib/db";
import { model, type Model } from "~/server/db/schema";
import { DrizzleRepository } from "./repository-base";
import type { DbExecutor } from "./repository-executor-types";
import { eq, and, like, inArray, desc, count, sql } from "drizzle-orm";

/* 单条多值 INSERT 的行数上限：SQLite 的绑定变量有上限，一次塞几千行会直接报
 * 「参数过多」，因此批量 upsert 按这个大小切片。 */
const UPSERT_CHUNK = 400;

export class ModelRepository extends DrizzleRepository<Model> {
  constructor() {
    super(model, model.id);
  }

  /** 模型清单（可用行，新到旧）。**契约（#4049）**：`rows` 目前封顶 300 条，
   *  `total` 是同条件下的可用模型总数——超限时的「还有更多」由调用方据这两个数
   *  自行表达，不再无声截断。 */
  async list(opts?: { q?: string; type?: string }): Promise<{ rows: Array<Model>; total: number }> {
    const where = and(
      eq(model.isAvailable, true),
      /* 过滤值空串与缺省同义 = 不加该条件（查询参数可能出现空串） */
      opts?.type !== undefined && opts.type !== "" ? eq(model.type, opts.type) : undefined,
      opts?.q !== undefined && opts.q !== "" ? like(model.name, `%${opts.q}%`) : undefined,
    );
    const rows = await db
      .select()
      .from(model)
      .where(where)
      .orderBy(desc(model.createdAt))
      .limit(300);
    const counted = await db.select({ n: count() }).from(model).where(where);
    return { rows, total: counted[0]?.n ?? 0 };
  }

  async setAvailabilityByFolder(folder: string, isAvailable: boolean): Promise<void> {
    await db.update(model).set({ isAvailable }).where(eq(model.folder, folder));
  }

  /** 停用全部 LOCAL 行。`executor`：由「停用 + 回填」的事务入口传入（ISSUE #3869），
   *  让两步同滚；缺省 = 模块级连接的单语句路径。 */
  async disableAllLocal(executor?: DbExecutor): Promise<void> {
    const exec = executor ?? db;
    await exec.update(model).set({ isAvailable: false }).where(eq(model.source, "LOCAL"));
  }

  async upsertScanned(input: {
    baseModel: string;
    fileName: string;
    folder: string;
    name: string;
    type: string;
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
   * (fileName, folder) 冲突则更新为「可见 + 最新的 name/type/baseModel」。
   * `executor`：由「停用 + 回填」的事务入口传入（ISSUE #3869）——分片虽逐片
   * 执行，但都落在同一事务里，某片失败整体回滚，不再留「部分可见」中间态。 */
  async upsertScannedMany(
    inputs: Array<{
      baseModel: string;
      fileName: string;
      folder: string;
      name: string;
      type: string;
    }>,
    executor?: DbExecutor,
  ): Promise<void> {
    if (!inputs.length) {
      return;
    }
    const exec = executor ?? db;
    for (let start = 0; start < inputs.length; start += UPSERT_CHUNK) {
      const chunk = inputs.slice(start, start + UPSERT_CHUNK);
      // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
      await exec
        .insert(model)
        .values(
          chunk.map((input) => ({
            fileName: input.fileName,
            folder: input.folder,
            name: input.name,
            type: input.type,
            baseModel: input.baseModel,
            isAvailable: true,
            /* SAFETY: 类型断言已复核 */
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

  /** 「全量停用 + 批量回填」一次提交（ISSUE #3869）：`syncModels` 的落库段收进
   *  同一 `immediate` 事务——分片逐片执行但同滚，中途失败不留「部分模型可见、
   *  部分不可见」的中间态。调用方（models.ts）不直接开事务、不直接摸 db。 */
  async applyLocalSync(
    inputs: Array<{
      baseModel: string;
      fileName: string;
      folder: string;
      name: string;
      type: string;
    }>,
  ): Promise<void> {
    await db.transaction(
      async (tx) => {
        await this.disableAllLocal(tx);
        await this.upsertScannedMany(inputs, tx);
      },
      { behavior: "immediate" },
    );
  }

  async listAvailableFileNamesByFolders(folders: Array<string>): Promise<Array<string>> {
    if (!folders.length) {
      return [];
    }
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
    for (const r of rows) {
      /* folder 是 DB 读出的可空列，空串同样按「没有分组键」跳过 */
      if (r.folder !== null && r.folder !== "") {
        out[r.folder] = Number(r.count);
      }
    }
    return out;
  }
}

export const modelRepository = new ModelRepository();
