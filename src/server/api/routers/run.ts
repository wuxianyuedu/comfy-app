// AI 自主执行 run 的控制端点（Phase 6 地基）。run = 挂统一项目上的「AI 跑到成片」协调态（生命周期 + 审批
// 粒度 + 每镜 rev 快照），落 `production.run` 列、由这里**单独写**（工坊自动保存不碰 run）。两视图（画布 /
// 工坊）都是操纵台：start/pause/resume/approve/cancel + status。status 用纯规划器算下一步动作；
// start/resume/approve 置 running 后 fire-and-forget 拉起 `advanceRunLoop`（推进到下一停点：点头/完成/
// 失败/暂停），引擎自带兜底、不抛给调用方。
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { isPlainRecord } from "~/lib/is-record";
import { productionRepository } from "~/lib/core/repository-production";
import {
  APPROVAL_MODES,
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
import { withProductionContentLock } from "~/lib/production/content-write-lock";
import {
  regenerateShot,
  reviewContent,
  reviewScript,
  autoselectShotImage,
  reviewShotImage,
  reviseScript,
} from "~/server/agent/review";

const approvalModeEnum = z.enum(APPROVAL_MODES);
const reviewModeEnum = z.enum(["gacha", "reprompt"]);

/** fire-and-forget 拉起执行引擎推进 run（动态 import 解耦；引擎自带异常兜底，不外抛）。 */
function kickEngine(userId: string, projectId: string): void {
  void (async () => {
    const { advanceRunLoop } = await import("~/server/agent/run-engine");
    await advanceRunLoop(userId, projectId);
  })();
}

function missingProductionError(): TRPCError {
  return new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "该项目还没有生产数据（先在工坊产出内容再启动）",
  });
}

/** 控制路由写回时必须保留的引擎进度字段（ISSUE #3960）：控制态与进度态分治，
 *  事务内取 `current` 的这些字段，避免 stale 读或并发推进被控制写覆盖。 */
function preserveProgress(current: ProductionRun, patch: Partial<ProductionRun>): ProductionRun {
  return {
    ...current,
    ...patch,
    stage: current.stage,
    log: current.log,
    processedShotRev: current.processedShotRev,
    autoReview: patch.autoReview ?? current.autoReview,
    reviewedShotRev: current.reviewedShotRev,
    reviewAttempts: current.reviewAttempts,
    scriptReviewDigest: current.scriptReviewDigest,
    scriptReviewAttempts: current.scriptReviewAttempts,
    scriptRevisionPending: current.scriptRevisionPending,
    storyboardScriptDigest: current.storyboardScriptDigest,
    filmStartedAt: current.filmStartedAt,
    updatedAt: new Date().toISOString(),
  };
}

async function planForRun(
  userId: string,
  projectId: string,
  run: ProductionRun,
): Promise<RunAction> {
  const row = await productionRepository.getForUser(userId, projectId);
  return planNextRunAction(toRunView(row ?? null), run);
}

type ControlDecision = { noop: true; run: ProductionRun } | { next: ProductionRun; noop: false };

