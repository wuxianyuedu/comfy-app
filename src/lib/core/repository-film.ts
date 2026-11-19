/**
 * `repository-film.ts` — FilmProject 与 FilmShot 业务仓储（Drizzle 版）
 * @module core/repository-film — FilmProject 与 FilmShot 业务仓储（Drizzle 版）
 */
import "server-only";

import { db } from "~/lib/db";
import { filmProject, filmShot, type FilmProject } from "~/server/db/schema";
import { DrizzleRepository } from "./repository-base";
import type { DbExecutor } from "./repository-executor-types";
import { tailWindow } from "~/lib/page-window";
import { KeyedAsyncMutex } from "~/lib/async-mutex";
import { logger } from "~/lib/core/logger";
import { errorText } from "~/lib/error-message";
import { eq, and, desc, asc, inArray, isNotNull, notInArray, count } from "drizzle-orm";
import { firstRowRequired } from "./repository-row";

/** 影片日志追加的按片互斥（ISSUE #3836）：`logs` 是 JSON 列，追加是
 * 「读整列 → push → 写回」三条语句，`watchFilm`（每 4s 打进度）与
 * `composeFilm`（合成起止各打一条）并发时互相覆盖丢日志行。SQLite 单写者
 * 只保证单条语句原子，这里把整段追加以影片为粒度串行化（都在本进程内）。 */
const filmLogMutexes = new KeyedAsyncMutex();

/** 单个成片任务的日志行数上限：`logs` 是 JSON 列，每打一条日志都要把整个
 *  数组读出来、再整列写回去 —— 无上限时这条路的成本随日志条数线性变贵
 *  （成片监看每 4s 就打进度日志），界面也只显示最近一段。 */
const LOGS_MAX = 500;

/** `logs` 是 JSON 列（运行期形状不受 schema 约束），先确认是数组再当数组用。 */
function isUnknownArray(value: unknown): value is Array<unknown> {
  return Array.isArray(value);
}

export type FilmSummary = {
  createdAt: Date;
  finalVideo: string | null;
  id: string;
  progress: number;
  shotCount: number;
  status: string;
  title: string;
};

export class FilmRepository extends DrizzleRepository<FilmProject> {
  constructor() {
    super(filmProject, filmProject.id);
  }

