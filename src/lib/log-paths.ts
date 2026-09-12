import path from "path";

/* ── log/ 目录布局的唯一事实来源 ────────────────────────────────────────
 * 任何需要在 Node 侧读写日志文件的代码都从这里取路径，禁止手拼
 * path.join(process.cwd(), "log", …)。布局总表见
 * docs/standards/launch-and-build.md §4。
 */

/** 日志根目录（<项目根>/log）。 */
export const LOG_ROOT = path.join(process.cwd(), "log");

/** 双击启动链路：python 启动器 + dev-launcher 编排日志。 */
export const LAUNCHER_LOG_DIR = path.join(LOG_ROOT, "launcher");

/** Next.js dev server 原始输出（按次命名，保留最近 5 份）。 */
export const NEXTJS_LOG_DIR = path.join(LOG_ROOT, "nextjs");

/** 常驻服务运行时日志（追加写；设置页日志面板跟随读取）。 */
export const SERVICES_LOG_DIR = path.join(LOG_ROOT, "services");

/** 构建与工具脚本日志（tools/scripts/Log-Common.ps1、setup 脚本）。 */
export const TOOLS_LOG_DIR = path.join(LOG_ROOT, "tools");

/** dev-launcher 历史归档（按年月分目录）。 */
export const ARCHIVE_LOG_DIR = path.join(LOG_ROOT, "archive");

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
/** python 启动器对 dev-launcher（pwsh）的 stdout 重定向。 */
export const DEV_LAUNCHER_STDOUT_LOG = path.join(
  LAUNCHER_LOG_DIR,
  "dev-launcher-stdout.log",
);
/** python 启动器对 dev-launcher（pwsh）的 stderr 重定向（启动失败先看这里）。 */
export const DEV_LAUNCHER_STDERR_LOG = path.join(
  LAUNCHER_LOG_DIR,
  "dev-launcher-stderr.log",
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

/** 匹配本次（或任意一次）运行的应用服务转录文件。 */
export const NEXTJS_PANEL_LOG_GLOB = `${NEXTJS_PANEL_LOG_PREFIX}*.log`;
