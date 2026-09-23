## Added

- **AI 自主执行的运行日志（Phase 7 配套）**：`ProductionRun` 加有界 `log: RunStep[]`（`appendRunStep` 尾部追加、超 `RUN_LOG_LIMIT` 裁剪，`normalizeProductionRun` 宽容解析）。服务端 `advanceRunLoop` 每执行一个动作追加一条 `{ts,kind,ok,detail}`——`detail` 是人读产出摘要（「已生成剧本（N 字）」「已提取 N 个角色」「已规划 N 个镜头」「逐镜生图：X 成功 / Y 失败」「已启动成片」「全流程完成，已出片」，失败则错误原因）。`run.status` 已带回 `run`（含 log），CLI / 控制条据此展示「到底跑了什么」。纯等待步（出片未就绪）不落日志，避免每拍刷屏。

## 说明

引擎侧先把日志产出并持久化；`agent-film` CLI 消费该 `run.log` 打印执行轨迹（CLI 侧改动在 #921 分支）。
