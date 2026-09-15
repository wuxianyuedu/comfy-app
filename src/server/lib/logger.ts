import {
  createPinoLogger,
  logger,
  REDACT_PATHS,
  redactSecretShaped,
  type PinoLogger,
  type PinoLoggerOptions,
} from "@/lib/core/logger";

/**
 * 服务端日志出口 —— 日志**实现**的唯一出处是 `src/lib/core/logger.ts`。
 * =========================================================
 *
 * 本文件曾是 pino 的**实现**处（`REDACT_PATHS` / `createPinoLogger` / ERROR
 * 镜像 / pretty 输出全在这里）。它与 `lib/core/logger` 是同一件事的两份实现，
 * 于是 `lib` 侧每一处要写日志的模块只能 `import { logger } from "~/server/lib/logger"`
 * —— 数据层的 11 个模块（`comfyui/**`、`drizzle-studio/lifecycle.ts`）就这样
 * 反向依赖了上层（只能靠清单逐个登记，见 `tests/lib-server-imports.test.ts`）。
 *
 * 现在实现合并到 `lib/core/logger`（地基侧），本文件只做**转发**，既有导入路径
 * 与服务端调用方的用法（`logger.info(msg, fields)`）逐字不变。
 */

export {
  createPinoLogger,
  logger,
  REDACT_PATHS,
  redactSecretShaped,
  type PinoLogger,
  type PinoLoggerOptions,
};
