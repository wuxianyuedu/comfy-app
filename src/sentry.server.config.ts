/**
 * Sentry 服务端初始化（Node.js runtime：API routes / tRPC / Server Actions）。
 * 未配置 SENTRY_DSN 时 no-op，不影响本地开发。
 */
import * as Sentry from "@sentry/nextjs";
import { env } from "~/env";

Sentry.init({
  dsn: env.SENTRY_DSN,
  environment: env.NODE_ENV,
  // 生产按 10% 采样，开发/测试不上报
  tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 0,
  // 敏感字段脱敏：避免 cookie / auth 头落盘
  beforeSend(event) {
    if (event.request?.headers) {
      delete event.request.headers.cookie;
      delete event.request.headers.authorization;
    }
    return event;
  },
});
