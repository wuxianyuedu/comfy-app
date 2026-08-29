/**
 * `repository-base.ts` — Repository 模式的契约与泛型基类
 * ===========================================================================
 *
 * 本文件承载 Repository 模式的基础设施，与具体业务实体无关：
 *
 *   - {@link Identifiable} / {@link Repository}：与具体 ORM 无关的契约接口；
 *   - {@link PrismaDelegate}：Prisma 模型 delegate 的结构化最小接口；
 *   - {@link PrismaRepository}：基于 Prisma delegate 的泛型基类，封装 CRUD；
 *   - {@link TaskWithCover}：带首张封面图的任务行类型。
 *
 * 业务 Repository（ProjectRepository / TaskRepository / ...）各自拆分为
 * `repository-*.ts`，由 `repository.ts` 统一 re-export，引用方零改动。
 *
 * @module core/repository-base
 */
import { NotFoundError } from "./errors";
import { createLogger } from "./logger";
import type { Prisma } from "../../../generated/prisma";

const log = createLogger("core:repository");

/** 带首张封面图的任务行（画廊/历史面板专用，`listByUser` includeImages 时返回）。 */
export type TaskWithCover = Prisma.TaskGetPayload<{ include: { images: true } }>;

/** 所有可被 Repository 管理的实体都需具备可比较的字符串主键。 */
export interface Identifiable {
  id: string;
}

/**
 * 与 ORM 无关的持久化契约。任何业务模块都应面向该接口编程，
 * 而非直接依赖 Prisma 客户端。
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
 * Prisma 模型 delegate 的结构化最小接口，用于约束泛型基类可操作的委托对象。
 * `prisma.project` / `prisma.task` 等均满足此形状。
 */
export interface PrismaDelegate<
  T,
  TCreate,
  TUpdate,
  TWhereUnique,
> {
  findUnique(args: { where: TWhereUnique }): Promise<T | null>;
  findMany(args?: unknown): Promise<T[]>;
  create(args: { data: TCreate }): Promise<T>;
  update(args: { where: TWhereUnique; data: TUpdate }): Promise<T>;
  delete(args: { where: TWhereUnique }): Promise<T>;
}

/**
 * 基于 Prisma delegate 的泛型 CRUD 基类。子类只需传入 `prisma.xxx` 委托与
 * 主键字段名，即可获得一套标准、可单测的持久化能力。
 *
 * @typeParam T           实体类型（需满足 {@link Identifiable}）
 * @typeParam TCreate     Prisma create 入参类型
 * @typeParam TUpdate     Prisma update 的 `data` 类型
 * @typeParam TWhereUnique Prisma 主键 where 类型
 */
export class PrismaRepository<
  T extends Identifiable,
  TCreate,
  TUpdate,
  TWhereUnique,
> implements Repository<T>
{
  constructor(
    protected readonly delegate: PrismaDelegate<
      T,
      TCreate,
      TUpdate,
      TWhereUnique
    >,
    protected readonly idField: keyof TWhereUnique = "id" as keyof TWhereUnique
  ) {}

  async findById(id: string): Promise<T | null> {
    return this.delegate.findUnique({
      where: { [this.idField]: id } as TWhereUnique,
    });
  }

  async findAll(): Promise<T[]> {
    return this.delegate.findMany();
  }

  async create(entity: T): Promise<T> {
    log.debug("create", { entity: (entity as { id?: string }).id });
    return this.delegate.create({ data: entity as unknown as TCreate });
  }

  async update(id: string, patch: Partial<T>): Promise<T> {
    const existing = await this.findById(id);
    if (!existing) throw new NotFoundError(`记录不存在: ${id}`);
    return this.delegate.update({
      where: { [this.idField]: id } as TWhereUnique,
      data: patch as unknown as TUpdate,
    });
  }

  async delete(id: string): Promise<void> {
    await this.delegate.delete({
      where: { [this.idField]: id } as TWhereUnique,
    });
  }
}
