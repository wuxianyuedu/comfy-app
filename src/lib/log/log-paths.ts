import "server-only";
import path from "path";

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
 * `.mjs`（由启动器动态加载 TS 会连带 `server-only` 的 throw 一起崩），
 * 后者是 PowerShell（根本读不了 TS）。它们**不是**本模块的消费方，
 * 也不该被本模块「代为声明」。
 *
 * 此前这里额外导出了 `TOOLS_LOG_DIR` / `ARCHIVE_LOG_DIR` /
 * `DEV_LAUNCHER_STDOUT_LOG` / `DEV_LAUNCHER_STDERR_LOG` /
 * `NEXTJS_PANEL_LOG_GLOB` 五个常量，实测全库零消费 —— 真正的写入方是上面那
 * 两套脚本，各自按自己的字面量拼路径。留着它们只会让读代码的人以为「改这里
 * 就能改布局」，实际改了什么也不会发生（§12.15 第二条「保留必须写得出谁在
 * 什么时候会用」，写不出即删）。
 */

/** 日志根目录（<项目根>/log）。 */
export const LOG_ROOT = path.join(process.cwd(), "log");

/** 双击启动链路：python 启动器 + dev-launcher 编排日志。 */
export const LAUNCHER_LOG_DIR = path.join(LOG_ROOT, "launcher");

/** Next.js dev server 原始输出（按次命名，保留最近 5 份）。 */
export const NEXTJS_LOG_DIR = path.join(LOG_ROOT, "nextjs");

/** 常驻服务运行时日志（追加写；设置页日志面板跟随读取）。 */
export const SERVICES_LOG_DIR = path.join(LOG_ROOT, "services");

/** 工坊生成执行日志（角色卡提取 / 分镜拆解 / 定妆照生成，按天分文件追加）。 */
export const WORKSHOP_LOG_DIR = path.join(LOG_ROOT, "workshop");

// ── 启动链路（launcher/）──
/** python 双击启动器的链路日志。 */
export const START_TAURI_LAUNCHER_LOG = path.join(
  LAUNCHER_LOG_DIR,
  "start-tauri-launcher.log",
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
export const COMFYUI_TRACE_DIR = path.join(LOG_ROOT, "comfyui");
/** ISSUE #216：ComfyUI 返回内容完整打印到这一份文件。 */
export const COMFYUI_TRACE_LOG = path.join(
  COMFYUI_TRACE_DIR,
  "comfyui-trace.log",
);

/** 应用运行期业务操作日志（tRPC 调用/生成/任务/工作流增删改等），供「应用日志」面板轮询。 */
export const APP_RUNTIME_LOG = path.join(SERVICES_LOG_DIR, "app-runtime.log");

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
