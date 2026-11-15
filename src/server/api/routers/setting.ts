import { realpathSync } from "node:fs";
import { resolve as resolvePath, relative as relativePath } from "node:path";

import { z } from "zod";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { getSettings, getSettingsSync, saveSettings } from "~/lib/app-settings/app-settings.server";
import {
  clearComfyAutoStartFailure,
  clearComfyManualStop,
  ensureComfyUiReady,
  getComfyUiStatus,
  openComfyUi,
  stopComfyUiProcess,
} from "~/lib/comfyui/lifecycle";
import { describeComfyInstance } from "~/lib/comfyui/instance-kind";
import { noteComfyStateChange } from "~/lib/comfyui/state-watch";
import { resolveDesktopStoragePaths } from "~/lib/comfyui/desktop-storage-paths.server";
import { decideComfyTabOpen, probeComfyEmbeddable } from "~/lib/comfy/comfy-embed";
import {
  ensureDrizzleStudioUp,
  isDrizzleStudioStarting,
  openDrizzleStudio,
  probeDrizzleStudio,
  stopDrizzleStudio,
  DRIZZLE_STUDIO_DEFAULT_PORT,
} from "~/lib/drizzle-studio/lifecycle";
import {
  createAppDataBackup,
  createBackup,
  importBackupFromDirectory,
  listAppDataBackupSets,
  listBackupEntries,
  readRestoreRequest,
  requestRestore,
} from "~/lib/db-backup/backup";
import { openUrlInBrowser } from "~/lib/shell/open-in-browser";
import { isHttpUrl } from "~/lib/url-scheme";
import { revealPathInFileManager } from "~/lib/shell/reveal-path";
import { CPU_LIMIT_MODES } from "~/lib/comfyui/cpu-limit";

/** `save` 入参里**影响运行态判据**的那几项：路径 / 端口 / 启动参数 / 解释器。
 *
 *  其余几项（自动启动、退出即杀、工作流自动同步）只改行为偏好，不动「此刻是不是
 *  在跑、在哪跑」这条结论 —— 它们变了不需要通知任何人重问状态。 */
