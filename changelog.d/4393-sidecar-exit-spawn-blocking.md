## Fixed

- **sidecar 退出记录挪进阻塞线程池**（#4393）：Terminated 事件回调跑在 tokio
  worker 上，分支里的 `write_sidecar_exit_record` 是同步文件 IO（create_dir_all +
  write + rename）。一次性小文件写，但没必要占住 async 上下文——挪进
  `spawn_blocking`，与 #4334 的取向一致。
