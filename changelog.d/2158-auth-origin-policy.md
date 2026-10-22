## Fixed

- **认证 origin 策略一处给：桌面端口随机也天然对，构建期那 30 条「Base URL is not set」
  警告一起消** —— 此前 `baseURL` 取 `env.BETTER_AUTH_URL`，而它是**可选**的：`.env.example`
  里没有这一项、`scripts/dev.mjs` 只透传 `PORT` ⇒ dev 期与构建期都是「没给」，
  `betterAuth()` 每次实例化都打一条警告（一次构建 30 次），而 better-auth 自己的警告明写
  「callbacks and redirects may not work correctly」。
  落成：改用 better-auth 1.7 的**动态 baseURL**（`{ allowedHosts, fallback, protocol }`），
  origin 按**请求的 `Host` 头**解析（`resolveRequestContext()` 每请求克隆一份 context）——
  - dev / e2e / 桌包三条链路共用 `src/server/better-auth/origin-policy.ts` 一处策略，
    **没有任何值进产物**（桌面形态的端口是运行期才挑的，编译期写死的 baseURL 对它永远不对）。
  - 允许名单只收回环，且**必须带端口形状**：`getHost()` 取 `new URL(url).host` ⇒
    `127.0.0.1:*` 匹配、`127.0.0.1` **不匹配**，而**不匹配不报错**（只是解析不出 origin，
    回调落兜底）。
  - `trustedOrigins` 显式写全：origin 校验取 `options.trustedOrigins`（数组形态）**或**按
    `allowedHosts` 派生的那份 —— **二选一，不是相加**。
  - 判据 `tests/better-auth-origin-policy.test.ts` 13 条（名单形状 / 动态解析 / 外来 host
    落兜底 / 兜底与「应用自身 origin」同口径 / 接线不许各写一份）。
  顺带还上 PRODUCTION-GAPS 的 A9 那半（「better-auth 未配 `trustedOrigins`」）；A9 的另两半
  （无 `middleware.ts`、限流仅 1 个 mutation）仍开放。
  （ISSUE #2158）
