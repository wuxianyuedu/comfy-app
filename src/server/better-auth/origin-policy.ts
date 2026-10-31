/**
 * 认证 origin 策略（**唯一出处**）。
 *
 * 为什么是「动态」而不是一个常量：桌面形态的端口是**运行期才定的**
 * （`scripts/launcher-core/standalone-runtime-env.mjs` 按壳挑的端口装运行期 env），
 * 编译期写死的 baseURL 对它永远不对 —— 而 dev / e2e / 桌面包三条链路的端口各不一样，
 * 端口还按检出路径推导（3200~3999，见 `scripts/app-port.mjs`）。
 * better-auth 1.7 的**动态 baseURL** 按请求的 `Host` 头解析 origin
 * （`resolveRequestContext()` 每请求克隆一份 context），于是这一处策略同时覆盖
 * 三条链路，且**没有任何一个值进产物**。
 *
 * 三个坑（都是本机实测 better-auth 1.7.7 的实现得出的，不是从文档转述的）：
 *
 *  ① **host 带端口**：`getHost()` 取 `new URL(url).host` ⇒ 允许名单必须写成
 *     `127.0.0.1:*` 这种**带端口**的形状；写 `127.0.0.1` **不匹配**
 *     （实测 `matchesHostPattern("127.0.0.1:3823", "127.0.0.1")` = false，
 *     同一 host 对 `"127.0.0.1:*"` = true）。
 *  ② **那条警告的触发条件**是 `!baseURL && !isDynamicBaseURLConfig(baseURL)`
 *     ⇒ 给动态配置后「Base URL is not set」**永不出现**（构建期那 30 条一起消）。
 *  ③ **显式 `trustedOrigins` 数组会顶掉派生名单**：origin 校验取
 *     `options.trustedOrigins`（数组形态）**或**派生那份 —— 二选一，不是相加
 *     ⇒ 显式那份必须自己写全（回环两个形状 + 配置项的 origin）。
 */
import { getBaseUrl } from "~/trpc/base-url";

/**
 * 回环 host 的允许名单（**带端口形状**，见上面 ①）。
 *
 * 只收回环：本仓是本机应用（桌面壳 + 本地 sidecar），应用自身的 origin 恒为回环。
 * 将来若公网部署：把域名加进这份名单，**同时**把 `protocol` 收紧为 `https`
 * （`auto` 会把 http 与 https 两个变体都算成可信 origin）。
 */
export const AUTH_LOOPBACK_HOST_PATTERNS = ["127.0.0.1:*", "localhost:*"];

/** 配置项（`BETTER_AUTH_URL`）给出的 host（带端口）；没给或不是 URL 就是空。 */
function configuredHost(configuredBaseUrl?: string): Array<string> {
  if (!configuredBaseUrl) {
    return [];
  }
  try {
    return [new URL(configuredBaseUrl).host];
  } catch {
    return [];
  }
}

/** 配置项给出的 origin（scheme + host）；没给或不是 URL 就是空。 */
function configuredOrigin(configuredBaseUrl?: string): Array<string> {
  if (!configuredBaseUrl) {
    return [];
  }
  try {
    return [new URL(configuredBaseUrl).origin];
  } catch {
    return [];
  }
}

/**
 * better-auth 的动态 baseURL 配置。
 *
 * `fallback` 用在**解析不出 host** 的场合（构建期没有请求、请求没有 `Host` 头），
 * 以及 host 不在允许名单时（**落兜底**，而不是解析成那个 host）。
 * 兜底值取「应用自身 origin」那一份（`getBaseUrl()`）—— 与 tRPC 自调用同一口径，
 * 不另写一份拼法。
 */
export function authBaseUrlConfig(configuredBaseUrl?: string) {
  return {
    allowedHosts: [...AUTH_LOOPBACK_HOST_PATTERNS, ...configuredHost(configuredBaseUrl)],
    fallback: configuredBaseUrl ?? getBaseUrl(),
    protocol: /* SAFETY: 类型断言已复核 */ "auto" as const,
  };
}

/**
 * 显式可信 origin 名单（见上面 ③：显式这份**顶掉**派生那份，所以必须写全）。
 *
 * 形状是 **host 形状**（带 `*`）而不是完整 origin：better-auth 的
 * `matchesOriginPattern()` 对带 `*` 且不带 `://` 的模式按 host 比对
 * （`getHost(url)`，带端口）⇒ 一条 `127.0.0.1:*` 同时管住 http 与 https 两个变体。
 */
export function authTrustedOrigins(configuredBaseUrl?: string) {
  return [...AUTH_LOOPBACK_HOST_PATTERNS, ...configuredOrigin(configuredBaseUrl)];
}
