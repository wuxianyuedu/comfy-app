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
import {
  Prisma,
  type Task,
  type WorkflowTemplate,
  type Model,
  type WorkflowModelTag,
  type FilmProject,
  type Skill,
  type UserModelConfig,
  type LoraTrainingJob,
  type User,
  type LlmConfig,
} from "../../../generated/prisma";

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

// ───────────────────────────────────────────────────────────────────────────
// 业务 Repository 范例：Project
// ───────────────────────────────────────────────────────────────────────────

import type { Project } from "../../../generated/prisma";

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
   * 创建一条排队任务（generate 等生产路径统一入口）。
   * `params` / `referenceImages` / `workflowSnapshot` 等 JSON 字段在此完成
   * Prisma `InputJsonValue` 收口，调用方无需再 `as any`。
   */
  async createQueued(input: {
    userId: string;
    type: string;
    prompt: string;
    negativePrompt?: string | null;
    params: unknown;
    workflowName: string;
    projectId?: string | null;
    referenceImages?: unknown;
    workflowSnapshot?: unknown;
  }): Promise<Task> {
    return prisma.task.create({
      data: {
        userId: input.userId,
        type: input.type,
        prompt: input.prompt,
        negativePrompt: input.negativePrompt ?? undefined,
        params: input.params as Prisma.InputJsonValue,
        workflowName: input.workflowName,
        projectId: input.projectId ?? null,
        referenceImages: input.referenceImages as Prisma.InputJsonValue | undefined,
        workflowSnapshot:
          input.workflowSnapshot as Prisma.InputJsonValue | undefined,
        status: "QUEUED",
      },
    });
  }

  /** 取某用户的任务，按创建时间倒序（最新在前）。
   * 支持按 `projectId` 过滤、状态过滤与分页（`take`/`skip`），供「项目归档」
   * 与无限滚动使用。`includeImages` 时附带每行首张封面图
   * （isCover 优先，历史行兜底取第一张），供画廊/历史面板使用。
   */
  async listByUser(
    userId: string,
    opts: {
      projectId?: string;
      take?: number;
      skip?: number;
      statusList?: string[];
      includeImages: true;
    }
  ): Promise<TaskWithCover[]>;
  async listByUser(
    userId: string,
    opts?: {
      projectId?: string;
      take?: number;
      skip?: number;
      statusList?: string[];
      includeImages?: boolean;
    }
  ): Promise<Task[]>;
  async listByUser(
    userId: string,
    opts?: {
      projectId?: string;
      take?: number;
      skip?: number;
      statusList?: string[];
      includeImages?: boolean;
    }
  ): Promise<Task[] | TaskWithCover[]> {
    return prisma.task.findMany({
      where: {
        userId,
        ...(opts?.projectId ? { projectId: opts.projectId } : {}),
        ...(opts?.statusList && opts.statusList.length > 0
          ? { status: { in: opts.statusList } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      ...(opts?.take !== undefined ? { take: opts.take } : {}),
      ...(opts?.skip !== undefined ? { skip: opts.skip } : {}),
      ...(opts?.includeImages
        ? {
            include: {
              images: {
                orderBy: [{ isCover: "desc" }, { sortIndex: "asc" }],
                take: 1,
              },
            },
          }
        : {}),
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

  /** 取单条任务并附带全部产出图（按 sortIndex 升序）。 */
  async findByIdWithImages(id: string) {
    return prisma.task.findUnique({
      where: { id },
      include: { images: { orderBy: { sortIndex: "asc" } } },
    });
  }

  /** 仅取状态（cancel 等轻量场景，避免拖大 JSON 列）。 */
  async findStatusById(id: string): Promise<{ status: string } | null> {
    return prisma.task.findUnique({
      where: { id },
      select: { status: true },
    });
  }

  /** 仅取执行快照与项目归属（workflow 下载路由用）。 */
  async findSnapshotById(
    id: string
  ): Promise<{ workflowSnapshot: unknown; projectId: string | null } | null> {
    return prisma.task.findUnique({
      where: { id },
      select: { workflowSnapshot: true, projectId: true },
    });
  }

  /** 取某项目下全部任务及产出图（项目产出列表路由用）。 */
  async findByProjectIdWithImages(projectId: string) {
    return prisma.task.findMany({
      where: { projectId },
      include: { images: { orderBy: { sortIndex: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
  }

  // ── 执行层（executor / reaper / runner-state / enqueue / firstframe / film）──
  // 以下方法操作的是「进程自己领养的任务」——由 API 层创建时已归属用户，
  // 执行层按 taskId 精确寻址即可，不再重复注入 userId；JSON 字段收口在本层。

  /** 执行完成回写元数据投影：任务归属项目 + 请求参数 + 复现快照源。 */
  async findExecutionMeta(
    taskId: string
  ): Promise<{
    projectId: string | null;
    params: unknown;
    prompt: string;
    negativePrompt: string | null;
    workflowName: string;
    referenceImages: unknown;
    createdAt: Date;
  } | null> {
    return prisma.task.findUnique({
      where: { id: taskId },
      select: {
        projectId: true,
        params: true,
        prompt: true,
        negativePrompt: true,
        workflowName: true,
        referenceImages: true,
        createdAt: true,
      },
    });
  }

  /** 轻量进度投影：watchFilm 轮询镜头对应任务时用。 */
  async findExecutionProgress(
    taskId: string
  ): Promise<{ status: string; progress: number; resultImages: unknown } | null> {
    return prisma.task.findUnique({
      where: { id: taskId },
      select: { status: true, progress: true, resultImages: true },
    });
  }

  /** 执行期进度回写：采样进度变化时置 RUNNING + progress。 */
  async updateProgress(taskId: string, pct: number): Promise<void> {
    await prisma.task.update({
      where: { id: taskId },
      data: { progress: pct, status: "RUNNING" },
    });
  }

  /** 提交成功后标记 RUNNING 并绑定 promptId（API 格式与 comfy-cli 共用）。 */
  async markRunning(taskId: string, promptId: string): Promise<void> {
    await prisma.task.update({
      where: { id: taskId },
      data: { status: "RUNNING", promptId },
    });
  }

  /**
   * 成功收口：写终态 + 产出图投影 + 运行时参数 + 执行快照。
   * `resultImages` / `params` / `workflowSnapshot` 在此完成 JSON 收口。
   */
  async finalizeSuccess(
    taskId: string,
    data: {
      resultImages: unknown;
      params: unknown;
      workflowSnapshot?: unknown;
    }
  ): Promise<void> {
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: "SUCCEEDED",
        progress: 100,
        finishedAt: new Date(),
        resultImages: data.resultImages as Prisma.InputJsonValue,
        params: data.params as Prisma.InputJsonValue,
        ...(data.workflowSnapshot !== undefined
          ? { workflowSnapshot: data.workflowSnapshot as Prisma.InputJsonValue }
          : {}),
      },
    });
  }

  /** 失败收口：终态 + 友好错误 + 结构化校验错误（JSON 序列化收口）。 */
  async finalizeFailure(
    taskId: string,
    error: string,
    validationErrors?: unknown[]
  ): Promise<void> {
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: "FAILED",
        error,
        validationErrors:
          validationErrors && validationErrors.length
            ? JSON.stringify(validationErrors)
            : null,
        finishedAt: new Date(),
      },
    });
  }

  /** 取消任务（DB 侧）：非终态行置 CANCELLED + finishedAt。 */
  async cancel(taskId: string): Promise<void> {
    await prisma.task.update({
      where: { id: taskId },
      data: { status: "CANCELLED", finishedAt: new Date() },
    });
  }

  /** reaper 对账收口：仅写终态 + 可选错误（不触碰结果/快照字段）。 */
  async finalizeFromReaper(
    taskId: string,
    status: "SUCCEEDED" | "FAILED",
    error: string | null
  ): Promise<void> {
    await prisma.task.update({
      where: { id: taskId },
      data: { status, finishedAt: new Date(), error },
    });
  }

  /** 取消前轻量投影：仅状态 + promptId（判断是否需 interrupt）。 */
  async findStatusAndPromptById(
    taskId: string
  ): Promise<{ status: string; promptId: string | null } | null> {
    return prisma.task.findUnique({
      where: { id: taskId },
      select: { status: true, promptId: true },
    });
  }

  /** 覆写任务日志（runner 防抖落盘 / 终态 flush）。 */
  async replaceLogs(taskId: string, logs: unknown[]): Promise<void> {
    await prisma.task
      .update({ where: { id: taskId }, data: { logs: logs as Prisma.InputJsonValue } })
      .catch(() => {});
  }

  /** reaper：取「卡在 QUEUED 超过 cutoff 且从未拿到 promptId」的孤儿行。 */
  async listStaleQueued(
    cutoff: Date,
    take: number
  ): Promise<Array<{ id: string; createdAt: Date; workflowName: string }>> {
    return prisma.task.findMany({
      where: {
        status: "QUEUED",
        finishedAt: null,
        createdAt: { lt: cutoff },
        promptId: null,
      },
      select: { id: true, createdAt: true, workflowName: true },
      take,
    });
  }

  /** reaper：取「RUNNING 超过 cutoff 且已拿到 promptId」的待对账行。 */
  async listStaleRunning(
    cutoff: Date,
    take: number
  ): Promise<Array<{ id: string; promptId: string | null; createdAt: Date; workflowName: string }>> {
    return prisma.task.findMany({
      where: {
        status: "RUNNING",
        finishedAt: null,
        createdAt: { lt: cutoff },
        promptId: { not: null },
      },
      select: { id: true, promptId: true, createdAt: true, workflowName: true },
      take,
    });
  }

  /** 成功收口时批量写入产出图（TaskImage 无 userId，与 Task 同仓内聚）。 */
  async createImages(
    taskId: string,
    images: Array<{
      localPath: string;
      sortIndex: number;
      isCover: boolean;
      mediaType: string;
      seed: string | null;
      width?: number | null;
      height?: number | null;
    }>
  ): Promise<void> {
    await prisma.taskImage.createMany({
      data: images.map((im) => ({
        taskId,
        localPath: im.localPath,
        sortIndex: im.sortIndex,
        isCover: im.isCover,
        mediaType: im.mediaType,
        seed: im.seed,
        width: im.width ?? null,
        height: im.height ?? null,
      })),
    });
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

  /**
   * 按用户 + 可选的投影字段取单条（subgraph 详情等需要 select 的场景）。
   * 只允许查归属当前用户的行，杜绝越权读取。
   */
  async findByIdForUserSelect<T extends Prisma.WorkflowTemplateSelect>(
    userId: string,
    id: string,
    select: T
  ): Promise<Prisma.WorkflowTemplateGetPayload<{ select: T }> | null> {
    return prisma.workflowTemplate.findFirst({
      where: { id, userId },
      select,
    });
  }

  /**
   * 列表查询：按用户隔离 + 可选过滤（类型 / 标签 / 自定义 where 与 select）。
   * 由工作流库 `GET /api/workflows` 与内部扫描路径共用，取代路由内裸 `findMany`。
   * 不传 select 时返回完整实体，传了则按投影类型推导返回。
   */
  async listForUser<S extends Prisma.WorkflowTemplateSelect | undefined = undefined>(
    userId: string,
    opts: {
      where?: Prisma.WorkflowTemplateWhereInput;
      select?: S;
      orderBy?: Prisma.WorkflowTemplateOrderByWithRelationInput[];
    } = {}
  ): Promise<
    S extends Prisma.WorkflowTemplateSelect
      ? Prisma.WorkflowTemplateGetPayload<{ select: S }>[]
      : WorkflowTemplate[]
  > {
    return prisma.workflowTemplate.findMany({
      where: { userId, ...opts.where },
      select: opts.select,
      orderBy: opts.orderBy ?? { createdAt: "desc" },
    }) as never;
  }

  /**
   * 工作流导入创建（`POST /api/workflows` 统一入口）。
   * JSON 字段（graph/paramMap/rawJson/positions）在此完成 `InputJsonValue` 收口。
   */
  async createImported(input: {
    userId: string;
    name: string;
    taskType: string;
    graph: unknown;
    paramMap?: unknown;
    rawJson?: unknown;
    positions?: unknown;
    sourcePath?: string | null;
    sourceChecksum?: string | null;
    sourceMtime?: number | null;
  }): Promise<WorkflowTemplate> {
    return prisma.workflowTemplate.create({
      data: {
        userId: input.userId,
        name: input.name,
        taskType: input.taskType,
        graph: input.graph as Prisma.InputJsonValue,
        paramMap: input.paramMap as Prisma.InputJsonValue | undefined,
        rawJson: input.rawJson as Prisma.InputJsonValue | undefined,
        positions: input.positions as Prisma.InputJsonValue | undefined,
        sourcePath: input.sourcePath ?? undefined,
        sourceChecksum: input.sourceChecksum ?? undefined,
        sourceMtime: input.sourceMtime ?? undefined,
      },
    });
  }

  /** 更新本地文件溯源字段（R-ardot105 本地工作流 relink 场景）。 */
  async relinkSourcePath(
    id: string,
    data: { sourcePath: string; sourceMtime: number }
  ): Promise<void> {
    await prisma.workflowTemplate.update({
      where: { id },
      data: { sourcePath: data.sourcePath, sourceMtime: data.sourceMtime },
    });
  }

  /** 设置工作流的模型标签关系（modelTags 全量 set 语义，R-T3-phase5 收口）。 */
  async setModelTags(id: string, tagIds: string[]): Promise<void> {
    await prisma.workflowTemplate.update({
      where: { id },
      data: { modelTags: { set: tagIds.map((tid) => ({ id: tid })) } },
    });
  }
}

/** 进程内单例。 */
export const workflowTemplateRepository = new WorkflowTemplateRepository();

// ───────────────────────────────────────────────────────────────────────────
// 业务 Repository：Model（模型目录，公共可读）
// ───────────────────────────────────────────────────────────────────────────

/**
 * 模型目录仓储。模型目录是**公共可读**的（不绑定用户），因此本类不强制
 * `userId` 隔离，仅提供按可用性 / 类型 / 名称的过滤查询，供
 * `GET /api/models` 等公共端点使用。所有写操作走别的业务路径，这里只暴露读。
 */
export class ModelRepository extends PrismaRepository<
  Model,
  Model,
  Partial<Model>,
  { id: string }
> {
  constructor() {
    super(
      prisma.model as unknown as PrismaDelegate<Model, Model, Partial<Model>, { id: string }>
    );
  }

  /**
   * 列出可用模型（默认仅 `isAvailable`）。支持按类型与名称模糊过滤。
   * 与改造前 `GET /api/models` 的 where 构造完全等价。
   */
  async list(opts?: { type?: string; q?: string }): Promise<Model[]> {
    const where: Prisma.ModelWhereInput = { isAvailable: true };
    if (opts?.type) where.type = opts.type;
    if (opts?.q) where.name = { contains: opts.q };
    return prisma.model.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 300,
    });
  }

  /**
   * 按目录批量切换可用性（models/config 启停目录时的即时反馈）。
   * 只允许对目录下已扫描入库的行生效，不触碰磁盘文件。
   */
  async setAvailabilityByFolder(
    folder: string,
    isAvailable: boolean
  ): Promise<void> {
    await prisma.model.updateMany({
      where: { folder },
      data: { isAvailable },
    });
  }

  // ── 模型同步执行层（models.ts / trainer.ts）──

  /** 全量退役所有 LOCAL 行（每次磁盘同步的第一步，防目录删除后残留假可用）。 */
  async disableAllLocal(): Promise<void> {
    await prisma.model.updateMany({
      where: { source: "LOCAL" },
      data: { isAvailable: false },
    });
  }

  /** 磁盘扫描到的单文件 upsert（fileName_folder 复合唯一键收口在此）。 */
  async upsertScanned(input: {
    fileName: string;
    folder: string;
    name: string;
    type: string;
    baseModel: string;
  }): Promise<void> {
    await prisma.model.upsert({
      where: { fileName_folder: { fileName: input.fileName, folder: input.folder } },
      create: {
        fileName: input.fileName,
        folder: input.folder,
        name: input.name,
        type: input.type,
        baseModel: input.baseModel,
        isAvailable: true,
        source: "LOCAL",
      },
      update: {
        isAvailable: true,
        name: input.name,
        type: input.type,
        baseModel: input.baseModel,
      },
    });
  }

  /** 按目录集合取可用模型文件名（canvas COMBO 下拉投影）。 */
  async listAvailableFileNamesByFolders(folders: string[]): Promise<string[]> {
    if (!folders.length) return [];
    const rows = await prisma.model.findMany({
      where: { isAvailable: true, folder: { in: folders } },
      select: { fileName: true },
    });
    return Array.from(new Set(rows.map((row) => row.fileName))).sort((left, right) =>
      left.localeCompare(right)
    );
  }

  /** 可用文件按目录计数（配置弹窗「文件数」列）。 */
  async countsByFolder(): Promise<Record<string, number>> {
    const rows = await prisma.model.groupBy({
      by: ["folder"],
      where: { isAvailable: true },
      _count: { _all: true },
    });
    const out: Record<string, number> = {};
    for (const r of rows) {
      if (r.folder) out[r.folder] = r._count._all;
    }
    return out;
  }

  /** LoRA 训练产出登记（trainer finishJob：把 .safetensors 注册进模型库）。 */
  async registerLora(input: {
    fileName: string;
    name: string;
    baseModel: string;
    triggerWord: string;
  }): Promise<void> {
    await prisma.model.upsert({
      where: { fileName_folder: { fileName: input.fileName, folder: "loras" } },
      update: { isAvailable: true, name: input.name, baseModel: input.baseModel, folder: "loras" },
      create: {
        name: input.name,
        type: "LORA",
        fileName: input.fileName,
        folder: "loras",
        baseModel: input.baseModel,
        category: "USER",
        source: "LOCAL",
        isAvailable: true,
        description: `由炼丹训练产出 · 触发词 ${input.triggerWord}`,
      },
    });
  }
}

/** 进程内单例。 */
export const modelRepository = new ModelRepository();

// ───────────────────────────────────────────────────────────────────────────
// 业务 Repository：WorkflowModelTag（用户级模型标签库）
// ───────────────────────────────────────────────────────────────────────────

/** 标签视图：去掉内部关系字段，只暴露 UI 需要的 id / name / count。 */
export interface WorkflowModelTagView {
  id: string;
  name: string;
  count: number;
}

/**
 * 模型标签仓储。标签是「用户级全局库」，按 `(userId, name)` 唯一；一个标签
 * 可被多张工作流（隐式多对多 `WorkflowTemplate.modelTags`）引用。本类集中
 * 实现列表 / 幂等 upsert / 重命名（保留关联）/ 删除，并把越权校验
 * （必须归属当前用户）收敛在仓储内，调用方不再手写 `where: { userId }`。
 */
export class WorkflowModelTagRepository extends PrismaRepository<
  WorkflowModelTag,
  WorkflowModelTag,
  Partial<WorkflowModelTag>,
  { id: string }
> {
  constructor() {
    super(
      prisma.workflowModelTag as unknown as PrismaDelegate<
        WorkflowModelTag,
        WorkflowModelTag,
        Partial<WorkflowModelTag>,
        { id: string }
      >
    );
  }

  /** 取该用户的全部标签，附各自被引用次数，按名称字母序稳定排序。 */
  async listByUser(userId: string): Promise<WorkflowModelTagView[]> {
    const rows = await prisma.workflowModelTag.findMany({
      where: { userId },
      select: { id: true, name: true, _count: { select: { workflows: true } } },
      orderBy: { name: "asc" },
    });
    return rows.map((row) =>({ id: row.id, name: row.name, count: row._count.workflows }));
  }

  /** 幂等 upsert：同名标签已存在则返回原记录，否则新建。 */
  async upsertByName(
    userId: string,
    name: string
  ): Promise<WorkflowModelTagView> {
    const tag = await prisma.workflowModelTag.upsert({
      where: { userId_name: { userId, name } },
      update: {},
      create: { userId, name },
      select: { id: true, name: true, _count: { select: { workflows: true } } },
    });
    return { id: tag.id, name: tag.name, count: tag._count.workflows };
  }

  /** 按「用户 + 名称」取主键（仅取 id），不存在返回 `null`。 */
  async findByUserAndName(
    userId: string,
    name: string
  ): Promise<{ id: string } | null> {
    return prisma.workflowModelTag.findUnique({
      where: { userId_name: { userId, name } },
      select: { id: true },
    });
  }

  /** 仅改名（关联行按 tag id 关联，重命名不破坏任何绑定）。 */
  async rename(id: string, newName: string): Promise<WorkflowModelTagView> {
    const tag = await prisma.workflowModelTag.update({
      where: { id },
      data: { name: newName },
      select: { id: true, name: true, _count: { select: { workflows: true } } },
    });
    return { id: tag.id, name: tag.name, count: tag._count.workflows };
  }

  /** 按主键删除（隐式关联的 workflow 绑定由关系级联清理）。 */
  async deleteById(id: string): Promise<void> {
    await prisma.workflowModelTag.delete({ where: { id } });
  }

  /** 按「用户 + 名称列表」批量取 id（PATCH modelTags set 场景）。 */
  async listIdsByNames(
    userId: string,
    names: string[]
  ): Promise<{ id: string }[]> {
    return prisma.workflowModelTag.findMany({
      where: { userId, name: { in: names } },
      select: { id: true },
    });
  }
}

/** 进程内单例。 */
export const workflowModelTagRepository = new WorkflowModelTagRepository();

// ───────────────────────────────────────────────────────────────────────────
// 业务 Repository：FilmProject（AI 影片项目）
// ───────────────────────────────────────────────────────────────────────────

/** 影片列表视图：去掉内部关系字段，只暴露列表卡需要的字段。 */
export interface FilmSummary {
  id: string;
  title: string;
  status: string;
  progress: number;
  finalVideo: string | null;
  shotCount: number;
  createdAt: Date;
}

/**
 * 影片项目仓储。所有查询按 `userId` 隔离；列表投影为 {@link FilmSummary}，
 * 详情可选项式 include 镜头（按 order 升序）。供 film 路由族与编排器使用。
 */
export class FilmRepository extends PrismaRepository<
  FilmProject,
  FilmProject,
  Partial<FilmProject>,
  { id: string }
> {
  constructor() {
    super(
      prisma.filmProject as unknown as PrismaDelegate<
        FilmProject,
        FilmProject,
        Partial<FilmProject>,
        { id: string }
      >
    );
  }

  /** 取某用户的影片列表（最近 50 部，含镜头数投影）。 */
  async listByUser(userId: string): Promise<FilmSummary[]> {
    const rows = await prisma.filmProject.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        title: true,
        status: true,
        progress: true,
        finalVideo: true,
        createdAt: true,
        _count: { select: { shots: true } },
      },
    });
    return rows.map((row) =>({      id: row.id,
      title: row.title,
      status: row.status,
      progress: row.progress,
      finalVideo: row.finalVideo,
      shotCount: (row as { _count: { shots: number } })._count.shots,
      createdAt: row.createdAt,
    }));
  }

  /** 取单条且仅当归属该用户；`includeShots` 时附带按 order 升序的镜头。 */
  async findByIdForUser(
    userId: string,
    id: string,
    opts: { includeShots?: boolean } = {}
  ): Promise<FilmProject | null> {
    return prisma.filmProject.findFirst({
      where: { id, userId },
      include: opts.includeShots
        ? { shots: { orderBy: { order: "asc" as const } } }
        : undefined,
    });
  }

  // ── 影片编排执行层（film/orchestrator.ts）──
  // 编排器按影片 id 精确寻址（影片创建时已归属用户），状态流转收口在本层。

  /** 创建影片（初始 PARSING）。 */
  async create(input: {
    userId: string;
    title: string;
    script: string;
    type: string;
    styleSlug?: string | null;
    size: string;
    fps: number;
    framesPerShot: number;
    subtitleOn: boolean;
    bgmName?: string | null;
  }): Promise<FilmProject> {
    return prisma.filmProject.create({
      data: {
        userId: input.userId,
        title: input.title,
        script: input.script,
        type: input.type,
        styleSlug: input.styleSlug ?? null,
        size: input.size,
        fps: input.fps,
        framesPerShot: input.framesPerShot,
        subtitleOn: input.subtitleOn,
        bgmName: input.bgmName ?? null,
        status: "PARSING",
      },
    });
  }

  /** 追加一条影片日志（读 logs → push → 覆写，失败静默）。 */
  async appendLog(
    id: string,
    entry: { t: number; level: "info" | "progress" | "warn" | "error" | "success"; msg: string }
  ): Promise<void> {
    const film = await prisma.filmProject.findUnique({
      where: { id },
      select: { logs: true },
    });
    const arr = (film?.logs as unknown[] | null) ?? [];
    arr.push(entry);
    await prisma.filmProject
      .update({ where: { id }, data: { logs: arr as Prisma.InputJsonValue } })
      .catch(() => {});
  }

  /** 开始逐镜生成：GENERATING + 进度归零 + 清错误。 */
  async markGenerating(id: string): Promise<void> {
    await prisma.filmProject.update({
      where: { id },
      data: { status: "GENERATING", progress: 0, error: null },
    });
  }

  /** 生成期进度回写（不改变状态）。 */
  async updateProgress(id: string, pct: number): Promise<void> {
    await prisma.filmProject.update({ where: { id }, data: { progress: pct } });
  }

  /** 失败收口（watch 超时 / 镜头全挂 / 无可用素材 / ffmpeg 缺失 / 合成异常）。 */
  async markFailed(id: string, error: string): Promise<void> {
    await prisma.filmProject.update({
      where: { id },
      data: { status: "FAILED", error },
    });
  }

  /** 进入合成阶段：COMPOSING + 90%。 */
  async markComposing(id: string): Promise<void> {
    await prisma.filmProject.update({
      where: { id },
      data: { status: "COMPOSING", progress: 90, error: null },
    });
  }

  /** 合成完成：DONE + 100% + 最终视频地址。 */
  async markDone(id: string, finalVideo: string): Promise<void> {
    await prisma.filmProject.update({
      where: { id },
      data: { status: "DONE", progress: 100, finalVideo, error: null },
    });
  }

  /** 用户取消影片。 */
  async markCancelled(id: string): Promise<void> {
    await prisma.filmProject.update({
      where: { id },
      data: { status: "CANCELLED", error: "已取消" },
    });
  }
}

