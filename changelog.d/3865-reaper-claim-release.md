## Fixed

- reaper 死信清扫改为「先取证、后抢锁」，且收口写库失败时归还一次性认领锁（#3865，审计源 #3848）：证据不足/写库失败不再空占 `settled`/`finalized`，任务不再在本进程存活期内永久卡 QUEUED/RUNNING。
