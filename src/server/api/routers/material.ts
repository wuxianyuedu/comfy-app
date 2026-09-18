import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import {
  MATERIAL_FOLDERS,
  SHARED_SCOPE,
  collectByFolder,
  folderDir,
  isValidFolder,
  listScopes,
  sanitizeFileName,
  sanitizeScope,
  type MaterialItem,
} from "~/lib/media/materials";

async function resolveScopes(
  scopeMode: string | null,
  projectId: string | null,
): Promise<string[]> {
  if (scopeMode === "cross") {
    const all = await listScopes();
    return all.length ? all : projectId ? [projectId] : [];
  }
  const scopes: string[] = [];
  if (projectId) scopes.push(projectId);
  scopes.push(SHARED_SCOPE);
  return scopes;
}

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
    .query(async ({ input }) => {
      const projectId = sanitizeScope(input?.projectId ?? null);
      const scopeMode = input?.scope ?? null;
      const folder = input?.folder?.trim() ?? null;
      const q = input?.q?.trim().toLowerCase() ?? null;

      const scopes = await resolveScopes(scopeMode, projectId);

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
        items = pool.filter((it) => it.name.toLowerCase().includes(q));
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
    .mutation(async ({ input }) => {
      const folder = input.folder;
      if (!isValidFolder(folder)) throw new Error("Invalid folder");
      const scope =
        sanitizeScope(input.projectId ?? input.scope ?? null) ?? SHARED_SCOPE;
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
    .mutation(async ({ input }) => {
      if (!isValidFolder(input.folder)) throw new Error("Invalid folder");
      const scope =
        sanitizeScope(input.projectId ?? input.scope ?? null) ?? SHARED_SCOPE;
      const fileName = sanitizeFileName(input.name);
      if (!fileName) throw new Error("Invalid file name");

      const dir = folderDir(scope, input.folder);
      if (!dir) throw new Error("Invalid storage path");
      const filePath = path.join(dir, fileName);
      await fs.rm(filePath, { force: true });
      return { ok: true };
    }),
});
