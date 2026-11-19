import "server-only";

/**
 * 服务端出网 URL 约束的 Next 侧入口：实现本体在 `./outbound-url-core`
 * （#4452 起拆出**不带 `server-only`** 的核心，供纯 Node 宿主——MCP/stdio
 * 通道的 `api-channel.ts`——共享同一份 SSRF 判据；本文件只剩服务端标记与
 * 再导出，Next 侧既有 import 面不变）。
 *
 * @module lib/outbound-url.server
 */
export {
  assertSafeOutboundUrl,
  isUnsafeOutboundUrlError,
  safeFetch,
  UnsafeOutboundUrlError,
} from "./outbound-url-core";
export type { OutboundUrlScenario, SafeFetchInit } from "./outbound-url-core";
