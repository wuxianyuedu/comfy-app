// ── Workshop MCP：HTTP(Streamable) transport 入口 ─────────────
// 独立 Node HTTP 服务，暴露 Streamable MCP 端点（默认 http://localhost:3001/mcp），
// 供应用内 agent 或支持 HTTP MCP 的客户端连接。与 stdio 共用同一份工具定义。
//
// 采用无状态模式（sessionIdGenerator: undefined + enableJsonResponse），
// 每个请求新建 server/transport，无需会话存储。日志走 stderr。
import http from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildWorkshopMcpServer } from "@/server/mcp/workshop-mcp";

const PORT = Number(process.env.MCP_HTTP_PORT ?? 3001);
const ENDPOINT = process.env.MCP_HTTP_PATH ?? "/mcp";

const httpServer = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, MCP-Protocol-Version");

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  if (req.url?.startsWith(ENDPOINT) && req.method === "POST") {
    void handlePost(req, res);
    return;
  }

  res.writeHead(405, { "Content-Type": "text/plain" }).end("Method Not Allowed");
});

async function handlePost(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
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
    console.error("[mcp-http] 处理请求失败:", err);
    if (!res.headersSent) res.writeHead(500).end("Internal Server Error");
  }
}

httpServer.listen(PORT, () => {
  console.error(`[mcp-http] Workshop MCP HTTP 服务已启动: http://localhost:${PORT}${ENDPOINT}`);
});

process.on("SIGTERM", () => {
  httpServer.close();
  process.exit(0);
});
process.on("SIGINT", () => {
  httpServer.close();
  process.exit(0);
});
