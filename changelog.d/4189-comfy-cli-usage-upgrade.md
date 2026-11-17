## Added

- **comfy-cli v1.24+ 用法升级（#4189）**：`comfy run` 提交带按任务拼接的
  `--client-id`（ComfyUI 侧队列 / 历史与服务端日志可对账本次提交，补上此前
  「cli 自己生成 id 无法反查任务」的盲区）；工作流库「实际使用」页签新增
  「调试：只跑到指定输出」——勾选后经 comfy-cli v1.24.0 的
  `--output-node-ids`（可重复）只执行目标输出及其依赖子图，用于把执行故障
  逐分支二分；执行流解析识别并落出 `partial_execution` /
  `partial_execution_targets_ignored` 回执（后者以 warn 提醒「服务端按全图
  执行」）。新增 comfy-cli 执行排障指南
  （`docs/guides/comfy-cli-debug.md`：版本确认 → validate → 部分执行 →
  jobs 跟踪）。
