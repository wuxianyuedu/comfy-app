import path from "node:path";

/* ── log/ 目录布局的唯一事实来源 ────────────────────────────────────────
 * 任何需要在 **Node 侧（应用服务内）** 读写日志文件的代码都从这里取路径，
 * 禁止手拼 path.join(process.cwd(), "log", …)。布局总表见
 * docs/standards/launch-and-build.md §4。
 *
 * ## 「唯一事实来源」的边界要说清楚（ISSUE #565 复议）
 *
 * 「唯一」指的是**同一条链路上**：本模块服务应用服务（Next）侧；启动编排
 * （`scripts/launcher-core/log.mjs`，纯 Node 宿主）与 Windows 工具脚本
 * （`tools/scripts/Log-Common.ps1`）各自持有自己那半边的布局表 —— 前者是
 * `.mjs`（启动器**刻意不引**本模块，各留一份布局字面量；不是被 server-only
 * 挡住——见下方 §18.4 第三类登记），后者是 PowerShell（根本读不了 TS）。
 * 它们**不是**本模块的消费方，也不该被本模块「代为声明」。
 *
 * 此前这里额外导出了 `ARCHIVE_LOG_DIR` / `DEV_LAUNCHER_STDOUT_LOG` /
 * `DEV_LAUNCHER_STDERR_LOG` / `NEXTJS_PANEL_LOG_GLOB` 几个常量，实测全库零
 * 消费 —— 真正的写入方是上面那两套脚本，各自按自己的字面量拼路径。留着它们
 * 只会让读代码的人以为「改这里就能改布局」，实际改了什么也不会发生（§12.15
 * 第二条「保留必须写得出谁在什么时候会用」，写不出即删）。
 *
 * `TOOLS_LOG_DIR` 曾在同一批里被删掉，ISSUE #1326 又**按同一条判据**加了回来
 * —— 这次有真消费方（`SCHEMA_SYNC_STATUS_FILE` 的读取者横跨
 * `scripts/db-schema-state.mjs`（写）与 `src/app/api/schema/route.ts`（读）两个
 * 进程，路径必须只有一处）。
 *
 * ## §18.4 三选一：本模块走第三类（P3 迁移第 1 期·lib 层地基批）
 *
 * 本模块只有一条 Node 内建值 import（`path`）+ 一堆 `path.join` 常量，
 * 不引任何 server-only 侧模块，形态上与 `src/lib/process/kill-process-tree.ts`
 * 同族。摘掉 `import "server-only"` 后按第三类登记进
 * `tests/lib-node-only-declarations.test.ts` 的 `PURE_NODE_HOSTS`。
 * 这是 P3 executor host 迁移能往下的**共同地基**：logger / app-runtime-log /
 * capture-streams / session-banner / comfyui lifecycle / trace 都静态引
 * `log-paths`；只要它带 server-only，纯 Node 里 `await import("~/lib/core/logger")`
 * 的 promise 就会因这一层的 throw 而 reject、上层 comfyui 的 lazy 兜底接不进去。
 * 「浏览器图别引我」这条约束**不由 server-only 兜**——scanner 的 clientReachable
 * 判据（`scripts/lib-node-only-scan.mjs`）盯着「有 `"use client"` 静态引到时
 * 顶层是否有 Node 内建」，path 命中即红。
 */

/** 日志根目录（<项目根>/log）。 */
export const LOG_ROOT = path.join(process.cwd(), "log");

/* ── 「一次运行一包」的写点：log/current/ ──────────────────────────────────
 * 进程**始终**写 current/（路径固定，见规范 §4）；退出时由启动编排的
 * `scripts/launcher-core/run.mjs` 把整个 current/ 复制进 `log/runs/<日期>_<时分秒>-<runId>/`
 * 再清空内容。因此这一层下面的每一个路径都必须是**固定名** —— 在这里拼时间戳
 * 目录会让日志库要重配、还容易漏掉早期日志（进程只持有一个句柄）。
 *
 * `log/exports/`（面板「保存到本地」的落点）刻意**不在** current/ 下：否则下一次
 * 归档会把它一趟趟搬进 runs/，包越滚越大（见下方 LOG_EXPORT_DIR）。
 */
/** 本次运行的日志目录（进程写这里，退出时整目录归档）。 */
export const LOG_CURRENT_DIR = path.join(LOG_ROOT, "current");

/** 双击启动链路：dev-launcher 编排日志 + 壳日志重定向。 */
export const LAUNCHER_LOG_DIR = path.join(LOG_CURRENT_DIR, "launcher");

/** Next.js dev server 原始输出（按次命名，保留最近 5 份）。 */
export const NEXTJS_LOG_DIR = path.join(LOG_CURRENT_DIR, "nextjs");

/** 常驻服务运行时日志（追加写；设置页日志面板跟随读取）。 */
export const SERVICES_LOG_DIR = path.join(LOG_CURRENT_DIR, "services");

/** ComfyUI 通信层原始回执（trace）。 */
export const COMFYUI_LOG_DIR = path.join(LOG_CURRENT_DIR, "comfyui");

/** 工坊生成执行日志（角色卡提取 / 分镜拆解 / 定妆照生成，按天分文件追加）。 */
export const WORKSHOP_LOG_DIR = path.join(LOG_CURRENT_DIR, "workshop");

// ── 启动链路（launcher/）──
/** 壳自己的启动链路日志：壳把 `[ComfyAPP]` 诊断与编排器输出（`[orchestrator] …`）
 *  重定向到这里，是双击链路排障的第一现场（Python 启动器已随 ISSUE #784 移除，
 *  这个常量名沿用是为了不动日志面板的来源契约）。 */
