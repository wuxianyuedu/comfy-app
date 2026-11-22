## Fixed

- **ollama-start 的 runtime 日志 writer 随启动会话走**（ISSUE #4733）：此前挂在模块
  作用域——并发 POST 走「已在运行 / 服务在跑」分支时，会把 `[state]` 行写进上一次
  启动会话的日志文件；会话结束后也不清空，残留到下次 `beginOllamaSession`。现由
  `beginOllamaSession` 返回、调用方持有并传给 spawn 的全部回调；无会话的分支不再
  串台写别人的文件（出口走响应体）。
