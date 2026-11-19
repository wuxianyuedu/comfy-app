/**
 * FR-SR-04 整季生成：进度聚合 + 整季/跨集一次提交生成（幂等断点续跑）。
 * 拆到独立子路由，避免 `series` 路由随功能增长越过文件行数上限（规范 §12.6）。
 */
import { z } from "zod";
import { asc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { episode, production, task } from "~/server/db/schema";
import { workflowTemplateRepository, taskRepository } from "~/lib/core/repository";
import { kickQueue } from "~/lib/comfyui/executor-continuation";
import { hasExecutableWorkflow } from "~/lib/comfyui/execution-shape";
import { resolveExecutorClaim } from "~/lib/comfyui/executor-mode";
import { assertSeasonOwner as sharedAssertSeasonOwner } from "./series-shared";
import { isPlainRecord } from "~/lib/is-record";

/* 断言当前用户拥有该季——用 series-shared 的共享版（#4048：此前这里自带一份，
 * 文案已与共享版分叉；series.ts 头注称归属断言两边共用）。 */
const assertSeasonOwner = sharedAssertSeasonOwner;

/** task 状态优先级：SUCCEEDED > RUNNING > QUEUED > FAILED > 未生成。聚合每镜「最佳状态」用。 */
const TASK_STATUS_RANK: Record<string, number> = { SUCCEEDED: 4, RUNNING: 3, QUEUED: 2, FAILED: 1 };
function bestStatus(a?: string, b?: string): string {
  const ra = a !== undefined && a !== "" ? (TASK_STATUS_RANK[a] ?? 0) : 0;
  const rb = b !== undefined && b !== "" ? (TASK_STATUS_RANK[b] ?? 0) : 0;
  return ra >= rb ? (a ?? b ?? "PENDING") : (b ?? a ?? "PENDING");
}

/** `production.shots` 的运行期判据：引擎写入的条目是对象、本文件只消费 `id`
 * 字段（字符串化判断在消费点），元素其余字段由写入端与 draft-integrity 保证。 */
function isShotIdList(v: unknown): v is Array<{ id?: string }> {
  return Array.isArray(v) && v.every((s) => isPlainRecord(s));
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

      /* 进度聚合改两趟批查（#4420）：此前每集各发 production.findFirst + task IN
       * 查询，一次进度轮询是「集数×2」次往返——集与集之间并无顺序依赖。 */
      const projectIds = [
        ...new Set(
          eps
            .map((e) => e.projectId)
            .filter((p): p is string => typeof p === "string" && p.length > 0),
        ),
      ];
      const prodRows =
        projectIds.length === 0
          ? []
          : await ctx.db.query.production.findMany({
              where: inArray(production.id, projectIds),
              columns: { id: true, shots: true },
            });
      const shotsByProject = new Map<string, Array<{ id?: string }>>();
      for (const prod of prodRows) {
        const rawShots: unknown = prod.shots;
        shotsByProject.set(prod.id, isShotIdList(rawShots) ? rawShots : []);
      }
      const tasksByProject = new Map<string, Map<string, string>>();
      if (projectIds.length > 0) {
        const taskRows = await ctx.db
          .select({ projectId: task.projectId, shotId: task.shotId, status: task.status })
          .from(task)
          .where(inArray(task.projectId, projectIds));
        for (const t of taskRows) {
          if (t.projectId === null || t.shotId === null) {
            continue;
          }
          let byShot = tasksByProject.get(t.projectId);
          if (!byShot) {
            byShot = new Map<string, string>();
            tasksByProject.set(t.projectId, byShot);
          }
          byShot.set(t.shotId, bestStatus(byShot.get(t.shotId), t.status));
        }
      }

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
          const shots = shotsByProject.get(ep.projectId) ?? [];
          total = shots.length;
          const statusByShot = tasksByProject.get(ep.projectId) ?? new Map<string, string>();
          for (const s of shots) {
            const sid = s.id;
            /* 坏镜头与旧口径一致：不计入任何桶（total 仍计入）。 */
            if (typeof sid !== "string" || sid === "") {
              continue;
            }
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
      /* 幂等断点续跑（ISSUE #3833/#4001）：预读 SUCCEEDED 占用集用于保持“已完成镜头
       * 不重排”语义；实际入队改为按镜原子 createQueuedForShotIfNoActive，与单镜生成/
       * 原样重跑共用同一事务守卫，避免跨入口竞态重复入队。 */
      const existing =
        projectIds.length === 0
          ? []
          : await ctx.db
              .select({ projectId: task.projectId, shotId: task.shotId, status: task.status })
              .from(task)
              .where(inArray(task.projectId, projectIds));
      const succeeded = new Set<string>();
      for (const t of existing) {
        if (t.projectId === null || t.shotId === null) {
          continue;
        }
        if (t.status === "SUCCEEDED") {
          succeeded.add(`${t.projectId}:${t.shotId}`);
        }
      }
      const tpl = await workflowTemplateRepository.findByIdForUser(ctx.user.id, input.workflowId);
      if (!tpl) {
        throw new TRPCError({ code: "NOT_FOUND", message: "工作流不存在" });
      }
      /* 与单发生成同一份预检（#4043）：空 rawJson 的工作流整季收下后会在执行侧
       * 逐个失败——在入队前整批拒绝并提示重新导入。 */
      if (!hasExecutableWorkflow(tpl)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "工作流没有可执行内容（rawJson 为空）：请重新导入该工作流",
        });
      }
      /* 集镜头清单一趟批查（#4420）：此前每集一个 production.findFirst，集与集
       * 之间并无顺序依赖。逐镜入队保持 `createQueuedForShotIfNoActive` 的**逐镜
       * 原子守卫**不变 —— 合并成整批事务会改变锁语义与失败粒度，刻意不做。 */
      const prodRows =
        projectIds.length === 0
          ? []
          : await ctx.db.query.production.findMany({
              where: inArray(production.id, projectIds),
              columns: { id: true, shots: true },
            });
      const shotsByProject = new Map<string, Array<{ id?: string }>>();
      for (const prod of prodRows) {
        const rawShots: unknown = prod.shots;
        shotsByProject.set(prod.id, isShotIdList(rawShots) ? rawShots : []);
      }
      const executorClaim = resolveExecutorClaim();
      let enqueued = 0;
      let skippedSucceeded = 0;
      let skippedActive = 0;
      let invalid = 0;
      /* 集镜头清单一趟批查（#4420）：此前每集一个 production.findFirst，集与集
       * 之间并无顺序依赖。逐镜入队保持 `createQueuedForShotIfNoActive` 的**逐镜
       * 原子守卫**不变 —— 合并成整批事务会改变锁语义与失败粒度，刻意不做。 */
      for (const ep of eps) {
        if (ep.projectId === null) {
          continue;
        }
        const shots = shotsByProject.get(ep.projectId) ?? [];
        for (const s of shots) {
          const sid = s.id;
          if (sid === undefined || sid === "") {
            /* 坏镜头计入 invalid，不再静默不计账（#4043）：调用方对得上镜头总数。 */
            invalid++;
            continue;
          }
          const key = `${ep.projectId}:${sid}`;
          if (succeeded.has(key)) {
            skippedSucceeded++;
            continue;
          }
          // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
          const created = await taskRepository.createQueuedForShotIfNoActive({
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
          if (created === null) {
            skippedActive++;
            continue;
          }
          enqueued++;
        }
      }
      if (enqueued > 0) {
        kickQueue();
      }
      return { enqueued, skippedSucceeded, skippedActive, invalid };
    }),
});
