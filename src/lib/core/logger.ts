/**
 * `logger.ts` — 极简结构化日志（零依赖，可替换后端）
 * ===========================================================================
 *
 * 现状问题
 * --------
 * 代码库大量使用 `console.log/console.error` 散布在各处，无法统一级别、
 * 无法携带上下文字段、生产环境无法关闭。本日志器提供：
 *   - 级别（debug/info/warn/error）+ 命名空间（如 `comfyui:runner`）
 *   - 结构化 `fields` 附加上下文（taskId、projectId 等），便于日志聚合
 *   - 通过 `LOG_LEVEL` 环境变量控制输出门槛
 *   - `child(ns)` 继承父级并追加命名空间，避免每层重复传 ctx
 *
 * 设计
 * ----
 * 不引入 pino/winston 以减少依赖；接口刻意与它们对齐，未来若需更强能力，
 * 只需在 {@link createLogger} 内替换实现，调用方无感。
 *
 * @module core/logger
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function currentLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return (raw as LogLevel) in LEVEL_ORDER ? (raw as LogLevel) : "info";
}

/** 日志器实例：命名空间 + 结构化字段输出。 */
export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  /** 派生子日志器，命名空间拼接为 `parent:child`。 */
  child(ns: string): Logger;
}

function format(
  level: LogLevel,
  ns: string,
  msg: string,
  fields?: Record<string, unknown>
): string {
  const ts = new Date().toISOString();
  const base = `${ts} ${level.toUpperCase()} [${ns}] ${msg}`;
  if (!fields || Object.keys(fields).length === 0) return base;
  try {
    return `${base} ${JSON.stringify(fields)}`;
  } catch {
    return `${base} <unserializable-fields>`;
  }
}

function makeLogger(ns: string): Logger {
  const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel()]) return;
    const line = format(level, ns, msg, fields);
    // error 走 stderr，其余走 stdout，便于外部日志采集分流
    if (level === "error") console.error(line);
    else console.log(line);
  };

  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
    child: (childNs) => makeLogger(ns ? `${ns}:${childNs}` : childNs),
  };
}

/** 创建根日志器。建议各模块 `export const log = createLogger("module:name")`。 */
export function createLogger(namespace: string): Logger {
  return makeLogger(namespace);
}

/** 全局默认日志器（命名空间 `app`）。 */
export const logger = makeLogger("app");
