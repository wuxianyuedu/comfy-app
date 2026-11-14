## Fixed

- **生产数据 upsert 越权覆盖（#3839 / #3837）**：`ProductionRepository.upsertForUser` 在命中已有生产数据行时校验归属并仅允许同一 `userId` 更新（`and(id,userId)`，不改变 owner），他人 id 命中时拒绝写入（`FORBIDDEN`）；`PUT /api/production` 对该拒绝返回 403 且不覆盖既有数据。同族 `ProjectRepository.upsertForUser` 也补齐归属校验，避免不安全原语被复用。补充仓储与路由回归测试覆盖跨用户覆盖场景。
