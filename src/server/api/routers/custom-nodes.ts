import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { getSettingsSync } from "@/lib/app-settings/app-settings.server";

export const customNodeRouter = createTRPCRouter({
  /** GET /api/custom-nodes — list custom node manifest */
  list: authedProcedure.query(async () => {
    // Manifest file is written by the comfyui helper; fall back to empty list.
    const settings = getSettingsSync();
    return { nodes: [], settings };
  }),
});