## Fixed

- **`executor-ws` 的 `wsWaitLogged` 去重表封顶（512 条、插入序淘汰）**（#4351）：
  该表防止对同一排队任务反复刷「WS 未就绪」提示，清空路径只有 WS open 一条；
  ComfyUI 长期起不来（自动启动被闩锁抑制后不再重连）时，集合随宕机期新进入
  提示窗口的任务只增不减。写入侧改走 `runner-state` 的 `touchAndEvict`（本次
  导出为共享地基，与日志驻留、instrumentation 异常去重同一形态），键数封顶、
  按插入序淘汰最旧；被淘汰的冷键最多再提示一行 warn，不放大成刷屏。
  `wsWaitLogged` 由 `Set<string>` 换成 `Map<string, true>`，`has`/`clear` 语义不变。
