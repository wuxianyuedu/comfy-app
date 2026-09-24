## Fixed

- **启动页「查看日志」混入历史启动内容**：`log/launcher/shell-launch.log`、`log/launcher/dev-launcher-stderr.log`、`log/shell/shell.log` 三份都是追加不轮转的固定名文件，会累积历次启动的日志，而启动页 `get_launch_log` 原先对后两份只取尾部，导致旧启动的 stderr / 壳诊断与本次启动混在一起（用户的截图里 `dev-launcher-stderr.log` 还停在 09-20，`shell.log` 混着 09:58 与本次），时间戳横跨多天，容易误判当前状态。现在壳在每次启动时往这三份文件各写一行会话标记（`=== 启动会话开始（shell_pid: N）`），`get_launch_log` 对它们统一只返回最后一个标记之后的行，从而保证面板仅展示本次启动相关日志。需重编壳生效（`src-tauri/src/**` 改动，见 §5）。
