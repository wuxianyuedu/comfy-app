## Changed

- **给高频查询补齐 SQLite 索引（性能）**：`src/server/db/schema.ts` 新增 4 条索引，
  `pnpm db:push` 已落本地库并二次校验「schema 已收敛」。`better-sqlite3` 是同步驱动，
  单进程 Next server 共享一个事件循环——任一次缺索引的全表扫都会卡住所有并发请求与轮询，
  所以这几条是「一处慢查询拖全局」的直接治理：
  - `taskimage_task_idx (taskImage.taskId)`：`task.list`/history 每次带 `includeImages`
    都按 `taskId IN(...)` 回表，产物行随任务增长，此前无索引 → 近全表扫。
  - `task_status_finished_idx (task.status, task.finishedAt)`：状态过滤与 reaper 扫陈旧
    `QUEUED/RUNNING`；复合索引最左前缀同时覆盖纯 status 过滤，并让按 `finishedAt` 收敛走索引。
  - `task_prompt_id_idx (task.promptId)`：执行器对账 / history 按 `promptId` 反查 task。
  - `wt_user_created_idx (workflowTemplate.userId, createdAt)`：`workflow.list` 的
    `listForUser` 按 userId 过滤 + `createdAt desc` 排序，此前仅有 `wt_user_idx` 单列，
    仍需整段临时 B-tree 排序。
  实测 `EXPLAIN QUERY PLAN` 四条查询均从 `SCAN`/`USE TEMP B-TREE` 转为 `SEARCH ... USING INDEX`。
  `db.sqlite` 属运行期数据（gitignore），分支仅含 schema 变更；其他检出经各自 `db:push`
  或启动链路收敛。
