import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, authedProcedure, rateLimitedProcedure } from "~/server/api/trpc";
import { taskRepository } from "@/lib/core/repository";

const VIDEO_EXT = /\.(mp4|webm|mov|mkv|avi|gif)$/i;
const AUDIO_EXT = /\.(wav|mp3|flac|ogg|m4a|aac)$/i;

function inferMediaType(
  coverPath: string | null,
  coverMediaType: string | null,
  taskType: string
): "image" | "video" | "audio" {
  if (coverPath) {
    if (AUDIO_EXT.test(coverPath)) return "audio";
    if (VIDEO_EXT.test(coverPath)) return "video";
  }
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
        .optional()
        .default({})
    )
    .query(async ({ ctx, input }) => {
      const statusList = input.status
        ? input.status.split(",").map((status) => status.trim().toUpperCase()).filter(Boolean)
        : undefined;

      const overFetch = input.media ? Math.min(input.take * 4, 400) : input.take;

      const tasks = await taskRepository.listByUser(ctx.user.id, {
        projectId: input.projectId ?? undefined,
        take: overFetch,
        statusList: statusList ?? undefined,
        includeImages: true,
      });

      let list = tasks.map((task) =>
{
        const p = (task.params as Record<string, any>) ?? {};
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
          checkpoint: p.checkpoint ?? null,
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
      if (!task || task.userId !== ctx.user.id) {
        throw new Error("Task not found");
      }
      return task;
    }),

  /** POST /api/tasks/[id]/cancel */
  cancel: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await taskRepository.cancel(input.id);
      return { ok: true };
    }),

  /** POST /api/tasks/[id]/open-folder 鈥?returns comfyapp:// URL for the task output dir */
  openFolder: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Returns the output directory path for the task
      const task = await taskRepository.findByIdWithImages(input.id);
      if (!task || task.userId !== ctx.user.id) {
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
      const snap = task.workflowSnapshot as
        | { workflow?: unknown; capturedAt?: string; source?: string }
        | null;
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
      if (!task || task.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      }
      // Delete image files on disk as well.
      const fsPromises = await import("fs/promises");
      const path = await import("path");
      for (const img of task.images) {
        const full = path.join(process.cwd(), "public", img.localPath.replace(/^\//, ""));
        fsPromises.unlink(full).catch(() => {});
      }
      const dir = path.join(process.cwd(), "public", "generated", input.id);
      fsPromises.rm(dir, { recursive: true, force: true }).catch(() => {});
      await taskRepository.delete(input.id);
      return { ok: true };
    }),
});