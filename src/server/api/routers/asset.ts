/**
 * `asset.ts` — 资产库路由（ISSUE #4868）：跨项目沉淀生成产物，
 * 公共 / 项目两档归属 + 七个分类，入库即保存完整生成参数快照。
 * @module server/routers/asset — 资产库 tRPC 路由
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createId } from "@paralleldrive/cuid2";

import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { assetRepository, taskRepository } from "~/lib/core/repository";
import { firstRowRequired } from "~/lib/core/repository-row";
import { copyIntoAssetStore, removeAssetStoreDir } from "~/lib/media/asset-store";
import { kindOf } from "~/lib/media/media-kind";

/** 资产分类键（展示名映射在 `asset-categories.ts`，这里只认键）。 */
export const ASSET_CATEGORY_KEYS = [
  "reference",
  "scene",
  "storyboard",
  "style",
  "character",
  "document",
  "music",
] as const;

/** 归属两档。 */
export const ASSET_SCOPE_KEYS = ["public", "project"] as const;

const categorySchema = z.enum(ASSET_CATEGORY_KEYS);
const scopeSchema = z.enum(ASSET_SCOPE_KEYS);

/** 产物 → 资产媒体类型：扩展名判据（`kindOf`）优先，其余按文档收口。 */
function assetMediaTypeOf(path: string): "image" | "video" | "audio" | "document" {
  const kind = kindOf(path);
  if (kind === "image" || kind === "video" || kind === "audio") {
    return kind;
  }
  return "document";
}

/** 资产名：提示词前 24 字符优先，退回工作流名，再退「未命名资产」。 */
function assetNameOf(prompt: string | null, workflowName: string, index: number, total: number) {
  const base = (prompt ?? "").replaceAll(/\s+/g, " ").trim().slice(0, 24);
  if (base !== "") {
    return total > 1 ? `${base} · ${index + 1}` : base;
  }
  return workflowName === "" ? `未命名资产 · ${index + 1}` : `${workflowName} · ${index + 1}`;
}

export const assetRouter = createTRPCRouter({
  /** 列表：归属 / 分类 / 媒体类型 / 关键词过滤 + 分类计数（角标一次带回）。 */
  list: authedProcedure
    .input(
      z
        .object({
          scope: z
            .enum(["all", ...ASSET_SCOPE_KEYS])
            .optional()
            .default("all"),
          category: z.string().optional().default("all"),
          mediaType: z
            .enum(["all", "image", "video", "audio", "document"])
            .optional()
            .default("all"),
          projectId: z.string().optional(),
          q: z.string().optional(),
          take: z.number().int().min(1).max(200).optional().default(120),
        })
        .default({ scope: "all", category: "all", mediaType: "all", take: 120 }),
    )
    .query(async ({ ctx, input }) => {
      const items = await assetRepository.listByUser({
        userId: ctx.user.id,
        scope: input.scope,
        category: input.category,
        mediaType: input.mediaType,
        projectId: input.projectId,
        q: input.q,
        take: input.take,
      });
      const categoryCounts = await assetRepository.countByCategory({
        userId: ctx.user.id,
        scope: input.scope,
        mediaType: input.mediaType,
        projectId: input.projectId,
        q: input.q,
      });
      return {
        items: items.map((row) => ({
          id: row.id,
          name: row.name,
          mediaType: row.mediaType,
          category: row.category,
          scope: row.scope,
          projectId: row.projectId,
          subdir: row.subdir,
          localPath: row.localPath,
          width: row.width,
          height: row.height,
          prompt: row.prompt,
          createdAt: row.createdAt,
          hasParams: row.params !== null && row.params !== undefined,
        })),
        categories: categoryCounts,
      };
    }),

  /** 详情（含完整生成参数——详情弹窗与「按参数重新生成」都读它）。 */
  detail: authedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const row = await assetRepository.findOwned(input.id, ctx.user.id);
    if (row === null) {
      throw new TRPCError({ code: "NOT_FOUND", message: "资产不存在" });
    }
    return row;
  }),

  /**
   * 从历史任务入库：该任务的每张产物各成一条资产，产物文件**复制**进
   * `generated/assets/<assetId>/`（与任务生命周期解耦），并随行保存
   * 提交参数快照（`task.params`）与提示词 / 工作流名。
   */
  createFromTask: authedProcedure
    .input(
      z.object({
        taskId: z.string(),
        scope: scopeSchema,
        projectId: z.string().optional(),
        category: categorySchema,
        subdir: z.string().max(120).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.scope === "project" && (input.projectId === undefined || input.projectId === "")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "项目资产必须指定所属项目" });
      }
      const task = await taskRepository.findByIdWithImages(input.taskId);
      if (task?.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
      }
      if (task.images.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "该任务没有可入库的产物" });
      }
      const total = task.images.length;
      let created = 0;
      let duplicated = 0;
      for (const [index, image] of task.images.entries()) {
        const id = createId();
        const name = assetNameOf(task.prompt, task.workflowName, index, total);
        const projectId = input.scope === "project" ? (input.projectId ?? null) : null;
        /* 同一目录（分类 + 归属）里已收过这张产物时跳过（ISSUE #4937）：
           查重放在复制之前，重复加入不再产生多余的资产文件。 */
        // oxlint-disable-next-line no-await-in-loop -- 与下面的串行链同一条
        const isDuplicate = await assetRepository.findDuplicate({
          userId: ctx.user.id,
          sourceTaskId: task.id,
          name,
          category: input.category,
          scope: input.scope,
          projectId,
        });
        if (isDuplicate) {
          duplicated += 1;
          continue;
        }
        /* 逐张「复制 → 插行」必须串行（oxlint no-await-in-loop 豁免）：复制成功
           才插行，且每张的目录互不相干；SQLite 单写者下并行也不会更快。 */
        // oxlint-disable-next-line no-await-in-loop -- 复制成功才插行，顺序依赖
        const storedUrl = await copyIntoAssetStore(image.localPath, id);
        if (storedUrl === null) {
          /* 单张复制失败不阻断整批：已入库的保留，失败的跳过并计数，
             结果里如实回报（部分成功语义，规范 05 §接口契约）。 */
          continue;
        }
        // oxlint-disable-next-line no-await-in-loop -- 与上面的复制同一条串行链
        const rows = await assetRepository.createMany([
          {
            userId: ctx.user.id,
            id,
            name,
            mediaType: assetMediaTypeOf(storedUrl),
            category: input.category,
            scope: input.scope,
            projectId,
            subdir: input.subdir ?? null,
            localPath: storedUrl,
            width: image.width,
            height: image.height,
            sourceTaskId: task.id,
            prompt: task.prompt,
            negativePrompt: task.negativePrompt,
            params: task.params,
            workflowName: task.workflowName,
          },
        ]);
        firstRowRequired(rows, "资产入库");
        created += 1;
      }
      if (created === 0 && duplicated === 0) {
        /* 一张都没收进来且也不是重复（全是复制失败）——这才是真的入库失败；
           「全部重复」是正常结论，由 created/duplicated 如实回报（见下）。 */
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "资产入库失败" });
      }
      return { created, skipped: total - created - duplicated, duplicated };
    }),

  /** 删除：库行 + 资产文件目录（文件在资产自己的目录里，不影响原任务）。 */
  delete: authedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const row = await assetRepository.findOwned(input.id, ctx.user.id);
    if (row === null) {
      throw new TRPCError({ code: "NOT_FOUND", message: "资产不存在" });
    }
    await assetRepository.delete(row.id);
    await removeAssetStoreDir(row.id).catch(() => undefined);
    return { ok: true };
  }),
});
