import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { env } from "~/env";
import { db } from "~/server/db";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "sqlite",
    // 表名单数（user/session/account/verification），对齐现有库
    usePlural: false,
  }),
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
    // OWASP A07（认证失败）：强制一个真正有意义的最小密码长度。
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },
  socialProviders: {
    github: {
      clientId: env.BETTER_AUTH_GITHUB_CLIENT_ID,
      clientSecret: env.BETTER_AUTH_GITHUB_CLIENT_SECRET,
      // OWASP A05/A07：已移除 redirectURI —— better-auth 会从 `baseURL` 推导它，
      // 于是生产环境里不会再残留硬编码的 localhost。
    },
  },
  // ── 生产级限流（OWASP A07 / A08）：auth 端点防暴破 ──────────
  rateLimit: {
    enabled: true,
    window: 10, // 秒
    max: 100, // 每窗口最大请求
    customRules: {
      "/sign-in/email": { window: 10, max: 5 }, // 登录更严
      "/forget-password": { window: 60, max: 3 }, // 找回密码最严
    },
  },
});

export type Session = typeof auth.$Infer.Session;
