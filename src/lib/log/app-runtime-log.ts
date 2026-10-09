import fs from "node:fs";

import {
  openRuntimeLogWriter,
  pruneRuntimeLogFiles,
  type RuntimeLogWriter,
} from "~/lib/log/runtime-log-pack.server";
import { formatLocalStamp } from "~/lib/time-format";

/**
 * 应用运行操作日志（面板可见）。
 * =========================================================
 * 本日志器解决「中间操作看不到」问题：把应用运行期发生的业务操作
 * （tRPC 调用、生成、任务、工作流增删改等）以面板可解析的行格式
 * 落到 `log/current/services/app-runtime-<YYYYMMDD-HHmmss>.log`，供应用内
 * 「应用日志」面板经 `GET /api/logs/current?source=app-runtime` 实时轮询展示。
 *
 * 与 comfyui-runtime / drizzle-studio-runtime 同一套「一次启动一份文件 + 面板
 * 轮询」模式，但覆盖的是**应用自身操作**而非外部常驻子进程输出。
 *
 * 行格式 = `[YYYY-MM-DD HH:mm:ss.mmm] [LEVEL] [ns] msg`
 * - 本地时区时间戳（面板展示给本机用户看，UTC 会差 8 小时）
 * - LEVEL ∈ INFO / WARN / ERROR / DEBUG
 * - ns 为命名空间（如 `trpc`、`generate`、`task`），可省略
 *
 * **§18.4 三选一：本模块走第三类（P3 迁移第 1 期·lib 层地基批）**。
 * 摘掉 `import "server-only"` 后登记进 `tests/lib-node-only-declarations.test.ts`
 * 的 `PURE_NODE_HOSTS`——上游 log-paths 已在 #1074 摘掉，本模块只依赖 Node 内建
 * (`node:fs` / `node:path`) + log-paths + time-format，形态与 `kill-process-tree`
 * 同族；这一步是把 logger 链最后一层地基纯化：`~/lib/core/logger` 静态引本模块，
 * 只要本模块带 server-only，纯 Node 里 `await import("~/lib/core/logger")` 就会
 * 因这一层 throw 而 reject、comfyui 各模块（#1053 / #1068 / #1071）的 lazy 兜底
 * 拿不到 logger、只能走 configureXxx 显式注入。摘掉后整链 logger 都能真加载。
 *
 * 「面板/API 侧只读、不直接碰 DOM」这一层分工保留——它是**消费者侧的约定**
 * （API 路由把这份文件读出去给前端轮询），不是「本模块只能是 Next 专属」的意思；
 * 写入方（Next server 与未来 executor host）都通过本模块，写入失败绝不阻塞业务。
 */

export type AppLogLevel = "info" | "warn" | "error" | "debug";

/** 本地时间戳（`YYYY-MM-DD HH:mm:ss.mmm`）—— 口径走 `~/lib/time-format`
 *  的 `formatLocalStamp`（此前与另外 5 处 runtime 日志逐字相同）。 */
function localTimestamp(): string {
  return formatLocalStamp(new Date(), { millis: true });
}

const LEVEL_TAG: Record<AppLogLevel, string> = {
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
  debug: "DEBUG",
};

export interface AppRuntimeLogger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  debug(msg: string, fields?: Record<string, unknown>): void;
  /** 派生子日志器，命名空间拼接为 `parent:child`。 */
  child(ns: string): AppRuntimeLogger;
}

function stringify(fields?: Record<string, unknown>): string {
  if (!fields || Object.keys(fields).length === 0) return "";
  try {
    return ` ${JSON.stringify(fields)}`;
  } catch {
    return " <unserializable-fields>";
  }
}

/**
 * 本次应用运行那一份日志文件的写入器。
 *
 * **惰性创建 + 进程内单例**：应用运行日志的「一次运行」就是**本进程的生命周期**
 * （Next server 进程起来 → 退出），所以句柄在第一次写入时定下来即可 ——
 * 没有第二个「启动事件」需要切分，也不必由宿主显式开一次（与 comfyui 那种
 * 「同一个应用进程里 ComfyUI 被反复启动」不同）。
 *
 * 句柄定下来之后**不再变**：改名 / 搬走正在写的文件会让已缓存 fd 指向不存在的
 * 路径，早期日志静默丢失（同 §4.0「进程只持有一个固定路径的句柄」那条）。
 */
let writer: RuntimeLogWriter | null = null;

function appendTo(file: string, line: string): void {
  try {
    fs.appendFileSync(/*turbopackIgnore: true*/ file, `${line}\n`, "utf-8");
  } catch {
    // 日志写入失败绝不阻塞业务主流程
  }
}

/** 首次写入时开本次运行的文件；轮转同族的旧文件（每个来源留最近若干份）。 */
function writerFor(): RuntimeLogWriter {
  if (writer) return writer;
  pruneRuntimeLogFiles();
  writer = openRuntimeLogWriter("app-runtime");
  return writer;
}

function makeLogger(ns: string, file?: string): AppRuntimeLogger {
  const emit = (
    level: AppLogLevel,
    msg: string,
    fields?: Record<string, unknown>,
  ) => {
    const line = `[${localTimestamp()}] [${LEVEL_TAG[level]}]${ns ? ` [${ns}]` : ""} ${msg}${stringify(fields)}`;
    const target = file ?? writerFor().file;
    appendTo(target, line);
  };

  return {
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
    debug: (message, fields) => emit("debug", message, fields),
    child: (childNs) => makeLogger(ns ? `${ns}:${childNs}` : childNs, file),
  };
}

/**
 * 创建应用运行日志器。各模块 `export const log = createAppRuntimeLogger("module")`。
 *
 * `file` 只在测试里传（指向自己的临时目录）：真实调用方一律走内部的
 * `writerFor()` 命名规则，别在别处拼 `app-runtime-*.log`。
 */
export function createAppRuntimeLogger(
  namespace: string,
  file?: string,
): AppRuntimeLogger {
  return makeLogger(namespace, file);
}

/** 全局默认应用运行日志器（命名空间 `app`）。 */
export const appRuntimeLog = makeLogger("app");
