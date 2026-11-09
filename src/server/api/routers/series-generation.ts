/**
 * FR-SR-04 整季生成：进度聚合 + 整季/跨集一次提交生成（幂等断点续跑）。
 * 拆到独立子路由，避免 `series` 路由随功能增长越过文件行数上限（规范 §12.6）。
 */
import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import type * as schema from "~/server/db/schema";
import { episode, production, season, series, task } from "~/server/db/schema";
import { workflowTemplateRepository, taskRepository } from "~/lib/core/repository";
import { kickQueue } from "~/lib/comfyui/executor-continuation";
import { resolveExecutorClaim } from "~/lib/comfyui/executor-mode";

type Db = SqliteRemoteDatabase<typeof schema>;
type Ctx = { db: Db; user: { id: string } };

/** 断言当前用户拥有该季（沿 series 校验归属）。 */
async function assertSeasonOwner(ctx: Ctx, id: string) {
  const rows = await ctx.db.select().from(season).where(eq(season.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "季不存在" });
  }
  const sr = await ctx.db.select().from(series).where(eq(series.id, row.seriesId)).limit(1);
  const owner = sr[0];
  if (owner?.userId !== ctx.user.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该季" });
  }
  return row;
}

/** task 状态优先级：SUCCEEDED > RUNNING > QUEUED > FAILED > 未生成。聚合每镜「最佳状态」用。 */
const TASK_STATUS_RANK: Record<string, number> = { SUCCEEDED: 4, RUNNING: 3, QUEUED: 2, FAILED: 1 };
function bestStatus(a?: string, b?: string): string {
  const ra = a !== undefined && a !== "" ? (TASK_STATUS_RANK[a] ?? 0) : 0;
  const rb = b !== undefined && b !== "" ? (TASK_STATUS_RANK[b] ?? 0) : 0;
  return ra >= rb ? (a ?? b ?? "PENDING") : (b ?? a ?? "PENDING");
}

export const seriesGenerationRouter = createTRPCRouter({
  /**
   * 整季生成进度（FR-SR-04 ③）：按集返回 总/完成/失败/进行中/待生成 计数，
   * 进度可读到「第几集 第几镜」粒度（每集的 shot 总数与已完成数）。
   */
  seasonGenerationProgress: authedProcedure
    .input(z.object({ seasonId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertSeasonOwner(ctx, input.seasonId);
      const eps = await ctx.db
        .select({
          id: episode.id,
          projectId: episode.projectId,
          episodeNumber: episode.episodeNumber,
          title: episode.title,
        })
        .from(episode)
        .where(eq(episode.seasonId, input.seasonId))
        .orderBy(asc(episode.episodeNumber));

      const rows: Array<{
        done: number;
        episodeId: string;
        episodeNumber: number;
        failed: number;
        pending: number;
        running: number;
        title: string;
        total: number;
      }> = [];

      for (const ep of eps) {
        let total = 0;
        let done = 0;
        let failed = 0;
        let running = 0;
        let pending = 0;
        if (ep.projectId !== null) {
          // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
          const prod = await ctx.db.query.production.findFirst({
            where: eq(production.id, ep.projectId),
          });
          /* SAFETY: 类型断言已复核 */
          const shots = Array.isArray(prod?.shots) ? (prod?.shots as Array<{ id?: string }>) : [];
          total = shots.length;
          const shotIds = shots
            .map((s) => s.id)
            .filter((id): id is string => typeof id === "string" && id.length > 0);
          if (shotIds.length > 0) {
            // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
            const tasks = await ctx.db
              .select({ shotId: task.shotId, status: task.status })
              .from(task)
              .where(and(eq(task.projectId, ep.projectId), inArray(task.shotId, shotIds)));
            const statusByShot = new Map<string, string>();
            for (const t of tasks) {
              if (t.shotId === null) {
                continue;
              }
              statusByShot.set(t.shotId, bestStatus(statusByShot.get(t.shotId), t.status));
            }
            for (const sid of shotIds) {
              const st = statusByShot.get(sid);
              if (st === "SUCCEEDED") {
                done++;
              } else if (st === "RUNNING") {
                running++;
              } else if (st === "FAILED") {
                failed++;
              } else {
                pending++;
              }
            }
          }
        }
        rows.push({
          episodeId: ep.id,
          episodeNumber: ep.episodeNumber,
          title: ep.title,
          total,
          done,
          failed,
          running,
          pending,
        });
      }
      return rows;
    }),

  /**
   * 整季/跨集一次提交生成（FR-SR-04 ①②）：遍历该季每集 project → production.shots，按
   * `(projectId, shotId)` 的 task 存在性幂等去重 —— 已有 SUCCEEDED / QUEUED / RUNNING 的镜不重排
   * （断点续跑，不靠记忆），只入队失败 / 未生成的镜。返回 { enqueued, skipped }。
   */
  batchGenerateSeason: authedProcedure
    .input(z.object({ seasonId: z.string().min(1), workflowId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertSeasonOwner(ctx, input.seasonId);
      const eps = await ctx.db
        .select({ id: episode.id, projectId: episode.projectId })
        .from(episode)
        .where(eq(episode.seasonId, input.seasonId));
      const projectIds = [
        ...new Set(
          eps
            .map((e) => e.projectId)
            .filter((p): p is string => typeof p === "string" && p.length > 0),
        ),
      ];
      const existing = await ctx.db
        .select({ projectId: task.projectId, shotId: task.shotId, status: task.status })
        .from(task)
        .where(inArray(task.projectId, projectIds));
      const occupied = new Set<string>();
      for (const t of existing) {
        if (t.projectId === null || t.shotId === null) {
          continue;
        }
        if (t.status === "SUCCEEDED" || t.status === "QUEUED" || t.status === "RUNNING") {
          occupied.add(`${t.projectId}:${t.shotId}`);
        }
      }
      const tpl = await workflowTemplateRepository.findByIdForUser(ctx.user.id, input.workflowId);
      if (!tpl) {
        throw new TRPCError({ code: "NOT_FOUND", message: "工作流不存在" });
      }
      const executorClaim = resolveExecutorClaim();
      let enqueued = 0;
      let skipped = 0;
      for (const ep of eps) {
        if (ep.projectId === null) {
          continue;
        }
        // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
        const prod = await ctx.db.query.production.findFirst({
          where: eq(production.id, ep.projectId),
        });
        /* SAFETY: 类型断言已复核 */
        const shots = Array.isArray(prod?.shots) ? (prod?.shots as Array<{ id?: string }>) : [];
        for (const s of shots) {
          const sid = s.id;
          if (sid === undefined || sid === "") {
            continue;
          }
          const key = `${ep.projectId}:${sid}`;
          if (occupied.has(key)) {
            skipped++;
            continue;
          }
          // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
          await taskRepository.createQueued({
            userId: ctx.user.id,
            type: tpl.taskType,
            prompt: "",
            negativePrompt: null,
            params: { workflow: input.workflowId, paramMap: {} },
            workflowName: tpl.name,
            projectId: ep.projectId,
            shotId: sid,
            referenceImages: undefined,
            claimedBy: executorClaim,
            execPayload: tpl.rawJson,
            parentId: null,
          });
          occupied.add(key);
          enqueued++;
        }
      }
      if (enqueued > 0) {
        kickQueue();
      }
      return { enqueued, skipped };
    }),
});