/** 进程内单例。 */
export const filmRepository = new FilmRepository();

// ───────────────────────────────────────────────────────────────────────────
// 业务 Repository：FilmShot（影片镜头）
// ───────────────────────────────────────────────────────────────────────────

/**
 * 镜头仓储。镜头挂在 FilmProject 下（无独立 userId 列），归属由父影片保证；
 * 编排器按 filmId / shotId 精确寻址，`params` JSON 字段在此收口。
 */
export class FilmShotRepository {
  /** 创建分镜批次（全部 IDLE；params JSON 收口）。 */
  async createMany(
    filmId: string,
    shots: Array<{
      order: number;
      heading?: string | null;
      prompt: string;
      negative?: string | null;
      params: unknown;
    }>
  ): Promise<void> {
    await prisma.filmShot.createMany({
      data: shots.map((shot) => ({
        filmId,
        order: shot.order,
        heading: shot.heading ?? null,
        prompt: shot.prompt,
        negative: shot.negative ?? null,
        status: "IDLE",
        params: shot.params as Prisma.InputJsonValue,
      })),
    });
  }

  /** 按影片取镜头（可选状态过滤，默认按 order 升序）。 */
  async listByFilm(
    filmId: string,
    opts: { status?: string; onlyWithVideo?: boolean } = {}
  ): Promise<Array<{
    id: string;
    order: number;
    heading: string | null;
    prompt: string;
    negative: string | null;
    status: string;
    taskId: string | null;
    progress: number;
    params: unknown;
    videoPath: string | null;
    duration: number | null;
  }>> {
    return prisma.filmShot.findMany({
      where: {
        filmId,
        ...(opts.status ? { status: opts.status } : {}),
        ...(opts.onlyWithVideo ? { NOT: { videoPath: null } } : {}),
      },
      orderBy: { order: "asc" },
    });
  }

