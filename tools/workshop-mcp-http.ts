// ── Workshop MCP：HTTP(Streamable) transport 入口（tools/workshop-mcp-http.ts）───
// 独立 Node HTTP 服务，暴露 Streamable MCP 端点（默认 http://127.0.0.1:4300/mcp），
// 供应用内 agent 或支持 HTTP MCP 的客户端连接。与 stdio 共用同一份工具定义。
//
// 采用无状态模式（sessionIdGenerator: undefined + enableJsonResponse），
// 每个请求新建 server/transport，无需会话存储。日志走 stderr。
//
// **可达面是本机回环**：这些工具会改库、删会话、发起出图/出视频（花的是本机额度），
// 而入口没有任何鉴权 —— 所以「谁能连上」就是唯一的信任边界。`listen()` 省略 host
// 时 Node 绑 `::`（所有网卡，Windows 双栈下同形暴露 IPv4），同网段主机与用户浏览器里
// 打开的任意站点都能驱动它；故这里显式取 `~/lib/endpoints` 的 `LOOPBACK_HOST`
// （硬规则 20：回环主机只有这一个出处，且必须写 `127.0.0.1` 不写 `localhost`）。
import http from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildWorkshopMcpServer } from "@/server/mcp/workshop-mcp";
import { LOOPBACK_HOST } from "~/lib/endpoints";

const PORT = Number(process.env.MCP_HTTP_PORT ?? 4300);
const ENDPOINT = process.env.MCP_HTTP_PATH ?? "/mcp";

/* 跨源默认**关闭**：本机原生 MCP 客户端不需要 CORS，而发出通配头等于把「任意网页
 * 可驱动这些写操作」这条路径打开。确有浏览器客户端时，用 `MCP_HTTP_ALLOWED_ORIGINS`
 * 逐条放行具体 origin（逗号分隔，不做通配）。 */
const ALLOWED_ORIGINS = (process.env.MCP_HTTP_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0);

const httpServer = http.createServer((req, res) => {
  const origin = req.headers.origin;
  if (typeof origin === "string" && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Accept, MCP-Protocol-Version",
    );
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  if (req.url?.startsWith(ENDPOINT) && req.method === "POST") {
    void handlePost(req, res);
    return;
  }

  res
    .writeHead(405, { "Content-Type": "text/plain" })
    .end("Method Not Allowed");
});

async function handlePost(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  try {
    const mcp = buildWorkshopMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    await mcp.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error("[workshop-mcp-http] 处理请求失败:", err);
    if (!res.headersSent) res.writeHead(500).end("Internal Server Error");
  }
}

httpServer.listen(PORT, LOOPBACK_HOST, () => {
  console.error(
    `[workshop-mcp-http] Workshop MCP HTTP 服务已启动: http://${LOOPBACK_HOST}:${PORT}${ENDPOINT}（仅本机回环；跨源客户端需登记 MCP_HTTP_ALLOWED_ORIGINS）`,
  );
});

process.on("SIGTERM", () => {
  httpServer.close();
  process.exit(0);
});
process.on("SIGINT", () => {
  httpServer.close();
  process.exit(0);
});