export const LAUNCHER_SHELL_LOG = path.join(
  LAUNCHER_LOG_DIR,
  "dev-launcher-stderr.log",
);
/** dev-launcher 当前运行日志（每次运行覆盖，供启动页/应用内面板实时读取）。 */
export const DEV_LAUNCHER_LOG = path.join(LAUNCHER_LOG_DIR, "dev-launcher.log");
/** sentinel：内容为本次运行真实 dev-launcher 日志的绝对路径（文件被锁回退改名时靠它定位）。 */
export const DEV_LAUNCHER_CURRENT_SENTINEL = path.join(
  LAUNCHER_LOG_DIR,
  "dev-launcher-current.txt",
);

// ── 常驻服务（services/）──
/** ComfyUI 拉起/等待与子进程输出的运行时日志。 */
export const COMFYUI_RUNTIME_LOG = path.join(
  SERVICES_LOG_DIR,
  "comfyui-runtime.log",
);
/** Drizzle Studio 运行时日志。 */
export const DRIZZLE_STUDIO_RUNTIME_LOG = path.join(
  SERVICES_LOG_DIR,
  "drizzle-studio-runtime.log",
);
/** Ollama 运行时日志。 */
export const OLLAMA_RUNTIME_LOG = path.join(
  SERVICES_LOG_DIR,
  "ollama-runtime.log",
);

/** ComfyUI 通信层原始回执（trace）：comfy-cli stdout/stderr、WS 消息、
 *  /history 与 /queue 原始 JSON。诊断通道，追加写（见 comfyui/trace.ts）。 */
export const COMFYUI_TRACE_DIR = COMFYUI_LOG_DIR;
/** ISSUE #216：ComfyUI 返回内容完整打印到这一份文件。 */
export const COMFYUI_TRACE_LOG = path.join(
  COMFYUI_TRACE_DIR,
  "comfyui-trace.log",
);

/** 构建与工具脚本日志（tools/scripts/Log-Common.ps1、setup 脚本、schema 同步）。 */
export const TOOLS_LOG_DIR = path.join(LOG_CURRENT_DIR, "tools");

/**
 * schema 后台同步的状态文件（`log/current/tools/schema-sync.json`）。
 *
 * 「双宿主」的**唯一交汇处**：写它的是 `scripts/db-sync.mjs` 子进程，读它的
 * 是另一个进程里的 Next 服务端（`GET /api/schema`）—— 两者只能靠磁盘通信。
 *
 * 此前它孤零零躺在 `log/` 根目录（Issue #1326 点名的孤儿之一）：根目录只该有
 * `current/` `runs/` `latest.txt` `exports/`，否则时间一长必然变成杂物堆。
 * 归 `tools/` 是因为它的写入方是工具脚本链（`db-sync.mjs` / `db-schema-state.mjs`）。
 */
export const SCHEMA_SYNC_STATUS_FILE = path.join(
  TOOLS_LOG_DIR,
  "schema-sync.json",
);

/** 应用运行期业务操作日志（tRPC 调用/生成/任务/工作流增删改等），供「应用日志」面板轮询。 */
export const APP_RUNTIME_LOG = path.join(SERVICES_LOG_DIR, "app-runtime.log");

/**
 * 追加写 runtime 日志的「来源键 → 文件」映射。
 *
 * 两个读取端点的**同一份**来源表：`GET /api/logs/current`（增量跟随）与
 * `GET /api/logs/sessions`（按会话切分）。分开放会各自漂移 —— 新增一个
 * runtime 通道时只补一侧，另一侧就静默读不到（而两处都「看起来是对的」）。
 *
 * 键即接口上的 `source` 查询值（与 `src/lib/log/log-file-client.ts` 的
 * `LogSourceKind` 一一对应），因此值一律取上面那些常量，不在这里另拼路径。
 */
export const RUNTIME_LOG_FILES: Record<string, string> = {
  "comfyui-runtime": COMFYUI_RUNTIME_LOG,
  "drizzle-studio-runtime": DRIZZLE_STUDIO_RUNTIME_LOG,
  "ollama-runtime": OLLAMA_RUNTIME_LOG,
  "app-runtime": APP_RUNTIME_LOG,
};

/**
 * 日志面板「保存到本地」的落盘目录（`log/exports/`，按次命名）。
 *
 * 为什么服务端落盘、而不是只靠浏览器下载：桌面壳（WebView2）里 `<a download>`
 * 是否弹出保存框取决于宿主设置，用户经常「点了下载但本地哪儿都没有」；而日志
 * 面板排障时最需要的正是「**确实存在磁盘上、路径说得出来**」（ISSUE #609 用户
 * 反馈第 3 条：「应用运行日志，没看到本地有保存」）。落进 log/ 目录也让导出与
 * 其余日志在同一处可查。
 */
export const LOG_EXPORT_DIR = path.join(LOG_ROOT, "exports");

/**
 * 「应用服务输出」转录文件（面板可见通道）的前缀与全局匹配式。
 *
 * 应用服务（Next dev server）的 stdout / stderr 由
 * `src/lib/capture-streams.server.ts` 额外转录一份到 `nextjs-panel-*.log`，
 * 供「应用日志」面板轮询展示——此前首屏编译错误 / Turbopack FATAL / 未捕获的
 * 服务端异常只落在 nextjs-stdout|stderr 文件里，面板完全看不到（ISSUE #360）。
 *
 * 文件按进程启动标识命名（每次运行一份），与 dev-launcher 清理
 * `nextjs-stdout-*` / `nextjs-stderr-*` 的口径一致：保留最近 5 份。
 */
export const NEXTJS_PANEL_LOG_PREFIX = "nextjs-panel-";
