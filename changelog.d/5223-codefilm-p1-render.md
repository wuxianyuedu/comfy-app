## Added

- 代码驱动影片 P1（#5223）：合同编译器接 LLM（`contract-compiler.server.ts`，最多 3 次有界 QA 修复重试）；
  服务端编排 `runCodeFilm()` 把合同落 `production.shots` 并逐镜 `createWorkflowRunTask` 入队，失败补偿取消；
  `codeFilm` 追加 `generate` / `render` / `status` 三口；工坊 MCP 追加 `codefilm_generate_contract` /
  `codefilm_validate_contract` / `codefilm_preview_shots` 三工具（纯 Node 侧平行实现，不引 server-only）；
  Agent 的 `generate_shot_images` stub 改为可行动提示。31 条新用例覆盖编译器重试、入队顺序、失败补偿、
  QA 前置拒绝与 router / client 接线。
