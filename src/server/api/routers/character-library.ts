/**
 * `character-library.ts` — 角色库路由（ISSUE #5009）：跨项目的二次元角色档案池。
 *
 * 能力：列表（关键词 + 标签 AND 过滤 + 状态过滤 + 标签分面 + 状态角标）、
 * 详情、手工增改删（标签随描述自动重提）、预置批量入库（组合式生成器，幂等）、
 * 批量生图（走工作流库工作流 + 既有任务队列，逐角色一个任务）、生成结果对账回写
 * （产物复制进角色自有目录，与任务生命周期解耦）。
 * @module server/routers/character-library — 角色库 tRPC 路由
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createId } from "@paralleldrive/cuid2";

import { isRecord } from "~/lib/is-record";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { characterProfileRepository, taskRepository } from "~/lib/core/repository";
import { extractCharacterTags } from "~/lib/character/tag-extract";
import {
  generateCharacterRoster,
  ROSTER_COUNT_MAX,
  ROSTER_COUNT_MIN,
} from "~/lib/character/roster-seed";
import { buildPortraitPrompt, PORTRAIT_NEGATIVE_PROMPT } from "~/lib/character/portrait-prompt";
import { copyIntoCharacterStore, removeCharacterStoreDir } from "~/lib/character/character-store";
import { prepareWorkflowRun, buildWorkflowRunParams } from "~/lib/workshop/workflow-run.server";
import { hasExecutableWorkflow } from "~/lib/comfyui/execution-shape";
import { resolveExecutorClaim } from "~/lib/comfyui/executor-mode";
import { kickQueue } from "~/lib/comfyui/executor-continuation";
import { DEFAULT_SIZE_SPEC } from "~/lib/media/size-presets";
import {
  CHARACTER_PROFILE_SOURCES,
  CHARACTER_PROFILE_STATUSES,
} from "~/server/db/schema-character";
import { uniqueConflict } from "./unique-conflict";

/** 角色库总容量上限：预置是批量动作，给个显式天花板防止误操作无限膨胀。 */
const MAX_LIBRARY_SIZE = 2000;

/** 单角色候选立绘上限（同工坊定妆照口径：超出丢最旧）。 */
const MAX_PORTRAIT_CANDIDATES = 12;

/** 单角色单批生图上限：一次入队太多会长时间占满队列，分批点几次更可控。 */
const MAX_ENQUEUE_PER_CALL = 200;

/** json 列回读是 unknown：标签只认非空字符串数组。 */
function normalizeTags(raw: unknown): Array<string> {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((tag): tag is string => typeof tag === "string" && tag !== "");
}

/** 候选立绘归一化：只认带 url 的对象，坏形状剔除（与工坊定妆照同思路）。 */
function normalizePortraits(
  raw: unknown,
): Array<{ createdAt: number; taskId?: string; url: string }> {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: Array<{ createdAt: number; taskId?: string; url: string }> = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue;
    }
    const url = entry.url;
    if (typeof url !== "string" || url === "") {
      continue;
    }
    out.push({
      url,
      createdAt: typeof entry.createdAt === "number" ? entry.createdAt : 0,
      ...(typeof entry.taskId === "string" ? { taskId: entry.taskId } : {}),
    });
  }
  return out;
}

const statusSchema = z.enum(["all", ...CHARACTER_PROFILE_STATUSES]).default("all");

