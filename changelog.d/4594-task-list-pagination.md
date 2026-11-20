## Fixed

- 历史记录列表分页双重失效（#4594）：`task.list` 的 `hasMore` 恒为 `false`（扫描只取一页行数，
  「多取一行」只写在注释里），任务超过一页后「加载更多」永远不出现；同时仓储 relational 分支
  把 `offset` 静默丢弃，即使翻页也会重复返回第一页。现在扫描多取一行判 hasMore、findMany 分支
  透传 offset，并补「两页不重不漏 + hasMore 推进」的回归用例。