/* SAFETY: 类型断言已复核 */
const COMFY_CONFIG_KEYS = [
  "comfyuiPort",
  "comfyuiPath",
  "comfyuiExtraArgs",
  "comfyCliPython",
] as const;

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
        comfyuiPort: z.number().int().min(0).max(65_535).optional(),
        comfyuiPath: z.string().optional(),
        comfyuiExtraArgs: z.string().optional(),
        /** comfy-cli 的 Python 解释器（桌包不随包 Python，用户自备后在这里指路径）。 */
        comfyCliPython: z.string().optional(),
        /** 出图进程的 CPU 档位（ISSUE #1959）：off / yield / throttle。
         *  取值集合由 `~/lib/comfyui/cpu-limit` 的 `CPU_LIMIT_MODES` 单点持有，
         *  这里用 `z.enum` 跟着它 —— 别在路由里手抄一份字面量清单。 */
        comfyuiCpuLimit: z.enum(CPU_LIMIT_MODES).optional(),
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
      if (input.comfyuiAutoStart === true) {
        clearComfyManualStop();
      }
      // 改「安装路径 / 启动参数」是把上次「启动失败」的成因改掉了：清掉
      // 「失败后不再重试」的闩锁，让自动启动重新尝试（否则用户修好了路径，
      // 却因为老闩锁一直不重试，还得再手动点一次启动）（ISSUE #335）。
      if (input.comfyuiPath !== undefined || input.comfyuiExtraArgs !== undefined) {
        clearComfyAutoStartFailure();
      }
      /* ComfyUI 四项只要动过一样，运行态的**判据**就变了（可能换了实例、
       * 换了端口、换了启动参数）：告诉「运行态变化」那条通道，设置页收到后
       * 立刻重问一次状态，而不是等下一拍兜底轮询。写在 `saveSettings` 之后 ——
       * 通知早于落盘的话，重问还是拿旧配置去探。 */
      if (COMFY_CONFIG_KEYS.some((key) => input[key] !== undefined)) {
        noteComfyStateChange("config", "ComfyUI 配置已更新");
      }
      const settings = await getSettings();
      return { settings };
    }),

  /** ComfyUI 安装形态（桌面版 / 便携版 / venv）：**只读文件系统的快速判据**。与下面 `comfyStatus` 分开是有意
   * 的：形态只取决于配置路径的目录形态（实测毫秒级），而运行态要付「进程表查询 + 端口探测」（秒级）。同在一个
   * 响应里时，形态会被拖到探测结束才出现 —— 设置页先看不到「安装形态」徽标，「端口 / 启动参数」输入框也要等探测
   * 完成才消失。设置页首屏与 `setting.get` 同批拉它，保存路径后再 refetch（见 launch-and-build §5）。 */
  comfyInstance: authedProcedure.query(() => describeComfyInstance(getSettingsSync().comfyuiPath)),

  /** 桌面实例的存储目录（模型 / 共享模型 / 输入 / 输出 / 共享输入输出）——**只读**。数据全部来自实例侧文件与
   * 元数据：`extra_model_paths.yaml`（共享目录的唯一来源）+ Comfy Desktop 登记的启动参数（`--base-directory`
   * 等会覆盖默认值）。与 `comfyInstance` 同为「配置路径的函数」，因此同样不进轮询：保存偏好与启动 ComfyUI 之后
   * 各重取一次。非桌面实例返回 `null`（便携版 / venv 的目录只由启动参数决定，拿它回答「模型在哪」是另一套口径）。 */
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
        timeoutMs: z.number().int().min(5000).max(600_000).optional(),
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

  /** ComfyUI 能否被内嵌进应用页签（「打开查看」据此决定页签里渲染什么）。必须在**服务端**探：宿主页在 WebView2
   * 里跨源读不到 ComfyUI 的响应头，iframe 的 error/load 事件也都不带失败原因 ——「被拦下」与「内容为空」在 JS
   * 里长得一样，这正是 ISSUE #310 空白页签难排查的原因。成因已更正：拦路的是「未开 CORS 时 origin-only 中间件
   * 对跨源请求返回 403」（不是 `X-Frame-Options`），故探测带 `Origin` 并以 403 / `Access-Control-Allow-Origin`
   * 判读；开关由拉起时注入（`withEmbedClearanceFlag` 加 `--enable-cors-header`），`target` 只有 embed / blocked。 */
  comfyEmbeddable: authedProcedure
    .input(
      z.object({
        base: z.url().refine(isHttpUrl, { message: "base 必须为 http/https" }),
        hostOrigin: z.url().refine(isHttpUrl, { message: "hostOrigin 必须为 http/https" }),
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

  /** 用系统默认浏览器打开任意 http(s) 地址（桌面壳内 target=_blank 外链打不开，须走 Node 端系统浏览器命令，与
   * 「打开查看」语义一致），用于生成结果的视频/图片等远程资源。⚠️ 入参是**请求方给的任意地址**，而 `z.url()`
   * 只管「是不是一个 URL」—— 它放行 `file:` / `javascript:` / 自定义协议。协议白名单落在 `openUrlInBrowser()`
   * （一处定义、覆盖每个出口），非 http(s) 返回 `{ ok: false, detail }` 且**不 spawn**，前端原样显示 detail。 */
  openExternal: authedProcedure
    .input(z.object({ url: z.url() }))
    .mutation(async ({ input }) => openUrlInBrowser(input.url)),

  /** 在系统文件管理器里定位一个本机路径（日志面板里点路径，ISSUE #1365）。⚠️ 入参是**请求方给的任意字符串**
   * （日志原文里扫出来的候选），所以把「路径存不存在」和「在不在检出目录里」**合成同一个探针**交给
   * `revealPathInFileManager`；分开判时「先解析、再校验」两段之间会漏掉「解析退到的前缀本身在检出外」这类情形。
   * 这一路把「打开用户点的那段文本」变成「在本机执行外部程序」，是仓库第二处交出控制权（第一处 `openExternal`
   * 只有 http(s) 协议闸）；候选由文本形状扫出、可来自任何地方 —— 无闸则构造日志就能开 `C:\Windows\System32`。 */
  revealPath: authedProcedure
    .input(z.object({ path: z.string().min(1).max(4096) }))
    .mutation(async ({ input }) => {
      return revealPathInFileManager(input.path, projectScopedProbe());
    }),

  /* ── D6 数据库备份 / 恢复（ISSUE #1611 建议默认②③）—— 口径详见 `docs/guides/PRODUCTION-GAPS.md` D6 条目：
   * 保留最近 3 份、落 `<应用根>/data/backups/`（由 `scripts/db-backup-core.mjs` 唯一持有）；恢复只给设置页入口
   * （选份 + 确认），但换文件不发生在点按钮那一刻 —— `backupRestore` 只写待恢复标记，真正换文件交给启动链
   * `applyPendingRestoreAtBoot`（那时天然满足「应用没在跑」）。刻意不提供「就地换文件」mutation：运行期多个进程
   * 持有此库（内嵌 Next server、执行宿主、Drizzle Studio），在别人握句柄时覆盖 `db.sqlite` 是不可逆数据事故。 */

  /** 备份清单（可选份 + 有没有待恢复的请求），供设置页那一区渲染。 */
  backupList: authedProcedure.query(() => {
    return {
      backups: listBackupEntries(process.cwd()),
      /* 本机应用数据的备份套（app-data-backup-<时刻>/，#3732）：与数据库快照
       * 同刻成套，恢复时一起覆盖回 data/。 */
      appDataBackups: listAppDataBackupSets(process.cwd()),
      pending: readRestoreRequest(process.cwd()),
    };
  }),

  /** 立即做一份备份（手动档）。失败**如实返回**原因而不是抛 —— 备份失败是
   *  可预期的一档（磁盘满 / 库被独占），界面上要能看见「为什么没成」。
   *  本机应用数据随同一刻备份（#3732）：数据库那份失败时应用数据照常备份
   *  （两份独立），原因各自带回去。 */
  backupCreate: authedProcedure.mutation(() => {
    const db = createBackup(process.cwd());
    const appData = createAppDataBackup(process.cwd());
    return { ...db, appData };
  }),

  /** 请求从某一份备份恢复：**只写标记**，真正换文件在下次启动。
   *  守卫（「不是一份备份的名字」/「读不通」）在 `requestRestore` 里，返回形状
   *  与备份那条同款，界面据 `ok` 分档。`appDataDir` 是同刻的本机应用数据备份
   *  套（#3732）—— 恢复时随数据库一起覆盖回 `data/`。 */
  backupRestore: authedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        appDataDir: z.string().min(1).max(255).optional(),
      }),
    )
    .mutation(({ input }) => {
      return requestRestore(process.cwd(), input.name, {
        appDataDir: input.appDataDir ?? null,
      });
    }),

  /** 从**用户指定的目录**导入备份件（ISSUE #3732）：另一台机器 / 移动盘上的
   *  备份拷回 `data/backups/`，之后照常出现在清单里、可恢复。目录里认不出
   *  备份件时如实说原因；同名不覆盖。 */
  backupImportFromDir: authedProcedure
    .input(z.object({ dir: z.string().min(1).max(4096) }))
    .mutation(({ input }) => {
      return importBackupFromDirectory(process.cwd(), input.dir);
    }),
});

