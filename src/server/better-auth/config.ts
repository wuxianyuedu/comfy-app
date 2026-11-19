import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { env } from "~/env";
import { db } from "~/server/db";
import { authBaseUrlConfig, authTrustedOrigins } from "~/server/better-auth/origin-policy";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "sqlite",
    // 表名单数（user/session/account/verification），对齐现有库
    usePlural: false,
  }),
  // 动态 baseURL：origin 按**请求的 Host 头**解析（better-auth 1.7 的 `resolveRequestContext()`
  // 每请求克隆一份 context），dev / e2e / 桌包三条链路共用这一处策略且无值进产物 —— 桌面端口
  // 运行期才挑，编译期写死的 baseURL 对它永远不对。三个坑（host 带端口 / 警告触发条件 /
  // 显式 trustedOrigins 顶掉派生那份）与实测读数见 `origin-policy.ts` 的头注。
  baseURL: authBaseUrlConfig(env.BETTER_AUTH_URL),
  // 显式可信 origin 名单（**顶掉** better-auth 按 allowedHosts 派生的那份，所以
  // 必须写全）：回环两个 host 形状 + 配置项给出的 origin。
  trustedOrigins: authTrustedOrigins(env.BETTER_AUTH_URL),
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
      // OWASP A05/A07：已移除 redirectURI —— better-auth 会从 baseURL 推导它（动态形态下 = 那一跑
      // 请求的 origin），生产环境不再残留硬编码 localhost。⚠️ 代价（形态，不是缺陷）：桌面形态的
      // origin 恒为回环且端口运行期才定 ⇒ GitHub 侧无法登记这条回调 URL —— 桌包里的 OAuth 本就
      // 不可用（运行期给的是 `OAUTH_PLACEHOLDER`），本机 dev 同理（端口按检出路径推导）。公网部署
      // 要跑 OAuth，则须在 `BETTER_AUTH_URL` 给出固定 origin。
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
