import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { getSettingsSync } from "~/lib/app-settings/app-settings.server";

export const customNodeRouter = createTRPCRouter({
  /* GET /api/custom-nodes —— 读：list custom node manifest */
  list: authedProcedure.query(async () => {
    // manifest 文件由 comfyui 助手写出；拿不到就回落到空列表。
    const settings = getSettingsSync();
    return { nodes: [], settings };
  }),
});
