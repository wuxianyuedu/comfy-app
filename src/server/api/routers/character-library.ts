/**
 * `character-library.ts` — 角色库路由（ISSUE #5009）：跨项目的二次元角色档案池。
 *
 * 能力：列表（关键词 + 标签 AND 过滤 + 状态过滤 + 标签分面 + 状态角标）、
 * 详情、生成历史（候选逐条回查任务信息）、手工增改删（标签随描述自动重提、
 * 候选立绘逐张删除）、预置批量入库（组合式生成器，幂等）、批量生图（走工作流库
 * 工作流 + 既有任务队列，逐角色一个任务）、生成结果对账回写（产物复制进角色
 * 自有目录，与任务生命周期解耦）。
 * @module server/routers/character-library — 角色库 tRPC 路由
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createId } from "@paralleldrive/cuid2";

import { asRecord, isRecord } from "~/lib/is-record";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import {
  characterProfileRepository,
  taskRepository,
  workflowModelTagRepository,
} from "~/lib/core/repository";
import { buildEncapsulatedInputs } from "~/lib/workshop/workflow-encapsulation";
import { extractCharacterTags } from "~/lib/character/tag-extract";
import {
  generateCharacterRoster,
  ROSTER_COUNT_MAX,
  ROSTER_COUNT_MIN,
} from "~/lib/character/roster-seed";
import { buildPortraitPrompts } from "~/lib/character/portrait-prompt";
import {
  copyIntoCharacterStore,
  readArtifactBytes,
  removeCharacterPortrait,
  removeCharacterStoreDir,
} from "~/lib/character/character-store";
import {
  needsRegeneration,
  PORTRAIT_REGENERATE_THRESHOLD,
  scorePortraitPng,
} from "~/lib/character/quality-check";
import { prepareWorkflowRun, buildWorkflowRunParams } from "~/lib/workshop/workflow-run.server";
import { hasExecutableWorkflow } from "~/lib/comfyui/execution-shape";
import { resolveExecutorClaim } from "~/lib/comfyui/executor-mode";
import { kickQueue } from "~/lib/comfyui/executor-continuation";
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

type WorkflowRunContext = NonNullable<Awaited<ReturnType<typeof prepareWorkflowRun>>>;

/** 单条候选立绘对应的任务信息（历史面板的只读投影）。 */
type PortraitHistoryEntry = {
  createdAt: number;
  error: string | null;
  imageCount: number;
  modelName: string | null;
  prompt: string | null;
  status: string | null;
  taskId: string;
  url: string;
  workflowName: string | null;
};

/**
 * 探针：这条工作流到底接不接负向提示词。
 *
 * 用同一份封装纯函数做一次假提交，只看 `resolved.negative` 有没有落点——
 * 落点只认作者连的线，没有线就没有落点（与真正下发时的判据同源，不另立一套
 * 模型元数据表）。探针的 workflowInputs 是假值，直接丢弃。
 */
function workflowSupportsNegative(runCtx: WorkflowRunContext): boolean {
  const { resolved } = buildEncapsulatedInputs({
    contractIds: runCtx.contractIds,
    io: runCtx.io,
    mode: runCtx.mode,
    paramMap: runCtx.tpl.paramMap,
    table: runCtx.sizeTable,
    values: { negativePrompt: "__probe__", prompt: "__probe__" },
  });
  return typeof resolved.negative === "string" && resolved.negative !== "";
}

