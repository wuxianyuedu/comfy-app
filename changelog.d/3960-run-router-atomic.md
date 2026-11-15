## Fixed

- **Run 控制路由 mutation 原子化与进度字段保留（#3960 / #3850）**：新增 `productionRepository.mutateRun`，在 immediate 事务内重读当前 `run` 后应用控制写；`start` / `pause` / `resume` / `approve` / `cancel` 改为基于事务内当前状态做控制态变更，并保留引擎进度字段（stage/log/rev 快照/评审与成片标记等），收口控制路由 stale RMW 对并发推进结果的覆盖风险；补充路由与仓储回归用例。
