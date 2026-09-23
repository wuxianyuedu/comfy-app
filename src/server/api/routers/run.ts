// AI 自主执行 run 的控制端点（Phase 6 地基）。
//
// run = 挂在统一项目上的一份「AI 正在把流水线跑到成片」的协调态（生命周期 + 审批粒度 +
// 每镜已处理 rev 快照），落在 production.run 列、由这里**单独写**（工坊自动保存不碰 run）。
// 两个视图（画布 / 工坊）都是它的操纵台：都能 start / pause / resume / approve / cancel，
// 都能读 status 看「下一步该做什么」。
//
// 本 PR（P6-1）只做**地基与只读规划回显**：控制端点管理 run 生命周期、`status` 用纯规划器
// 算出下一步动作并回显。真正「按动作执行」（调 LLM 阶段、提交 ComfyUI 生图任务、复用 render 管线）
// 在 P6-2 的服务端引擎里消费同一套 run + planner，故此处不产生副作用。
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
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const run = await loadRun(ctx.user.id, input.projectId);
      const next: ProductionRun = {
        ...run,
        status: "running",
        approvalMode: input.approvalMode ?? run.approvalMode,
        goal: input.goal ?? run.goal,
        awaitingStage: null,
        error: null,
        updatedAt: new Date().toISOString(),
      };
      return persistAndPlan(ctx.user.id, input.projectId, next);
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
      return persistAndPlan(ctx.user.id, input.projectId, {
        ...run,
        status: "running",
        updatedAt: new Date().toISOString(),
      });
    }),

  /** 对某步点头放行（awaiting_approval → running）。 */
  approve: authedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const run = await loadRun(ctx.user.id, input.projectId);
      if (run.status !== "awaiting_approval") {
        return { run, action: { kind: "idle" } as RunAction };
      }
      return persistAndPlan(ctx.user.id, input.projectId, {
        ...run,
        status: "running",
        awaitingStage: null,
        updatedAt: new Date().toISOString(),
      });
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
