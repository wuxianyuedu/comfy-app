## Fixed

- MCP / stdio 通道的媒体拉取（`resolveMediaDataUrl`）改走与 Next 侧同一份 SSRF 判据。
  此前它是裸 `fetch`——模型/客户端可把内网或云元数据地址写进 `Shot.imageUrl`，让
  服务端代发对内网的请求。实现拆出**不带 `server-only`** 的
  `src/lib/network/outbound-url-core.ts`（纯 Node 宿主可加载），`outbound-url.server.ts`
  变成服务端标记 + 再导出，Next 侧 import 面不变；MCP 侧经 `safeFetch` 走
  `remote-media` 场景（拦回环/私网/链路本地/云元数据、重定向逐跳校验）。（#4452）
