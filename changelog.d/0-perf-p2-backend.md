## Fixed

- 合规债 P2 后端两项：
  - `src/app/api/health/route.ts` 不再直接 import `db` + `drizzle-orm`（§1.10），探活改调 `src/server/db.ts` 新增的 `pingDatabase()`，行为与原 `SELECT 1` 一致。
  - `repository-user` 的 `RemoteModelRepository.replaceAll` 由「循环内逐条 update/insert」改为单条语句批量 upsert（以唯一索引 `remoteModel_name_uniq` 作为 `onConflictDoUpdate` 目标），继承既有 `workshopAdapters` 的行为不变。
  - 配套：`health` 路由测试的 `~/server/db` mock 补上 `pingDatabase` 出口。
  - 说明：未改成事务——测试基建跑 better-sqlite3（同步驱动）不接受 async 事务回调，且原实现本就非原子，故只做批量化、不改原子性语义。
