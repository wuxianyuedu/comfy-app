import { realpathSync } from "node:fs";
import { resolve as resolvePath, relative as relativePath } from "node:path";

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
import { describeComfyInstance } from "~/lib/comfyui/instance-kind";
import { resolveDesktopStoragePaths } from "~/lib/comfyui/desktop-storage-paths.server";
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
import { isHttpUrl } from "~/lib/url-scheme";
import { revealPathInFileManager } from "~/lib/shell/reveal-path";

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
        comfyuiPath: z.string().optional(),
        comfyuiExtraArgs: z.string().optional(),
        /** comfy-cli 的 Python 解释器（桌包不随包 Python，用户自备后在这里指路径）。 */
        comfyCliPython: z.string().optional(),
        comfyuiAutoStart: z.boolean().optional(),
        exitKillComfyui: z.boolean().optional(),
        exitKillOllama: z.boolean().optional(),
        /** 绑定到本地文件的工作流：进详情是否自动把磁盘最新内容同步回库。 */
        autoSyncLocalWorkflow: z.boolean().optional(),
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

  /** ComfyUI 安装形态（桌面版 / 便携版 / venv）：**只读文件系统的快速判据**。
   *
   * 与下面的 `comfyStatus` 分开是有意的：形态只取决于配置路径的目录形态
   * （实测毫秒级），而运行态要付「进程表查询 + 端口探测」（秒级）。两者同在一个
   * 响应里时，形态会被拖到探测结束才出现 —— 设置页先看不到「安装形态」徽标，
   * 「端口 / 启动参数」输入框也要等探测完成才消失。设置页在首屏与 `setting.get`
   * 同批拉它，保存路径后再 refetch（见 launch-and-build §5）。 */
  comfyInstance: authedProcedure.query(() =>
    describeComfyInstance(getSettingsSync().comfyuiPath),
  ),

  /** 桌面实例的存储目录（模型 / 共享模型 / 输入 / 输出 / 共享输入输出）——**只读**。
   *
   * 数据全部来自实例侧文件与元数据：`extra_model_paths.yaml`（共享目录的唯一
   * 来源）+ Comfy Desktop 登记的启动参数（`--base-directory` 等会覆盖默认值）。
   * 与 `comfyInstance` 同为「配置路径的函数」，因此同样不进轮询：它在保存偏好
   * 与启动 ComfyUI 之后各重取一次。
   *
   * 非桌面实例返回 `null`：便携版 / venv 的目录只由启动参数决定，界面拿它来
   * 回答「模型在哪」会是另一套口径。 */
  comfyStorage: authedProcedure.query(() =>
    resolveDesktopStoragePaths(getSettingsSync().comfyuiPath),
  ),

  /** ComfyUI 运行状态（设置页状态行 / 启动按钮旁） */
  comfyStatus: authedProcedure.query(async () => {
    const settings = getSettingsSync();
    /* 状态结论统一由 getComfyUiStatus 给出（进程级快照 + HTTP 探测合并）：
     * 只看 HTTP 探测会把「外部已启动但接口未就绪」的实例误报成未运行，并让
     * 状态行先落到「未运行」再跳「运行中」（ISSUE #339）。 */
    const status = await getComfyUiStatus();
    const base = status.base;
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
      autoStart: settings.comfyuiAutoStart,
      path: settings.comfyuiPath,
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
    .input(
      z.object({
        base: z.url().refine(isHttpUrl, { message: "base 必须为 http/https" }),
        hostOrigin: z
          .url()
          .refine(isHttpUrl, { message: "hostOrigin 必须为 http/https" }),
      }),
    )
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
   *  用于生成结果的视频/图片等远程资源在默认浏览器里打开播放。
   *
   *  ⚠️ 入参是**请求方给的任意地址**，而 `z.url()` 只管「是不是一个 URL」
   *  —— 它放行 `file:` / `javascript:` / 自定义协议。协议白名单落在
   *  `openUrlInBrowser()` 里（判据一处定义、覆盖每一个出口），非 http(s) 时
   *  返回 `{ ok: false, detail }` 且**不 spawn**；这一路的前端会原样把 detail 显示出来。 */
  openExternal: authedProcedure
    .input(z.object({ url: z.url() }))
    .mutation(async ({ input }) => openUrlInBrowser(input.url)),

  /** 在系统文件管理器里定位一个本机路径（日志面板里点路径，ISSUE #1365）。
   *
   *  ⚠️ 入参是**请求方给的任意字符串**（日志原文里扫出来的候选），所以这里的闸门
   *  是把「路径存不存在」和「在不在检出目录里」**合成同一个探针**交给
   *  `revealPathInFileManager` —— 只有同时满足两条的路径才可能被打开。合并不是
   *  图省事：分开判时「先解析、再校验」两段之间会漏掉「解析退到的那个前缀本身
   *  在检出外」这类情形（`F:\AI\x\..\..\Windows` 退出来的前缀），而探针
   *  形态下每条候选都要当场答「能不能打开」，漏不掉。
   *
   *  为什么要有这道闸：这一路把「打开用户点的那一段文本」变成了「在本机执行一个
   *  外部程序」，是本仓库第二处「把控制权交给外部程序」的落点（第一处是
   *  `openExternal`，那里只有 http(s) 的协议闸）。日志行里的候选由**文本形状**
   *  扫出，而文本可以来自任何地方（用户贴进控制台的命令输出、模型返回的日志行…）
   *  —— 没有这道闸，一句精心构造的日志就能让面板去打开 `C:\Windows\System32`。
   *  检出目录是**说得清的最小范围**：要打开的现场（编排脚本、日志目录、
   *  `run/launch-status.json`、`.next` 缓存、产物目录）全在里面。 */
  revealPath: authedProcedure
    .input(z.object({ path: z.string().min(1).max(4096) }))
    .mutation(async ({ input }) => {
      return revealPathInFileManager(input.path, projectScopedProbe());
    }),
});

/**
 * 「这个路径能被打开吗」的探针：存在 **且** 在检出目录内。
 *
 * 白名单根在**每次调用时**取一次（`process.cwd()` 在 Next server 里是进程级的、
 * 不随请求变；但取一次让「服务被换到别的检出」这件事在下一轮请求就生效，而不是
 * 等进程重启）。`realpath` 失败（根不存在，理论上不该发生）时退化为**全拒**，
 * 不是全放 —— 闸门失效时的默认方向只能是更严的一侧。
 *
 * 比较用归一化后的绝对路径：`realpath` 解掉 `..` 与符号链接，否则检出目录里一条
 * `link -> C:\Windows` 就能绕过去。分隔符边界交给 `path.relative`（同盘外返回
 * `..` 开头），比手拼 `root + sep` 少一处平台判据。
 */
function projectScopedProbe(): (candidate: string) => boolean {
  let root: string | null = null;
  try {
    root = realpathSync(process.cwd());
  } catch {
    root = null;
  }
  return (candidate: string) => {
    if (root === null) return false;
    let real: string;
    try {
      real = realpathSync(resolvePath(candidate));
    } catch {
      return false;
    }
    if (real === root) return true;
    const rel = relativePath(root, real);
    return rel !== "" && !rel.startsWith("..") && !isAbsolutePath(rel);
  };
}

/** `path.relative` 跨盘（Windows 盘不同）时会回一个绝对路径 —— 那就是界外。 */
function isAbsolutePath(rel: string): boolean {
  return /^([A-Za-z]:[\\/]|[\\/])/.test(rel);
}
