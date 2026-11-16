## Fixed

- tRPC 错误日志按错误码分级：`INTERNAL_SERVER_ERROR` 升为 `error` 并附带堆栈，客户端错误维持 `warn`，`UNAUTHORIZED`/`FORBIDDEN` 等预期内鉴权拒绝不再记录，避免真故障淹没在告警噪声里（#4093）