  /** 镜头提交任务后置 QUEUED 并绑定 taskId。 */
  async markQueued(shotId: string, taskId: string): Promise<void> {
    await prisma.filmShot.update({
      where: { id: shotId },
      data: { taskId, status: "QUEUED", progress: 0 },
    });
  }

  /** 镜头提交失败置 FAILED。 */
  async markFailed(shotId: string): Promise<void> {
    await prisma.filmShot.update({
      where: { id: shotId },
      data: { status: "FAILED" },
    });
  }

  /** 镜头状态回写（watch 轮询：跟随任务状态 + 进度 + 产物路径）。 */
  async updateFromTask(
    shotId: string,
    data: {
      status: string;
      progress: number;
      videoPath?: string | null;
      duration?: number | null;
    }
  ): Promise<void> {
    await prisma.filmShot.update({
      where: { id: shotId },
      data: {
        status: data.status,
        progress: data.progress,
        videoPath: data.videoPath ?? undefined,
        duration: data.duration ?? null,
      },
    });
  }

  /** 取消影片时取仍在排队的镜头（用于逐个 cancelTask）。 */
  async listActiveWithTask(
    filmId: string
  ): Promise<Array<{ id: string; taskId: string | null }>> {
    return prisma.filmShot.findMany({
      where: {
        filmId,
        status: { in: ["QUEUED", "RUNNING"] },
        NOT: { taskId: null },
      },
      select: { id: true, taskId: true },
    });
  }

