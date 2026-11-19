## Fixed

- **后台 schema 同步子进程不再脱离进程树（#4005）**：`spawnSchemaSync` 此前
  `detached: true` + `unref()` 拉起 drizzle 同步——POSIX 上自建进程组逃出 launcher
  的组回收，launcher 退出后成孤儿并握着 db.sqlite 句柄（期间对该检出 `pnpm install`
  会 EPERM 连锁失败）。现在留在调用方进程组里（组回收照常收得到），`unref` 的
  「不吊住事件循环」语义保留；子进程自身另有 600s 预算兜底。可终止性审计 #3889
  的 P2 项。
