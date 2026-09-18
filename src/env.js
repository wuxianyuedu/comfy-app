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
    // 提示必须跨平台（ISSUE #489）：这里原本指着「双击 tools/start/run-local.ps1」，
    // 而那是 Windows 专属入口 —— Linux / macOS / CI 上并不存在（规范 §9 的
    // Web-only 模式明确不依赖任何 .ps1）。`pnpm env:init` 三平台同一条命令。
    const err = new Error(
      [
        "缺少 .env 环境配置文件，应用无法启动。",
        "",
        "生成它（三平台同一条命令，跨平台、无需任何 .ps1）：",
        "  pnpm env:init",
        "",
        "手工方式：把 .env.example 复制为 .env，并至少填上",
        "  BETTER_AUTH_SECRET=<64 位随机 hex>",
        "  BETTER_AUTH_GITHUB_CLIENT_ID / _SECRET=<非空占位值即可>",
        "（留空等于没给：校验把空串当「未配置」。）",
      ].join("\n"),
    );
    err.name = "MissingEnvFileError";
    throw err;
  }
}

export const env = createEnv({
  /**
   * 在这里声明服务端环境变量的 schema。这样你就能保证应用
   * 不会带着非法的 env 变量被构建。
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
   * 在这里声明客户端环境变量的 schema。这样你就能保证应用
   * 不会带着非法的 env 变量被构建。要暴露给客户端，
   * 给它们加 `NEXT_PUBLIC_` 前缀。
   */
  client: {
    // 客户端变量这样声明：NEXT_PUBLIC_CLIENTVAR: z.string(),
  },

  /**
   * 在 Next.js 的 edge 运行时（例如中间件）或客户端里，
   * 你不能把 `process.env` 当普通对象解构，所以要手动解构。
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
   * 带 `SKIP_ENV_VALIDATION` 跑 `build` 或 `dev` 可跳过 env 校验。
   * Docker 构建时尤其有用。
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * 让空字符串被当成 undefined。`SOME_VAR: z.string()` 与
   * `SOME_VAR=''` 都会抛错。
   */
  emptyStringAsUndefined: true,
});