async function applyControlMutation(
  userId: string,
  projectId: string,
  decide: (current: ProductionRun) => ControlDecision,
): Promise<{ action: RunAction; run: ProductionRun; wrote: boolean }> {
  const outcome = await productionRepository.mutateRun(userId, projectId, (current) => {
    const decision = decide(current);
    if (decision.noop) {
      return null;
    }
    return { meta: undefined, next: decision.next };
  });
  if (!outcome) {
    throw missingProductionError();
  }
  const run = outcome.next;
  const action = outcome.wrote
    ? await planForRun(userId, projectId, run)
    : { kind: "idle" as const };
  return { action, run, wrote: outcome.wrote };
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
      const result = await applyControlMutation(ctx.user.id, input.projectId, (current) => ({
        noop: false,
        next: preserveProgress(current, {
          status: "running",
          approvalMode: input.approvalMode ?? current.approvalMode,
          goal: input.goal ?? current.goal,
          imageWorkflowId: input.imageWorkflowId ?? current.imageWorkflowId,
          videoWorkflowId: input.videoWorkflowId ?? current.videoWorkflowId,
          autoReview: input.autoReview ?? current.autoReview,
          awaitingStage: null,
          error: null,
        }),
      }));
      if (result.wrote) {
        kickEngine(ctx.user.id, input.projectId);
      }
      return { action: result.action, run: result.run };
    }),

  /** 用户主动暂停（画布/工坊的「暂停」按钮）。 */
  pause: authedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await applyControlMutation(ctx.user.id, input.projectId, (current) => {
        if (current.status !== "running" && current.status !== "awaiting_approval") {
          return { noop: true, run: current };
        }
        return { noop: false, next: preserveProgress(current, { status: "paused" }) };
      });
      return { action: result.action, run: result.run };
    }),

  /** 继续（从 paused 恢复）。awaiting_approval 的点头走 approve。 */
  resume: authedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await applyControlMutation(ctx.user.id, input.projectId, (current) => {
        if (current.status !== "paused") {
          return { noop: true, run: current };
        }
        return { noop: false, next: preserveProgress(current, { status: "running" }) };
      });
      if (result.wrote) {
        kickEngine(ctx.user.id, input.projectId);
      }
      return { action: result.action, run: result.run };
    }),

  /** 对某步点头放行（awaiting_approval → running）。 */
  approve: authedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await applyControlMutation(ctx.user.id, input.projectId, (current) => {
        if (current.status !== "awaiting_approval") {
          return { noop: true, run: current };
        }
        return {
          noop: false,
          next: preserveProgress(current, { status: "running", awaitingStage: null }),
        };
      });
      if (result.wrote) {
        kickEngine(ctx.user.id, input.projectId);
      }
      return { action: result.action, run: result.run };
    }),

  /** 取消整条自主执行。 */
  cancel: authedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await applyControlMutation(ctx.user.id, input.projectId, (current) => {
        /* 终态幂等（ISSUE #3901）：done / failed 已收尾，取消不改写终态、
         * 原样回显；重复取消（已 cancelled）同样幂等返回。 */
        if (
          current.status === "done" ||
          current.status === "failed" ||
          current.status === "cancelled"
        ) {
          return { noop: true, run: current };
        }
        return {
          noop: false,
          next: preserveProgress(current, { status: "cancelled", awaitingStage: null }),
        };
      });
      return { action: result.action, run: result.run };
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
        throw missingProductionError();
      }
      const rawList = input.kind === "shot" ? row.shots : row.characters;
      const list: Array<unknown> = Array.isArray(rawList) ? rawList : [];
      const rec = list.find((item) => isPlainRecord(item) && item.id === input.targetId);
      if (rec === undefined) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `找不到要裁决的${input.kind === "shot" ? "镜头" : "角色卡"}`,
        });
      }
      /* 写回收进 per-project 内容写锁（ISSUE #3864）：裁决快照的 rev 取**锁内
       * 重读**到的最新值，叠加裁决后整列写回——与引擎/评审器的并发修改不再互覆。 */
      const humanVerdict = await withProductionContentLock(input.projectId, async () => {
        const fresh = await productionRepository.getForUser(ctx.user.id, input.projectId);
        if (!fresh) {
          throw missingProductionError();
        }
        const freshRaw = input.kind === "shot" ? fresh.shots : fresh.characters;
        const freshList: Array<unknown> = Array.isArray(freshRaw) ? freshRaw : [];
        const freshRec = freshList.find(
          (item) => isPlainRecord(item) && item.id === input.targetId,
        );
        if (freshRec === undefined) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `找不到要裁决的${input.kind === "shot" ? "镜头" : "角色卡"}`,
          });
        }
        const revRaw = isPlainRecord(freshRec) ? freshRec.rev : undefined;
        const rev = typeof revRaw === "number" && Number.isFinite(revRaw) ? revRaw : 0;
        const verdict = {
          pass: input.pass,
          note: input.note.trim(),
          at: new Date().toISOString(),
          rev,
        };
        const nextList = applyHumanVerdict(freshList, input.targetId, verdict);
        await productionRepository.patchContent(ctx.user.id, input.projectId, {
          ...(input.kind === "shot" ? { shots: nextList } : { characters: nextList }),
        });
        return verdict;
      });
      return { humanVerdict };
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
        throw missingProductionError();
      }
      /* 写回收进 per-project 内容写锁（ISSUE #3864）：锁内重读最新 shots 再叠加
       * 评分，不与引擎/评审器的并发修改互覆。 */
      await withProductionContentLock(input.projectId, async () => {
        const fresh = await productionRepository.getForUser(ctx.user.id, input.projectId);
        if (!fresh) {
          throw missingProductionError();
        }
        const shots: Array<unknown> = Array.isArray(fresh.shots) ? fresh.shots : [];
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
        throw missingProductionError();
      }
      const script = typeof row.scriptMarkdown === "string" ? row.scriptMarkdown : "";
      const verdict = {
        pass: input.pass,
        note: input.note.trim(),
        at: new Date().toISOString(),
        digest: scriptDigestOf(script),
      };
      /* 写回收进 per-project 内容写锁（ISSUE #3864）：锁内重读最新评审位再叠加
       * 人工裁决，裁决快照的指纹按当前剧本算。 */
      await withProductionContentLock(input.projectId, async () => {
        const fresh = await productionRepository.getForUser(ctx.user.id, input.projectId);
        if (!fresh) {
          throw missingProductionError();
        }
        const next = applyScriptHumanVerdict(fresh.scriptReview, verdict);
        await productionRepository.patchContent(ctx.user.id, input.projectId, {
          scriptReview: next,
        });
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