  /** 取消影片时把未终态镜头统一置 FAILED。 */
  async markAllActiveFailed(filmId: string): Promise<void> {
    await prisma.filmShot.updateMany({
      where: { filmId, status: { in: ["QUEUED", "RUNNING"] } },
      data: { status: "FAILED" },
    });
  }
}

/** 进程内单例。 */
export const filmShotRepository = new FilmShotRepository();

// ───────────────────────────────────────────────────────────────────────────
// 业务 Repository：Skill（内置/用户技能库，公共可读）
// ───────────────────────────────────────────────────────────────────────────

/** 内置技能种子数据的入参契约（数据本体见 `src/lib/skills-seed.ts`）。 */
export interface SkillSeed {
  name: string;
  slug: string;
  description: string;
  icon: string;
  category: string;
  promptTemplate: string;
  negativePrompt?: string;
  defaultParams?: Record<string, unknown>;
  recommendedModel?: string;
  tags: string[];
  coverUrl?: string;
  sortOrder: number;
}

/**
 * 技能仓储。技能库是**公共可读**的（不绑定用户），GET 走公共路由；
 * 写操作仅限管理员/本机场景。种子初始化（ensureBuiltIns）、列表过滤、
 * 分类计数、slug 唯一性校验与创建全部收口在本类。
 */
