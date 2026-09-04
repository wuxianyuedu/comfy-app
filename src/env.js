import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

// ── 缺 .env 时给出一句人话，而不是一屏 zod 校验明细 ────────────
// 仅 Node.js runtime 执行（Edge runtime 无文件系统与 node:* 内置模块，
// 环境变量由平台注入，不存在本地 .env 文件）。
if (process.env.NEXT_RUNTIME !== "edge") {
  const { existsSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  // 本文件位于 <项目根>/src/env.js，据此定位项目根以探测 .env。
  const envFilePath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    ".env",
  );
  if (!process.env.SKIP_ENV_VALIDATION && !existsSync(envFilePath)) {
    const err = new Error(
      [
        "缺少 .env 环境配置文件，应用无法启动。",
        "",
        "请把项目根目录下的 .env.example 复制一份并命名为 .env，再重新启动：",
        "  · Windows：        copy .env.example .env",
        "  · macOS / Linux：  cp .env.example .env",
        "",
        "小贴士：直接双击 tools/start/run-local.ps1 可自动生成 .env，无需手动处理。",
      ].join("\n"),
    );
    err.name = "MissingEnvFileError";
    throw err;
  }
}

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    BETTER_AUTH_SECRET:
      process.env.NODE_ENV === "production"
        ? z.string().min(32)
        : z.string().min(32).optional(),
    BETTER_AUTH_URL: z.string().url().optional(),
    BETTER_AUTH_GITHUB_CLIENT_ID: z.string(),
    BETTER_AUTH_GITHUB_CLIENT_SECRET: z.string(),
    DATABASE_URL: z.string().url(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    // 可观测性：日志级别（pino）；SENTRY_DSN 仅生产接入错误追踪时配置
    LOG_LEVEL: z
      .enum(["debug", "info", "warn", "error", "fatal"])
      .default("info"),
    SENTRY_DSN: z.string().url().optional(),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    // NEXT_PUBLIC_CLIENTVAR: z.string(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    BETTER_AUTH_GITHUB_CLIENT_ID: process.env.BETTER_AUTH_GITHUB_CLIENT_ID,
    BETTER_AUTH_GITHUB_CLIENT_SECRET:
      process.env.BETTER_AUTH_GITHUB_CLIENT_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    LOG_LEVEL: process.env.LOG_LEVEL,
    SENTRY_DSN: process.env.SENTRY_DSN,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});
