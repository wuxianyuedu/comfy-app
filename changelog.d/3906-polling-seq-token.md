## Fixed

- 多处轮询无轮次令牌（#3906）：请求耗时超过轮询间隔（dev 热重载 / 卡顿窗口）
  时两发在途，先发后至者把旧快照盖在新快照上——run 状态 / 项目阶段条短暂
  回跳、RawCli 弹窗行数回退一拍。`use-agent-run`、`use-project-home`、
  `WorkflowRunRawCliModal` 三处补 seqRef 轮次令牌（样板：
  `use-runtime-log-source`），只接受最新一次发起的响应。