export class SkillRepository extends PrismaRepository<
  Skill,
  Skill,
  Partial<Skill>,
  { id: string }
> {
  constructor() {
    super(
      prisma.skill as unknown as PrismaDelegate<Skill, Skill, Partial<Skill>, { id: string }>
    );
  }

  /** 幂等种子：已有内置技能则跳过，否则整批写入。 */
  async ensureBuiltIns(seeds: SkillSeed[]): Promise<void> {
    const count = await prisma.skill.count({ where: { isBuiltIn: true } });
    if (count > 0) return;
    await prisma.skill.createMany({
      data: seeds.map((seed) =>({        name: seed.name,
        slug: seed.slug,
        description: seed.description,
        icon: seed.icon,
        category: seed.category,
        promptTemplate: seed.promptTemplate,
        negativePrompt: seed.negativePrompt,
        defaultParams: seed.defaultParams as unknown as Prisma.InputJsonValue,
        recommendedModel: seed.recommendedModel,
        coverUrl: seed.coverUrl,
        sortOrder: seed.sortOrder,
        isBuiltIn: true,
        isActive: true,
        tags: JSON.stringify(seed.tags),
      })),
    });
  }

  /** 列表查询：按分类 / 关键词 / 是否含未激活过滤（与旧 GET 行为等价）。 */
  async list(opts: {
    category?: string | null;
    q?: string;
    includeInactive?: boolean;
  }): Promise<Skill[]> {
    const where: Prisma.SkillWhereInput = {};
    if (!opts.includeInactive) where.isActive = true;
    if (opts.category && opts.category !== "all") where.category = opts.category;
    if (opts.q) {
      where.OR = [
        { name: { contains: opts.q } },
        { description: { contains: opts.q } },
        { tags: { contains: opts.q } },
      ];
    }
    return prisma.skill.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });
  }

  /** 按激活状态分组统计分类（含计数，按引用数倒序）。 */
  async groupByActiveCategory(): Promise<Array<{ category: string; count: number }>> {
    const rows = await prisma.skill.groupBy({
      by: ["category"],
      where: { isActive: true },
      _count: { category: true },
      orderBy: { _count: { category: "desc" } },
    });
    return rows.map((row) =>({      category: row.category as string,
      count: (row._count as { category: number }).category,
    }));
  }

  /** 按 slug 取唯一行（slug 全局唯一）。 */
  async findBySlug(slug: string): Promise<Skill | null> {
    return prisma.skill.findUnique({ where: { slug } });
  }

  /** 创建用户技能（非内置、默认激活）；tags 在此完成 JSON 序列化。 */
  async createUserSkill(input: {
    name: string;
    slug: string;
    description: string;
    icon: string;
    category: string;
    promptTemplate: string;
    negativePrompt?: string | null;
    defaultParams?: unknown;
    recommendedModel?: string | null;
    coverUrl?: string | null;
    sortOrder: number;
    tags: string[];
  }): Promise<Skill> {
    return prisma.skill.create({
      data: {
        name: input.name,
        slug: input.slug,
        description: input.description,
        icon: input.icon,
        category: input.category,
        promptTemplate: input.promptTemplate,
        negativePrompt: input.negativePrompt ?? undefined,
        defaultParams: input.defaultParams as Prisma.InputJsonValue | undefined,
        recommendedModel: input.recommendedModel ?? undefined,
        coverUrl: input.coverUrl ?? undefined,
        sortOrder: input.sortOrder,
        tags: JSON.stringify(input.tags),
        isBuiltIn: false,
        isActive: true,
      },
    });
  }
}

