## Fixed

- 修复日志捕获流把 dev server 打成「活着但不服务」僵尸态的回路（#3534）：对端
  （dev-launcher 日志采集侧）被强杀后，`process.stdout/stderr` 的每一次 write 都同步抛
  EPIPE，异常从转录包装冒出去成 uncaughtException，而 Next 的默认处理器自己又经
  `console.error` 写 stderr → 再过同一包装 → 再抛。`patchedWrite` 现在对 EPIPE 单独降级：
  标记流已断、后续写跳过原 fd 只保留面板转录；callback 以成功形态放行（错误形状会在流
  机制里变成无人监听的 error 事件）；非 EPIPE 错误不掩盖，那才是真正的程序缺陷。
