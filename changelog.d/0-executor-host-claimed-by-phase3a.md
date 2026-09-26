## Added

- **P3 §5 第 2 期 · Phase 3-A：`task.claimedBy` 归属列 + 队列领取 SQL（不接线）**：按 ADR §6/§7 的 3-A scope 落「灰度期 inline/host 互斥」的数据地基——本 PR **不接 host 主循环、不接 tRPC**（3-B 单独 PR），行为零变化。
  - `src/server/db/schema.ts`：`task` 表新增 nullable `claimedBy`（`'inline' | 'host'`，NULL 归 inline，历史行免 backfill）+ 独立索引 `task_claimed_by_idx (status, claimedBy)`。索引刻意不与 `task_status_finished_idx` 合并：那条服务孤儿判决 `(status, finishedAt)`、本条服务领取谓词 `(status, claimedBy)`，语义分离。
  - `src/lib/core/repository-task-impl.ts`：第 13 个方法 `claimNextQueued(mode, take)`——单语句 `UPDATE ... SET status='RUNNING', claimedBy=mode WHERE id IN (SELECT ... ORDER BY createdAt LIMIT ?) RETURNING id`，原子性由 SQLite 单写语句（子查询同语句求值）保证。归属谓词按 ADR §6：host 只领 `'host'`，inline 领 NULL 与 `'inline'`，领取时把 NULL 覆写成显式归属。**不用 `db.transaction` 先 SELECT 后 UPDATE**：该形态在共享 impl 的同步测试宿主（better-sqlite3）上于 continuation 之前就 COMMIT、原子性静默失效，且 drizzle-orm 0.45.2 的 libsql session 忽略 `behavior` 配置项（`BEGIN IMMEDIATE` 无法在 drizzle 层表达）。
  - 契约测 5 条（`repository-task-impl.test.ts`）：host/inline 归属谓词、NULL 覆写、FIFO+take 截断、非 QUEUED 不领、空手而归零副作用；`tests/helpers/test-db.ts` 手写 DDL 镜像同步补列。
  - `pnpm db:push` 已落本地库（列 + 索引经 `pragma_table_info` / `sqlite_master` 真数确认）。
