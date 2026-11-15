## Fixed

- **镜头评审 / 抽卡优选的写回收进内容写锁（#4019）**：`review.ts` 的
  `reviewShotImage` 与 `autoselectShotImage` 此前锁外拿 T0 快照、LLM 慢 IO 后
  整列回写 `production.shots`——评审期间持锁写者（工坊自动保存 / 生图回写 /
  成片回写）写入的内容被旧快照静默回滚。现在打分留在锁外、落判定收进
  `withProductionContentLock` 锁内重读最新 shots 再叠加，与同文件其余三处及
  全仓其他写者同一纪律。一致性（双写）审计 #3890 的 P1 项。