/**
 * 「这个路径能被打开吗」的探针：存在 **且** 在检出目录内。白名单根在**每次调用时**取一次（`process.cwd()` 在
 * Next server 里是进程级的；取一次让「服务被换到别的检出」在下一轮请求就生效，而不是等进程重启）。`realpath`
 * 失败（根不存在）时退化为**全拒**，不是全放 —— 闸门失效时默认方向只能更严。比较用归一化后的绝对路径：
 * `realpath` 解掉 `..` 与符号链接，否则检出目录里一条 `link -> C:\Windows` 就能绕过去；分隔符边界交给 `path.relative`（同盘外返回 `..` 开头），比手拼 `root + sep` 少一处平台判据。 */
function projectScopedProbe(): (candidate: string) => boolean {
  let root: string | null = null;
  try {
    root = realpathSync(process.cwd());
  } catch {
    root = null;
  }
  return (candidate: string) => {
    if (root === null) {
      return false;
    }
    let real: string;
    try {
      real = realpathSync(resolvePath(candidate));
    } catch {
      return false;
    }
    if (real === root) {
      return true;
    }
    const rel = relativePath(root, real);
    return rel !== "" && !rel.startsWith("..") && !isAbsolutePath(rel);
  };
}

/** `path.relative` 跨盘（Windows 盘不同）时会回一个绝对路径 —— 那就是界外。 */
function isAbsolutePath(rel: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|[\\/])/.test(rel);
}
