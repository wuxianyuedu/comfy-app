import pino from "pino";

/**
 * 生产级结构化日志（pino）。
 *
 * - 生产输出 JSON 行（便于采集到 Datadog / Grafana / ELK）；
 *   本地开发用 pino-pretty 美化。
 * - redact 覆盖常见敏感字段，杜绝 password/token/secret 落盘。
 * - 只记 userId 与事件类型，不把 PII 当明文字段。
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "BETTER_AUTH_SECRET",
    "password",
    "token",
    "*.password",
    "*.secret",
    "apiKey",
  ],
  transport:
    process.env.NODE_ENV === "production"
      ? undefined
      : { target: "pino-pretty", options: { colorize: true } },
});
