## Fixed

- `db-schema-ready` 只缓存肯定结论（#3875，审计源 #3848）：`missing`/`unknown` 不再被永久缓存，表后建（db:push 晚于服务启动）或 PRAGMA 瞬时撞锁后，reaper 等库侧副作用能在下一拍自动恢复，不再被静默禁用到进程退出。
