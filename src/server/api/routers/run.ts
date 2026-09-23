// AI 自主执行 run 的控制端点（Phase 6 地基）。
//
// run = 挂在统一项目上的一份「AI 正在把流水线跑到成片」的协调态（生命周期 + 审批粒度 +
// 每镜已处理 rev 快照），落在 production.run 列、由这里**单独写**（工坊自动保存不碰 run）。
// 两个视图（画布 / 工坊）都是它的操纵台：都能 start / pause / resume / approve / cancel，
// 都能读 status 看「下一步该做什么」。
//
// 控制端点管理 run 生命周期、`status` 用纯规划器算出下一步动作并回显。`start / resume / approve`
// 把 run 置为 running 后，以 fire-and-forget 拉起服务端执行引擎 `advanceRunLoop`（推进到下一个
// 停点：等点头 / 完成 / 失败 / 被暂停），引擎内部自带异常兜底、不抛给调用方。
import { z } from "zod";

import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { productionRepository } from "~/lib/core/repository-production";
import {
  normalizeProductionRun,
  planNextRunAction,
  toRunView,
  type ProductionRun,
  type RunAction,
} from "~/lib/production/run-types";

const approvalModeEnum = z.enum(["auto", "stage", "shot"]);

/** fire-and-forget 拉起执行引擎推进 run（动态 import 解耦；引擎自带异常兜底，不外抛）。 */
function kickEngine(userId: string, projectId: string): void {
  void (async () => {
    const { advanceRunLoop } = await import("~/server/agent/run-engine");
    await advanceRunLoop(userId, projectId);
  })();
}

/** 读项目并归一 run；无生产数据行 → 抛可行动错误。 */
async function loadRun(
  userId: string,
  projectId: string,
): Promise<ProductionRun> {
  const row = await productionRepository.getForUser(userId, projectId);
  if (!row) throw new Error("该项目还没有生产数据（先在工坊产出内容再启动）");
  return normalizeProductionRun(row.run);
}

/** 保存 run 并回显下一步动作（含规划视图）。 */
async function persistAndPlan(
  userId: string,
  projectId: string,
  run: ProductionRun,
): Promise<{ run: ProductionRun; action: RunAction }> {
  const saved = await productionRepository.updateRun(userId, projectId, run);
  if (!saved) throw new Error("保存 run 失败：生产数据行不存在");
  const row = await productionRepository.getForUser(userId, projectId);
  const action = planNextRunAction(toRunView(row ?? null), run);
  return { run, action };
}

export const runRouter = createTRPCRouter({
  /** 当前 run + 下一步动作（两视图轮询/刷新读它）。 */
  status: authedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const row = await productionRepository.getForUser(
        ctx.user.id,
        input.projectId,
      );
      if (!row)
        return {
          run: normalizeProductionRun(null),
          action: { kind: "idle" } as RunAction,
        };
      const run = normalizeProductionRun(row.run);
      return { run, action: planNextRunAction(toRunView(row), run) };
    }),

  /** 启动 / 重启自主执行。默认审批粒度沿用已存的（首次为 stage）。 */
  start: authedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        goal: z.string().max(500).optional(),
        approvalMode: approvalModeEnum.optional(),
        imageWorkflowId: z.string().optional(),
        videoWorkflowId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const run = await loadRun(ctx.user.id, input.projectId);
      const next: ProductionRun = {
        ...run,
        status: "running",
        approvalMode: input.approvalMode ?? run.approvalMode,
        goal: input.goal ?? run.goal,
        imageWorkflowId: input.imageWorkflowId ?? run.imageWorkflowId,
        videoWorkflowId: input.videoWorkflowId ?? run.videoWorkflowId,
        awaitingStage: null,
        error: null,
        updatedAt: new Date().toISOString(),
      };
      const result = await persistAndPlan(ctx.user.id, input.projectId, next);
      kickEngine(ctx.user.id, input.projectId);
      return result;
    }),

  /** 用户主动暂停（画布/工坊的「暂停」按钮）。 */
  pause: authedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const run = await loadRun(ctx.user.id, input.projectId);
      if (run.status !== "running" && run.status !== "awaiting_approval") {
        return { run, action: { kind: "idle" } as RunAction };
      }
      return persistAndPlan(ctx.user.id, input.projectId, {
        ...run,
        status: "paused",
        updatedAt: new Date().toISOString(),
      });
    }),

  /** 继续（从 paused 恢复）。awaiting_approval 的点头走 approve。 */
  resume: authedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const run = await loadRun(ctx.user.id, input.projectId);
      if (run.status !== "paused")
        return { run, action: { kind: "idle" } as RunAction };
      const result = await persistAndPlan(ctx.user.id, input.projectId, {
        ...run,
        status: "running",
        updatedAt: new Date().toISOString(),
      });
      kickEngine(ctx.user.id, input.projectId);
      return result;
    }),

  /** 对某步点头放行（awaiting_approval → running）。 */
  approve: authedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const run = await loadRun(ctx.user.id, input.projectId);
      if (run.status !== "awaiting_approval") {
        return { run, action: { kind: "idle" } as RunAction };
      }
      const result = await persistAndPlan(ctx.user.id, input.projectId, {
        ...run,
        status: "running",
        awaitingStage: null,
        updatedAt: new Date().toISOString(),
      });
      kickEngine(ctx.user.id, input.projectId);
      return result;
    }),

  /** 取消整条自主执行。 */
  cancel: authedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const run = await loadRun(ctx.user.id, input.projectId);
      return persistAndPlan(ctx.user.id, input.projectId, {
        ...run,
        status: "cancelled",
        awaitingStage: null,
        updatedAt: new Date().toISOString(),
      });
    }),
});
