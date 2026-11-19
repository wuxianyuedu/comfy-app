## Fixed

- **流程测试（工坊封装页签）的 SSE 订阅随卸载撤销**（#4461）：与 use-generation-runner
  的 #3912 修法同款 —— 发起路径 `watchWorkflowRun` 的 closer 登记进 ref，生成中切到
  「画布节点」页签即撤销订阅，不再让 EventSource 存活到任务终态（持续打日志、
  占用同源连接）；切回本页签由恢复路径重订（服务端全量回放历史帧、store 按
  (taskId, msg) 去重，撤销安全）。
