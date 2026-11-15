## Fixed

- execFilm 起片前先在 immediate 事务里 CAS 认领 `filmStartedAt`（#3868，审计源 #3848）：起片失败立刻释放、可重试；崩溃窗口内重启不再建出第二条完整成片管线。
