import { z } from "zod";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { modelRepository } from "~/lib/core/repository";
import { syncModels, modelCountsByFolder } from "~/lib/models";
import { listModelFolders, comfyBase } from "~/lib/comfyui/client";
import { probeBaseOnce } from "~/lib/comfyui/probe";
import { folderMeta, isModelFolder } from "~/lib/model-types";
import { getSettingsSync } from "~/lib/app-settings/app-settings.server";

export const modelRouter = createTRPCRouter({
  /* GET /api/models —— 读：public model list */
  list: authedProcedure
    .input(z.object({ type: z.string().optional(), q: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const models = await modelRepository.list(input ?? {});
      return { models };
    }),

  /* POST /api/models/sync —— 新建：rescan model folders */
  sync: authedProcedure.mutation(async () => {
    const count = await syncModels();
    return { ok: true, count };
  }),

  /* GET /api/models/config —— 读：ComfyUI 的目录清单（全部目录默认启用）。
   * 非模型用途的目录在这里同刀排除（判据与同步共用 `isModelFolder`，ISSUE #3368
   * —— 否则「Custom Nodes」会以 count=0 挂在目录列上）。
   * `comfyuiPathConfigured` 让模型库空态能区分「没配路径」与「已配置但没模型」；
   * 可达性走全库唯一口径 `probeBaseOnce`（连上即存活，见 ISSUE #685）。 */
  configList: authedProcedure.query(async () => {
    const [comfyFoldersRaw, counts] = await Promise.all([
      listModelFolders(),
      modelCountsByFolder(),
    ]);
    const comfyFolders = comfyFoldersRaw.filter(isModelFolder);
    const folders = [...new Set(comfyFolders)].sort().map((folder) => ({
      folder,
      type: folder,
      label: folderMeta(folder).label,
      count: counts[folder] ?? 0,
    }));
    const comfyReachable = (await probeBaseOnce(comfyBase())) !== null;
    /* 设置文件 JSON.parse 后可显式写 null，运行期值不在类型里，故先落到 `unknown` 再窄化。 */
    const configuredPath: unknown = getSettingsSync().comfyuiPath;
    const comfyuiPathConfigured =
      typeof configuredPath === "string" && configuredPath.trim().length > 0;
    return { folders, comfyReachable, comfyuiPathConfigured };
  }),
});
