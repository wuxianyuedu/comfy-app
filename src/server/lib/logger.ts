import {
  createPinoLogger,
  logger,
  REDACT_PATHS,
  redactSecretShaped,
  type PinoLogger,
  type PinoLoggerOptions,
} from "~/lib/core/logger";

/**
 * 服务端日志出口 —— 实现唯一出处是 `src/lib/core/logger.ts`。本文件曾是 pino 实现（`REDACT_PATHS` /
 * `createPinoLogger` / ERROR 镜像 / pretty 输出），与 `lib/core/logger` 同物两份实现，致数据层 11 个模块反向依赖
 * 上层（逐项登记见 `tests/lib-server-imports.test.ts`）；现仅转发，导入路径与 `logger.info(msg, fields)` 用法逐字不变。
 */

export {
  createPinoLogger,
  logger,
  REDACT_PATHS,
  redactSecretShaped,
  type PinoLogger,
  type PinoLoggerOptions,
};
