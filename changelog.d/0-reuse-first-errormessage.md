## Changed

- **按 §12.18 接线 #1（errorMessage 子批）**：把「家已存在、却仍手拼 `e instanceof Error ? e.message : X`」的**展示串/日志串**落点收口到 `~/lib/error-message` 的 `errorMessage(e, X)`——9 处 / 7 文件：`use-dynamic-workflow-form`（上传失败）、`use-model-adapters`（保存失败）、`executor-scheduler`（已 import errorText 却漏用 errorMessage）、`server/api/routers/workflow`（3 处）、`server/workshop/llm`、`DebugChainFooter`（读取源码失败）、`WorkflowCanvasNodePreview`。tsc + eslint + 受影响测试 72 例全过。
  - **刻意未接（门禁联动，各属另一个家）**：API route 里 `NextResponse.json({ error: … })` 的信封拼法 → P32 要求 `apiErrorBody`（会改响应形状，独立迁移）；`use-encapsulation-test-run` / `use-workshop-agent` 的 try/catch+setState+finally 反馈样板 → P27 要求 `runAsyncAction`；`llm/browser` 等网络错误路径 → `errorMessage` 会翻译网络错误、撞断言原文的测试（如 `browser.test.ts:330` 断言 `"Failed to fetch"`）。这些留作各自专注迁移，不在本批盲扫。
