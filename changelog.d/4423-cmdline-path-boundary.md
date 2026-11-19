## Fixed

- launcher：`cmdlineBelongsToRoot` 子串命中后要求**路径边界**（base 后一位必须是
  命令行结尾或 `/` `\`）。裸子串下，前缀兄弟检出（`…comfy-app-t3-branch3-old` 的
  命令行包含 `…comfy-app-t3-branch3`）与「命令行恰好带着本检出绝对路径的无关进程」
  都会命中——PID 复用撞上会话锚点里的陈旧 PID 时会连同子树被误杀。形状判据保持
  放宽（不要求 dev/start/next 形状），盖住 db-sync / executor-host 的语义不变。
  （#4423）
