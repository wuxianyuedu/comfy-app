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
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { productionRepository } from "~/lib/core/repository-production";
import {
  normalizeProductionRun,
  planNextRunAction,
  scriptDigestOf,
  toRunView,
  type ProductionRun,
  type RunAction,
} from "~/lib/production/run-types";
import {
  applyHumanRating,
  applyHumanVerdict,
  applyScriptHumanVerdict,
} from "~/lib/production/review-types";
import { calibrateFromShots } from "~/lib/production/review-calibration";
import {
  regenerateShot,
  reviewContent,
  reviewScript,
  autoselectShotImage,
  reviewShotImage,
  reviseScript,
} from "~/server/agent/review";

const approvalModeEnum = z.enum(["auto", "stage", "shot"]);
const reviewModeEnum = z.enum(["gacha", "reprompt"]);

/** fire-and-forget 拉起执行引擎推进 run（动态 import 解耦；引擎自带异常兜底，不外抛）。 */
function kickEngine(userId: string, projectId: string): void {
  void (async () => {
    const { advanceRunLoop } = await import("~/server/agent/run-engine");
    await advanceRunLoop(userId, projectId);
  })();
}

/** 读项目并归一 run；无生产数据行 → 抛可行动错误。 */
async function loadRun(userId: string, projectId: string): Promise<ProductionRun> {
  const row = await productionRepository.getForUser(userId, projectId);
  // PRECONDITION_FAILED 而不是 NOT_FOUND：这一支要告诉调用方「先去医院，先产出内容」。
  // 探测面没有变大 —— 别人的项目与没内容的项目走的是同一条 `row === null`，
  // 回的是同一句话（口径同 A2 / A3 / A12 的「越权与不存在同形」）。
  if (!row) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "该项目还没有生产数据（先在工坊产出内容再启动）",
    });
  }
  return normalizeProductionRun(row.run);
}

/** 保存 run 并回显下一步动作（含规划视图）。 */
async function persistAndPlan(
  userId: string,
  projectId: string,
  run: ProductionRun,
): Promise<{ action: RunAction; run: ProductionRun }> {
  const saved = await productionRepository.updateRun(userId, projectId, run);
  if (!saved) {
    throw new TRPCError({ code: "NOT_FOUND", message: "生产数据行不存在" });
  }
  const row = await productionRepository.getForUser(userId, projectId);
  const action = planNextRunAction(toRunView(row ?? null), run);
  return { run, action };
}

