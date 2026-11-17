## Fixed

- **后台启动分支失败不再静默**（#4257）：instrumentation 的功能分支（任务派发 /
  孤儿回收 / 成片监看恢复）失败时先**自愈重试**（至多 3 次、间隔 30s），仍失败则
  记账落盘 `run/boot-branches.json`，并由新端点 `GET /api/dev/boot-branches` 暴露；
  消息中心在新进程就绪后读取，把仍失败的分支记成可见提示（含后果与「重启应用」
  指引；确定性 id 幂等，刷新/重复轮询不重复）。观测类分支（event-loop-watch /
  sentry）的失败不提示。`COMFYAPP_BOOT_BRANCH_FAIL=<名[,名…]>` 为测试注入点。
