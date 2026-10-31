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
      const statusList = input.status
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
          const p = /* SAFETY: 类型断言已复核 */ (task.params ?? {}) as Record<string, unknown>;
          const checkpoint = typeof p.checkpoint === "string" ? p.checkpoint : null;
          const cover = task.images[0]?.localPath ?? null;
          const coverMediaType = task.images[0]?.mediaType ?? null;
          /* 视频落点**只有服务端答得了**：封面（`images[0]`）通常是预览图，
           * 它的 `cover` / `mediaType` 都指向那张图，看不出成片在哪。执行侧落盘
           * 顺序是「先 images 后 videos」，因此成片不在首位 —— 必须单独找。
           * 判据按**磁盘上的事实**：扩展名（`isVideo`，见 `lib/media/media-kind`）
           * **或**产物子表的 `mediaType` —— 后者管住「落盘名不带视频扩展名、但
           * 执行侧记了它是视频」的那一档，只看扩展名会把它漏成 `null`。 */
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
    /* 取消的统一出口（P3 §5 ADR §14 D2）：走执行侧那份 `cancelTask`，而不是
     * 只把行写成 CANCELLED。区别对用户可感三件事——① 落一行「用户取消任务」
     * 进执行日志（只写状态时面板上看不到原因）；② 这一行正占着 ComfyUI 执行位
     * 时请求中断，不再「按了取消还继续出图」；③ 归还本进程的并发槽并清理记账。
     * 归属在 host 名下时也有效：跨归属的只是状态标记与全局中断，kill 在飞子进程
     * 仍由 host 自己的 tick 负责（executor-host.mjs 的 reconcileCancelled）。 */
    await cancelExecutorTask(input.id);
    return { ok: true };
  }),

  /* 「原样重跑」（#2481 · FR-QA-04③ 的历史面落点）：按**原任务行**重建一个
   * QUEUED 任务（新 taskId，不复活旧行）。执行载荷用原行的 `execPayload`
   * （提交时刻的 RAW 原件），语义是「复现当时那次提交」——模板后来改了 / 删了
   * 都不影响这一格；要用新模板语义请去创作台重新生成。提示词 / 参数 / 归属
   * （project / shot）/ 参考图逐字复制。
   *
   * 参考图语义（如实）：`referenceImages` 存的是 ComfyUI input 侧的持久文件名，
   * 重跑原样复用；ComfyUI 侧文件被清理时任务会在 LoadImage 节点失败并进任务
   * 日志 —— 失败可见，不是静默缺图（原始本地文件只在客户端，服务端没有可重传的源）。
   *
   * 只放行**终态**任务：QUEUED / RUNNING 本来就在跑，重跑是制造第二份。
   */
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
      if (!dir) {
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
    const snap = /* SAFETY: 类型断言已复核 */ task.workflowSnapshot as {
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
      /* 产物目录整体删除，目录与落盘侧共用 `taskOutputDir()` 这一份定义。
       *
       * 旧写法在这里有两处各自拼错的拼接，而两条失败都被
       * `.catch(() => undefined)` 吞掉（磁盘一直在涨、日志里一个字都没有）：
       *  · 目录只拼 `public/generated/<taskId>`，而 project 任务的产物实际落在
       *    `projects/<projectId>/<taskId>` 下 —— 在画布里删任务永远删不到目录；
       *  · 又按 `TaskImage.localPath` 逐张 unlink，却把 `/api/generated/...`
       *    解析成 `public/api/generated/...`（多了一段 `api`）→ 每次都是 ENOENT。
       * 现在只留「删整个产物目录」这一条：落盘侧保证每张产物都在该目录内
       * （同一个 segments 派生），逐张删反而可能碰目录之外的文件。
       * 越界（id / projectId 形状会把结果甩出产物根）时只删库行并把原因落日志，
       * 不允许把一个根外路径交给 `fs.rm(..., { recursive: true })`。 */
      const dir = taskOutputDir(input.id, task.projectId);
      if (!dir) {
        logger.warn(
          `[task.delete] 产物目录越界，只删库行不动磁盘：taskId=${input.id} projectId=${task.projectId}`,
        );
      } else {
        fsPromises
          .rm(dir, { recursive: true, force: true })
          .catch((error: unknown) =>
            logger.warn(
              `[task.delete] 产物目录没删掉（库行照删）：${dir} — ${errorMessage(error, String(error))}`,
            ),
          );
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
