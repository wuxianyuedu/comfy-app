import { z } from "zod";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import {
  modelRepository,
  userModelConfigRepository,
} from "~/lib/core/repository";
import { syncModels, modelCountsByFolder } from "~/lib/models";
import { listModelFolders, comfyBase } from "~/lib/comfyui/client";
import { folderMeta } from "~/lib/model-types";

export const modelRouter = createTRPCRouter({
  /** GET /api/models — public model list */
  list: authedProcedure
    .input(
      z
        .object({ type: z.string().optional(), q: z.string().optional() })
        .optional(),
    )
    .query(async ({ input }) => {
      const models = await modelRepository.list(input ?? {});
      return { models };
    }),

  /** POST /api/models/sync — rescan model folders */
  sync: authedProcedure.mutation(async ({ ctx }) => {
    const count = await syncModels(ctx.user.id);
    return { ok: true, count };
  }),

  /** GET /api/models/config — per-folder availability config */
  configList: authedProcedure.query(async ({ ctx }) => {
    const [rows, comfyFolders, counts] = await Promise.all([
      userModelConfigRepository.listByUser(ctx.user.id),
      listModelFolders(),
      modelCountsByFolder(),
    ]);
    const overrides = new Map(rows.map((row) => [row.folder, row]));
    const folders = comfyFolders
      .slice()
      .sort()
      .map((folder) => {
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
    const comfyReachable = await fetch(comfyBase(), {
      signal: AbortSignal.timeout(3000),
    })
      .then((res) => res.ok)
      .catch(() => false);
    return { folders, rows, comfyReachable };
  }),

  /** PATCH /api/models/config — enable/disable a folder */
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
        await userModelConfigRepository.addOrEnable(
          ctx.user.id,
          input.folder,
          input.label ?? null,
        );
      } else {
        await userModelConfigRepository.deleteForUser(
          ctx.user.id,
          input.folder,
        );
      }
      return { ok: true };
    }),

  /** DELETE /api/models/config */
  configDelete: authedProcedure
    .input(z.object({ folder: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await userModelConfigRepository.deleteForUser(ctx.user.id, input.folder);
      return { ok: true };
    }),
});
