// ── Workshop MCP：stdio transport 入口 ────────────────────────
// 供外部 AI 客户端（Claude Desktop / Cline / 自定义 agent）以 stdio 连接。
// 用法：tsx tools/mcp-stdio.ts（或经 npx/pnpm exec）。
// 注意：所有日志必须走 stderr，stdout 仅用于 MCP 协议帧。
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildWorkshopMcpServer } from "@/server/mcp/workshop-mcp";

async function main() {
  const server = buildWorkshopMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // 进程随 transport 读取 stdin 保持存活；错误走 stderr，不污染协议流。
}

main().catch((err) => {
  console.error("[mcp-stdio] 启动失败:", err);
  process.exit(1);
});
