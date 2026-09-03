/**
 * `repository-base.ts` — Repository 模式的契约与泛型基类（Drizzle 版）
 * ===========================================================================
 *
 * 替代原 `PrismaRepository` / `PrismaDelegate`。子类传入表对象即可获得标准
 * CRUD；复杂查询在子类中用 `db` + Drizzle 查询构造器实现。
 *
 * @module core/repository-base
 */
import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import type { AnySQLiteColumn, AnySQLiteTable } from "drizzle-orm/sqlite-core";
import { NotFoundError } from "./errors";
import { createLogger } from "./logger";
import type { Task, TaskImage } from "~/server/db/schema";

const log = createLogger("core:repository");

/** 带首张封面图的任务行（画廊/历史面板专用）。 */
export type TaskWithCover = Task & { images: TaskImage[] };

/** 所有可被 Repository 管理的实体都需具备可比较的字符串主键。 */
export interface Identifiable {
  id: string;
}

/**
 * 与 ORM 无关的持久化契约。任何业务模块都应面向该接口编程，
 * 而非直接依赖 Drizzle 客户端。
 */
export interface Repository<T extends Identifiable> {
  /** 按主键取单条；不存在返回 `null`。 */
  findById(id: string): Promise<T | null>;
  /** 取全部（小规模集合；大数据量请改用分页方法）。 */
  findAll(): Promise<T[]>;
  /** 插入一条。 */
  create(entity: T): Promise<T>;
  /** 部分更新（仅覆盖传入字段）。 */
  update(id: string, patch: Partial<T>): Promise<T>;
  /** 删除；不存在静默忽略。 */
  delete(id: string): Promise<void>;
}

/**
 * 通用 Drizzle CRUD 基类。子类传入表对象即可获得一套标准、可单测的
 * 持久化能力（findById / findAll / create / update / delete）。
 *
 * @typeParam T 实体类型（需满足 {@link Identifiable}，通常为 `InferSelectModel`）
 */
export class DrizzleRepository<T extends Identifiable> implements Repository<T> {
  constructor(
    protected readonly table: AnySQLiteTable,
    protected readonly idColumn?: AnySQLiteColumn
  ) {}

  private get id() {
    return (this.idColumn ?? (this.table as unknown as Record<string, AnySQLiteColumn>).id)!;
  }

  async findById(id: string): Promise<T | null> {
    const rows = await db
      .select()
      .from(this.table)
      .where(eq(this.id, id))
      .limit(1);
    return (rows[0] as T) ?? null;
  }

  async findAll(): Promise<T[]> {
    return (await db.select().from(this.table)) as T[];
  }

  async create(entity: T): Promise<T> {
    log.debug("create", { id: (entity as { id?: string }).id });
    const rows = await db
      .insert(this.table)
      .values(entity as Record<string, unknown>)
      .returning();
    return rows[0] as T;
  }

  async update(id: string, patch: Partial<T>): Promise<T> {
    const existing = await this.findById(id);
    if (!existing) throw new NotFoundError(`记录不存在: ${id}`);
    const rows = await db
      .update(this.table)
      .set(patch as Record<string, unknown>)
      .where(eq(this.id, id))
      .returning();
    return rows[0] as T;
  }

  async delete(id: string): Promise<void> {
    await db.delete(this.table).where(eq(this.id, id));
  }
}
