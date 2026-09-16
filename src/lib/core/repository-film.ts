/**
 * `repository-film.ts` — FilmProject 与 FilmShot 业务仓储（Drizzle 版）
 * @module core/repository-film
 */
import "server-only";

import { db } from "~/lib/db";
import { filmProject, filmShot, type FilmProject } from "~/server/db/schema";
import { DrizzleRepository } from "./repository-base";
import { eq, and, desc, asc, inArray, isNotNull, count } from "drizzle-orm";

export interface FilmSummary {
  id: string;
  title: string;
  status: string;
  progress: number;
  finalVideo: string | null;
  shotCount: number;
  createdAt: Date;
}

export class FilmRepository extends DrizzleRepository<FilmProject> {
  constructor() {
    super(filmProject, filmProject.id);
  }

  async listByUser(userId: string): Promise<FilmSummary[]> {
    const rows = await db
      .select({
        id: filmProject.id,
        title: filmProject.title,
        status: filmProject.status,
        progress: filmProject.progress,
        finalVideo: filmProject.finalVideo,
        createdAt: filmProject.createdAt,
        /* `count(列)` 而不是 `count(*)`：这里是与 filmShot 的 LEFT JOIN，
         * 一个镜头都没有的成片那一行里 filmShot 侧全是 NULL ——
         * `COUNT(*)` 会把它数成 1，于是**没生成过任何镜头的成片显示「1 镜」**。
         * 同一个坑在 `repository-model-tag.ts` 的 listByUser 已经踩过一次，
         * 那条注释与这里同因：LEFT JOIN 下必须数关联列。 */
        shotCount: count(filmShot.id),
      })
      .from(filmProject)
      .leftJoin(filmShot, eq(filmShot.filmId, filmProject.id))
      .where(eq(filmProject.userId, userId))
      .groupBy(filmProject.id)
      .orderBy(desc(filmProject.createdAt))
      .limit(50);
    return rows.map((r) => ({ ...r, shotCount: Number(r.shotCount) }));
  }

  async findByIdForUser(
    userId: string,
    id: string,
    opts: { includeShots?: boolean } = {},
  ): Promise<FilmProject | null> {
    if (opts.includeShots) {
      return (
        (await db.query.filmProject.findFirst({
          where: and(eq(filmProject.id, id), eq(filmProject.userId, userId)),
          with: { shots: { orderBy: [asc(filmShot.order)] } },
        })) ?? null
      );
    }
    const rows = await db
      .select()
      .from(filmProject)
      .where(and(eq(filmProject.id, id), eq(filmProject.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async create(input: {
    userId: string;
    title: string;
    script: string;
    type: string;
    styleSlug?: string | null;
    /** 成片画幅的**尺寸表达** JSON（`lib/size-presets` 的 `SizeSpec`）。
     *  老行里是 "1280x720" 字符串 —— 读的一律用 `toSizeSpec` 归一。 */
    size: string;
    fps: number;
    framesPerShot: number;
    subtitleOn: boolean;
    bgmName?: string | null;
  }): Promise<FilmProject> {
    const rows = await db
      .insert(filmProject)
      .values({
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
      })
      .returning();
    return rows[0]!;
  }

  async appendLog(
    id: string,
    entry: {
      t: number;
      level: "info" | "progress" | "warn" | "error" | "success";
      msg: string;
    },
  ): Promise<void> {
    const film = await db
      .select({ logs: filmProject.logs })
      .from(filmProject)
      .where(eq(filmProject.id, id))
      .limit(1);
    const arr = (film[0]?.logs as unknown[] | null) ?? [];
    arr.push(entry);
    await db
      .update(filmProject)
      .set({ logs: arr })
      .where(eq(filmProject.id, id))
      .catch(() => undefined);
  }

  async markGenerating(id: string): Promise<void> {
    await db
      .update(filmProject)
      .set({ status: "GENERATING", progress: 0, error: null })
      .where(eq(filmProject.id, id));
  }

  async updateProgress(id: string, pct: number): Promise<void> {
    await db
      .update(filmProject)
      .set({ progress: pct })
      .where(eq(filmProject.id, id));
  }

  async markFailed(id: string, error: string): Promise<void> {
    await db
      .update(filmProject)
      .set({ status: "FAILED", error })
      .where(eq(filmProject.id, id));
  }

  async markComposing(id: string): Promise<void> {
    await db
      .update(filmProject)
      .set({ status: "COMPOSING", progress: 90, error: null })
      .where(eq(filmProject.id, id));
  }

  async markDone(id: string, finalVideo: string): Promise<void> {
    await db
      .update(filmProject)
      .set({ status: "DONE", progress: 100, finalVideo, error: null })
      .where(eq(filmProject.id, id));
  }

  async markCancelled(id: string): Promise<void> {
    await db
      .update(filmProject)
      .set({ status: "CANCELLED", error: "已取消" })
      .where(eq(filmProject.id, id));
  }
}

export class FilmShotRepository {
  async createMany(
    filmId: string,
    shots: Array<{
      order: number;
      heading?: string | null;
      prompt: string;
      negative?: string | null;
      params: unknown;
    }>,
  ): Promise<void> {
    await db.insert(filmShot).values(
      shots.map((shot) => ({
        filmId,
        order: shot.order,
        heading: shot.heading ?? null,
        prompt: shot.prompt,
        negative: shot.negative ?? null,
        status: "IDLE",
        params: shot.params,
      })),
    );
  }

  async listByFilm(
    filmId: string,
    opts: { status?: string; onlyWithVideo?: boolean } = {},
  ): Promise<
    Array<{
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
    }>
  > {
    const where = and(
      eq(filmShot.filmId, filmId),
      opts.status ? eq(filmShot.status, opts.status) : undefined,
      opts.onlyWithVideo ? isNotNull(filmShot.videoPath) : undefined,
    );
    return db.select().from(filmShot).where(where).orderBy(asc(filmShot.order));
  }

  async markQueued(shotId: string, taskId: string): Promise<void> {
    await db
      .update(filmShot)
      .set({ taskId, status: "QUEUED", progress: 0 })
      .where(eq(filmShot.id, shotId));
  }

  async markFailed(shotId: string): Promise<void> {
    await db
      .update(filmShot)
      .set({ status: "FAILED" })
      .where(eq(filmShot.id, shotId));
  }

  async updateFromTask(
    shotId: string,
    data: {
      status: string;
      progress: number;
      videoPath?: string | null;
      duration?: number | null;
    },
  ): Promise<void> {
    await db
      .update(filmShot)
      .set({
        status: data.status,
        progress: data.progress,
        videoPath: data.videoPath ?? undefined,
        duration: data.duration ?? null,
      })
      .where(eq(filmShot.id, shotId));
  }

  async listActiveWithTask(
    filmId: string,
  ): Promise<Array<{ id: string; taskId: string | null }>> {
    return db
      .select({ id: filmShot.id, taskId: filmShot.taskId })
      .from(filmShot)
      .where(
        and(
          eq(filmShot.filmId, filmId),
          inArray(filmShot.status, ["QUEUED", "RUNNING"]),
          isNotNull(filmShot.taskId),
        ),
      );
  }

  async markAllActiveFailed(filmId: string): Promise<void> {
    await db
      .update(filmShot)
      .set({ status: "FAILED" })
      .where(
        and(
          eq(filmShot.filmId, filmId),
          inArray(filmShot.status, ["QUEUED", "RUNNING"]),
        ),
      );
  }
}

export const filmRepository = new FilmRepository();
export const filmShotRepository = new FilmShotRepository();
