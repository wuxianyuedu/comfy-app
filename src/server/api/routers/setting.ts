import { z } from "zod";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { getSettings, saveSettings } from "@/lib/app-settings";

export const settingRouter = createTRPCRouter({
  /** GET /api/settings */
  get: authedProcedure.query(async () => {
    const settings = await getSettings();
    return { settings };
  }),

  /** PUT /api/settings */
  save: authedProcedure
    .input(
      z.object({
        comfyuiUrl: z.string().url().optional(),
        trainerUrl: z
          .string()
          .refine((url) => url === "" || /^https?:\/\//.test(url))
          .optional(),
        defaultVideoWorkflow: z.enum(["auto", "txt2video", "img2video"]).optional(),
        comfyLorasDir: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await saveSettings(input);
      const settings = await getSettings();
      return { settings };
    }),
});