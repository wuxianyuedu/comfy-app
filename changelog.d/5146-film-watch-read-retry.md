## Fixed

- 成片监看不再因一次瞬时锁冲突整部判死（#5146）：四处仓储读包进 `runWithSqliteBusyRetry`
  （新增 `FILM_WATCH_READ`：8 次 × 500ms，只重试锁族）；重试穷尽后若仍是 SQLite 锁族，
  只写「瞬时锁冲突 / 重启恢复扫描会接回」日志、不 `markFailed`、不撤在飞任务，
  在飞表清空交给 boot 扫描接回。错误日志改用 `sqliteAwareErrorText` 带底层原因。
  同批补读失败回归与源码形态断言。
