## Fixed

- SQLite 撞锁重试不再静默（#3954）：`runWithSqliteBusyRetry` 的 `onBusy` 缺省落到标准 logger（首次撞锁一行 warn；显式传参仍整体覆盖、不双写），`sqlite-pragmas` 与 `repository-user` 的 6 个站点从「重试无现场」变为可观测；`SQLITE_PRAGMA_BOOT` 开 `equal` 抖动——7 个 worker 同时切 WAL 的重试拍错开（文件头实测首轮 3/8 撞 `SQLITE_BUSY`），对应规范 08 §8.10 第③条。
