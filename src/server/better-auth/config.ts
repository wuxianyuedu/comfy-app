import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

import { env } from "~/env";
import { db } from "~/server/db";

export const auth = betterAuth({
  database: prismaAdapter(db, {
    provider: "sqlite", // or "sqlite" or "mysql"
  }),
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
    // R-T3-phase4 (OWASP A07): enforce a real minimum password length.
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },
  socialProviders: {
    github: {
      clientId: env.BETTER_AUTH_GITHUB_CLIENT_ID,
      clientSecret: env.BETTER_AUTH_GITHUB_CLIENT_SECRET,
      // R-T3-phase4 (OWASP A05/A07): redirectURI removed — better-auth derives
      // it from `baseURL`, so no hard-coded localhost in production.
    },
  },
  // ── 生产级限流（OWASP A07 / A08）：auth 端点防暴破 ──────────
  // 登录/忘记密码收紧为独立规则；单机部署用内存存储，
  // 多副本部署需配 rateLimit.storage 共享 Redis/Upstash。
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
