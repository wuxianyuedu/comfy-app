## Fixed

- **日志管线 EPIPE 自激循环切断 + 转录按大小轮转**（#4948）：stdout/stderr 断管（EPIPE）后，兜底打印再经被补丁的写出口反复抛错、把单份运行转录刷到 4.5GB 撑爆磁盘。现在给 stdout/stderr 挂上空 `error` 监听（断管的异步抵达路径也不再变成 uncaughtException），配合既有的同步 EPIPE 降级彻底切断循环；转录补上按大小轮转——单段超 64MiB 即换 `<boot>.<n>.log` 新段（读侧按 mtime 取最新仍命中活动段），单文件不再可能无界增长。
