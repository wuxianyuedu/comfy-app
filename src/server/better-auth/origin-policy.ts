/** 认证 origin 策略（**唯一出处**）：桌面形态端口**运行期才定**（`standalone-runtime-env.mjs` 按壳挑端口），
 * 编译期写死的 baseURL 永远不对 —— dev/e2e/桌面包三条链路端口各不同，还按检出路径推导（3200~3999）。
 * better-auth 1.7 的**动态 baseURL** 按请求 `Host` 解析 origin（`resolveRequestContext()` 每请求克隆），
 * 于是同时覆盖三条链路且无值进产物。三个坑（本机实测 1.7.7）：①`getHost()` 带端口 ⇒ 名单须 `127.0.0.1:*`；
 * ②动态配置后「Base URL is not set」永不出现；③显式 `trustedOrigins` **顶掉**派生名单（二选一 ⇒ 须写全）。 */
import { getBaseUrl } from "~/trpc/base-url";

/**
 * 回环 host 的允许名单（**带端口形状**，见上面 ①）。只收回环：本仓是本机应用（桌面壳 + 本地 sidecar），
 * 应用自身 origin 恒为回环。将来若公网部署：把域名加进名单，**同时**把 `protocol` 收紧为 `https`
 * （`auto` 会把 http 与 https 两个变体都算成可信 origin）。
 */
export const AUTH_LOOPBACK_HOST_PATTERNS = ["127.0.0.1:*", "localhost:*"];

/** 配置项（`BETTER_AUTH_URL`）给出的 host（带端口）；没给或不是 URL 就是空。 */
function configuredHost(configuredBaseUrl?: string): Array<string> {
  if (configuredBaseUrl === undefined) {
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
  if (configuredBaseUrl === undefined) {
    return [];
  }
  try {
    return [new URL(configuredBaseUrl).origin];
  } catch {
    return [];
  }
}

/**
 * better-auth 的动态 baseURL 配置。`fallback` 用在**解析不出 host** 的场合（构建期没有请求、请求没有
 * `Host` 头），以及 host 不在允许名单时（**落兜底**，而不是解析成那个 host）。兜底值取 `getBaseUrl()`
 * （应用自身 origin）—— 与 tRPC 自调用同一口径，不另写一份拼法。
 */
export function authBaseUrlConfig(configuredBaseUrl?: string) {
  return {
    allowedHosts: [...AUTH_LOOPBACK_HOST_PATTERNS, ...configuredHost(configuredBaseUrl)],
    fallback: configuredBaseUrl ?? getBaseUrl(),
    /* SAFETY: 类型断言已复核 */
    protocol: "auto" as const,
  };
}

/**
 * 显式可信 origin 名单（见上面 ③：显式这份**顶掉**派生那份，所以必须写全）。形状是 **host 形状**
 * （带 `*`）而不是完整 origin：`matchesOriginPattern()` 对带 `*` 且不带 `://` 的模式按 host 比对
 * （`getHost(url)`，带端口）⇒ 一条 `127.0.0.1:*` 同时管住 http 与 https 两个变体。
 */
export function authTrustedOrigins(configuredBaseUrl?: string) {
  return [...AUTH_LOOPBACK_HOST_PATTERNS, ...configuredOrigin(configuredBaseUrl)];
}
