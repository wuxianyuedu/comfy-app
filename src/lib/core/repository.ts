/**
 * `repository.ts` — 持久化访问的 Repository 抽象（Repository 模式）
 * ===========================================================================
 *
 * 动机
 * ----
 * 当前 44 个 API 路由里有 30 个直接 `import { prisma }` 并手写 `findMany` /
 * `update` / `deleteMany`，导致：SQL 散落、缺统一校验、缺按用户隔离、
 * 无法单测（强耦合 Prisma 单例）。本文件确立 **Repository 模式**：
 *
 *   - {@link Identifiable} / {@link Repository}：与具体 ORM 无关的契约接口；
 *   - {@link PrismaRepository}：基于 Prisma delegate 的泛型基类，封装 CRUD；
 *   - `ProjectRepository`：业务 Repository 范例，附加「按用户隔离」语义。
 *
 * 收益
 * ----
 * - API 路由只依赖 `Repository` 接口，不碰 `prisma` → 可换实现、可 mock 测试；
 * - 用户隔离（userId 过滤）集中在 Repository，避免每个路由各写一遍 `where`；
 * - 后续引入缓存/读写分离，只需在基类加一层，调用方无感。
 *
 * @module core/repository
 */
import { prisma } from "@/lib/db";
import { NotFoundError } from "./errors";
import { createLogger } from "./logger";
import { Prisma, type Task, type WorkflowTemplate } from "@prisma/client";

const log = createLogger("core:repository");

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

// ───────────────────────────────────────────────────────────────────────────
// 业务 Repository 范例：Project
// ───────────────────────────────────────────────────────────────────────────

import type { Project } from "@prisma/client";

/**
 * 项目仓储。在基类 CRUD 之上，强制所有查询按 `userId` 隔离，
 * 杜绝「A 用户读到 B 用户项目」的越权风险。
 */
export class ProjectRepository extends PrismaRepository<
  Project,
  Project,
  Partial<Project>,
  { id: string }
> {
  constructor() {
    super(prisma.project as unknown as PrismaDelegate<
      Project,
      Project,
      Partial<Project>,
      { id: string }
    >);
  }

  /** 取某用户的所有项目（按更新时间倒序，最新的在前）。 */
  async listByUser(userId: string): Promise<Project[]> {
    return prisma.project.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    });
  }

  /**
   * 按用户 upsert：客户端生成的稳定 `proj_*` id 即主键，
   * 首次写入建行（归属 userId），之后仅更新字段。
   */
  async upsertForUser(
    userId: string,
    data: {
      id: string;
      name: string;
      nodes?: unknown;
      edges?: unknown;
    }
  ): Promise<Project> {
    return prisma.project.upsert({
      where: { id: data.id },
      create: {
        id: data.id,
        name: data.name,
        nodes: data.nodes as unknown as Prisma.InputJsonValue,
        edges: data.edges as unknown as Prisma.InputJsonValue,
        userId,
      },
      update: {
        name: data.name,
        nodes: data.nodes as unknown as Prisma.InputJsonValue,
        edges: data.edges as unknown as Prisma.InputJsonValue,
        updatedAt: new Date(),
      },
    });
  }

  /** 仅当用户拥有该项目时才删除，避免越权删除。 */
  async deleteForUser(userId: string, id: string): Promise<void> {
    await prisma.project.deleteMany({ where: { id, userId } });
  }
}

/** 进程内单例：API 路由与 server action 共享同一实例。 */
export const projectRepository = new ProjectRepository();

// ───────────────────────────────────────────────────────────────────────────
// 业务 Repository 范例：Task（生成任务）
// ───────────────────────────────────────────────────────────────────────────

/**
 * 任务仓储。在基类 CRUD 之上，强制所有查询按 `userId` 隔离，并提供任务专属的
 * 列表/状态更新语义。执行层与 API 路由统一通过本类访问 `Task`，不直接碰 Prisma。
 */
export class TaskRepository extends PrismaRepository<
  Task,
  Task,
  Partial<Task>,
  { id: string }
> {
  constructor() {
    super(
      prisma.task as unknown as PrismaDelegate<
        Task,
        Task,
        Partial<Task>,
        { id: string }
      >
    );
  }

  /**
   * 取某用户的任务，按创建时间倒序（最新在前）。
   * 支持按 `projectId` 过滤与分页（`take`/`skip`），供「项目归档」与无限滚动使用。
   */
  async listByUser(
    userId: string,
    opts?: { projectId?: string; take?: number; skip?: number }
  ): Promise<Task[]> {
    return prisma.task.findMany({
      where: {
        userId,
        ...(opts?.projectId ? { projectId: opts.projectId } : {}),
      },
      orderBy: { createdAt: "desc" },
      ...(opts?.take !== undefined ? { take: opts.take } : {}),
      ...(opts?.skip !== undefined ? { skip: opts.skip } : {}),
    });
  }

  /** 取单条且仅当归属该用户；否则返回 `null`（杜绝越权读取）。 */
  async findByIdForUser(userId: string, id: string): Promise<Task | null> {
    const task = await this.findById(id);
    return task && task.userId === userId ? task : null;
  }

  /**
   * 仅当用户拥有该任务时更新状态（及可选的附加字段）。
   * 集中处理「越权 + 不存在」校验，调用方无需重复判断。
   */
  async updateStatusForUser(
    userId: string,
    id: string,
    status: string,
    extra?: Prisma.TaskUpdateInput
  ): Promise<Task> {
    const existing = await this.findByIdForUser(userId, id);
    if (!existing) throw new NotFoundError(`任务不存在: ${id}`);
    const data: Prisma.TaskUpdateInput = { status };
    if (extra) Object.assign(data, extra);
    return prisma.task.update({ where: { id }, data });
  }
}

/** 进程内单例。 */
export const taskRepository = new TaskRepository();

// ───────────────────────────────────────────────────────────────────────────
// 业务 Repository 范例：WorkflowTemplate（用户导入的工作流）
// ───────────────────────────────────────────────────────────────────────────

/**
 * 工作流模板仓储。与 `TaskRepository` 同构：所有查询按 `userId` 隔离，
 * 提供列表与「归属校验」读取，供工作流库 API 与执行层统一使用。
 */
export class WorkflowTemplateRepository extends PrismaRepository<
  WorkflowTemplate,
  WorkflowTemplate,
  Partial<WorkflowTemplate>,
  { id: string }
> {
  constructor() {
    super(
      prisma.workflowTemplate as unknown as PrismaDelegate<
        WorkflowTemplate,
        WorkflowTemplate,
        Partial<WorkflowTemplate>,
        { id: string }
      >
    );
  }

  /** 取某用户的全部工作流模板（按创建时间倒序）。 */
  async listByUser(userId: string): Promise<WorkflowTemplate[]> {
    return prisma.workflowTemplate.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  /** 取单条且仅当归属该用户；否则返回 `null`（杜绝越权读取）。 */
  async findByIdForUser(
    userId: string,
    id: string
  ): Promise<WorkflowTemplate | null> {
    const wf = await this.findById(id);
    return wf && wf.userId === userId ? wf : null;
  }
}

/** 进程内单例。 */
export const workflowTemplateRepository = new WorkflowTemplateRepository();
