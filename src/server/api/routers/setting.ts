import { z } from "zod";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { getSettings, getSettingsSync, saveSettings } from "@/lib/app-settings";
import {
  ensureComfyUiReady,
  isComfyStarting,
  probeComfyUi,
  stopComfyUiProcess,
} from "@/lib/comfyui/lifecycle";
import { classifyComfyInstall } from "@/lib/comfyui/instance-kind";
import {
  ensureDrizzleStudioUp,
  isDrizzleStudioStarting,
  openDrizzleStudio,
  probeDrizzleStudio,
  stopDrizzleStudio,
  DRIZZLE_STUDIO_DEFAULT_PORT,
} from "@/lib/drizzle-studio/lifecycle";

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
        exitKillComfyui: z.boolean().optional(),
        exitKillOllama: z.boolean().optional(),
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
    // 形态识别：配置好路径后返回 桌面版/便携版/venv，供设置页展示徽标并按形态
    // 决定是否隐藏 端口/启动参数 输入（桌面版由 Comfy Desktop 元数据决定）。
    let instanceType: "desktop" | "portable" | "venv" | "unknown" | null = null;
    let desktopManaged = false;
    if (settings.comfyuiPath?.trim()) {
      const c = classifyComfyInstall(settings.comfyuiPath);
      instanceType = c.kind === "unknown" ? null : c.kind;
      // desktopManaged = 桌面实例且能读到实例 ID（端口/参数走元数据，非手填）。
      desktopManaged = c.kind === "desktop" && !!c.instanceIdFile;
    }
    return {
      up: !!base,
      base,
      starting: isComfyStarting(),
      pathConfigured: !!settings.comfyuiPath,
      autoStart: settings.comfyuiAutoStart,
      path: settings.comfyuiPath,
      port: settings.comfyuiPort,
      instanceType,
      desktopManaged,
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

  /** Drizzle Studio 运行状态（设置页「数据库」分区）。
   *  探测失败按「未运行」降级返回而非抛错——状态查询挂了会把三个按钮
   *  全部禁成不可点（#92），宁可显示未运行让用户能点「启动」。 */
  dbStudioStatus: authedProcedure.query(async () => {
    const port = DRIZZLE_STUDIO_DEFAULT_PORT;
    const up = await probeDrizzleStudio(port).catch(() => false);
    return { up, port, starting: isDrizzleStudioStarting() };
  }),

  /** 启动 Drizzle Studio（设置页按钮）：未运行时解析 drizzle-kit 并拉起等待就绪 */
  dbStudioStart: authedProcedure.mutation(async () => {
    return ensureDrizzleStudioUp();
  }),

  /** 关闭 Drizzle Studio（设置页按钮）：杀整棵进程树 */
  dbStudioStop: authedProcedure.mutation(async () => {
    return stopDrizzleStudio();
  }),

  /** 用系统默认浏览器打开 Drizzle Studio 回连地址 */
  dbStudioOpen: authedProcedure.mutation(async () => {
    return openDrizzleStudio();
  }),
});
