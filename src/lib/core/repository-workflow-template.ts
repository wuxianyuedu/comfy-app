/**
 * `repository-workflow-template.ts` — WorkflowTemplate 业务仓储（用户导入的工作流）
 * ===========================================================================
 *
 * 工作流模板仓储。所有查询按 `userId` 隔离，提供列表与「归属校验」读取，
 * 供工作流库 API 与执行层统一使用。
 *
 * @module core/repository-workflow-template
 */
import { prisma } from "@/lib/db";
import { type Prisma, type WorkflowTemplate } from "../../../generated/prisma";
import { PrismaRepository, type PrismaDelegate } from "./repository-base";

/**
 * 工作流模板仓储。所有查询按 `userId` 隔离，提供列表与「归属校验」读取，
 * 供工作流库 API 与执行层统一使用。
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
    return wf?.userId === userId ? wf : null;
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
    modes?: string[];
    defaultMode?: string | null;
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
        modes: input.modes?.length
          ? JSON.stringify(input.modes)
          : undefined,
        defaultMode: input.defaultMode ?? undefined,
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
