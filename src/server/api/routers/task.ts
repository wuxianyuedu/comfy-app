import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  authedProcedure,
  rateLimitedProcedure,
} from "~/server/api/trpc";
import { taskRepository } from "@/lib/core/repository";
import { kindOf } from "@/lib/media-kind";

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
  if (byName === "video" || byName === "audio") return byName;
  if (coverMediaType === "video") return "video";
  if (coverMediaType === "audio") return "audio";
  if (coverMediaType === "image") return "image";
  if (/video|2V$|^T2V|^I2V|FLF/i.test(taskType)) return "video";
  if (/audio|tts|voice/i.test(taskType)) return "audio";
  return "image";
}

export const taskRouter = createTRPCRouter({
  /** GET /api/tasks — list tasks */
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
            .map((status) => status.trim().toUpperCase())
            .filter(Boolean)
        : undefined;

      const overFetch = input.media
        ? Math.min(input.take * 4, 400)
        : input.take;

      const tasks = await taskRepository.listByUser(ctx.user.id, {
        projectId: input.projectId ?? undefined,
        take: overFetch,
        statusList: statusList ?? undefined,
        includeImages: true,
      });

      let list = tasks.map((task) => {
        const p = (task.params ?? {}) as Record<string, unknown>;
        const checkpoint =
          typeof p.checkpoint === "string" ? p.checkpoint : null;
        const cover = task.images[0]?.localPath ?? null;
        const coverMediaType = task.images[0]?.mediaType ?? null;
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
          projectId: task.projectId ?? null,
          progress: task.progress,
          error: task.error ?? null,
        };
      });

      if (input.media) {
        list = list.filter((list) => list.mediaType === input.media);
      }
      if (input.media) list = list.slice(0, input.take);

      return { tasks: list };
    }),

  /** GET /api/tasks/[id] */
  detail: authedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const task = await taskRepository.findByIdWithImages(input.id);
      if (task?.userId !== ctx.user.id) {
        throw new Error("Task not found");
      }
      return task;
    }),

  /** POST /api/tasks/[id]/cancel */
  cancel: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // 越权修复:与 detail/openFolder/delete 一致,cancel 必须校验
      // 任务归属——此前任意登录用户可用任意 taskId 取消他人任务。
      const task = await taskRepository.findByIdWithImages(input.id);
      if (task?.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
      }
      await taskRepository.cancel(input.id);
      return { ok: true };
    }),

  /** POST /api/tasks/[id]/open-folder 鈥?returns comfyapp:// URL for the task output dir */
  openFolder: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Returns the output directory path for the task
      const task = await taskRepository.findByIdWithImages(input.id);
      if (task?.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
      }
      const fsPromises = await import("fs/promises");
      const path = await import("path");
      const baseDir = path.join(process.cwd(), "public", "generated");
      const dir = task.projectId
        ? path.join(baseDir, "projects", task.projectId, input.id)
        : path.join(baseDir, input.id);
      // whitelist: resolved dir must stay under public/generated
      const normalized = path.resolve(dir);
      const normalizedBase = path.resolve(baseDir);
      if (
        normalized !== normalizedBase &&
        !normalized.startsWith(normalizedBase + path.sep)
      ) {
        throw new TRPCError({ code: "FORBIDDEN", message: "forbidden" });
      }
      let exists = false;
      try {
        const st = await fsPromises.stat(normalized);
        exists = st.isDirectory();
      } catch {
        exists = false;
      }
      if (!exists) {
        return {
          opened: false,
          error: "directory missing",
          absolutePath: normalized,
        };
      }
      return {
        opened: true,
        absolutePath: normalized,
        comfyappUrl: "comfyapp://open?path=" + encodeURIComponent(normalized),
      };
    }),

  /** GET /api/tasks/[id]/workflow — returns the workflow snapshot */
  workflow: authedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const task = await taskRepository.findSnapshotById(input.id);
      if (!task) throw new Error("Task not found");
      const snap = task.workflowSnapshot as {
        workflow?: unknown;
        capturedAt?: string;
        source?: string;
      } | null;
      return {
        workflow: snap?.workflow ?? null,
        source: snap?.source ?? null,
        capturedAt: snap?.capturedAt ?? null,
      };
    }),

  /** DELETE /api/tasks/[id] — delete task + its generated files on disk */
  delete: rateLimitedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const task = await taskRepository.findByIdWithImages(input.id);
      if (task?.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      }
      // Delete image files on disk as well.
      const fsPromises = await import("fs/promises");
      const path = await import("path");
      for (const img of task.images) {
        const full = path.join(
          process.cwd(),
          "public",
          img.localPath.replace(/^\//, ""),
        );
        fsPromises.unlink(full).catch(() => undefined);
      }
      const dir = path.join(process.cwd(), "public", "generated", input.id);
      fsPromises
        .rm(dir, { recursive: true, force: true })
        .catch(() => undefined);
      await taskRepository.delete(input.id);
      return { ok: true };
    }),
});
