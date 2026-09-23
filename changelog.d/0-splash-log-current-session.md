## Fixed

- **启动页日志面板混入历史启动内容**：`log/launcher/shell-launch.log` 是追加写，会累积历次启动日志，而启动页 `get_launch_log` 原先只取尾部，导致旧启动的 `[orchestrator]` 条目与本次启动混在一起，时间戳横跨多天，容易误判当前状态。现在壳在每次启动时先往 `shell-launch.log` 写入一次会话标记，`get_launch_log` 只返回最后一个标记之后的行，从而保证面板仅展示本次启动相关日志。需重编壳生效。
