## Fixed

- **日志端点鉴权收尾与写入端点滥用约束（ISSUE #4051）**：`/api/logs/current`、`/api/logs/sessions`、`/api/logs/app-runtime` 三条的服务端鉴权已随 #4041 落地，本轮补上防回退回归用例——三条端点未登录一律 401 且不触达日志读写；写入端点 `app-runtime` 另加最小滥用约束：复用 tRPC `rateLimitedProcedure` 同一套滑动窗口限流（窗口内超限 429），`fields` 序列化超长整段替换为截断标记（`RUNTIME_LOG_FIELDS_MAX = 4000`），该只追加不轮转的日志文件单行体积有界。
