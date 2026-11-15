## Fixed

- **起片补偿清理改为原子操作（#3939 / #3850）**：`productionRepository.clearFilmStart` 改为在 immediate 事务内重读 `production.run` 并仅清空 `filmStartedAt` 后写回（与 `claimFilmStart` 对称），避免补偿路径的跨语句 RMW 将并发写者对 run 的更新一并覆盖。
