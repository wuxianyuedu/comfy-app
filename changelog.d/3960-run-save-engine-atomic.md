## Fixed

- **Run 引擎 run 回写原子化与控制态优先（#3960 / #3850）**：新增 `productionRepository.saveEngineRun`，在 immediate 事务内重读当前 `run` 并按控制态优先级合并后写回，收口引擎 `saveRun` 的跨语句 TOCTOU；`cancelled` 终态不被覆盖，`paused` 优先于引擎推进/失败收口（吸收进度与日志但保持暂停），降低并发窗口下状态回退风险。
