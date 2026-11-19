## Fixed

- **ComfyUI bound 拉起与 Drizzle Studio 的 spawn 补上 `error` 监听**（#4202）：异步 spawn
  失败（EACCES / 被安全软件拦截 / existsSync 校验与真正 spawn 之间的竞态）走的是 error
  事件而不是同步抛错，且 `exit` 不会发——此前不接住就是 uncaughtException 打挂应用服务，
  启动等待循环还会空转到 deadline（手动启动没有 deadline）。现在按「进程没了」同形收口：
  清句柄（等待循环据此判死、用留底给出口）+ 落运行日志与退出账。
