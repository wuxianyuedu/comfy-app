## Fixed

- codefilm MCP 工具注册拆出 `buildWorkshopMcpServer`（#5227）：三个新工具把该函数撑到 430 行，
  命中函数长度硬闸（§12.13，>400 行阻断）、GA `heavy-gates` 判红拦住合并。
  注册逻辑搬到 `src/server/mcp/codefilm-tools.ts` 的 `registerCodeFilmTools()`，
  `buildWorkshopMcpServer` 只调一行；MCP 工具面 29 条用例与函数长度门禁均恢复全绿。
