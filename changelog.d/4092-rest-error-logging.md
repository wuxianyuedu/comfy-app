## Fixed

- REST 错误出口 `errorResponse()` 按状态分级落服务端日志：≥500 记 `error`（带原始异常与堆栈），4xx/401 只记 `debug` 不进告警面；响应体仍不下发堆栈（#4092）
