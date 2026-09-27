import { upperToken } from "~/lib/upper-token";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  authedProcedure,
  rateLimitedProcedure,
} from "~/server/api/trpc";
import { taskRepository } from "~/lib/core/repository";
import { kindOf } from "~/lib/media/media-kind";

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
      };

      if (!input.media) {
        return { tasks: await scanOnce(0) };
      }

      type Card = Awaited<ReturnType<typeof scanOnce>>[number];
      const matched: Card[] = [];
      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        const page = await scanOnce(round * PAGE);
        for (const card of page) {
          if (card.mediaType === input.media) matched.push(card);
          if (matched.length >= PAGE) break;
        }
        if (matched.length >= PAGE || page.length < PAGE) break;
      }
      return { tasks: matched };
    }),

  /* GET /api/tasks/[id] —— 读 */
  detail: authedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const task = await taskRepository.findByIdWithImages(input.id);
      if (task?.userId !== ctx.user.id) {
        throw new Error("Task not found");
      }
      return task;
    }),

  /* POST /api/tasks/[id]/cancel —— 新建 */
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
      // 返回该任务的产物目录路径
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
      // 白名单：解析后的目录必须留在 public/generated 之下
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

  /* GET /api/tasks/[id]/workflow —— 读：returns the workflow snapshot */
  workflow: authedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const owner = await taskRepository.findByIdWithImages(input.id);
      if (owner?.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      }
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

  /* DELETE /api/tasks/[id] —— 删除：delete task + its generated files on disk */
  delete: rateLimitedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const task = await taskRepository.findByIdWithImages(input.id);
      if (task?.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      }
      // 磁盘上的图片文件也一并删掉。
      const fsPromises = await import("fs/promises");
      const path = await import("path");
      const publicRoot = path.resolve(process.cwd(), "public");
      for (const img of task.images) {
        const full = path.resolve(
          publicRoot,
          img.localPath.replace(/^\/+/, ""),
        );
        if (full !== publicRoot && !full.startsWith(publicRoot + path.sep)) {
          continue;
        }
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
