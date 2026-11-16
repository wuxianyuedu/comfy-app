## Fixed

- **`task.list` 补真分页与截断可见性（#4044）**：路由此前不暴露翻页参数
  （仓储层早已支持 skip）——历史页「加载更多」只在同一份 60 条里切；media
  过滤靠 400 行内存扫描，凑不满一页就静默返回、无「还有更多」标记；排序仅
  `desc(createdAt)` 无 tiebreaker。现在：路由暴露 `cursor`（tRPC 无限查询
  自动带入）、响应带 `hasMore` / `scanned`、排序补 `desc(id)` tiebreaker，
  历史页改用无限查询接真分页。接口契约与兼容审计 #3907 的 P2 项。
