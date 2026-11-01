import { z } from "zod";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { modelRepository, userModelConfigRepository } from "~/lib/core/repository";
import { syncModels, modelCountsByFolder } from "~/lib/models";
import { listModelFolders, comfyBase } from "~/lib/comfyui/client";
import { probeBaseOnce } from "~/lib/comfyui/probe";
import { folderMeta } from "~/lib/model-types";

export const modelRouter = createTRPCRouter({
  /* GET /api/models —— 读：public model list */
  list: authedProcedure
    .input(z.object({ type: z.string().optional(), q: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const models = await modelRepository.list(input ?? {});
      return { models };
    }),

  /* POST /api/models/sync —— 新建：rescan model folders */
  sync: authedProcedure.mutation(async ({ ctx }) => {
    const count = await syncModels(ctx.user.id);
    return { ok: true, count };
  }),

  /* GET /api/models/config —— 读：per-folder availability config */
  configList: authedProcedure.query(async ({ ctx }) => {
    const [rows, comfyFolders, counts] = await Promise.all([
      userModelConfigRepository.listByUser(ctx.user.id),
      listModelFolders(),
      modelCountsByFolder(),
    ]);
    const overrides = new Map(rows.map((row) => [row.folder, row]));
    const folders = [...comfyFolders].sort().map((folder) => {
      const ov = overrides.get(folder);
      return {
        folder,
        type: folder,
        label: folderMeta(folder).label,
        enabled: ov?.enabled ?? false,
        hasConfig: Boolean(ov),
        count: counts[folder] ?? 0,
      };
    });
    /* 可达性走全库唯一口径 `probeBaseOnce`（**连上即存活**）。这里原本另搓了一份：
     * `fetch(comfyBase()).then(res => res.ok)` —— 探的是根路径、且把 HTTP 500 判成「没起」，
     * 正是 #685 收口掉的形态（显存爆掉的实例会被这里假报「未连接」，而设置页状态行判它
     * 「活着」，两屏互相矛盾）。地址仍取 `comfyBase()`，与上面 `listModelFolders()` 问的是
     * 同一个地址 ⇒ 两个答案不可能指向不同端口。 */
    const comfyReachable = (await probeBaseOnce(comfyBase())) !== null;
    return { folders, rows, comfyReachable };
  }),

  /* PATCH /api/models/config —— 局部更新：enable/disable a folder */
  configSave: authedProcedure
    .input(
      z.object({
        folder: z.string().min(1),
        enabled: z.boolean(),
        label: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.enabled) {
        await userModelConfigRepository.addOrEnable(ctx.user.id, input.folder, input.label ?? null);
      } else {
        await userModelConfigRepository.deleteForUser(ctx.user.id, input.folder);
      }
      return { ok: true };
    }),

  /* DELETE /api/models/config —— 删除 */
  configDelete: authedProcedure
    .input(z.object({ folder: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await userModelConfigRepository.deleteForUser(ctx.user.id, input.folder);
      return { ok: true };
    }),
});