/** 进程内单例。 */
export const skillRepository = new SkillRepository();

// ───────────────────────────────────────────────────────────────────────────
// 业务 Repository：UserModelConfig（用户模型目录配置）
// ───────────────────────────────────────────────────────────────────────────

/**
 * 模型目录配置仓储。每行以 `(userId, folder)` 唯一，记录用户对某个 ComfyUI
 * 目录的启用 / 别名覆盖。所有方法按 `userId` 隔离，upsert/delete 的
 * `userId_folder` 复合主键收口在此，路由不再手写 `prisma.userModelConfig`。
 */
export class UserModelConfigRepository extends PrismaRepository<
  UserModelConfig,
  UserModelConfig,
  Partial<UserModelConfig>,
  { id: string }
> {
  constructor() {
    super(
      prisma.userModelConfig as unknown as PrismaDelegate<
        UserModelConfig,
        UserModelConfig,
        Partial<UserModelConfig>,
        { id: string }
      >
    );
  }

  /** 取某用户的全部目录配置行。 */
  async listByUser(userId: string): Promise<UserModelConfig[]> {
    return prisma.userModelConfig.findMany({ where: { userId } });
  }

  /** 取所有已启用目录的 folder 名（canvas COMBO 投影用，全局启用集）。 */
  async listEnabledFolders(): Promise<string[]> {
    const rows = await prisma.userModelConfig.findMany({
      where: { enabled: true },
      select: { folder: true },
    });
    return rows.map((row) => row.folder);
  }

  /**
   * POST 语义：新增 / 重新启用目录。每次调用都会把该目录的 type/types
   * 重置为「目录名即类型」（R-ardot45），并强制启用。
   */
  async addOrEnable(
    userId: string,
    folder: string,
    label: string | null
  ): Promise<UserModelConfig> {
    return prisma.userModelConfig.upsert({
      where: { userId_folder: { userId, folder } },
      create: {
        userId,
        folder,
        type: folder,
        types: "[]",
        label,
        enabled: true,
        isCustom: true,
      },
      update: { type: folder, types: "[]", label, enabled: true },
    });
  }

  /** PATCH 语义：仅更新给定字段；行不存在则按补丁语义创建。 */
  async patchForUser(
    userId: string,
    folder: string,
    patch: { enabled?: boolean; label?: string | null }
  ): Promise<UserModelConfig> {
    return prisma.userModelConfig.upsert({
      where: { userId_folder: { userId, folder } },
      create: {
        userId,
        folder,
        type: folder,
        types: "[]",
        label: patch.label ?? null,
        enabled: patch.enabled ?? true,
        isCustom: true,
      },
      update: patch,
    });
  }

  /** DELETE 语义：删除覆盖行；不存在静默忽略（幂等）。 */
  async deleteForUser(userId: string, folder: string): Promise<void> {
    await prisma.userModelConfig
      .delete({ where: { userId_folder: { userId, folder } } })
      .catch(() => null);
  }
}