  async listByUser(userId: string): Promise<Array<FilmSummary>> {
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
    if (opts.includeShots === true) {
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

  async create(
    input: {
      bgmName?: string | null;
      fps: number;
      framesPerShot: number;
      /** 关联的统一项目 id（proj_*）；纯文本自由建片时为空。 */
      projectId?: string | null;
      script: string;
      /** 成片画幅的**尺寸表达** JSON（`lib/size-presets` 的 `SizeSpec`）。
       *  老行里是 "1280x720" 字符串 —— 读的一律用 `toSizeSpec` 归一。 */
      size: string;
      styleSlug?: string | null;
      subtitleOn: boolean;
      title: string;
      type: string;
      userId: string;
    },
    executor?: DbExecutor,
  ): Promise<FilmProject> {
    const exec = executor ?? db;
    const rows = await exec
      .insert(filmProject)
      .values({
        userId: input.userId,
        projectId: input.projectId ?? null,
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
    return firstRowRequired(rows, "切片项目插入");
  }

  async appendLog(
    id: string,
    entry: {
      level: "info" | "progress" | "warn" | "error" | "success";
      msg: string;
      t: number;
    },
  ): Promise<void> {
    await filmLogMutexes.run(id, async () => {
      const film = await db
        .select({ logs: filmProject.logs })
        .from(filmProject)
        .where(eq(filmProject.id, id))
        .limit(1);
      const logs = film[0]?.logs;
      const arr: Array<unknown> = isUnknownArray(logs) ? logs : [];
      arr.push(entry);
      await db
        .update(filmProject)
        .set({ logs: tailWindow(arr, LOGS_MAX) })
        .where(eq(filmProject.id, id))
        .catch((writeError: unknown) => {
          /* 落库失败要看得见（ISSUE #4271）：成片时间线（含失败原因）无声缺行，
           * 排障时现场不完整。保持「不拒绝」契约不变——调用方（appendFilmLog）
           * 逐个接错不现实，失败在这里留痕即可。 */
          logger.warn(
            `[film] 成片日志落库失败（film=${id}）：${errorText(writeError, "成片日志落库")}`,
          );
        });
    });
  }

  /** 按项目取最近一条影片（ISSUE #3962）：run 起片恢复需要定位与项目关联的
   *  最近一次成片尝试，判断是否已进入可恢复生成态或已终态。 */
  async findLatestByProjectId(
    userId: string,
    projectId: string,
  ): Promise<{ createdAt: Date; id: string; status: string } | null> {
    const rows = await db
      .select({
        id: filmProject.id,
        status: filmProject.status,
        createdAt: filmProject.createdAt,
      })
      .from(filmProject)
      .where(and(eq(filmProject.userId, userId), eq(filmProject.projectId, projectId)))
      .orderBy(desc(filmProject.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  /** 按状态列出影片（进程重启后的恢复扫描用），`createdAt` 升序 = 先起先续。
   *
   *  刻意**不带 userId**：这条查询的语义是「本机这份库里还有哪些行该有人推进」，
   *  扫描者不知道也不该关心归属；本应用是单用户本地应用，多一层归属条件只会让
   *  「重启后没人续跑」的窗口更难解释。排序与领取队列同口径（先起先续）。 */
  async listByStatus(
    statuses: ReadonlyArray<string>,
  ): Promise<Array<{ id: string; status: string }>> {
    if (statuses.length === 0) {
      return [];
    }
    return db
      .select({ id: filmProject.id, status: filmProject.status })
      .from(filmProject)
      .where(inArray(filmProject.status, [...statuses]))
      .orderBy(asc(filmProject.createdAt));
  }

  async updateProgress(id: string, pct: number): Promise<void> {
    await db.update(filmProject).set({ progress: pct }).where(eq(filmProject.id, id));
  }

  /**
   * 判失败（ISSUE #3894）：仅当当前状态**不是终态**时写入。终态之间此前可互相
   * 覆写（「已取消又被判失败」「已完成又被判失败」）；失败原因取第一次落库的
   * 那条，后续迟到判决不再改写。
   */
  async markFailed(id: string, error: string): Promise<void> {
    await db
      .update(filmProject)
      .set({ status: "FAILED", error })
      .where(
        and(
          eq(filmProject.id, id),
          notInArray(filmProject.status, ["DONE", "FAILED", "CANCELLED"]),
        ),
      );
  }

  /**
   * 条件置位 GENERATING（ISSUE #3836）：仅当影片不在 GENERATING/COMPOSING 时才写入，
   * 返回是否抢到。startFilm 原先「先读 status → 判断 → 无条件 markGenerating」，
   * 双击/并发会在窗口内双双通过，给每个镜头排两批视频任务 —— 把判断与置位收进
   * 同一条 UPDATE（SQLite 单写者下原子），抢不到（0 行更新）即让位。
   */
  async claimGenerating(id: string): Promise<boolean> {
    const rows = await db
      .update(filmProject)
      .set({ status: "GENERATING", progress: 0, error: null })
      .where(
        and(eq(filmProject.id, id), notInArray(filmProject.status, ["GENERATING", "COMPOSING"])),
      )
      .returning({ id: filmProject.id });
    return rows.length > 0;
  }

  /** 同 {@link claimGenerating}，合成侧：仅当不在 COMPOSING/DONE/CANCELLED 时写成 COMPOSING。
   *  CANCELLED 也在排除集（ISSUE #3867）：「取消」与「合成抢跑」赛跑时，
   *  不能给已取消的影片跑完 ffmpeg 并标 DONE——状态与产物互相矛盾。
   *  FAILED **不在**排除集（ISSUE #4251）：合成失败后装好 ffmpeg / 补齐镜头视频，
   *  「重新合成」是文档承诺的恢复出口——把它挡在门外就是静默空转（按钮点了
   *  没有任何反应，影片永久卡 FAILED）。FAILED 影片的监看循环早已退场、恢复
   *  扫描也只会维持 FAILED，不存在自动路径会误碰它；能走到这里的只有显式的
   *  「重新合成」。 */
  async claimComposing(id: string): Promise<boolean> {
    const rows = await db
      .update(filmProject)
      .set({ status: "COMPOSING", progress: 90, error: null })
      .where(
        and(
          eq(filmProject.id, id),
          notInArray(filmProject.status, ["COMPOSING", "DONE", "CANCELLED"]),
        ),
      )
      .returning({ id: filmProject.id });
    return rows.length > 0;
  }

  /** 合成完成（ISSUE #3867 / #3894）：仅当当前不是终态时写入 —— 取消是用户终态，
   *  不得被合成收口改判 DONE；DONE / FAILED 之间也不再互相改写。 */
  async markDone(id: string, finalVideo: string): Promise<void> {
    await db
      .update(filmProject)
      .set({ status: "DONE", progress: 100, finalVideo, error: null })
      .where(
        and(
          eq(filmProject.id, id),
          notInArray(filmProject.status, ["DONE", "FAILED", "CANCELLED"]),
        ),
      );
  }

  /** 取消（ISSUE #3894）：仅当当前不是终态时写入 —— DONE / FAILED / CANCELLED
   *  的终态不再被「取消」改写（对终态重复取消按幂等处理）。 */
  async markCancelled(id: string, executor?: DbExecutor): Promise<void> {
    const exec = executor ?? db;
    await exec
      .update(filmProject)
      .set({ status: "CANCELLED", error: "已取消" })
      .where(
        and(
          eq(filmProject.id, id),
          notInArray(filmProject.status, ["DONE", "FAILED", "CANCELLED"]),
        ),
      );
  }
}

export class FilmShotRepository {
  async createMany(
    filmId: string,
    shots: Array<{
      heading?: string | null;
      negative?: string | null;
      order: number;
      params: unknown;
      prompt: string;
      /** 关联的统一镜头 id（Phase 5 回写用）；自由建片时为空。 */
      shotId?: string | null;
    }>,
    executor?: DbExecutor,
  ): Promise<void> {
    const exec = executor ?? db;
    await exec.insert(filmShot).values(
      shots.map((shot) => ({
        filmId,
        shotId: shot.shotId ?? null,
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
    opts: { onlyWithVideo?: boolean; status?: string } = {},
  ): Promise<
    Array<{
      duration: number | null;
      heading: string | null;
      id: string;
      negative: string | null;
      order: number;
      params: unknown;
      progress: number;
      prompt: string;
      shotId: string | null;
      status: string;
      taskId: string | null;
      videoPath: string | null;
    }>
  > {
    const where = and(
      eq(filmShot.filmId, filmId),
      /* 过滤值空串与缺省同义 = 不加该条件（查询参数可能出现空串） */
      opts.status !== undefined && opts.status !== ""
        ? eq(filmShot.status, opts.status)
        : undefined,
      opts.onlyWithVideo === true ? isNotNull(filmShot.videoPath) : undefined,
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
    await db.update(filmShot).set({ status: "FAILED" }).where(eq(filmShot.id, shotId));
  }

  async updateFromTask(
    shotId: string,
    data: {
      duration?: number | null;
      progress: number;
      status: string;
      videoPath?: string | null;
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

  async listActiveWithTask(filmId: string): Promise<Array<{ id: string; taskId: string | null }>> {
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

  async markAllActiveFailed(filmId: string, executor?: DbExecutor): Promise<void> {
    const exec = executor ?? db;
    await exec
      .update(filmShot)
      .set({ status: "FAILED" })
      .where(and(eq(filmShot.filmId, filmId), inArray(filmShot.status, ["QUEUED", "RUNNING"])));
  }
}

export const filmRepository = new FilmRepository();
export const filmShotRepository = new FilmShotRepository();
