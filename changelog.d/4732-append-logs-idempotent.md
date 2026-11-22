## Fixed

- **`appendLogs` 幂等化，防抖与收口双跑不再丢整列写**（ISSUE #4732）：防抖定时器的
  `flushLogsDelta` 与收口点 `persistLogs` 并发进入时，双方可能在对方推进游标前用旧游标
  算出同一批 delta 并各自追加——第二批撞 `taskLog` 复合主键 `(taskId, seq)` 抛错被 catch
  吞成 warn，这一次的 `task.logs` 整列写没有执行。追加本身是幂等操作（同 seq 同内容），
  现加 `onConflictDoNothing`（目标 = 复合主键），撞键即跳过，不再丢写。
