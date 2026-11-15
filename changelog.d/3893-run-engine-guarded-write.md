## Fixed

- run 引擎整包回写覆盖用户意图位（#3893）：`productionRepository` 新增
  `updateRunGuarded`（封禁状态不在名单内才写，判断收在同一条 UPDATE 里），
  引擎的 `saveRun` 全部改走它并封禁 `paused / cancelled` —— 用户在长动作
  （LLM / 逐镜生图，分钟级窗口）期间点的暂停 / 取消，不再被拍初旧快照回退成
  running，引擎下一拍重读即让位；取消与失败收口相交时取消优先。
