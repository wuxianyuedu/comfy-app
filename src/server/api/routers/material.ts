import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { matchesNeedle, normalizeNeedle } from "~/lib/list-filter";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import {
  MATERIAL_FOLDERS,
  SHARED_SCOPE,
  canWriteMaterialScope,
  collectByFolder,
  folderDir,
  isValidFolder,
  sanitizeFileName,
  sanitizeScope,
  visibleMaterialScopes,
  type MaterialItem,
} from "~/lib/media/materials";

export const materialRouter = createTRPCRouter({
  /* GET /api/materials?projectId=&scope=&folder=&q= —— 读 */
  list: authedProcedure
    .input(
      z
        .object({
          projectId: z.string().optional(),
          scope: z.string().optional(),
          folder: z.string().optional(),
          q: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const projectId = sanitizeScope(input?.projectId ?? null);
      const scopeMode = input?.scope ?? null;
      const folder = input?.folder?.trim() ?? null;
      /* 归一化走 `~/lib/list-filter`（规范 16 §16.2.4.16）—— 与 REST 路由的
       * 同一段是同一条账。 */
      const q = normalizeNeedle(input?.q ?? "") || null;

      const scopes = await visibleMaterialScopes(ctx.user.id, {
        cross: scopeMode === "cross",
        projectId,
      });

      const byFolder = await collectByFolder(scopes);
      const folders = MATERIAL_FOLDERS.map((MATERIAL_FOLDERS) => ({
        id: MATERIAL_FOLDERS.id,
        name: MATERIAL_FOLDERS.name,
        count: byFolder.get(MATERIAL_FOLDERS.id)?.length ?? 0,
      }));

      let items: MaterialItem[] = [];
      if (q) {
        const pool: MaterialItem[] = [];
        for (const f of MATERIAL_FOLDERS)
          pool.push(...(byFolder.get(f.id) ?? []));
        items = pool.filter((it) => matchesNeedle(q, it.name));
      } else if (folder) {
        if (!isValidFolder(folder)) {
          throw new Error("Invalid folder");
        }
        items = byFolder.get(folder) ?? [];
      }

      return { folders, items };
    }),

  /* POST /api/materials —— 新建：save a text material file */
  save: authedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        content: z.string(),
        folder: z.string().default("docs"),
        projectId: z.string().optional(),
        scope: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const folder = input.folder;
      if (!isValidFolder(folder)) throw new Error("Invalid folder");
      const scope =
        sanitizeScope(input.projectId ?? input.scope ?? null) ?? SHARED_SCOPE;
      // 归属闸与 `/api/materials` POST 同一份判据（`~/lib/media/materials`）。
      if (!(await canWriteMaterialScope(ctx.user.id, scope))) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "素材不存在或无权访问",
        });
      }
      const fileName = sanitizeFileName(input.name);
      if (!fileName) throw new Error("Invalid file name");

      const dir = folderDir(scope, folder);
      if (!dir) throw new Error("Invalid storage path");
      await fs.mkdir(dir, { recursive: true });

      const filePath = path.join(dir, fileName);
      await fs.writeFile(filePath, input.content, "utf-8");
      return { ok: true, path: filePath };
    }),

  /* DELETE /api/materials?name=&folder=&projectId= —— 删除 */
  delete: authedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        folder: z.string().default("docs"),
        projectId: z.string().optional(),
        scope: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isValidFolder(input.folder)) throw new Error("Invalid folder");
      const scope =
        sanitizeScope(input.projectId ?? input.scope ?? null) ?? SHARED_SCOPE;
      /* 归属判定必须在**碰磁盘之前**：这一条的副作用是 `fs.rm`，拦在响应阶段
       * 等于已经删完再报错（§11.2.1 的闸门判据）。 */
      if (!(await canWriteMaterialScope(ctx.user.id, scope))) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "素材不存在或无权访问",
        });
      }
      const fileName = sanitizeFileName(input.name);
      if (!fileName) throw new Error("Invalid file name");

      const dir = folderDir(scope, input.folder);
      if (!dir) throw new Error("Invalid storage path");
      const filePath = path.join(dir, fileName);
      await fs.rm(filePath, { force: true });
      return { ok: true };
    }),
});
