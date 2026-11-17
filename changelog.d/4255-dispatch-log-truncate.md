## Fixed

- **派发日志的输入参数序列化截断到 4000 字符**（#4255）：生成入参的端口值
  无大小上限，全量 `JSON.stringify(…, null, 2)` 进任务日志会落出 MB 级单行
  随 persistLogs 落库、进面板。完整参数仍在 task.params 里，日志只是排障现场。