/** 进程内单例。 */
export const userModelConfigRepository = new UserModelConfigRepository();

// ───────────────────────────────────────────────────────────────────────────
// 业务 Repository：LoraTrainingJob（LoRA 训练任务）
// ───────────────────────────────────────────────────────────────────────────

/**
 * LoRA 训练任务仓储。所有查询按 `userId` 隔离；创建时由训练队列参数
 * （steps/batchSize/learningRate 等）给出默认值，路由不再手写 `prisma.loraTrainingJob`。
 */
export class LoraTrainingJobRepository extends PrismaRepository<
  LoraTrainingJob,
  LoraTrainingJob,
  Partial<LoraTrainingJob>,
  { id: string }
> {
  constructor() {
    super(
      prisma.loraTrainingJob as unknown as PrismaDelegate<
        LoraTrainingJob,
        LoraTrainingJob,
        Partial<LoraTrainingJob>,
        { id: string }
      >
    );
  }

  /** 取某用户的训练任务（最近 100 条）。 */
  async listByUser(userId: string): Promise<LoraTrainingJob[]> {
    return prisma.loraTrainingJob.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  /** 创建排队中的训练任务（datasetImages 等 JSON 字段在此收口）。 */
  async createQueued(input: {
    userId: string;
    name: string;
    baseModel: string;
    triggerWord: string;
    classWord?: string | null;
    datasetImages: unknown;
    resolution: number;
    steps: number;
    batchSize: number;
    learningRate: number;
    rankDim: number;
    networkAlpha: number;
    optimizer: string;
    scheduler: string;
    seed: number;
  }): Promise<LoraTrainingJob> {
    return prisma.loraTrainingJob.create({
      data: {
        userId: input.userId,
        name: input.name,
        baseModel: input.baseModel,
        triggerWord: input.triggerWord,
        classWord: input.classWord ?? null,
        datasetImages: input.datasetImages as Prisma.InputJsonValue,
        resolution: input.resolution,
        steps: input.steps,
        batchSize: input.batchSize,
        learningRate: input.learningRate,
        rankDim: input.rankDim,
        networkAlpha: input.networkAlpha,
        optimizer: input.optimizer,
        scheduler: input.scheduler,
        seed: input.seed,
        status: "QUEUED",
      },
    });
  }

  /** 取单条且仅当归属该用户；可选投影（cancel 只需 id/status）。 */
  async findByIdForUser<S extends Prisma.LoraTrainingJobSelect | undefined = undefined>(
    userId: string,
    id: string,
    select?: S
  ): Promise<
    S extends Prisma.LoraTrainingJobSelect
      ? Prisma.LoraTrainingJobGetPayload<{ select: S }> | null
      : LoraTrainingJob | null
  > {
    return prisma.loraTrainingJob.findFirst({
      where: { id, userId },
      select,
    }) as never;
  }

  // ── 训练执行层（trainer.ts）──
  // 训练编排器按 jobId 精确寻址，不重复注入 userId；日志数组在此收口。

  /** 仅取状态（cancel 判断是否终态用）。 */
  async findStatusById(jobId: string): Promise<{ status: string } | null> {
    return prisma.loraTrainingJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
  }

  /** 追加一条训练日志（读 logs → push → 覆写，updatedAt 一并刷新）。 */
  async appendLog(
    jobId: string,
    entry: { t: number; level: "info" | "progress" | "warn" | "error" | "success"; msg: string }
  ): Promise<void> {
    const job = await prisma.loraTrainingJob.findUnique({
      where: { id: jobId },
      select: { logs: true },
    });
    const arr = (job?.logs as unknown[] | null) ?? [];
    arr.push(entry);
    await prisma.loraTrainingJob.update({
      where: { id: jobId },
      data: { logs: arr as Prisma.InputJsonValue, updatedAt: new Date() },
    });
  }

  /** 后端确认接收后标记 RUNNING（progress 归零）。 */
  async markRunning(jobId: string): Promise<void> {
    await prisma.loraTrainingJob.update({
      where: { id: jobId },
      data: { status: "RUNNING", progress: 0 },
    });
  }

  /** 训练进度回写（钳制到 0-100，保持 RUNNING）。 */
  async updateProgress(jobId: string, pct: number): Promise<void> {
    await prisma.loraTrainingJob.update({
      where: { id: jobId },
      data: { progress: Math.min(100, Math.max(0, pct)), status: "RUNNING" },
    });
  }

  /** 训练成功收口：DONE + 100% + 产出文件名。 */
  async markDone(jobId: string, outputName: string): Promise<void> {
    await prisma.loraTrainingJob.update({
      where: { id: jobId },
      data: { status: "DONE", progress: 100, outputName, updatedAt: new Date() },
    });
  }

  /** 训练失败收口。 */
  async markFailed(jobId: string, error: string): Promise<void> {
    await prisma.loraTrainingJob.update({
      where: { id: jobId },
      data: { status: "FAILED", error, updatedAt: new Date() },
    });
  }

  /** 用户取消训练。 */
  async markCancelled(jobId: string): Promise<void> {
    await prisma.loraTrainingJob.update({
      where: { id: jobId },
      data: { status: "CANCELLED", updatedAt: new Date() },
    });
  }
}

/** 进程内单例。 */
export const loraTrainingJobRepository = new LoraTrainingJobRepository();

// ───────────────────────────────────────────────────────────────────────────

/**
 * 用户仓储。认证链路（register / change-email / change-password / getServerUser）
 * 统一通过本类访问 `User`，不直接碰 Prisma。查询按 email 建立索引；密码哈希
 * 生成/校验仍由调用方（bcrypt）负责，本类只做持久化收口。
 */
export class UserRepository {
  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email } });
  }

  async createUser(input: {
    email: string;
    name: string | null;
    password: string;
  }): Promise<User> {
    return prisma.user.create({ data: input });
  }

  async updateEmail(id: string, email: string): Promise<User> {
    return prisma.user.update({ where: { id }, data: { email } });
  }

  async updatePassword(id: string, password: string): Promise<User> {
    return prisma.user.update({ where: { id }, data: { password } });
  }
}

