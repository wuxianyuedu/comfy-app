## Fixed

- `createSession` 指纹去重的并发旁路（#3908 的会话半边）：改为**先占位后创建** ——
  指纹账本在调用 `repo.createSession` 之前就写入同一个 promise，并发同参调用共享
  同一次创建，不再各建一套「会话 + 项目 + production」；创建失败撤掉占位，不把
  rejection 留在 TTL 窗口里。`task.retry` 半边随后续批次处理。