export const runRouter = createTRPCRouter({
  /** 当前 run + 下一步动作（两视图轮询/刷新读它）。 */
  status: authedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const row = await productionRepository.getForUser(ctx.user.id, input.projectId);
      if (!row) {
        return {
          run: normalizeProductionRun(null),
          /* SAFETY: 类型断言已复核 */
          action: {
            kind: "idle",
          } as RunAction,
        };
      }
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
        autoReview: z.boolean().optional(),
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
        autoReview: input.autoReview ?? run.autoReview,
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
        return {
          run,
          /* SAFETY: 类型断言已复核 */
          action: {
            kind: "idle",
          } as RunAction,
        };
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
      if (run.status !== "paused") {
        return {
          run,
          /* SAFETY: 类型断言已复核 */
          action: {
            kind: "idle",
          } as RunAction,
        };
      }
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
        return {
          run,
          /* SAFETY: 类型断言已复核 */
          action: {
            kind: "idle",
          } as RunAction,
        };
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

  /** 评审一个分镜镜头（文本评审）：调模型给判定 → 落库 `shot.review` → 回显判定。 */
  reviewShot: authedProcedure
    .input(z.object({ projectId: z.string().min(1), shotId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const verdict = await reviewContent(ctx.user.id, input.projectId, "shot", input.shotId);
      return { verdict };
    }),

  /**
   * 视觉评审一个分镜镜头的生图（P8-2 多模态评审）：看图 + 出场角色定妆照，按生图 rubric
   * 打分，判定写回 `shot.imageReview`。没图 / 找不到镜头时抛可行动错误。
   */
  reviewShotImage: authedProcedure
    .input(z.object({ projectId: z.string().min(1), shotId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const verdict = await reviewShotImage(ctx.user.id, input.projectId, input.shotId);
      return { verdict };
    }),

  /** 评审一张角色卡（文本评审）。 */
  reviewCharacter: authedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        characterId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const verdict = await reviewContent(
        ctx.user.id,
        input.projectId,
        "character",
        input.characterId,
      );
      return { verdict };
    }),

  /**
   * 评审整份剧本（FR-QA-07 ② · #2477）：判定写回 `production.scriptReview` 列
   * （含轮次历史）。项目级内容、无实体 id；无剧本时抛可行动错误。
   * 回包带完整分数曲线（`history` 旧→新含本轮，FR-QA-07「每轮分数可回看」）。
   */
  reviewScript: authedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const outcome = await reviewScript(ctx.user.id, input.projectId);
      return outcome;
    }),

  /**
   * 按评审判定定向改写剧本（FR-QA-07 ④ · #2478）：消费上一轮评审的低分维度产出新剧本，
   * 旧版留档 `scriptReview.revisions`。没评过 / 无剧本时抛可行动错误。
   */
  reviseScript: authedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const markdown = await reviseScript(ctx.user.id, input.projectId);
      return { markdown };
    }),

  /** 抽卡优选（FR-QA-04④ · #2612）：对同一镜头的 2~4 个候选任务逐张视觉评审，
   *  均分最高者为赢家。返回赢家与全部候选分数；imageUrl / taskId 由客户端经
   *  镜头草稿回写（字段所有权见 #2615）。 */
  autoselectShot: authedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        shotId: z.string().min(1),
        taskIds: z.array(z.string().min(1)).min(2).max(4),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return autoselectShotImage(ctx.user.id, input.projectId, input.shotId, input.taskIds);
    }),

  /**
   * 评审不合格后的重生成（镜头）：gacha=同提示词换种子重出，reprompt=（未给新提示词时）据评审
   * 意见改写提示词再重出。两者都把镜头退回（rev 自增）交规划器重新纳入 —— 本端点不主动起 run，
   * 是否立即重跑由调用方（视图 resume / 自动评审）决定。
   */
  regenerateShot: authedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        shotId: z.string().min(1),
        mode: reviewModeEnum,
        newPrompt: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await regenerateShot(ctx.user.id, input.projectId, input.shotId, input.mode, input.newPrompt);
      return { ok: true };
    }),

  /* ── 人工裁决与人工评分（FR-QA-07 人工侧 · #2480）─────────────────────────
   * 人工裁决**优先于 AI 判定**（FR-AG-02「质量停点由人拍板」）：裁决快照（rev /
   * 剧本指纹）由规划器与评审收敛判据消费——人判废的不因 AI 判过而放行，人判过的
   * AI 再红也定稿。人评分（0~5）同时是校准读数的人侧输入。 */

  /** 人工裁决一条镜头 / 角色卡（approved / rejected + 一句话理由）。 */
  setHumanVerdict: authedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        kind: z.enum(["shot", "character"]),
        targetId: z.string().min(1),
        pass: z.boolean(),
        note: z.string().max(200).default(""),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await productionRepository.getForUser(ctx.user.id, input.projectId);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "生产数据行不存在" });
      }
      const rawList = input.kind === "shot" ? row.shots : row.characters;
      const list: Array<unknown> = Array.isArray(rawList) ? rawList : [];
      const rec = list.find(
        (item) =>
          /* SAFETY: 类型断言已复核 */
          typeof item === "object" &&
          item !== null &&
          (item as { id?: unknown }).id === input.targetId,
      );
      if (rec === undefined) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `找不到要裁决的${input.kind === "shot" ? "镜头" : "角色卡"}`,
        });
      }
      /* SAFETY: 类型断言已复核 */
      const revRaw = (rec as { rev?: unknown }).rev;
      const rev = typeof revRaw === "number" && Number.isFinite(revRaw) ? revRaw : 0;
      const verdict = {
        pass: input.pass,
        note: input.note.trim(),
        at: new Date().toISOString(),
        rev,
      };
      const nextList = applyHumanVerdict(list, input.targetId, verdict);
      await productionRepository.patchContent(ctx.user.id, input.projectId, {
        ...(input.kind === "shot" ? { shots: nextList } : { characters: nextList }),
      });
      return { humanVerdict: verdict };
    }),

  /** 人工评分一个镜头（0~5；null = 清除）。写 `shot.humanRating`。 */
  setHumanRating: authedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        shotId: z.string().min(1),
        rating: z.number().int().min(0).max(5).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await productionRepository.getForUser(ctx.user.id, input.projectId);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "生产数据行不存在" });
      }
      const shots: Array<unknown> = Array.isArray(row.shots) ? row.shots : [];
      const nextShots = applyHumanRating(shots, input.shotId, input.rating);
      if (nextShots === shots) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "找不到要评分的镜头",
        });
      }
      await productionRepository.patchContent(ctx.user.id, input.projectId, {
        shots: nextShots,
      });
      return { ok: true };
    }),

  /** 人工裁决整份剧本（approved / rejected + 理由）；裁决快照带当前剧本指纹。 */
  setScriptHumanVerdict: authedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        pass: z.boolean(),
        note: z.string().max(200).default(""),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await productionRepository.getForUser(ctx.user.id, input.projectId);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "生产数据行不存在" });
      }
      const script = typeof row.scriptMarkdown === "string" ? row.scriptMarkdown : "";
      const verdict = {
        pass: input.pass,
        note: input.note.trim(),
        at: new Date().toISOString(),
        digest: scriptDigestOf(script),
      };
      const next = applyScriptHumanVerdict(row.scriptReview, verdict);
      await productionRepository.patchContent(ctx.user.id, input.projectId, {
        scriptReview: next,
      });
      return { humanVerdict: verdict };
    }),

  /**
   * 校准读数（只读，#2480）：扫镜头上「AI 视觉判定 + 人评分」都齐全的样本，
   * 聚合总体偏差（AI 均分 vs 人评、MAE、判定一致率）与按维度偏差——调 rubric /
   * 评审提示词的依据。不写任何状态；样本不足时各读数 null。
   */
  reviewCalibration: authedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const row = await productionRepository.getForUser(ctx.user.id, input.projectId);
      const shots: Array<unknown> = row && Array.isArray(row.shots) ? row.shots : [];
      return calibrateFromShots(shots);
    }),
});
