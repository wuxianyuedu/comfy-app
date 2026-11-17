## Fixed

- **后台启动分支失败不再静默**（#4257）：instrumentation 的功能分支（任务派发 /
  孤儿任务回收 / 成片监看恢复）失败时只有一行 boot 日志——任务永久 QUEUED、
  孤儿任务永不对账、影片永停 GENERATING。现在失败**立即记账**落盘
  `run/boot-branches.json`，并由新端点 `GET /api/dev/boot-branches` 暴露；消息中心
  在新进程就绪后读取，把仍失败的分支记成可见提示（含后果与「重启应用」指引；
  确定性 id 幂等，刷新/重复轮询不重复）。观测类分支（event-loop-watch /
  sentry）的失败不提示。`COMFYAPP_BOOT_BRANCH_FAIL=<名[,名…]>` 为测试注入点。
- 记账模块收进 `src/lib/shell/`（R13 子域归属）。
