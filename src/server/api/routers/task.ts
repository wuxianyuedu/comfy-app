import { upperToken } from "~/lib/upper-token";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, authedProcedure, rateLimitedProcedure } from "~/server/api/trpc";
import { taskRepository } from "~/lib/core/repository";
import { logger } from "~/lib/core/logger";
import { errorMessage } from "~/lib/error-message";
import { taskOutputDir } from "~/lib/media/output-paths";
import { cancelTask as cancelExecutorTask } from "~/lib/comfyui/enqueue";
import { kickQueue } from "~/lib/comfyui/executor-continuation";
import { resolveExecutorClaim } from "~/lib/comfyui/executor-mode";
import { isVideo, kindOf } from "~/lib/media/media-kind";

/* 扩展名判据已收敛到 `media-kind.ts`（ISSUE #571）。此前这里自带一份清单，
 * 且与 `lib/media.ts` 的注释**直接矛盾**——那边明确写「gif 不是视频，`<video>`
 * 解不了 GIF 会黑屏」，这边却把 gif 判成视频。 */
function inferMediaType(
  coverPath: string | null,
  coverMediaType: string | null,
  taskType: string,
): "image" | "video" | "audio" {
  /* 文件事实（扩展名）优先于元数据（mediaType），元数据优先于任务类型推断：
   * 越靠前的来源越接近「磁盘上到底是什么」。 */
  const byName = kindOf(coverPath);
  if (byName === "video" || byName === "audio") {
    return byName;
  }
  if (coverMediaType === "video") {
    return "video";
  }
  if (coverMediaType === "audio") {
    return "audio";
  }
  if (coverMediaType === "image") {
    return "image";
  }
  if (/video|2V$|^T2V|^I2V|FLF/i.test(taskType)) {
    return "video";
  }
  if (/audio|tts|voice/i.test(taskType)) {
    return "audio";
  }
  return "image";
}