export const characterLibraryRouter = createTRPCRouter({
  /**
   * 列表：关键词（名字 / 原型 / 描述）+ 标签（AND）+ 状态过滤；
   * 一并带回标签分面（当前过滤条件下每个标签的命中数）与状态角标。
   */
  list: authedProcedure
    .input(
      z
        .object({
          q: z.string().optional(),
          status: statusSchema,
          tags: z.array(z.string().min(1)).max(12).optional(),
          take: z.number().int().min(1).max(500).optional().default(120),
          skip: z.number().int().min(0).optional().default(0),
        })
        .default({ status: "all", take: 120, skip: 0 }),
    )
    .query(async ({ ctx, input }) => {
      const filter = {
        userId: ctx.user.id,
        q: input.q,
        status: input.status,
        tags: input.tags,
      };
      const items = await characterProfileRepository.listByUser({
        ...filter,
        take: input.take,
        skip: input.skip,
      });
      const tagFacets = await characterProfileRepository.countByTag(filter);
      const statusCounts = await characterProfileRepository.countByStatus(ctx.user.id);
      return {
        items: items.map((row) => ({
          id: row.id,
          name: row.name,
          archetype: row.archetype,
          gender: row.gender,
          description: row.description,
          tags: normalizeTags(row.tags),
          status: row.status,
          source: row.source,
          portraitUrl: row.portraitUrl,
          portraitCount: normalizePortraits(row.portraits).length,
          width: row.width,
          height: row.height,
          createdAt: row.createdAt,
        })),
        tagFacets,
        statusCounts,
      };
    }),

  /** 详情（含全部候选立绘与生图参数快照）。 */
  detail: authedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const row = await characterProfileRepository.findOwned(input.id, ctx.user.id);
    if (row === null) {
      throw new TRPCError({ code: "NOT_FOUND", message: "角色不存在" });
    }
    return {
      ...row,
      tags: normalizeTags(row.tags),
      portraits: normalizePortraits(row.portraits),
    };
  }),

  /** 手工创建一个角色（标签从描述自动提取，调用方不必传）。 */
  create: authedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(60),
        archetype: z.string().max(60).optional().default(""),
        gender: z.string().max(20).optional().default(""),
        description: z.string().min(1).max(8000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tags = extractCharacterTags(input.description, input.archetype);
      try {
        const rows = await characterProfileRepository.createManyIgnoringConflicts([
          {
            id: createId(),
            userId: ctx.user.id,
            name: input.name,
            archetype: input.archetype,
            gender: input.gender,
            description: input.description,
            tags,
            source: "manual",
          },
        ]);
        const row = rows[0];
        if (row === undefined) {
          /* onConflictDoNothing 吞掉撞名行时 returning 为空 —— 唯一冲突的幂等面。 */
          throw new TRPCError({ code: "CONFLICT", message: "同名角色已存在" });
        }
        return { id: row.id, tags: normalizeTags(row.tags) };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw uniqueConflict(error, [
          {
            columns: ["characterProfile.userId", "characterProfile.name"],
            message: "同名角色已存在",
          },
        ]);
      }
    }),

  /** 更新档案；描述或原型变化时标签自动重提。 */
  update: authedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(60).optional(),
        archetype: z.string().max(60).optional(),
        gender: z.string().max(20).optional(),
        description: z.string().min(1).max(8000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await characterProfileRepository.findOwned(input.id, ctx.user.id);
      if (row === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "角色不存在" });
      }
      const description = input.description ?? row.description;
      const archetype = input.archetype ?? row.archetype;
      const tags =
        input.description === undefined && input.archetype === undefined
          ? undefined
          : extractCharacterTags(description, archetype);
      try {
        const updated = await characterProfileRepository.updateProfileFields(
          input.id,
          ctx.user.id,
          {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.archetype === undefined ? {} : { archetype }),
            ...(input.gender === undefined ? {} : { gender: input.gender }),
            ...(input.description === undefined ? {} : { description }),
            ...(tags === undefined ? {} : { tags }),
          },
        );
        if (updated === null) {
          throw new TRPCError({ code: "NOT_FOUND", message: "角色不存在" });
        }
        return { ok: true, tags: normalizeTags(updated.tags) };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw uniqueConflict(error, [
          {
            columns: ["characterProfile.userId", "characterProfile.name"],
            message: "同名角色已存在",
          },
        ]);
      }
    }),

  /** 删除：库行 + 立绘目录（文件在角色自己的目录里，不影响原任务）。 */
  delete: authedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const row = await characterProfileRepository.findOwned(input.id, ctx.user.id);
    if (row === null) {
      throw new TRPCError({ code: "NOT_FOUND", message: "角色不存在" });
    }
    await characterProfileRepository.delete(row.id);
    await removeCharacterStoreDir(row.id).catch(() => undefined);
    return { ok: true };
  }),

  /**
   * 预置批量入库：组合式生成器按 (count, seed) 产出角色（含已提取的标签），
   * 批量插入；(userId, name) 撞名按幂等跳过——同种子重跑不产生重复行。
   */
  seed: authedProcedure
    .input(
      z.object({
        count: z.number().int().min(ROSTER_COUNT_MIN).max(ROSTER_COUNT_MAX),
        seed: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const statusCounts = await characterProfileRepository.countByStatus(ctx.user.id);
      const existing = Object.values(statusCounts).reduce((sum, n) => sum + n, 0);
      if (existing >= MAX_LIBRARY_SIZE) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `角色库已满（上限 ${MAX_LIBRARY_SIZE} 个）`,
        });
      }
      const roster = generateCharacterRoster({
        count: Math.min(input.count, MAX_LIBRARY_SIZE - existing),
        seed: input.seed,
      });
      const created = await characterProfileRepository.createManyIgnoringConflicts(
        roster.map((entry) => ({
          id: createId(),
          userId: ctx.user.id,
          name: entry.name,
          archetype: entry.archetype,
          gender: entry.gender,
          description: entry.description,
          tags: entry.tags,
          source: CHARACTER_PROFILE_SOURCES[0],
        })),
      );
      return { created: created.length, skipped: roster.length - created.length, existing };
    }),

  /**
   * 批量生图：给（选中的 / 全部待生成的）角色逐个入队一个生图任务。
   * 工作流来自工作流库（如 minimax_h3_image）；入参封装与工坊批量同一条链
   * （prepareWorkflowRun + buildWorkflowRunParams），提示词由角色描述折算。
   * 显式点名 ids 时允许对已就绪角色重跑（新候选）；自动模式只取 draft / failed。
   */
  enqueueGeneration: authedProcedure
    .input(
      z.object({
        workflowId: z.string().min(1),
        ids: z.array(z.string()).max(1000).optional(),
        limit: z.number().int().min(1).max(MAX_ENQUEUE_PER_CALL).optional().default(50),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const runCtx = await prepareWorkflowRun(ctx.user.id, input.workflowId);
      if (runCtx === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "工作流不存在" });
      }
      if (!hasExecutableWorkflow(runCtx.tpl)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "工作流没有可执行内容（rawJson 为空）：请重新导入该工作流",
        });
      }

      let targets;
      if (input.ids !== undefined && input.ids.length > 0) {
        const picked = await characterProfileRepository.findOwnedByIds(input.ids, ctx.user.id);
        targets = picked.filter((row) => row.status !== "generating");
      } else {
        const [draft, failed] = await Promise.all([
          characterProfileRepository.listByStatus(ctx.user.id, "draft"),
          characterProfileRepository.listByStatus(ctx.user.id, "failed"),
        ]);
        targets = [...draft, ...failed].slice(0, input.limit);
      }

      const executorClaim = resolveExecutorClaim();
      let enqueued = 0;
      for (const character of targets) {
        const prompt = buildPortraitPrompt({
          name: character.name,
          archetype: character.archetype,
          description: character.description,
        });
        const params = buildWorkflowRunParams(runCtx, {
          prompt,
          negativePrompt: PORTRAIT_NEGATIVE_PROMPT,
          size: DEFAULT_SIZE_SPEC,
        });
        // oxlint-disable-next-line no-await-in-loop -- 先入队成功再标记生成中，顺序依赖
        const task = await taskRepository.createQueued({
          userId: ctx.user.id,
          type: runCtx.tpl.taskType,
          prompt,
          negativePrompt: PORTRAIT_NEGATIVE_PROMPT,
          params,
          workflowName: runCtx.tpl.name,
          projectId: null,
          shotId: null,
          claimedBy: executorClaim,
          execPayload: runCtx.tpl.rawJson,
          parentId: null,
        });
        // oxlint-disable-next-line no-await-in-loop -- 先入队成功再标记生成中，顺序依赖
        await characterProfileRepository.markGenerating(character.id, ctx.user.id, task.id, params);
        enqueued += 1;
      }
      if (enqueued > 0) {
        kickQueue();
      }
      return { enqueued, workflowName: runCtx.tpl.name };
    }),

  /**
   * 生成结果对账：扫描「生成中」的角色，按任务终态回写——
   * SUCCEEDED → 产物复制进角色目录、立绘入候选列表（最新在前）、状态 ready；
   * FAILED / CANCELED / 任务丢失 → 状态 failed（保留原立绘）。
   * 由界面在存在生成中角色时轮询；也可手动触发。
   */
  syncGeneration: authedProcedure.mutation(async ({ ctx }) => {
    const generating = await characterProfileRepository.listByStatus(ctx.user.id, "generating");
    /* 任务行的回查没有顺序依赖，一趟并行取回（no-await-in-loop 的正解）；
     * 回写仍逐行串行——复制成功才落库，SQLite 单写者下并行无收益。 */
    const tasks = await Promise.all(
      generating.map((character) =>
        character.taskId === null
          ? Promise.resolve(null)
          : taskRepository.findByIdWithImages(character.taskId),
      ),
    );
    let ready = 0;
    let failed = 0;
    let pending = 0;
    for (const [index, character] of generating.entries()) {
      const task = tasks[index] ?? null;
      if (
        task === null ||
        task.status === "FAILED" ||
        task.status === "CANCELED" ||
        (task.status === "SUCCEEDED" && (task.images?.length ?? 0) === 0)
      ) {
        // oxlint-disable-next-line no-await-in-loop -- 对账逐行回写，SQLite 单写者并行无收益
        await characterProfileRepository.markFailed(character.id, ctx.user.id, character.taskId);
        failed += 1;
        continue;
      }
      if (task.status !== "SUCCEEDED") {
        pending += 1;
        continue;
      }
      const image = task.images[0];
      if (image === undefined) {
        pending += 1;
        continue;
      }
      // oxlint-disable-next-line no-await-in-loop -- 复制成功才回写，顺序依赖
      const storedUrl = await copyIntoCharacterStore(image.localPath, character.id);
      if (storedUrl === null) {
        // oxlint-disable-next-line no-await-in-loop -- 与上面的复制同一条串行链
        await characterProfileRepository.markFailed(character.id, ctx.user.id, character.taskId);
        failed += 1;
        continue;
      }
      const portraits = normalizePortraits(character.portraits);
      const nextPortraits = [
        { url: storedUrl, createdAt: Date.now(), taskId: task.id },
        ...portraits.filter((entry) => entry.url !== storedUrl),
      ].slice(0, MAX_PORTRAIT_CANDIDATES);
      // oxlint-disable-next-line no-await-in-loop -- 与上面的复制同一条串行链
      await characterProfileRepository.markReady(character.id, ctx.user.id, {
        portraitUrl: storedUrl,
        portraits: nextPortraits,
        width: image.width,
        height: image.height,
        params: task.params,
        taskId: task.id,
      });
      ready += 1;
    }
    return { ready, failed, pending, scanned: generating.length };
  }),
});
