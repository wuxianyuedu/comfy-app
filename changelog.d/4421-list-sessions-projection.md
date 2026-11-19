## Fixed

- 工坊会话列表改摘要投影：`listSessions` 只取标量列 + `length()` /
  `json_array_length()`，不再把 `idea` / `scriptMarkdown` / `scenes` / `characters` /
  `shots` 五个内容列整批拉回内存后只留摘要——会话表没有清理路径、只增不减，
  列表页随历史长度线性变慢。内容本体留给 `getSession` 的单行读；摘要字段与
  旧口径一致。（#4421）