/** 逐个角色入队生图任务（批量生图与「重生成有问题的立绘」共用的同一条链）。 */
async function enqueueCharacters(
  characters: Array<{
    archetype: string;
    description: string;
    id: string;
    name: string;
  }>,
  runCtx: WorkflowRunContext,
  userId: string,
): Promise<number> {
  const executorClaim = resolveExecutorClaim();
  /* 一批只用同一条工作流，能力探针在循环外判一次（避免逐角色重复封装）。 */
  const supportsNegative = workflowSupportsNegative(runCtx);
  let enqueued = 0;
  for (const character of characters) {
    const { prompt, negativePrompt } = buildPortraitPrompts(
      {
        name: character.name,
        archetype: character.archetype,
        description: character.description,
      },
      supportsNegative,
    );
    const params = buildWorkflowRunParams(runCtx, {
      prompt,
      ...(negativePrompt === null ? {} : { negativePrompt }),
      /* 尺寸不传：工作流（如 minimax h3）的 aspect_ratio 是枚举口
       * （「3:4 (Portrait Standard)」这类带说明的标签），按场景表折算的
       * 宽高 / 比例值落不进枚举，会在执行前校验被打回。角色立绘直接用
       * 工作流作者烘在图里的默认档。 */
    });
    // oxlint-disable-next-line no-await-in-loop -- 先入队成功再标记生成中，顺序依赖
    const task = await taskRepository.createQueued({
      userId,
      type: runCtx.tpl.taskType,
      prompt,
      ...(negativePrompt === null ? {} : { negativePrompt }),
      params,
      workflowName: runCtx.tpl.name,
      projectId: null,
      shotId: null,
      claimedBy: executorClaim,
      execPayload: runCtx.tpl.rawJson,
      parentId: null,
    });
    // oxlint-disable-next-line no-await-in-loop -- 先入队成功再标记生成中，顺序依赖
    await characterProfileRepository.markGenerating(character.id, userId, task.id, params);
    enqueued += 1;
  }
  if (enqueued > 0) {
    kickQueue();
  }
  return enqueued;
}

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
          qualityScore: row.qualityScore,
          qualityIssues: normalizeTags(row.qualityIssues),
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
      qualityIssues: normalizeTags(row.qualityIssues),
    };
  }),

  /** 生成历史：候选立绘逐条回查任务信息；查不到 / 不属于当前用户的跳过。 */
  history: authedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const row = await characterProfileRepository.findOwned(input.id, ctx.user.id);
    if (row === null) {
      throw new TRPCError({ code: "NOT_FOUND", message: "角色不存在" });
    }
    const portraits = normalizePortraits(row.portraits)
      .filter((portrait) => portrait.taskId !== undefined)
      .slice(0, MAX_PORTRAIT_CANDIDATES);
    /* 任务回查互不依赖，一趟并行取回（no-await-in-loop 的正解）。 */
    const tasks = await Promise.all(
      portraits.map((portrait) =>
        portrait.taskId === undefined
          ? Promise.resolve(undefined)
          : taskRepository.findByIdWithImages(portrait.taskId),
      ),
    );
    const visible = portraits.flatMap((portrait, index) => {
      const task = tasks[index];
      if (portrait.taskId === undefined || task === undefined || task.userId !== ctx.user.id) {
        return [];
      }
      return [{ portrait: { taskId: portrait.taskId, url: portrait.url }, task }];
    });
    /* 模型名与任务详情同一口径：任务行不存模型，工作流上挂的标签才是权威来源。 */
    const templateIds = [
      ...new Set(
        visible
          .map(({ task }) => {
            const workflowId = asRecord(task.params)?.workflow;
            return typeof workflowId === "string" && workflowId !== "" ? workflowId : null;
          })
          .filter((id): id is string => id !== null),
      ),
    ];
    const tagRows =
      templateIds.length === 0
        ? []
        : await workflowModelTagRepository.getTemplateTagRows(templateIds);
    const modelNameByTemplate = new Map(tagRows.map((tagRow) => [tagRow.templateId, tagRow.name]));
    return visible.map(({ portrait, task }): PortraitHistoryEntry => {
      const workflowId = asRecord(task.params)?.workflow;
      const templateId = typeof workflowId === "string" && workflowId !== "" ? workflowId : null;
      return {
        createdAt: task.createdAt.getTime(),
        error: task.error ?? null,
        imageCount: task.images.length,
        modelName: templateId === null ? null : (modelNameByTemplate.get(templateId) ?? null),
        prompt: task.prompt ?? null,
        status: task.status ?? null,
        taskId: portrait.taskId,
        url: portrait.url,
        workflowName: task.workflowName ?? null,
      };
    });
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
   * 删除选中的候选立绘（只认本角色的候选地址）。删掉当前图时把剩余第一张
   * 提升为新的当前图（没有剩余则为 null）；角色状态保持现状，不强行改写。
   */
  deletePortraits: authedProcedure
    .input(z.object({ id: z.string(), urls: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const row = await characterProfileRepository.findOwned(input.id, ctx.user.id);
      if (row === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "角色不存在" });
      }
      const portraits = normalizePortraits(row.portraits);
      const removedUrls = new Set(input.urls);
      const remaining = portraits.filter((portrait) => !removedUrls.has(portrait.url));
      const removedPortraits = portraits.filter((portrait) => removedUrls.has(portrait.url));
      const currentRemoved = row.portraitUrl !== null && removedUrls.has(row.portraitUrl);
      const nextPortraitUrl = currentRemoved ? (remaining[0]?.url ?? null) : row.portraitUrl;
      /* 先落库再删盘：删盘失败不影响库内状态（下次清理可按地址重试）。 */
      await characterProfileRepository.update(row.id, {
        portraitUrl: nextPortraitUrl,
        portraits: remaining,
      });
      for (const portrait of removedPortraits) {
        // oxlint-disable-next-line no-await-in-loop -- 逐张删盘，彼此独立，落库成功后才动文件
        await removeCharacterPortrait(portrait.url, row.id).catch(() => undefined);
      }
      return { portraitUrl: nextPortraitUrl, removed: removedPortraits.length };
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

      const enqueued = await enqueueCharacters(targets, runCtx, ctx.user.id);
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
        task.status === "CANCELLED" ||
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

  /**
   * 质量打分（单张）：对角色的当前立绘做**确定性**质量检查（纯色 / 空白 /
   * 低分辨率 / 文件异常等规则，见 `~/lib/character/quality-check`），分数与
   * 问题清单落库。打分不依赖外部模型，同一张图结果恒定。
   */
  scoreQuality: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await characterProfileRepository.findOwned(input.id, ctx.user.id);
      if (row === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "角色不存在" });
      }
      if (row.status !== "ready" || row.portraitUrl === null || row.portraitUrl === "") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "该角色还没有已生成的立绘可打分" });
      }
      const file = await readArtifactBytes(row.portraitUrl);
      if (file === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "立绘文件不存在（可能已被清理）" });
      }
      const quality = scorePortraitPng(file);
      await characterProfileRepository.updateQuality(
        row.id,
        ctx.user.id,
        quality.score,
        quality.issues,
      );
      return {
        id: row.id,
        name: row.name,
        score: quality.score,
        issues: quality.issues,
        metrics: quality.metrics,
        needsRegeneration: needsRegeneration(quality),
      };
    }),

  /**
   * 质量打分（批量）：**依次**给每张已就绪立绘打分并落库，返回低于阈值的
   * 「有问题」清单（需要重新生成的候选）。
   */
  scoreAllQuality: authedProcedure.mutation(async ({ ctx }) => {
    const rows = await characterProfileRepository.listReadyWithPortraits(ctx.user.id);
    const flagged: Array<{ id: string; issues: Array<string>; name: string; score: number }> = [];
    let scored = 0;
    let unscored = 0;
    for (const row of rows) {
      if (row.portraitUrl === null || row.portraitUrl === "") {
        unscored += 1;
        continue;
      }
      /* 逐张读文件 → 打分 → 落库：一张失败不影响其余（部分成功语义）。 */
      // oxlint-disable-next-line no-await-in-loop -- 逐张打分落库，SQLite 单写者并行无收益
      const file = await readArtifactBytes(row.portraitUrl);
      if (file === null) {
        unscored += 1;
        continue;
      }
      const quality = scorePortraitPng(file);
      // oxlint-disable-next-line no-await-in-loop -- 与上面的读取同一条串行链
      await characterProfileRepository.updateQuality(
        row.id,
        ctx.user.id,
        quality.score,
        quality.issues,
      );
      scored += 1;
      if (needsRegeneration(quality)) {
        flagged.push({ id: row.id, issues: quality.issues, name: row.name, score: quality.score });
      }
    }
    return { scored, unscored, flagged, threshold: PORTRAIT_REGENERATE_THRESHOLD };
  }),

  /**
   * 重新生成有问题的立绘：把质量分低于阈值的就绪角色退回待生成，并按
   * 「批量生图」同一条链重新入队（旧立绘保留为候选，不先删）。
   */
  regenerateFlagged: authedProcedure
    .input(
      z.object({
        workflowId: z.string().min(1),
        minScore: z
          .number()
          .int()
          .min(0)
          .max(100)
          .optional()
          .default(PORTRAIT_REGENERATE_THRESHOLD),
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
      const flagged = await characterProfileRepository.listFlaggedLowQuality(
        ctx.user.id,
        input.minScore,
      );
      if (flagged.length === 0) {
        return { regenerated: 0, flagged: 0, workflowName: runCtx.tpl.name };
      }
      for (const row of flagged) {
        // oxlint-disable-next-line no-await-in-loop -- 逐行退档，SQLite 单写者并行无收益
        await characterProfileRepository.resetToDraft(row.id, ctx.user.id);
      }
      const regenerated = await enqueueCharacters(flagged, runCtx, ctx.user.id);
      return { regenerated, flagged: flagged.length, workflowName: runCtx.tpl.name };
    }),
});