/**
 * LLM 配置仓储。全局单例行（`id: "singleton"`）的读写在 lib/llm/server 与
 * 本路由间收口；`upsertSingleton` 保持旧路由语义：仅显式传入的字段参与
 * update，空字符串 apiKey 视为清除。
 */
export class LlmConfigRepository {
  /** 读取全局单例行；未初始化返回 `null`（调用方走默认配置）。 */
  async findSingleton(): Promise<LlmConfig | null> {
    return prisma.llmConfig.findUnique({ where: { id: "singleton" } });
  }

  async upsertSingleton(input: {
    provider?: string;
    baseUrl?: string;
    model?: string;
    apiKey?: string | null;
    temperature?: number;
    maxTokens?: number;
  }): Promise<LlmConfig> {
    return prisma.llmConfig.upsert({
      where: { id: "singleton" },
      create: {
        id: "singleton",
        provider: input.provider ?? "local",
        baseUrl: input.baseUrl ?? "http://localhost:11434/v1",
        model: input.model ?? "llama3.1",
        apiKey: input.apiKey ?? null,
        temperature: input.temperature ?? 0.7,
        maxTokens: input.maxTokens ?? 2048,
      },
      update: {
        ...(input.provider !== undefined ? { provider: input.provider } : {}),
        ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.apiKey !== undefined ? { apiKey: input.apiKey || null } : {}),
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
        ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
      },
    });
  }
}

export const userRepository = new UserRepository();
export const llmConfigRepository = new LlmConfigRepository();
