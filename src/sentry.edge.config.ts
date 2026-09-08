/**
 * Sentry Edge runtime 初始化（middleware 等 Edge 环境）。
 * 未配置 SENTRY_DSN 时 no-op。
 *
 * 注意：勿从这里 import "~/env"（src/env.js）。Edge 侧的 env.js 虽已用
 * `NEXT_RUNTIME !== "edge"` 守卫了文件系统探测，但 Turbopack 编译 Edge
 * instrumentation 包时是静态把整个模块图并进来，node:fs / node:path /
 * node:url 仍会被识别为 Edge 不支持的内置模块，每次编译都报 warning +
 * `Ecmascript file had an error` 并陷入无限重编，把 nextjs-stderr 刷满。
 * Edge 只需要 SENTRY_DSN 与 NODE_ENV 两个值，直接读 process.env 即可。
 */
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,
});