export const taskRouter = createTRPCRouter({
  /* GET /api/tasks —— 读：list tasks */
  list: authedProcedure
    .input(
      z
        .object({
          take: z.number().int().min(1).max(200).optional().default(60),
          projectId: z.string().optional(),
          media: z.enum(["image", "video", "audio"]).optional(),
          status: z.string().optional(),
        })
        .default({ take: 60 }),
    )
    .query(async ({ ctx, input }) => {
      const statusList =
        input.status !== undefined && input.status !== ""
          ? input.status
              .split(",")
              .map((status) => upperToken(status))
              .filter(Boolean)
          : undefined;

      const PAGE = input.take;
      /* media 过滤的判据（`inferMediaType`）依赖首图扩展名等应用层解析，
       * 纯 SQL 复刻不了，内存过滤保留；但把原先「固定 ×4（最多 400 行，
       * 含大 JSON 关联）」改成**迭代补页**——大多数请求第 1 页就凑满，
       * 不再无条件把 400 行拉回来。扫描行数上限与旧版对齐（400）。 */
      const MAX_ROUNDS = Math.ceil(400 / PAGE);

      const scanOnce = async (skip: number) => {
        const tasks = await taskRepository.listByUser(ctx.user.id, {
          projectId: input.projectId ?? undefined,
          take: PAGE,
          skip,
          statusList: statusList ?? undefined,
          includeImages: true,
        });
        return tasks.map((task) => {
          /* SAFETY: 类型断言已复核 */
          const p = (task.params ?? {}) as Record<string, unknown>;
          const checkpoint = typeof p.checkpoint === "string" ? p.checkpoint : null;
          const cover = task.images[0]?.localPath ?? null;
          const coverMediaType = task.images[0]?.mediaType ?? null;
          /* 视频落点只有服务端答得了：封面（`images[0]`）通常是预览图，成片不在首位（执行侧
           * 「先 images 后 videos」）。判据按磁盘事实：扩展名（`isVideo`）**或**产物子表 `mediaType`
           * —— 后者管住「落盘名不带视频扩展名、但记了是视频」那档，只看扩展名会漏成 `null`。 */
          const videoPath =
            task.images.find((image) => isVideo(image.localPath) || image.mediaType === "video")
              ?.localPath ?? null;
          return {
            id: task.id,
            type: task.type,
            workflowName: task.workflowName,
            status: task.status,
            prompt: task.prompt,
            createdAt: task.createdAt,
            cover,
            checkpoint,
            mediaType: inferMediaType(cover, coverMediaType, task.type),
            videoPath,
            projectId: task.projectId ?? null,
            progress: task.progress,
            error: task.error ?? null,
          };
        });
      };

      if (!input.media) {
        return { tasks: await scanOnce(0) };
      }

      type Card = Awaited<ReturnType<typeof scanOnce>>[number];
      const matched: Array<Card> = [];
      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
        const page = await scanOnce(round * PAGE);
        for (const card of page) {
          if (card.mediaType === input.media) {
            matched.push(card);
          }
          if (matched.length >= PAGE) {
            break;
          }
        }
        if (matched.length >= PAGE || page.length < PAGE) {
          break;
        }
      }
      return { tasks: matched };
    }),

  /* GET /api/tasks/[id] —— 读 */
  detail: authedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const task = await taskRepository.findByIdWithImages(input.id);
    if (task?.userId !== ctx.user.id) {
      throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
    }
    return task;
  }),

  /* POST /api/tasks/[id]/cancel —— 新建 */
  cancel: authedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    // 越权修复:与 detail/openFolder/delete 一致,cancel 必须校验
    // 任务归属——此前任意登录用户可用任意 taskId 取消他人任务。
    const task = await taskRepository.findByIdWithImages(input.id);
    if (task?.userId !== ctx.user.id) {
      throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
    }
    /* 取消统一出口（P3 §5 ADR §14 D2）：走执行侧 `cancelTask` 而非只把行写成 CANCELLED ——
     * ① 执行日志落「用户取消任务」；② 正占 ComfyUI 执行位时请求中断，不再「按了还继续出图」；
     * ③ 归还本进程并发槽并清理记账。host 归属下同样有效，在飞子进程 kill 仍由 host 的 tick
     * 负责（`executor-host.mjs` 的 reconcileCancelled）。 */
    await cancelExecutorTask(input.id);
    return { ok: true };
  }),

  /* 「原样重跑」（#2481 · FR-QA-04③）：按原任务行重建 QUEUED（新 taskId，不复活旧行）。执行载荷
   * 用原行 `execPayload`（提交时刻 RAW 原件），语义是复现当时那次提交，模板后来改动/删除都不影响；
   * 提示词/参数/归属/参考图逐字复制。参考图是 ComfyUI input 侧持久文件名，被清理时会在 LoadImage
   * 失败并进任务日志（可见，非静默缺图）。只放行终态任务：QUEUED/RUNNING 重跑会造第二份。 */
  retry: authedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const original = await taskRepository.findByIdForUser(ctx.user.id, input.id);
    if (!original) {
      throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
    }
    if (original.status === "QUEUED" || original.status === "RUNNING") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "任务还在排队或执行中，不需要重试（可在队列监视里观察）",
      });
    }
    if (!original.execPayload) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "这一行没有执行载荷（execPayload 为空的历史遗留行），无法原样重跑：请到创作台重新生成",
      });
    }
    const created = await taskRepository.createQueued({
      userId: ctx.user.id,
      type: original.type,
      prompt: original.prompt,
      negativePrompt: original.negativePrompt,
      params: original.params,
      workflowName: original.workflowName,
      projectId: original.projectId,
      shotId: original.shotId,
      referenceImages: original.referenceImages ?? undefined,
      workflowSnapshot: original.workflowSnapshot ?? undefined,
      claimedBy: resolveExecutorClaim(),
      execPayload: original.execPayload,
    });
    /* 与 generate 同一口径：只写行，kick 只是省掉等派发节拍（ADR §14 D1）。 */
    kickQueue();
    return { taskId: created.id };
  }),

  /** 打开产物目录：返回 comfyapp:// 深链（协议未注册时的引导见 openTaskFolder）。 */
  openFolder: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // 返回该任务的产物目录路径
      const task = await taskRepository.findByIdWithImages(input.id);
      if (task?.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
      }
      const fsPromises = await import("node:fs/promises");
      /* 目录由 `taskOutputDir()` 一处算：形状会让它落到产物根之外（例如客户端
       * 生成的 projectId 写成 `../../x`）时返回 null → 这里按越界处置。
       * 旧写法在本处内联拼路径 + 内联白名单，与 `delete` 那份已经分叉，见
       * `~/lib/media/output-paths.ts` 的模块注释。 */
      const dir = taskOutputDir(input.id, task.projectId);
      if (dir === null) {
        logger.warn(
          `[task.openFolder] 产物目录越界，已拒绝：taskId=${input.id} projectId=${task.projectId}`,
        );
        throw new TRPCError({ code: "FORBIDDEN", message: "forbidden" });
      }
      let exists;
      try {
        const st = await fsPromises.stat(dir);
        exists = st.isDirectory();
      } catch {
        exists = false;
      }
      if (!exists) {
        return { opened: false, error: "directory missing", absolutePath: dir };
      }
      return {
        opened: true,
        absolutePath: dir,
        comfyappUrl: `comfyapp://open?path=${encodeURIComponent(dir)}`,
      };
    }),

  /* GET /api/tasks/[id]/workflow —— 读：returns the workflow snapshot */
  workflow: authedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const owner = await taskRepository.findByIdWithImages(input.id);
    if (owner?.userId !== ctx.user.id) {
      throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
    }
    const task = await taskRepository.findSnapshotById(input.id);
    if (!task) {
      throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
    }
    /* SAFETY: 类型断言已复核 */
    const snap = task.workflowSnapshot as {
      capturedAt?: string;
      source?: string;
      workflow?: unknown;
    } | null;
    return {
      workflow: snap?.workflow ?? null,
      source: snap?.source ?? null,
      capturedAt: snap?.capturedAt ?? null,
    };
  }),

  /* DELETE /api/tasks/[id] —— 删除：delete task + its generated files on disk */
  delete: rateLimitedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const task = await taskRepository.findByIdWithImages(input.id);
      if (task?.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
      }
      const fsPromises = await import("node:fs/promises");
      /* 产物目录整体删除，目录与落盘侧共用 `taskOutputDir()`。旧写法两处拼错路径且都被
       * `.catch(() => undefined)` 吞掉（磁盘在涨、日志空白）：目录只拼 `public/generated/<taskId>`
       * 漏掉 `projects/<projectId>/<taskId>`；按 `localPath` 逐张 unlink 又把 `/api/generated`
       * 解析成 `public/api/generated` ⇒ ENOENT。越界时只删库行并记原因，不把根外路径交给 rm。 */
      const dir = taskOutputDir(input.id, task.projectId);
      if (dir === null) {
        logger.warn(
          `[task.delete] 产物目录越界，只删库行不动磁盘：taskId=${input.id} projectId=${task.projectId}`,
        );
      } else {
        fsPromises.rm(dir, { recursive: true, force: true }).catch((error: unknown) => {
          logger.warn(
            `[task.delete] 产物目录没删掉（库行照删）：${dir} — ${errorMessage(error, String(error))}`,
          );
        });
      }
      await taskRepository.delete(input.id);
      return { ok: true };
    }),

  /**
   * 人工评分 / 收藏一张产物图（FR-QA-07 人工侧 · #2480）：rating 0~5（null = 清除）、
   * favorite 布尔。rating 是校准读数（`run.reviewCalibration`）的人侧输入；
   * favorite 是「优秀样本进 few-shot」沉淀机制的输入。图不存在 → NOT_FOUND。
   */
  setImageFeedback: authedProcedure
    .input(
      z.object({
        imageId: z.string().min(1),
        humanRating: z.number().int().min(0).max(5).nullable(),
        isFavorite: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const image = await taskRepository.findImageById(input.imageId);
      if (image?.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "找不到这张产物图",
        });
      }
      await taskRepository.patchImageFeedback(input.imageId, {
        humanRating: input.humanRating,
        isFavorite: input.isFavorite,
      });
      return { ok: true };
    }),
});
