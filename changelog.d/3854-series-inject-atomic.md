## Fixed

- **系列角色注入原子性（#3854 / #3848）**：`series.injectToProduction` 将 `production.characters` 的读-改-写收敛到 immediate 事务内，在一致性视图下合并本集关联角色并以 `id + userId` 条件回写，避免并发自动保存/引擎写入导致的丢失更新与归属窗口风险；保持按 name 合并、重复执行幂等。
