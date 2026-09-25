## Fixed

- **为 `workflow.list` 的本地工作流目录扫描加 30 秒整体超时**：`src/server/api/routers/workflow.ts`
  工作流库首次加载时，若用户配置的本地工作流目录位于特殊文件系统（网络映射盘、
  WSL 路径、云盘占位符等），`fs.promises.readdir/stat` 可能长时间挂起而不抛错，
  导致 `workflow.list` 请求永远不返回，前端一直显示「正在加载工作流…」。
  现使用 `~/lib/with-timeout` 的 `withTimeout` 给 `scanLocalWorkflowRoots` 包一层
  30 秒超时，超时后抛出 `TimeoutError`，由 tRPC 转成可展示错误，前端不再无限转圈，
  用户能看到「工作流列表加载失败：扫描本地工作流目录超时（30s）」并可重试。
  同时在前端 `useWorkflowLibrary` 集成测试中新增 fake-timer 用例，锁住「首次拉取
  卡住超过 `LIST_STALL_MS` 后 `loadStalled` 必为 true」这一行为。
