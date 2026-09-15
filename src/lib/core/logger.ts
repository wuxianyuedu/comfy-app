/**
 * `logger.ts` — 核心层日志出口（薄封装，复用服务端 pino 的脱敏契约）
 * ===========================================================================
 *
 * 为什么不再自带一套实现
 * ----------------------
 * 本模块曾是「零依赖自研日志器」：自己拼行、走 `console.log/error`、**没有任何
 * 脱敏**。而仓库另一侧 `src/server/lib/logger.ts` 是 pino（带 `REDACT_PATHS` +
 * 密钥值形状守卫 + ERROR 镜像进应用日志面板）。于是同一件事出现两条互不相通的
 * 通道，直接后果有三条：
 *
 *   1. **同一件事两种口径**：`LOG_LEVEL` 的读法、级别集合、输出形态各自实现一遍；
 *   2. **安全契约不成立**：`repository-base.ts` 的 `log.debug("update", patch)`
 *      若某天多带一个 `token` 字段，旧实现会原文落盘 —— pino 那条通道有 redact
 *      兜底，这条什么都没有（规范 07 §7.18.2.1 的脱敏契约在这条通道上失效）；
 *   3. **观测通道不完整**：`console.*` 不进 ERROR 镜像（面板「应用运行」那一路
 *      看不到），排查时「明明有 error，面板却一片空白」。
 *
 * 现在本模块只做一件事：**把接口暴露给核心层，实现全部委派给 pino**。调用方
 * （`repository-base` / `events` / `container`）一行不改，但落盘通道、脱敏、
 * 镜像、级别过滤都只剩一份实现。
 *
 * 为什么不让 `core/` 直接 import `server/lib/logger`
 * --------------------------------------------------
 * 那会把 `core` 这个「零框架依赖的架构基座」钉在 `src/server/**` 上：方向由
 * 外部模块迁入内部，且 `core` 的消费方从此必须连带 server 目录可解析。本模块
 * 保持**不带 `server-only`**（18.4 的第三类：由纯 Node 宿主/编排动态加载），
 * 因此 import 关系仍是「可复用的一层」。真正的合并（把两份文件并成一个）留给
 * 领域归属那条线（#572）一起做，不在本条重命名/搬迁 —— 那属于巨型改名噪声。
 *
 * @module core/logger
 */
import {
  createPinoLogger,
  type PinoLogger,
  type PinoLoggerOptions,
} from "@/server/lib/logger";

/**
 * 日志器接口 = pino 的公开面。
 *
 * 保留 `child(ns)`：pino 的 `child({ ns })` 只绑上下文、不改绑定名，因此这里
 * 显式包装成「命名空间拼接」的语义（`a:b`），与旧接口逐字一致 —— 调用方
 * （`events.ts`、各 repository）无需改动。
 */
export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  /** 派生子日志器，命名空间拼接为 `parent:child`。 */
  child(ns: string): Logger;
}

/** 绑定名放在 `ns` 字段（pino 的 `bindings` 会带上它，便于采集端按命名空间过滤）。 */
function wrap(inner: PinoLogger): Logger {
  // pino 的 `bindings()` 类型是 `Record<string, unknown>` 之外的自由形状，
  // 这里显式窄化，避免把 any 带进后续字符串拼接（本仓库零 any 口径）。
  const binding: unknown = (inner.bindings() as Record<string, unknown>).ns;
  const ns = typeof binding === "string" ? binding : "";
  const next = (childNs: string) =>
    wrap(inner.child({ ns: ns ? `${ns}:${childNs}` : childNs }));
  return {
    debug: (msg, fields) => inner.debug(fields ?? {}, msg),
    info: (msg, fields) => inner.info(fields ?? {}, msg),
    warn: (msg, fields) => inner.warn(fields ?? {}, msg),
    error: (msg, fields) => inner.error(fields ?? {}, msg),
    child: next,
  };
}

/**
 * 创建根日志器（命名空间在 `ns` 绑定里）。
 *
 * `opts` 只用于把落盘目标换成调用方自己的流（测试断言 JSON 行、或宿主自定义
 * 目标流）；常规调用方不需要传。
 */
export function createLogger(
  namespace: string,
  opts: Omit<PinoLoggerOptions, "ns"> = {},
): Logger {
  return wrap(createPinoLogger({ ...opts, ns: namespace }));
}

/** 全局默认日志器（命名空间 `app`）。 */
export const logger: Logger = wrap(createPinoLogger({ ns: "app" }));
