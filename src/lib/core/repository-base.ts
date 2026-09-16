/**
 * `repository-base.ts` — Repository 模式的契约与泛型基类（Drizzle 版）
 * ===========================================================================
 *
 * 子类传入表对象即可获得标准 CRUD；复杂查询在子类中用 `db` + Drizzle 查询
 * 构造器实现。
 *
 * 本模块只做一件事：**把「实体 ↔ 表 ↔ 主键」的关系翻译成 CRUD 的机械动作**。
 * 它刻意不含日志、不含框架、不含任何领域判断 —— 那三样都不属于基类：
 *
 *   · **日志**：基类曾对 `create` 打一条 `log.debug("create", { id })`。但这一行
 *     是全文件唯一的日志调用，而 `create` 本身是三步机械动作（insert →
 *     returning → 取首行），没有任何「值得一提的分支」；它的实际效果是把日志
 *     口径钉在基类（每个子类想记点更有用的东西时，只能自己另加一条），并让
 *     这个模块在**没有日志设施**的宿主（测试、纯 Node 脚本）里也必须连带加载
 *     日志实现（pino + 脱敏 + 写盘镜像）。删除后模块只依赖 `db` 与表对象，
 *     可单独加载；需要留痕的写入由**子类**按自己的语义记（例如任务状态机在
 *     `repository-task.ts` 里记状态迁移，那才是有信息量的那一行）。
 *   · **错误类型**：更新不存在的记录抛 `NotFoundError`。类本身是领域契约、住在
 *     `./errors`（没有 re-export），这里只 import 它 —— 调用方要区分这个错误
 *     必须从定义处取（`~/lib/core/errors`），避免「基类的实现细节」被当成公开 API。
 *   · **表名**：findAll / update 这类「按任意条件取行」的方法不保证行序，
 *     SQL 没有默认顺序。基类因此**不承诺顺序**：需要稳定顺序的查询在子类里
 *     `.orderBy(...)`（不在这里按主键排一遍当作「通用规则」——那是先猜后验）。
 *
 * 基类允许表对象与主键列**不同源**（第二个参数缺省时才回落到 `table.id`）：
 * `AnySQLiteTable` 与列对象的 `T` 类型也不保证可比。这里不用
 * `satisfies DrizzleRepository<T>` 之类的断言去「顺便」证明这件事 ——
 * 实测那类断言碰巧不报错（`T` 只出现在方法签名与 `protected` 成员里，没有
 * 不兼容读操作），会给出一个**假保证**：它证明的只是「类型还能编译」，
 * 不是「子类传的表与主键列对得上」。真正的判据在行为侧：`idColumn` 覆盖
 * `table.id` 时能否命中正确的行，由 `repository.test.ts` 的用例锁住。
 *
 * @module core/repository-base
 */
import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import type { AnySQLiteColumn, AnySQLiteTable } from "drizzle-orm/sqlite-core";
import { NotFoundError } from "./errors";
import type { Task, TaskImage } from "~/server/db/schema";

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
  /** 取全部（**不保证顺序**；需要稳定顺序时在子类里 `orderBy`）。 */
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
export class DrizzleRepository<
  T extends Identifiable,
> implements Repository<T> {
  constructor(
    protected readonly table: AnySQLiteTable,
    protected readonly idColumn?: AnySQLiteColumn,
  ) {}

  private get id() {
    return (this.idColumn ??
      (this.table as unknown as Record<string, AnySQLiteColumn>).id)!;
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
