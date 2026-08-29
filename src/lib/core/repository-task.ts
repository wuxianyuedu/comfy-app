/**
 * `repository-task.ts` — Task 业务仓储（生成任务）
 * ===========================================================================
 *
 * 任务仓储。在基类 CRUD 之上，强制所有查询按 `userId` 隔离，并提供任务专属的
 * 列表/状态更新语义。执行层与 API 路由统一通过本类访问 `Task`，不直接碰 Prisma。
 *
 * @module core/repository-task
 */
import { prisma } from "@/lib/db";
import { NotFoundError } from "./errors";
import { type Prisma, type Task } from "../../../generated/prisma";
import { PrismaRepository, type PrismaDelegate, type TaskWithCover } from "./repository-base";

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
    return task?.userId === userId ? task : null;
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
          validationErrors?.length
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
      .catch(() => undefined);
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
