## Fixed

- master 全量单测基线红：#4248 把 shell_launch.rs 的锁获取改成防中毒形态（`unwrap_or_else(PoisonError::into_inner)`）后，win-job 形态用例里两条旧字符串 pin 当场过期（#4259）。改为双形态正则（unwrap 与防中毒都算在场）——这条 pin 的语义是「句柄存进 static 且赋值发生」，不钉锁的错误处理写法，此后两类写法互改不再红。
