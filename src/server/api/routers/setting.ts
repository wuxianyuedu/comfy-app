import { z } from "zod";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import {
  getSettings,
  getSettingsSync,
  saveSettings,
} from "~/lib/app-settings/app-settings.server";
import {
  clearComfyAutoStartFailure,
  clearComfyManualStop,
  ensureComfyUiReady,
  getComfyUiStatus,
  openComfyUi,
  stopComfyUiProcess,
} from "~/lib/comfyui/lifecycle";
import { classifyComfyInstall } from "~/lib/comfyui/instance-kind";
import {
  decideComfyTabOpen,
  probeComfyEmbeddable,
} from "~/lib/comfy/comfy-embed";
import {
  ensureDrizzleStudioUp,
  isDrizzleStudioStarting,
  openDrizzleStudio,
  probeDrizzleStudio,
  stopDrizzleStudio,
  DRIZZLE_STUDIO_DEFAULT_PORT,
} from "~/lib/drizzle-studio/lifecycle";
import { openUrlInBrowser } from "~/lib/shell/open-in-browser";

export const settingRouter = createTRPCRouter({
  /* GET /api/settings —— 读 */
  get: authedProcedure.query(async () => {
    const settings = await getSettings();
    return { settings };
  }),

  /* PUT /api/settings —— 更新 */
  save: authedProcedure
    .input(
      z.object({
        comfyuiPort: z.number().int().min(0).max(65535).optional(),
        trainerUrl: z
          .string()
          .refine((url) => url === "" || /^https?:\/\//.test(url))
          .optional(),
        comfyLorasDir: z.string().optional(),
        comfyuiPath: z.string().optional(),
        comfyuiExtraArgs: z.string().optional(),
        comfyuiAutoStart: z.boolean().optional(),
        exitKillComfyui: z.boolean().optional(),
        exitKillOllama: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      await saveSettings(input);
      // 用户显式（重新）开启自动启动 = 授权自动拉起：清掉上次「手动关闭
      // 后不自动启动」的闩锁，让自动启动恢复生效（ISSUE #290）。
      if (input.comfyuiAutoStart === true) clearComfyManualStop();
      // 改「安装路径 / 启动参数」是把上次「启动失败」的成因改掉了：清掉
      // 「失败后不再重试」的闩锁，让自动启动重新尝试（否则用户修好了路径，
      // 却因为老闩锁一直不重试，还得再手动点一次启动）（ISSUE #335）。
      if (
        input.comfyuiPath !== undefined ||
        input.comfyuiExtraArgs !== undefined
      ) {
        clearComfyAutoStartFailure();
      }
      const settings = await getSettings();
      return { settings };
    }),

  /** ComfyUI 运行状态（设置页状态行 / 启动按钮旁） */
  comfyStatus: authedProcedure.query(async () => {
    const settings = getSettingsSync();
    /* 状态结论统一由 getComfyUiStatus 给出（进程级快照 + HTTP 探测合并）：
     * 只看 HTTP 探测会把「外部已启动但接口未就绪」的实例误报成未运行，并让
     * 状态行先落到「未运行」再跳「运行中」（ISSUE #339）。 */
    const status = await getComfyUiStatus();
    const base = status.base;
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
      up: status.up,
      base,
      // 「启动中」也包含「进程在但端口未绑定」（外部实例正在加载）：状态行据此
      // 显示启动中而不是未运行。
      starting: status.starting,
      // 探测仍在进行/事实不可信：UI 显示「检测中…」，不要先报「未运行」。
      probing: status.probing,
      // 「关闭中」窗口（服务端 globalThis 计时）：状态行/按钮据此保持关闭进行态，
      // 替代无法跨挂载存活的 React 本地 state（ISSUE #103）。
      stopping: status.stopping,
      /* 进程级快照补充信息：命中但 HTTP 未就绪时端口仍有值，状态行可提示
       * 「端口监听中」；via 说明这个实例是怎么起来的（排查「不是我起的」）。 */
      port: status.port ?? settings.comfyuiPort,
      via: status.via ?? null,
      pathConfigured: !!settings.comfyuiPath,
      autoStart: settings.comfyuiAutoStart,
      path: settings.comfyuiPath,
      instanceType,
      desktopManaged,
    };
  }),

  /** 手动启动 ComfyUI（设置页按钮）：未运行时按配置路径拉起并等待就绪。
   *  不传 timeoutMs = 不设硬超时——冷加载慢没有准数，误报「启动超时」时
   *  ComfyUI 随后就绪了；用户看得到实时启动日志，可随时手动关闭中止。 */
  comfyStart: authedProcedure
    .input(
      z.object({
        timeoutMs: z.number().int().min(5000).max(600000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      // 手动启动＝用户明确要求拉起：manual:true 会先清掉「手动关闭后不自动
      // 启动」闩锁，确保这次手动启动不被上次手动关闭拦住（ISSUE #290）。
      const r = await ensureComfyUiReady({
        timeoutMs: input.timeoutMs,
        manual: true,
      });
      return r;
    }),

  /** 手动关闭 ComfyUI（设置页按钮）：杀整棵进程树。
   *  硬规则：cmd/pnpm 外壳单杀会留下 node/python 孤儿锁端口，
   *  Windows 必须 taskkill /T /F，POSIX 用 kill(-pid)。 */
  comfyStop: authedProcedure.mutation(async () => {
    return stopComfyUiProcess();
  }),

  /** 用系统默认浏览器打开运行中的 ComfyUI（设置页「打开查看」按钮） */
  comfyOpen: authedProcedure.mutation(async () => {
    return openComfyUi();
  }),

  /** ComfyUI 能否被内嵌进应用页签（「打开查看」据此决定页签里渲染什么）。
   *
   *  必须在**服务端**探：宿主页在 WebView2 里跨源读不到 ComfyUI 的响应头，
   *  iframe 的 error/load 事件也都不带失败原因 ——「被拦下」与「内容为空」
   *  在 JS 里长得一样，这正是 ISSUE #310 空白页签难排查的原因。
   *
   *  成因已更正：拦路的是「未开 CORS 时的 origin-only 中间件对跨源请求返回
   *  403」（不是 `X-Frame-Options: DENY`），响应体为空所以一片白。探测会带
   *  `Origin` 模拟 iframe 视角，并以 403 / `Access-Control-Allow-Origin` 判读。
   *
   *  该开关由本应用在拉起 ComfyUI 时注入（`withEmbedClearanceFlag` 加
   *  `--enable-cors-header`），所以正常路径下这里应当恒为「可嵌」；
   *  `target` 只有 embed / blocked 两档，两者都留在同一个窗口的页签里。 */
  comfyEmbeddable: authedProcedure
    .input(z.object({ base: z.string().url(), hostOrigin: z.string().url() }))
    .query(async ({ input }) => {
      const verdict = await probeComfyEmbeddable(input.base, input.hostOrigin);
      return {
        ...verdict,
        target: decideComfyTabOpen(verdict.embeddable),
      };
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

  /** 用系统默认浏览器打开任意 http(s) 地址（桌面壳内 target=_blank 外链
   *  打不开，须走 Node 端系统浏览器命令，与「打开查看」语义一致）。
   *  用于生成结果的视频/图片等远程资源在默认浏览器里打开播放。 */
  openExternal: authedProcedure
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ input }) => openUrlInBrowser(input.url)),
});
