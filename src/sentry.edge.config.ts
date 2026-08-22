/**
 * Sentry Edge runtime 初始化（middleware 等 Edge 环境）。
 * 未配置 SENTRY_DSN 时 no-op。
 */
import * as Sentry from "@sentry/nextjs";
import { env } from "~/env";

Sentry.init({
  dsn: env.SENTRY_DSN,
  environment: env.NODE_ENV,
  tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 0,
});
