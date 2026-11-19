## Fixed

- **shell-launch.log 补上轮转上限**（#4389）：编排链路日志原为「追加不轮转」，
  prebuilt 长开会话里编排器/服务的持续输出会把文件推到无界。现在与 shell.log
  同一取向：超过 40MB 整份重建（丢旧保新），判据收在 shell_launch.rs 一处。
