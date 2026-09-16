import "server-only";
import fs from "node:fs";
import path from "node:path";

import { APP_RUNTIME_LOG } from "@/lib/log-paths";

/**
 * 应用运行操作日志（面板可见）。
 * =========================================================
 * 本日志器解决「中间操作看不到」问题：把应用运行期发生的业务操作
 * （tRPC 调用、生成、任务、工作流增删改等）以面板可解析的行格式
 * 追加到 `log/services/app-runtime.log`，供应用内「应用日志」面板
 * 经 `GET /api/logs/current?source=app-runtime` 实时轮询展示。
 *
 * 与 comfyui-runtime / drizzle-studio-runtime 同一套「追加写 + 面板轮询」模式，
 * 但覆盖的是**应用自身操作**而非外部常驻子进程输出。
 *
 * 行格式 = `[YYYY-MM-DD HH:mm:ss.mmm] [LEVEL] [ns] msg`
 * - 本地时区时间戳（面板展示给本机用户看，UTC 会差 8 小时）
 * - LEVEL ∈ INFO / WARN / ERROR / DEBUG
 * - ns 为命名空间（如 `trpc`、`generate`、`task`），可省略
 *
 * 服务端使用；面板经 API 读取，不直接碰 DOM。写入失败绝不阻塞业务主流程。
 */

export type AppLogLevel = "info" | "warn" | "error" | "debug";

/** 本地时间戳（YYYY-MM-DD HH:mm:ss.mmm）。 */
function localTimestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${ms}`;
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

function makeLogger(
  ns: string,
  filePath: string = APP_RUNTIME_LOG,
): AppRuntimeLogger {
  const emit = (
    level: AppLogLevel,
    msg: string,
    fields?: Record<string, unknown>,
  ) => {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const line = `[${localTimestamp()}] [${LEVEL_TAG[level]}]${ns ? ` [${ns}]` : ""} ${msg}${stringify(fields)}\n`;
      fs.appendFileSync(/*turbopackIgnore: true*/ filePath, line, "utf-8");
    } catch {
      // 日志写入失败绝不阻塞业务主流程
    }
  };

  return {
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
    debug: (message, fields) => emit("debug", message, fields),
    child: (childNs) => makeLogger(ns ? `${ns}:${childNs}` : childNs, filePath),
  };
}

/** 创建应用运行日志器。各模块 `export const log = createAppRuntimeLogger("module")`。 */
export function createAppRuntimeLogger(
  namespace: string,
  filePath?: string,
): AppRuntimeLogger {
  return makeLogger(namespace, filePath);
}

/** 全局默认应用运行日志器（命名空间 `app`）。 */
export const appRuntimeLog = makeLogger("app");
