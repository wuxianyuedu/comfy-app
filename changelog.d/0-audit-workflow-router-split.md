## Changed

- **workflow 路由按子域拆分**（`src/server/api/routers/workflow.ts` 943 行 →
  组合根 19 行 + `workflow-list` / `workflow-detail` / `workflow-mutations` /
  `workflow-local-roots` 四个子域文件）：procedure 的 key 逐字不变，客户端
  `RouterOutputs` 类型不受影响；结构门禁的「944 行拆分候选」提醒随之消除。

## Fixed

- **本地工作流「导入安全边界比扫描器严」的死胡同**：list 的磁盘扫描用
  `readEnvVar` 实时读 `.env` 的 `LOCAL_WORKFLOWS_PATH`，create 的导入守卫却读
  `process.env` 启动快照——`.env` 新增目录后界面扫得出「待导入」项、点击导入
  被守卫以「只允许导入配置目录下的文件」拒绝。现在两个口径收进
  `workflow-local-roots.ts` 的同一份出处（回归测试
  `workflow-local-roots.test.ts`）。
