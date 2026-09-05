import { z } from "zod";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { getSettings, getSettingsSync, saveSettings } from "@/lib/app-settings";
import {
  ensureComfyUiReady,
  isComfyStarting,
  probeComfyUi,
  stopComfyUiProcess,
} from "@/lib/comfyui/lifecycle";

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
        comfyuiUrl: z.url().optional(),
        comfyuiPort: z.number().int().min(0).max(65535).optional(),
        trainerUrl: z
          .string()
          .refine((url) => url === "" || /^https?:\/\//.test(url))
          .optional(),
        defaultVideoWorkflow: z.enum(["auto", "txt2video", "img2video"]).optional(),
        comfyLorasDir: z.string().optional(),
        comfyuiPath: z.string().optional(),
        comfyuiExtraArgs: z.string().optional(),
        comfyuiAutoStart: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      await saveSettings(input);
      const settings = await getSettings();
      return { settings };
    }),

  /** ComfyUI 运行状态（设置页状态行 / 启动按钮旁） */
  comfyStatus: authedProcedure.query(async () => {
    const settings = getSettingsSync();
    const base = await probeComfyUi(2000);
    return {
      up: !!base,
      base,
      starting: isComfyStarting(),
      pathConfigured: !!settings.comfyuiPath,
      autoStart: settings.comfyuiAutoStart,
      path: settings.comfyuiPath,
      port: settings.comfyuiPort,
    };
  }),

  /** 手动启动 ComfyUI（设置页按钮）：未运行时按配置路径拉起并等待就绪。
   *  不传 timeoutMs = 不设硬超时——冷加载慢没有准数，误报「启动超时」时
   *  ComfyUI 随后就绪了；用户看得到实时启动日志，可随时手动关闭中止。 */
  comfyStart: authedProcedure
    .input(z.object({ timeoutMs: z.number().int().min(5000).max(600000).optional() }))
    .mutation(async ({ input }) => {
      const r = await ensureComfyUiReady({ timeoutMs: input.timeoutMs });
      return r;
    }),

  /** 手动关闭 ComfyUI（设置页按钮）：杀整棵进程树。
   *  硬规则：cmd/pnpm 外壳单杀会留下 node/python 孤儿锁端口，
   *  Windows 必须 taskkill /T /F，POSIX 用 kill(-pid)。 */
  comfyStop: authedProcedure.mutation(async () => {
    return stopComfyUiProcess();
  }),
});
