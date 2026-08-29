/**
 * `repository-film.ts` — FilmProject（影片项目）与 FilmShot（影片镜头）仓储
 * ===========================================================================
 *
 * 影片项目仓储：所有查询按 `userId` 隔离；列表投影为 {@link FilmSummary}，
 * 详情可选项式 include 镜头（按 order 升序）。供 film 路由族与编排器使用。
 *
 * 镜头仓储：镜头挂在 FilmProject 下（无独立 userId 列），归属由父影片保证；
 * 编排器按 filmId / shotId 精确寻址，`params` JSON 字段在此收口。
 *
 * @module core/repository-film
 */
import { prisma } from "@/lib/db";
import { type FilmProject, type Prisma } from "../../../generated/prisma";
import { PrismaRepository, type PrismaDelegate } from "./repository-base";

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
      .catch(() => undefined);
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
